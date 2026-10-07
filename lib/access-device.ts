/**
 * Identidade do APARELHO pro histórico de acesso (migration 037).
 *
 * aparelho = um navegador com armazenamento próprio. O id mora no
 * localStorage, então todas as abas do mesmo navegador mandam o MESMO id —
 * é isso que impede "duas abas" de virar "acesso simultâneo".
 *
 * A impressão de MÁQUINA (machineFingerprint) só usa o que é igual entre
 * navegadores do mesmo computador (sistema, tela, núcleos, fuso). Ela serve
 * pra um único fim: no mesmo IP, separar "janela anônima / outro navegador
 * no mesmo PC" de "outro computador na mesma rede".
 *
 * Este arquivo roda nos dois lados: parseUserAgent no servidor (heartbeat) e
 * no cliente (pra impressão de máquina); o resto só no navegador.
 */

export type DeviceKind = 'desktop' | 'mobile' | 'tablet';

export type UaInfo = {
  browser: string | null;
  os: string | null;
  kind: DeviceKind | null;
};

/** Lê navegador, sistema e tipo de aparelho do User-Agent. Sem dependência. */
export function parseUserAgent(ua: string | null | undefined, touchPoints = 0): UaInfo {
  if (!ua) return { browser: null, os: null, kind: null };
  const s = ua;

  let browser: string | null = null;
  if (/EdgiOS\//.test(s) || /Edg(e|A)?\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera|OPT\//.test(s)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet';
  else if (/YaBrowser\//.test(s)) browser = 'Yandex';
  else if (/Vivaldi\//.test(s)) browser = 'Vivaldi';
  else if (/Electron\//.test(s)) browser = 'App desktop';
  else if (/FxiOS\/|Firefox\//.test(s)) browser = 'Firefox';
  else if (/CriOS\/|Chrome\/|Chromium\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';
  else if (/Safari\//.test(s)) browser = 'Safari';

  let os: string | null = null;
  if (/Windows NT|Windows/.test(s)) os = 'Windows';
  else if (/iPhone|iPod/.test(s)) os = 'iOS';
  else if (/iPad/.test(s)) os = 'iPadOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(s)) os = touchPoints > 1 ? 'iPadOS' : 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let kind: DeviceKind = 'desktop';
  if (os === 'iPadOS' || /Tablet/.test(s) || (os === 'Android' && !/Mobile/.test(s))) kind = 'tablet';
  else if (/Mobi|iPhone|iPod/.test(s) || os === 'Android') kind = 'mobile';

  return { browser, os, kind };
}

/** "Chrome · Windows" — rótulo curto pro painel. */
export function deviceLabel(browser: string | null | undefined, os: string | null | undefined): string {
  const parts = [browser, os].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length ? parts.join(' · ') : 'Aparelho desconhecido';
}

/** Id válido vindo do cliente (o servidor rejeita qualquer outra coisa). */
export function isValidDeviceId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_.:-]{8,80}$/.test(v);
}

export function isValidFingerprint(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(v);
}

/** FNV-1a de 32 bits, duas sementes = 64 bits em hex. Não é cripto: só agrupa. */
export function hash64(text: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return fnv(0x811c9dc5) + fnv(0x9747b28c);
}

/** Partes da impressão de máquina. Tela entra ordenada (girar o celular não
 *  muda a máquina). Navegador NÃO entra: Chrome e Edge do mesmo PC batem. */
export function machineFingerprintFrom(parts: {
  os: string | null;
  screenW: number;
  screenH: number;
  availW: number;
  availH: number;
  colorDepth: number;
  cores: number;
  timeZone: string;
  touchPoints: number;
}): string {
  const [sMin, sMax] = [parts.screenW, parts.screenH].sort((a, b) => a - b);
  const [aMin, aMax] = [parts.availW, parts.availH].sort((a, b) => a - b);
  return (
    'm' +
    hash64(
      [
        parts.os ?? '?',
        `${sMin}x${sMax}`,
        `${aMin}x${aMax}`,
        parts.colorDepth,
        parts.cores,
        parts.timeZone,
        parts.touchPoints,
      ].join('|'),
    )
  );
}

/* ───────────── Só no navegador ───────────── */

const DEVICE_KEY = 'ae_device_id';
let memoFp: string | null = null;

/** Impressão de máquina do navegador atual (calculada uma vez por aba). */
export function getMachineFingerprint(): string | null {
  if (typeof window === 'undefined') return null;
  if (memoFp) return memoFp;
  try {
    const touch = navigator.maxTouchPoints || 0;
    memoFp = machineFingerprintFrom({
      os: parseUserAgent(navigator.userAgent, touch).os,
      screenW: screen.width,
      screenH: screen.height,
      availW: screen.availWidth,
      availH: screen.availHeight,
      colorDepth: screen.colorDepth,
      cores: navigator.hardwareConcurrency || 0,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      touchPoints: touch,
    });
    return memoFp;
  } catch {
    return null;
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* segue pro fallback */
  }
  return 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Id do aparelho. Lido do localStorage A CADA ping (nada em memória): se uma
 * aba regenerar o id, as outras pegam o mesmo no ping seguinte.
 * Sem localStorage (bloqueado), cai numa impressão estável do navegador —
 * igual entre abas, então duas abas continuam sendo um aparelho só.
 */
export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const cur = window.localStorage.getItem(DEVICE_KEY);
    if (isValidDeviceId(cur)) return cur;
    const id = newId();
    window.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    const fp = getMachineFingerprint();
    if (!fp) return null;
    return 'fp-' + hash64(fp + '|' + navigator.userAgent + '|' + (navigator.language || ''));
  }
}
