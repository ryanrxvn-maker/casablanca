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
  extractVariantToken,
  matchAvatar,
  normAvatarKey,
  type ParsedDarkoBriefing,
  type DocLink,
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
  /** Role/speaker do briefing (ex "Doutor", "Mulher") — agrupa partes em
   *  slots de avatar. null quando nao ha role explicito. */
  role: string | null;
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

/** Normaliza um token AD pro seu BASE id removendo o infixo G<N> dos siblings.
 *  "AD139G1GL" -> "AD139GL" · "AD139GL" -> "AD139GL" · "AD23G2VN" -> "AD23VN". */
export function toBaseAdId(token: string): string {
  return token.toUpperCase().replace(/G\d+/, '');
}

/**
 * Extrai o base AD id de uma LINHA de heading, cobrindo as 2 convencoes
 * DARKO + removendo o infixo G<N> dos siblings:
 *   "AD139GL - VFPB04"     → "AD139GL"  (sufixo colado, variant após " - ")
 *   "AD139G1GL-VFPB04"     → "AD139GL"
 *   "AD01 - PV"            → "AD01PV"   (sufixo após " - ")
 *   "AD01G1-PV"            → "AD01PV"
 */
function baseFromHeadingLine(line: string): string | null {
  // Captura AD<num> + sufixo colado opcional + (opcional " - SUFIXO")
  const m = line.match(/^AD\d+[A-Z0-9]*(?:\s*[-–—]\s*[A-Z0-9]+)?/i);
  if (!m) return null;
  const code = m[0].toUpperCase().replace(/G\d+/, ''); // tira infixo de sibling
  return extractAdIds(code).baseAdId;
}

/** Descobre TODOS os base AD ids presentes em headings do doc, em ordem de
 *  aparicao e sem duplicar. So considera linhas que casam o formato de
 *  heading "AD<num><sufixo> - XXX". Cobre as 2 convencoes (colada e " - "). */
export function discoverBaseAdIds(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!AD_HEADING_RE.test(line)) continue;
    const base = baseFromHeadingLine(line);
    if (!base || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

/** Constroi o mapa role->avatar + lista de nao-casados, identico ao
 *  clickup-pilot (matchAvatar score >= 30). */
function buildAvatarMatch(
  avatars: Array<{ role: string; username: string; youtubeUrl?: string | null }>,
  candidates: AvatarCandidate[],
): {
  matchedByRole: Record<string, { id: string; name: string; voiceId: string | null }>;
  matchedByUsername: Record<string, { id: string; name: string; voiceId: string | null }>;
  unmatched: string[];
} {
  const matchedByRole: Record<string, { id: string; name: string; voiceId: string | null }> = {};
  const matchedByUsername: Record<string, { id: string; name: string; voiceId: string | null }> = {};
  const unmatched: string[] = [];
  for (const av of avatars) {
    // Avatar referenciado por YouTube (clone de voz): username e o video ID
    // (11 chars base64url), NAO um handle de avatar. Alimentar isso no
    // matchAvatar casa um avatar ERRADO da biblioteca por acaso (~2% das vezes
    // via token/group substring). Fica PENDENTE — o user escolhe o avatar.
    const m = av.youtubeUrl ? null : matchAvatar(av.username, candidates);
    if (m && m.score >= 30) {
      const cand = candidates.find((c) => c.id === m.id);
      const matched = { id: m.id, name: m.name, voiceId: cand?.voiceId ?? null };
      matchedByRole[av.role.toLowerCase()] = matched;
      const uk = normAvatarKey(av.username);
      if (uk) matchedByUsername[uk] = matched;
    } else {
      unmatched.push(`${av.role}: @${av.username}`);
    }
  }
  return { matchedByRole, matchedByUsername, unmatched };
}

/** Escolhe avatar pra um trecho — MESMA prioridade do clickup-pilot:
 *  0) username do segmento (chip/filename do avatar no body) — autoritativo
 *  1) role detectado pelo parser (match exato, depois fuzzy)
 *  2) label contem um role conhecido
 *  3) primeiras 2 linhas do texto contem um role
 *  4) fallback: primeiro avatar casado. */
function makePicker(
  matchedByRole: Record<string, { id: string; name: string; voiceId: string | null }>,
  matchedByUsername: Record<string, { id: string; name: string; voiceId: string | null }> = {},
) {
  const firstMatched = Object.values(matchedByRole)[0] || null;
  return function pick(
    text: string,
    label: string,
    detectedRole: string | null = null,
    username: string | null = null,
  ): { id: string; name: string; voiceId: string | null } | null {
    // 0) Avatar declarado pelo chip/filename do segmento — vence tudo.
    if (username) {
      const uk = normAvatarKey(username);
      if (uk && matchedByUsername[uk]) return matchedByUsername[uk];
    }
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
  const { matchedByRole, matchedByUsername, unmatched } = buildAvatarMatch(briefing.avatars, candidates);
  const pick = makePicker(matchedByRole, matchedByUsername);
  const parts: DisparoPart[] = [];

  for (const h of briefing.hooks) {
    const av = pick(h.text, h.label, h.role);
    parts.push({
      label: h.label,
      text: h.text,
      avatarId: av?.id || null,
      avatarName: av?.name || null,
      voiceId: av?.voiceId ?? null,
      role: h.role ?? null,
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
      const av = pick(segParts[pi], label, seg.role, (seg as any).username ?? null);
      parts.push({
        label,
        text: segParts[pi],
        avatarId: av?.id || null,
        avatarName: av?.name || null,
        voiceId: av?.voiceId ?? null,
        role: seg.role ?? null,
      });
    }
  }

  return { parts, unmatched };
}

function safeNameOf(s: string): string {
  return (s.trim() || 'heygen').replace(/[^a-z0-9_-]/gi, '_');
}

/**
 * Núcleo compartilhado: tenta o parser DARKO (G[N]=Hook[N]) pelo `baseAdId`;
 * se nao houver hooks/body, cai pro parser legado (parseAdSection) usando
 * `fullAdId` (a nomenclatura completa com sufixo, ex "AD139GL - VFPB04").
 * Retorna null se nada parseavel.
 */
function buildDisparoCore(
  text: string,
  baseAdId: string,
  fullAdId: string,
  candidates: AvatarCandidate[],
  variant?: string | null,
  links: DocLink[] = [],
): DiscoveredDisparo | null {
  // 1) Parser DARKO LAB (preferido). Variant token (F2/P1/AVA05) isola a secao
  //    quando o doc tem varias variantes do mesmo AD (senao avatares/copy vazam
  //    entre variantes). Vem do caller (nomenclatura ORIGINAL — fullAdId pode
  //    estar truncado antes do token). `links` habilita identificar avatar por
  //    smart-chip de YouTube/Drive (sem @user/.mp4 no texto).
  const briefing = parseDarkoBriefing(text, baseAdId, variant ?? extractVariantToken(fullAdId), links);
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

  // 2) Parser legado (secao com avatares + parts auto-detectadas). Tenta a
  // nomenclatura completa, depois so o 1o token (igual o clickup-pilot).
  const legacy =
    parseAdSection(text, fullAdId) || parseAdSection(text, fullAdId.split(/\s|-/)[0]);
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
        role: null,
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

/** Constroi um disparo pra um base AD ja normalizado (ex "AD139GL"). */
export function buildDisparoForAd(
  text: string,
  baseAdId: string,
  candidates: AvatarCandidate[],
  links: DocLink[] = [],
): DiscoveredDisparo | null {
  return buildDisparoCore(text, baseAdId, baseAdId, candidates, undefined, links);
}

/**
 * Extrai o base AD id (ex "AD139GL") + a nomenclatura completa de um texto
 * digitado pelo user — MESMA logica do runParser do clickup-pilot a partir
 * do nome da task.
 *   "AD139GL - VFPB04"        → base "AD139GL", full "AD139GL - VFPB04"
 *   "AD15VN - PRPB06 - G1"    → base "AD15VN",  full "AD15VN - PRPB06"
 *   "AD24G1VN - VRWA02"       → base "AD24VN",  full "AD24G1VN - VRWA02"
 */
export function extractAdIds(nomenclature: string): { baseAdId: string; fullAdId: string } {
  const raw = nomenclature.trim();
  // Base = AD<num> + 1o bloco de letras (colado OU separado por espaco/traco).
  //   "AD139GL - VFPB04" → "AD139" + "GL"  (letras coladas vencem; ignora " - VFPB04")
  //   "AD01 - PV"        → "AD01"  + "PV"  (sem letra colada → pega "PV" após o traco)
  //
  // CRITICAL: tira o infixo de sibling G<N> ANTES de extrair o sufixo. Sem
  // isso, "AD24G1VN" pegava "G" (do "G1") como sufixo → base "AD24G" errado,
  // findGSiblings nunca casava (procura ...G<N>...G), o parser DARKO devolvia
  // zero hooks/body e CAÍA no parser legado — que NAO segmenta por speaker.
  // Resultado: body inteiro num bloco só, roteado pro 1o role do texto (a
  // "Mulher") → video inteiro com a mulher falando. (G\d+ só casa o infixo
  // de sibling — "GL" de "AD139GL" tem G+letra, nao G+digito, fica intacto.)
  const norm = raw.replace(/G\d+/i, '');
  const m = norm.match(/AD(\d+)\s*[-–—]?\s*([A-Za-z]+)/i);
  let baseAdId: string;
  if (m) {
    baseAdId = `AD${m[1]}${m[2].toUpperCase()}`;
  } else {
    const m2 = raw.match(/AD\d+/i);
    baseAdId = m2 ? m2[0].toUpperCase() : raw.toUpperCase();
  }
  const fullMatch = raw.match(/AD\d+[A-Z0-9]*\s*[-–—]\s*[A-Z0-9]+/i);
  const fullAdId = fullMatch ? fullMatch[0].toUpperCase() : raw.toUpperCase();
  return { baseAdId, fullAdId };
}

/**
 * Constroi um disparo a partir de uma NOMENCLATURA digitada (ex
 * "AD139GL - VFPB04"). Procura esse AD no doc com a inteligencia do
 * clickup-pilot. Retorna null se nao achar.
 */
export function buildDisparoForNomenclature(
  text: string,
  nomenclature: string,
  candidates: AvatarCandidate[],
  links: DocLink[] = [],
): DiscoveredDisparo | null {
  if (!text || !nomenclature.trim()) return null;
  const { baseAdId, fullAdId } = extractAdIds(nomenclature);
  // Variant token vem da nomenclatura ORIGINAL (fullAdId trunca antes do token).
  const d = buildDisparoCore(text, baseAdId, fullAdId, candidates, extractVariantToken(nomenclature), links);
  // Preserva a nomenclatura digitada como nome do AD (mais claro pro user)
  if (d && nomenclature.trim()) {
    return { ...d, baseAdId: nomenclature.trim(), safeName: safeNameOf(nomenclature) };
  }
  return d;
}

/**
 * Resolve uma lista de nomenclaturas digitadas pelo user. Cada uma vira um
 * disparo (na ordem digitada). Retorna tambem as que NAO foram achadas.
 */
export function buildDisparosFromNomenclatures(
  text: string,
  nomenclatures: string[],
  candidates: AvatarCandidate[],
  links: DocLink[] = [],
): { disparos: DiscoveredDisparo[]; notFound: string[]; diagnostic: string } {
  if (!text || !text.trim()) {
    return { disparos: [], notFound: [], diagnostic: 'Doc vazio — cole/importe a copy.' };
  }
  const disparos: DiscoveredDisparo[] = [];
  const notFound: string[] = [];
  const seen = new Set<string>();
  for (const raw of nomenclatures) {
    const name = raw.trim();
    if (!name || seen.has(name.toUpperCase())) continue;
    seen.add(name.toUpperCase());
    const d = buildDisparoForNomenclature(text, name, candidates, links);
    if (d) disparos.push(d);
    else notFound.push(name);
  }
  let diagnostic = '';
  if (disparos.length > 0) diagnostic = `${disparos.length} AD(s) encontrado(s).`;
  if (notFound.length > 0) {
    diagnostic += `${diagnostic ? ' ' : ''}Nao achei no doc: ${notFound.join(', ')}.`;
  }
  if (!diagnostic) diagnostic = 'Digite pelo menos 1 nomenclatura de AD.';
  return { disparos, notFound, diagnostic };
}

/**
 * Ponto de entrada principal: descobre TODOS os ADs do doc e monta um
 * disparo pra cada um (a "fila"). Quando `onlyBaseAdId` e passado, restringe
 * a esse AD (modo single, equivalente ao handoff do clickup-pilot).
 */
export function buildDisparosFromDoc(
  text: string,
  candidates: AvatarCandidate[],
  opts: { onlyBaseAdId?: string; links?: DocLink[] } = {},
): DiscoverResult {
  if (!text || !text.trim()) {
    return { disparos: [], detectedAdIds: [], diagnostic: 'Doc vazio — cole/importe a copy.' };
  }
  const links = opts.links ?? [];

  let bases = opts.onlyBaseAdId ? [toBaseAdId(opts.onlyBaseAdId)] : discoverBaseAdIds(text);

  // Sem headings AD reconheciveis: trata o doc inteiro como 1 copy unica.
  // Util pra copy colada crua (sem nomenclatura). parseParts SEMPRE descarta a
  // 1a linha (assume header AD), entao prefixamos um header sintetico pra que
  // o conteudo real seja preservado. Avatares vem de parseAvatars no texto cru.
  if (bases.length === 0) {
    const avatars = parseAvatars(text, links);
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
          role: null,
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
    const d = buildDisparoForAd(text, base, candidates, links);
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
