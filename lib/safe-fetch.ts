import { lookup } from 'dns/promises';

/**
 * Guarda anti-SSRF (Server-Side Request Forgery).
 *
 * Várias rotas baixam uma URL fornecida pelo usuário (lipsync, separador de
 * áudio, avatar-visual-match). Sem proteção, um usuário pago pode apontar
 * essa URL pro endpoint de METADADOS da nuvem (http://169.254.169.254/...)
 * ou pra um serviço interno (localhost, IPs da rede privada) e fazer o
 * servidor buscar/streamar segredos de infraestrutura de volta.
 *
 * ESTRATÉGIA (escolhida pra NÃO quebrar fornecedor legítimo):
 *   - NÃO usamos allowlist rígida de domínios (que esqueceria um host válido).
 *   - Em vez disso, resolvemos o DNS do host e BLOQUEAMOS se QUALQUER IP
 *     resolvido cair em faixa privada/loopback/link-local/reservada.
 *   - Revalidamos a cada redirect (defesa contra "host público que redireciona
 *     pra IP interno" e contra DNS-rebinding básico).
 *
 * Resultado: qualquer host PÚBLICO (fal, Supabase, Drive, etc) passa; só os
 * destinos internos — que nenhum fluxo legítimo usa — são barrados.
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/** Converte "a.b.c.d" em inteiro 32-bit, ou null se não for IPv4 válido. */
function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inV4Range(ipInt: number, cidrBase: string, bits: number): boolean {
  const baseInt = ipv4ToInt(cidrBase)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** True se o IPv4 for privado / loopback / link-local / reservado. */
function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return (
    inV4Range(n, '0.0.0.0', 8) || // "this" network
    inV4Range(n, '10.0.0.0', 8) || // privada
    inV4Range(n, '100.64.0.0', 10) || // CGNAT
    inV4Range(n, '127.0.0.0', 8) || // loopback
    inV4Range(n, '169.254.0.0', 16) || // link-local (METADADOS da nuvem!)
    inV4Range(n, '172.16.0.0', 12) || // privada
    inV4Range(n, '192.0.0.0', 24) || // IETF
    inV4Range(n, '192.168.0.0', 16) || // privada
    inV4Range(n, '198.18.0.0', 15) || // benchmarking
    inV4Range(n, '224.0.0.0', 4) || // multicast
    inV4Range(n, '240.0.0.0', 4) // reservado
  );
}

/** True se o IPv6 for loopback / ULA / link-local / unspecified / multicast. */
function isPrivateV6(ip: string): boolean {
  const a = ip.toLowerCase().split('%')[0]; // tira zone id (fe80::1%eth0)
  if (a === '::1' || a === '::') return true;
  // IPv4 mapeado (::ffff:1.2.3.4) — decodifica e checa como v4
  const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateV4(mapped[1]);
  if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb'))
    return true; // fe80::/10 link-local
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // fc00::/7 ULA
  if (a.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

/**
 * Valida que `rawUrl` é http(s) e que NENHUM IP resolvido do host é interno.
 * Lança SsrfError se for inseguro. Use ANTES de qualquer fetch de URL vinda
 * do usuário.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError('URL inválida.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError(`Protocolo não permitido (${u.protocol}).`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // tira colchetes de IPv6

  // Se o host JÁ é um IP literal, checa direto (sem DNS).
  if (ipv4ToInt(host) !== null) {
    if (isPrivateV4(host)) throw new SsrfError('Destino interno bloqueado.');
    return;
  }
  if (host.includes(':')) {
    if (isPrivateV6(host)) throw new SsrfError('Destino interno bloqueado.');
    return;
  }

  // Hostname → resolve TODOS os endereços e barra se algum for interno.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfError('Falha ao resolver o host.');
  }
  if (addrs.length === 0) throw new SsrfError('Host sem endereço.');
  for (const a of addrs) {
    const bad = a.family === 6 ? isPrivateV6(a.address) : isPrivateV4(a.address);
    if (bad) throw new SsrfError('Destino interno bloqueado.');
  }
}

/**
 * fetch() seguro: valida a URL inicial e CADA salto de redirect contra
 * destinos internos. Drop-in pra `fetch(url, init)` em rotas que baixam
 * URLs do usuário. Mantém o seguir-redirect (Drive/CDN usam) mas barra
 * redirect → IP interno.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  opts?: { maxRedirects?: number },
): Promise<Response> {
  const maxRedirects = opts?.maxRedirects ?? 5;
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicHttpUrl(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res; // 3xx sem Location — devolve como veio
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new SsrfError('Redirects demais.');
}
