/**
 * doc-to-disparos — leitura de briefings DARKO LAB direto no HeyGen Auto,
 * com a MESMA inteligencia do ClickUp Pilot (sem precisar do ClickUp).
 *
 * Entrada: texto bruto de um Google Docs (link exportado em txt OU arquivo
 * .txt/.docx) + a lista de avatares da biblioteca HeyGen do user.
 *
 * Saida: 1+ "disparos" (cada AD encontrado no doc vira um disparo). Cada
 * disparo ja vem com as partes resolvidas (HOOK 1, HOOK 2, BODY, ...) +
 * texto sanitizado + avatarId casado por role/voz. Isso e EXATAMENTE o que
 * o dispatchPlan do clickup-pilot produz — aqui so reaproveitamos as funcoes
 * puras do copy-parser e replicamos a heuristica de pickAvatarForText.
 *
 * Importante: ZERO dependencia de React/DOM. Testavel isolado (ver
 * lib/doc-to-disparos.test.ts).
 */

import {
  parseAdSection,
  parseAvatars,
  parseParts,
  parseDarkoBriefing,
  matchAvatar,
  type ParsedDarkoBriefing,
} from './copy-parser';
import { splitCopyIntoParts } from './heygen-extension-bridge';

/** Candidato de avatar da biblioteca HeyGen (flat) — igual ao usado no
 *  clickup-pilot (avatarCandidates). */
export type AvatarCandidate = {
  id: string;
  name: string;
  groupName?: string;
  voiceName?: string | null;
  voiceId?: string | null;
  thumb?: string | null;
};

export type DisparoPart = {
  /** "HOOK 1", "HOOK 2", "BODY", "BODY 2", ... */
  label: string;
  /** Texto que vai pro TTS (ja sanitizado) */
  text: string;
  /** Avatar HeyGen casado (null = nao achou) */
  avatarId: string | null;
  avatarName: string | null;
  /** Voz override (vem do avatar casado, se houver) */
  voiceId: string | null;
};

export type DiscoveredDisparo = {
  /** Base AD ID detectado (ex "AD139GL"). Vira prefixo dos arquivos. */
  baseAdId: string;
  /** Nome "safe" pra arquivo (so [a-z0-9_-]) */
  safeName: string;
  /** Partes prontas pra dispatch */
  parts: DisparoPart[];
  /** Avatares do briefing que NAO casaram com a biblioteca (debug/UI) */
  unmatchedAvatars: string[];
  /** True quando veio do parser DARKO (G[N]=Hook[N]); false = parser legado */
  fromDarkoBriefing: boolean;
};

export type DiscoverResult = {
  disparos: DiscoveredDisparo[];
  /** AD ids brutos encontrados no doc (debug) */
  detectedAdIds: string[];
  /** Mensagem de diagnostico amigavel quando nada foi encontrado */
  diagnostic: string;
};

const AD_HEADING_RE = /^AD\d+[A-Z0-9]*\s*-\s*[A-Z0-9]+/i;
/** Token AD no inicio da linha (com ou sem sufixo " - XXX") */
const AD_TOKEN_RE = /^(AD\d+[A-Z0-9]*)/i;

/** Normaliza um token AD pro seu BASE id removendo o infixo G<N> dos siblings.
 *  "AD139G1GL" -> "AD139GL" · "AD139GL" -> "AD139GL" · "AD23G2VN" -> "AD23VN". */
export function toBaseAdId(token: string): string {
  return token.toUpperCase().replace(/G\d+/, '');
}

/** Descobre TODOS os base AD ids presentes em headings do doc, em ordem de
 *  aparicao e sem duplicar. So considera linhas que casam o formato de
 *  heading "AD<num><sufixo> - XXX". */
export function discoverBaseAdIds(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!AD_HEADING_RE.test(line)) continue;
    const m = line.match(AD_TOKEN_RE);
    if (!m) continue;
    const base = toBaseAdId(m[1]);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

/** Constroi o mapa role->avatar + lista de nao-casados, identico ao
 *  clickup-pilot (matchAvatar score >= 30). */
function buildAvatarMatch(
  avatars: Array<{ role: string; username: string }>,
  candidates: AvatarCandidate[],
): {
  matchedByRole: Record<string, { id: string; name: string; voiceId: string | null }>;
  unmatched: string[];
} {
  const matchedByRole: Record<string, { id: string; name: string; voiceId: string | null }> = {};
  const unmatched: string[] = [];
  for (const av of avatars) {
    const m = matchAvatar(av.username, candidates);
    if (m && m.score >= 30) {
      const cand = candidates.find((c) => c.id === m.id);
      matchedByRole[av.role.toLowerCase()] = {
        id: m.id,
        name: m.name,
        voiceId: cand?.voiceId ?? null,
      };
    } else {
      unmatched.push(`${av.role}: @${av.username}`);
    }
  }
  return { matchedByRole, unmatched };
}

/** Escolhe avatar pra um trecho — MESMA prioridade do clickup-pilot:
 *  1) role detectado pelo parser (match exato, depois fuzzy)
 *  2) label contem um role conhecido
 *  3) primeiras 2 linhas do texto contem um role
 *  4) fallback: primeiro avatar casado. */
function makePicker(
  matchedByRole: Record<string, { id: string; name: string; voiceId: string | null }>,
) {
  const firstMatched = Object.values(matchedByRole)[0] || null;
  return function pick(
    text: string,
    label: string,
    detectedRole: string | null = null,
  ): { id: string; name: string; voiceId: string | null } | null {
    if (detectedRole) {
      const dr = detectedRole.toLowerCase().trim();
      if (matchedByRole[dr]) return matchedByRole[dr];
      for (const role of Object.keys(matchedByRole)) {
        if (role === dr || role.includes(dr) || dr.includes(role)) return matchedByRole[role];
      }
    }
    const labelLower = label.toLowerCase();
    for (const role of Object.keys(matchedByRole)) {
      if (labelLower.includes(role.toLowerCase())) return matchedByRole[role];
    }
    const firstLines = text.split(/\r?\n/).slice(0, 2).join(' ').toLowerCase();
    for (const role of Object.keys(matchedByRole)) {
      if (firstLines.includes(role.toLowerCase())) return matchedByRole[role];
    }
    return firstMatched;
  };
}

/** Monta as partes de um disparo a partir de um briefing DARKO ja parseado.
 *  Replica fielmente a logica de planParts do clickup-pilot (hooks na ordem,
 *  body segmentado por speaker + split por tempo). */
function partsFromBriefing(
  briefing: ParsedDarkoBriefing,
  candidates: AvatarCandidate[],
): { parts: DisparoPart[]; unmatched: string[] } {
  const { matchedByRole, unmatched } = buildAvatarMatch(briefing.avatars, candidates);
  const pick = makePicker(matchedByRole);
  const parts: DisparoPart[] = [];

  for (const h of briefing.hooks) {
    const av = pick(h.text, h.label, h.role);
    parts.push({
      label: h.label,
      text: h.text,
      avatarId: av?.id || null,
      avatarName: av?.name || null,
      voiceId: av?.voiceId ?? null,
    });
  }

  const bodySegs =
    briefing.bodySegments && briefing.bodySegments.length > 0
      ? briefing.bodySegments
      : briefing.body
        ? [{ role: briefing.bodyRole, text: briefing.body }]
        : [];
  const totalSegs = bodySegs.length;
  for (let si = 0; si < bodySegs.length; si++) {
    const seg = bodySegs[si];
    const segParts = splitCopyIntoParts(seg.text, { targetSec: 20, minSec: 10, maxSec: 35 });
    for (let pi = 0; pi < segParts.length; pi++) {
      const label =
        totalSegs === 1 && segParts.length === 1
          ? 'BODY'
          : totalSegs === 1
            ? `BODY ${pi + 1}`
            : segParts.length === 1
              ? `BODY ${si + 1}`
              : `BODY ${si + 1}.${pi + 1}`;
      const av = pick(segParts[pi], label, seg.role);
      parts.push({
        label,
        text: segParts[pi],
        avatarId: av?.id || null,
        avatarName: av?.name || null,
        voiceId: av?.voiceId ?? null,
      });
    }
  }

  return { parts, unmatched };
}

function safeNameOf(s: string): string {
  return (s.trim() || 'heygen').replace(/[^a-z0-9_-]/gi, '_');
}

/**
 * Constroi um disparo pra um base AD especifico. Tenta o parser DARKO
 * (G[N]=Hook[N]); se nao houver hooks/body, cai pro parser legado
 * (parseAdSection — parts auto-detectadas). Retorna null se nada parseavel.
 */
export function buildDisparoForAd(
  text: string,
  baseAdId: string,
  candidates: AvatarCandidate[],
): DiscoveredDisparo | null {
  // 1) Parser DARKO LAB (preferido)
  const briefing = parseDarkoBriefing(text, baseAdId);
  if (briefing && (briefing.hooks.length > 0 || briefing.body)) {
    const { parts, unmatched } = partsFromBriefing(briefing, candidates);
    if (parts.length > 0) {
      return {
        baseAdId: briefing.baseAdId || baseAdId,
        safeName: safeNameOf(briefing.baseAdId || baseAdId),
        parts,
        unmatchedAvatars: unmatched,
        fromDarkoBriefing: true,
      };
    }
  }

  // 2) Parser legado (secao com avatares + parts auto-detectadas)
  const legacy = parseAdSection(text, baseAdId);
  if (legacy && legacy.parts.length > 0) {
    const { matchedByRole, unmatched } = buildAvatarMatch(legacy.avatars, candidates);
    const pick = makePicker(matchedByRole);
    const parts: DisparoPart[] = legacy.parts.map((p) => {
      const av = pick(p.text, p.label);
      return {
        label: p.label,
        text: p.text,
        avatarId: av?.id || null,
        avatarName: av?.name || null,
        voiceId: av?.voiceId ?? null,
      };
    });
    return {
      baseAdId: legacy.adId || baseAdId,
      safeName: safeNameOf(legacy.adId || baseAdId),
      parts,
      unmatchedAvatars: unmatched,
      fromDarkoBriefing: false,
    };
  }

  return null;
}

/**
 * Ponto de entrada principal: descobre TODOS os ADs do doc e monta um
 * disparo pra cada um (a "fila"). Quando `onlyBaseAdId` e passado, restringe
 * a esse AD (modo single, equivalente ao handoff do clickup-pilot).
 */
export function buildDisparosFromDoc(
  text: string,
  candidates: AvatarCandidate[],
  opts: { onlyBaseAdId?: string } = {},
): DiscoverResult {
  if (!text || !text.trim()) {
    return { disparos: [], detectedAdIds: [], diagnostic: 'Doc vazio — cole/importe a copy.' };
  }

  let bases = opts.onlyBaseAdId ? [toBaseAdId(opts.onlyBaseAdId)] : discoverBaseAdIds(text);

  // Sem headings AD reconheciveis: trata o doc inteiro como 1 copy unica.
  // Util pra copy colada crua (sem nomenclatura). parseParts SEMPRE descarta a
  // 1a linha (assume header AD), entao prefixamos um header sintetico pra que
  // o conteudo real seja preservado. Avatares vem de parseAvatars no texto cru.
  if (bases.length === 0) {
    const avatars = parseAvatars(text);
    const partsParsed = parseParts(`COPY-IMPORTADA\n${text}`);
    if (partsParsed.length > 0) {
      const { matchedByRole, unmatched } = buildAvatarMatch(avatars, candidates);
      const pick = makePicker(matchedByRole);
      const parts: DisparoPart[] = partsParsed.map((p) => {
        const av = pick(p.text, p.label);
        return {
          label: p.label,
          text: p.text,
          avatarId: av?.id || null,
          avatarName: av?.name || null,
          voiceId: av?.voiceId ?? null,
        };
      });
      return {
        disparos: [
          {
            baseAdId: 'COPY',
            safeName: 'copy',
            parts,
            unmatchedAvatars: unmatched,
            fromDarkoBriefing: false,
          },
        ],
        detectedAdIds: [],
        diagnostic: 'Sem nomenclatura AD — tratei o doc como 1 copy unica.',
      };
    }
    return {
      disparos: [],
      detectedAdIds: [],
      diagnostic:
        'Nao achei nenhum heading "AD<num> - XXX" nem copy reconhecivel. Confere se colou o doc certo.',
    };
  }

  const disparos: DiscoveredDisparo[] = [];
  for (const base of bases) {
    const d = buildDisparoForAd(text, base, candidates);
    if (d) disparos.push(d);
  }

  return {
    disparos,
    detectedAdIds: bases,
    diagnostic:
      disparos.length > 0
        ? `${disparos.length} AD(s) prontos pra fila.`
        : `Headings detectados (${bases.join(', ')}) mas nenhum tinha HOOK/BODY parseavel.`,
  };
}
