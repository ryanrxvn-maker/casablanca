/**
 * Copy do avatar no modo CREATOR do Pilot: caixas separadas de HOOK (0..10) e
 * BODY, convertidas nos `partTemplates` que o disparo e a montagem já leem.
 *
 * O modelo é o da montagem (lib/clickup-pilot-pipeline.ts): UM vídeo por
 * HOOK n (G1, G2...), todos com o MESMO body; sem hook, um vídeo só com o
 * body ("full body"). Por isso o número do hook é global na task — dois
 * avatares com hooks continuam a numeração, não recomeçam.
 *
 * Puro: o corte do body em takes (~20s) entra por parâmetro, então isto roda
 * em teste sem navegador.
 */

export const MAX_HOOKS = 10;

export type CopyDoAvatar = {
  /** um gancho por caixa; vazio = full body */
  hooks: string[];
  body: string;
};

export type ParteDaCopy = {
  label: string;
  text: string;
  matchByRole: string | null;
  speaker?: string | null;
};

export function copyVazia(): CopyDoAvatar {
  return { hooks: [''], body: '' };
}

const HOOK_RE = /^(?:HOOK|GANCHO)\s*(\d+)/i;
const BODY_RE = /^(?:BODY|PARTE|CORPO)\s*(\d+)?/i;

export function ehHook(label: string): boolean {
  return HOOK_RE.test(label.trim());
}

/** Maior número usado nos labels de `partes` que casam com `re`. */
function maiorNumero(partes: ParteDaCopy[], re: RegExp): number {
  let mx = 0;
  for (const p of partes) {
    const m = re.exec((p.label || '').trim());
    if (m && m[1]) mx = Math.max(mx, parseInt(m[1], 10));
  }
  return mx;
}

export type ProblemaDaCopy = 'sem-texto' | 'hooks-demais';

/** O que impede de virar takes. Hook em branco não é problema: é descartado. */
export function problemaDaCopy(copy: CopyDoAvatar): ProblemaDaCopy | null {
  const hooks = copy.hooks.map((h) => h.trim()).filter(Boolean);
  if (hooks.length > MAX_HOOKS) return 'hooks-demais';
  if (hooks.length === 0 && !copy.body.trim()) return 'sem-texto';
  return null;
}

/**
 * Copy do avatar → partes DESTE avatar. `outros` são as partes dos demais
 * avatares (mantidas pelo chamador): a numeração de HOOK/BODY continua depois
 * delas pra não colidir. O body é cortado por `cortarBody` (a mesma regra da
 * análise: ~20s, sem quebrar frase).
 */
export function partesDaCopy(
  copy: CopyDoAvatar,
  role: string,
  outros: ParteDaCopy[],
  cortarBody: (texto: string) => string[],
): ParteDaCopy[] {
  const roleLc = role.toLowerCase();
  const hooks = copy.hooks.map((h) => h.replace(/\r\n/g, '\n').trim()).filter(Boolean).slice(0, MAX_HOOKS);
  const body = copy.body.replace(/\r\n/g, '\n').trim();
  let hookN = maiorNumero(outros, HOOK_RE);
  let bodyN = maiorNumero(outros, BODY_RE);
  const out: ParteDaCopy[] = [];
  for (const h of hooks) {
    hookN += 1;
    out.push({ label: `HOOK ${hookN}`, text: h, matchByRole: roleLc, speaker: role });
  }
  if (body) {
    for (const pedaco of cortarBody(body)) {
      const t = pedaco.trim();
      if (!t) continue;
      bodyN += 1;
      out.push({ label: `BODY ${bodyN}`, text: t, matchByRole: roleLc, speaker: role });
    }
  }
  return out;
}

/**
 * Inverso: das partes que já são deste avatar, remonta as caixas (pra editar
 * de novo sem perder o que foi colado). Takes de body voltam como parágrafos.
 */
export function copyDasPartes(partesDoAvatar: ParteDaCopy[]): CopyDoAvatar {
  const hooks = partesDoAvatar.filter((p) => ehHook(p.label)).map((p) => p.text);
  const body = partesDoAvatar
    .filter((p) => !ehHook(p.label))
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join('\n\n');
  return { hooks: hooks.length ? hooks : [''], body };
}

/** Quantos vídeos a montagem vai produzir com estas partes (todas as do AD). */
export function videosDaMontagem(partes: ParteDaCopy[]): number {
  const hooks = partes.filter((p) => ehHook(p.label)).length;
  if (hooks > 0) return hooks;
  return partes.length > 0 ? 1 : 0;
}
