/**
 * Aviso/propaganda → e-mail (parte PURA). Decide o template, as cores, as
 * imagens e os links absolutos a partir do mesmo conteúdo da janela.
 *
 * "Também por e-mail" (botão do envelope): template automático —
 *   aviso → Comunicado · propaganda com a cena do Pilot → Lançamento (com o
 *   quadro do herói) · propaganda → Oferta (imagem enviada ou arte do tema).
 * Modelo "E-mail" da central: o admin escolhe o template (content.mail).
 */

import {
  matchesAudience,
  normalizeEmail,
  TONE_META,
  timeLeft,
  type AnnKind,
  type AnnContent,
  type Audience,
  type AvisoContent,
  type AvisoTone,
  type PromoContent,
  type PromoTheme,
  type Viewer,
} from './announcements';
import type { EmailMessage, EmailTemplate } from './email-templates';

export const THEME_HEX: Record<PromoTheme, string> = {
  violeta: '#A291E0',
  lima: '#C8D684',
  ciano: '#7ED5E2',
  ambar: '#EBC860',
  rosa: '#E084B0',
};

export const TONE_HEX: Record<AvisoTone, string> = {
  info: '#7ED5E2',
  novidade: '#A291E0',
  sucesso: '#C8D684',
  atencao: '#EBC860',
  urgente: '#E85C68',
};

/** Arte do tema e quadro do Pilot (public/email/*, mesmas peças da janela). */
export function emailArtUrl(site: string, theme: PromoTheme): string {
  return `${site}/email/arte-${theme}.jpg`;
}
export function pilotHeroUrl(site: string): string {
  return `${site}/email/pilot-hero.jpg`;
}

/** "/planos" → "https://site/planos"; https fica; qualquer outra coisa some. */
export function absoluteUrl(u: string | undefined | null, site: string): string {
  const s = (u ?? '').trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return `${site}${s}`;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** Template automático do "também por e-mail". */
export function autoTemplate(kind: AnnKind, content: AnnContent): EmailTemplate {
  if (kind === 'aviso') return 'comunicado';
  return (content as PromoContent).art === 'pilot' ? 'lancamento' : 'oferta';
}

/* ───────────────────────── Quem recebe ───────────────────────── */

/** `key` = posição fixa na fila (ordem de cadastro) — é o que o marcador de envio guarda. */
export type Recipient = { id: string; email: string; name: string | null; key: string };
export type Person = { viewer: Viewer; name: string | null; createdAt: string };

/** Chave de ordem que compara como texto: data de cadastro (ms, 15 dígitos) + id. */
export function orderKey(createdAt: string, id: string): string {
  const ms = Math.max(0, Date.parse(createdAt) || 0);
  return `${String(ms).padStart(15, '0')}|${id}`;
}

/** Quem ainda não recebeu nesta ativação: tudo DEPOIS do marcador. */
export function afterCursor(list: Recipient[], cursor: string | null): Recipient[] {
  return cursor ? list.filter((r) => r.key > cursor) : list;
}

/**
 * Mesma regra de público da janela (matchesAudience: conta ativa, plano,
 * e-mails avulsos, admins se pedido) + e-mail válido, sem repetir e-mail e
 * sem quem pediu pra sair. Ordem de CADASTRO: quem entra depois vai pro fim,
 * então os lotes já enviados não mudam numa retomada.
 */
export function pickRecipients(people: Person[], audience: Audience, optOut: Set<string>): { list: Recipient[]; optOut: number } {
  const sorted = [...people].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.viewer.id.localeCompare(b.viewer.id));
  const seen = new Set<string>();
  const list: Recipient[] = [];
  let out = 0;
  for (const p of sorted) {
    const email = normalizeEmail(p.viewer.email);
    if (!email || !matchesAudience(audience, p.viewer)) continue;
    if (optOut.has(p.viewer.id)) {
      out++;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    list.push({ id: p.viewer.id, email, name: p.name, key: orderKey(p.createdAt, p.viewer.id) });
  }
  return { list, optOut: out };
}

/** "Maria Clara Souza" → "Maria" (saudação do e-mail); vazio/esquisito → null. */
export function firstName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim().split(/\s+/)[0] ?? '';
  if (!n || n.length > 24 || /[@\d]/.test(n)) return null;
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/**
 * Chave de idempotência de um lote = aviso + ativação + quem está nele (1º e
 * último). Clique duplo / duas abas montam o MESMO lote a partir do mesmo
 * marcador → mesma chave → o Resend não manda duas vezes (vale 24 h; depois
 * disso quem protege é o marcador).
 */
export function batchKey(annId: string, activatedAt: string, slice: Pick<Recipient, 'id'>[]): string {
  const first = slice[0]?.id ?? '';
  const last = slice[slice.length - 1]?.id ?? '';
  return `ann-${annId}-${Date.parse(activatedAt) || 0}-${first}-${last}-${slice.length}`;
}

/**
 * Plano grátis do Resend: 100 e-mails por dia, e a cota é a MESMA dos códigos
 * de cadastro e de senha. O disparo para guardando FREE_RESERVE pro dia —
 * senão quem se cadastra depois fica sem código até a meia-noite UTC.
 */
export const FREE_DAILY = 100;
export const FREE_RESERVE = 20;

/** Dia da cota do Resend (vira à meia-noite UTC = 21h de Brasília). */
export function utcDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

/**
 * Uso do dia ESTIMADO depois de um lote. O cabeçalho x-resend-daily-quota
 * ATRASA (10.10: dizia 88 com 228 já aceitos — a trava confiou nele e a cota
 * do dia estourou, travando os códigos de cadastro até as 21h). Então a conta
 * é nossa: nunca menos que o estimado antes + o que acabou de ser aceito.
 * Sem estimativa do mesmo dia, supõe que o cabeçalho ainda NÃO contou este lote.
 *   header null = não veio cabeçalho (rede) → segue a estimativa;
 *   header.daily null = plano sem limite diário (pago) → sem limite.
 */
export function nextQuota(
  before: { daily: number | null; monthly: number | null; at: string } | null,
  header: { daily: number | null; monthly: number | null; at: string } | null,
  accepted: number,
  now: string,
): { daily: number | null; monthly: number | null; at: string } | null {
  const same = before && utcDay(before.at) === utcDay(now) ? before : null;
  if (!header) {
    if (!same || same.daily === null) return same ? { ...same, at: now } : null;
    return { daily: same.daily + accepted, monthly: same.monthly === null ? null : same.monthly + accepted, at: now };
  }
  const monthly = header.monthly === null ? null : Math.max(header.monthly, (same?.monthly ?? header.monthly) + accepted);
  if (header.daily === null) return { daily: null, monthly, at: now };
  const daily = Math.max(header.daily, (same?.daily ?? header.daily) + accepted);
  return { daily, monthly, at: now };
}

/** Quantos ainda dá pra mandar hoje sem comer a reserva (sem limite diário = Infinity). */
export function roomToday(quota: { daily: number | null } | null): number {
  if (!quota || quota.daily === null) return Infinity;
  return Math.max(0, FREE_DAILY - FREE_RESERVE - quota.daily);
}

/**
 * Tamanho do próximo lote: o 1º de cada rodada leva 1 pessoa (lê a cota nos
 * cabeçalhos antes de mandar em massa); depois, até `max`, sem passar da folga.
 */
export function nextBatchSize(probed: boolean, room: number, max = 100): number {
  if (!probed) return Math.min(1, room);
  return Math.max(0, Math.min(max, room));
}

function excerpt(s: string, max = 140): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

export function emailFromAnnouncement(
  a: { kind: AnnKind; content: AnnContent; endsAt?: string | null },
  site: string,
  now = Date.now(),
): EmailMessage {
  const left = a.endsAt ? timeLeft(a.endsAt, now) : null;
  const deadline = left ? `Termina em ${left}` : undefined;

  if (a.kind === 'aviso') {
    const c = a.content as AvisoContent;
    return {
      template: 'comunicado',
      subject: c.title,
      preheader: excerpt(c.body || c.title),
      accent: TONE_HEX[c.tone] ?? TONE_HEX.novidade,
      toneLabel: TONE_META[c.tone]?.label,
      title: c.title,
      body: c.body,
      ctaLabel: c.ctaLabel || undefined,
      ctaUrl: absoluteUrl(c.ctaUrl, site) || undefined,
      deadline,
    };
  }

  const c = a.content as PromoContent;
  const template = c.mail?.template ?? autoTemplate(a.kind, c);
  const image =
    template === 'comunicado'
      ? ''
      : c.art === 'pilot'
        ? pilotHeroUrl(site)
        : absoluteUrl(c.imageUrl, site) || emailArtUrl(site, c.theme);
  return {
    template,
    subject: c.mail?.subject || c.title,
    preheader: c.mail?.preheader || excerpt(c.body || c.title),
    accent: THEME_HEX[c.theme] ?? THEME_HEX.violeta,
    toneLabel: template === 'comunicado' ? c.badge || undefined : undefined,
    badge: template === 'comunicado' ? undefined : c.badge || undefined,
    title: c.title,
    body: c.body,
    bullets: c.bullets.filter(Boolean),
    priceOld: c.priceOld || undefined,
    priceNew: c.priceNew || undefined,
    priceNote: c.priceNote || undefined,
    ctaLabel: c.ctaLabel || undefined,
    ctaUrl: absoluteUrl(c.ctaUrl, site) || undefined,
    imageUrl: image || undefined,
    deadline,
  };
}
