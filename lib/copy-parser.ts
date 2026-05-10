/**
 * Parser de briefings DARKO LAB (formato Google Docs do user).
 *
 * Estrutura tipica:
 *   AD135GL - VFPB04                 (heading do AD)
 *   Avatar:
 *     Doutor: @renatomartins1.mp4   (mention do avatar com role + @user)
 *     Mulher: @marcella.malvar2.mp4
 *   Instruções para edição           (briefing de edicao - ignorar pra TTS)
 *   ...
 *   HOOK 1: ...                      (multi-hook OU single body)
 *   HOOK 2: ...
 *   BODY: ...
 */

export type ParsedAvatar = {
  /** "Doutor", "Mulher", etc. */
  role: string;
  /** "renatomartins1" (sem @ e sem .mp4) */
  username: string;
  /** linha completa pra debug */
  raw: string;
};

export type ParsedPart = {
  /** "HOOK 1", "HOOK 2", "BODY", "PARTE 1" */
  label: string;
  /** Texto que vai pro TTS */
  text: string;
};

export type ParsedAdSection = {
  /** ID do AD encontrado (ex "AD135GL - VFPB04") */
  adId: string;
  avatars: ParsedAvatar[];
  parts: ParsedPart[];
  /** Texto bruto da secao pra debug */
  rawSection: string;
};

const AD_HEADING_RE = /^AD\d+[A-Z0-9]*\s*-\s*[A-Z0-9]+/i;

/**
 * Localiza a secao do AD especifico no texto bruto do doc.
 * Aceita ad ID exato OU prefixo (ex "AD135GL").
 */
export function findAdSection(text: string, adIdOrPrefix: string): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const targetUp = adIdOrPrefix.toUpperCase().trim();

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toUpperCase();
    if (!AD_HEADING_RE.test(line)) continue;
    // Match exato ou prefixo
    if (line === targetUp || line.startsWith(targetUp + ' ') || line.startsWith(targetUp + '-')) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;

  // Procura o proximo heading AD pra delimitar a secao
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (AD_HEADING_RE.test(lines[i].trim())) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/** Extrai avatares mencionados no formato "Role: @username.mp4" ou "Role: @username" */
export function parseAvatars(section: string): ParsedAvatar[] {
  const out: ParsedAvatar[] = [];
  const lines = section.split(/\r?\n/);
  // Procura linhas "Role: @username..." (com ou sem .mp4)
  // Tambem aceita emojis (🎬) e variacoes
  const re = /^([\wÀ-ÿ ]+?):\s*[^@\w]*@([\w._-]+?)(?:\.mp4|\.mov)?\s*$/i;
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(re);
    if (m) {
      const role = m[1].trim();
      const username = m[2].trim();
      // Skip falsos positivos comuns
      if (/^(http|https|www|exemplo|ex)$/i.test(username)) continue;
      out.push({ role, username, raw: trimmed });
    }
  }
  return out;
}

/**
 * Extrai partes (hooks/body) da secao. Heuristicas:
 * 1. Procura linhas tipo "HOOK 1:", "HOOK1", "GANCHO 1", "PARTE 1", "BODY", "CORPO"
 * 2. Se acha headings, divide o texto entre eles
 * 3. Se nao acha, retorna 1 parte unica com todo o conteudo (excluindo briefing
 *    de edicao + linhas de avatar)
 */
export function parseParts(section: string): ParsedPart[] {
  const lines = section.split(/\r?\n/);
  // Pula header (primeira linha = AD ID)
  const cleanLines: string[] = [];
  let inAvatarBlock = false;
  let inEditBlock = false;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^Avatar:?$/i.test(trimmed)) { inAvatarBlock = true; continue; }
    if (/^Instru[cç][oõ]es para edi[cç][aã]o:?$/i.test(trimmed)) { inAvatarBlock = false; inEditBlock = true; continue; }
    if (inAvatarBlock) {
      // linha tipo "Doutor: @x.mp4" — skip
      if (/^[\wÀ-ÿ ]+?:\s*[^@\w]*@[\w._-]+/.test(trimmed)) continue;
      // linha em branco apos avatar = fim do bloco
      if (!trimmed) { inAvatarBlock = false; continue; }
    }
    cleanLines.push(lines[i]);
  }
  const cleaned = cleanLines.join('\n');

  // Heading patterns: HOOK, GANCHO, BODY, CORPO, PARTE — case insensitive,
  // com numero opcional, com ":" opcional
  const headingRe = /^[\s•\-*]*(HOOK|GANCHO|BODY|CORPO|PARTE|TAKE)\s*([0-9IVX]+)?[\s:.\-]*$/i;
  const headingLineIdxs: number[] = [];
  const headingLabels: string[] = [];
  const splitLines = cleaned.split(/\r?\n/);
  for (let i = 0; i < splitLines.length; i++) {
    const m = splitLines[i].trim().match(headingRe);
    if (m) {
      headingLineIdxs.push(i);
      const num = m[2] ? ` ${m[2]}` : '';
      headingLabels.push(`${m[1].toUpperCase()}${num}`);
    }
  }

  if (headingLineIdxs.length === 0) {
    // Sem headings — uma parte unica
    const text = cleaned.trim();
    if (!text) return [];
    return [{ label: 'PARTE 1', text }];
  }

  const out: ParsedPart[] = [];
  for (let h = 0; h < headingLineIdxs.length; h++) {
    const start = headingLineIdxs[h] + 1;
    const end = h + 1 < headingLineIdxs.length ? headingLineIdxs[h + 1] : splitLines.length;
    const text = splitLines.slice(start, end).join('\n').trim();
    if (text) {
      out.push({ label: headingLabels[h], text });
    }
  }
  return out;
}

/** Parse top-level: localiza secao, extrai avatares + partes */
export function parseAdSection(fullDocText: string, adIdOrPrefix: string): ParsedAdSection | null {
  const section = findAdSection(fullDocText, adIdOrPrefix);
  if (!section) return null;
  const adId = (section.split(/\r?\n/)[0] || '').trim();
  return {
    adId,
    avatars: parseAvatars(section),
    parts: parseParts(section),
    rawSection: section,
  };
}

/* ============= Convencao G[N] = Hook[N] (DARKO LAB briefings) ============= */

/**
 * Encontra todos os siblings AD<base>G<N>GL-<rest> dado um base ID
 * (ex "AD139GL" → ["AD139G1GL-VFPB04", "AD139G2GL-VFPB04", ...]).
 * Retorna em ordem numerica de N.
 */
export function findGSiblings(fullDocText: string, baseAdId: string): Array<{ gNum: number; heading: string; section: string }> {
  if (!fullDocText) return [];
  // Extrai a parte numerica + sufixo "GL" do base (ex AD139GL → "AD139", "GL")
  const m = baseAdId.toUpperCase().match(/^(AD\d+)([A-Z]+)$/);
  if (!m) return [];
  const numPart = m[1]; // "AD139"
  const suffix = m[2]; // "GL"
  // Procura headings tipo "AD139G<N>GL-XXX"
  const lines = fullDocText.split(/\r?\n/);
  const re = new RegExp(`^${numPart}G(\\d+)${suffix}\\b`, 'i');
  const found: Array<{ gNum: number; lineStart: number; heading: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const mm = t.match(re);
    if (mm) {
      found.push({ gNum: parseInt(mm[1], 10), lineStart: i, heading: t });
    }
  }
  // Pra cada heading, extrai conteudo ate o proximo AD heading
  return found
    .map((f) => {
      let end = lines.length;
      for (let i = f.lineStart + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^AD\d+[A-Z0-9]*\s*-\s*[A-Z0-9]+/i.test(t)) { end = i; break; }
      }
      return {
        gNum: f.gNum,
        heading: f.heading,
        section: lines.slice(f.lineStart, end).join('\n'),
      };
    })
    .sort((a, b) => a.gNum - b.gNum);
}

/**
 * Parse de um G[N] sibling: extrai hooks (linhas antes de "Body") + body
 * (linhas depois). Cada linha nao-vazia antes de "Body" e tratada como
 * 1 hook separado (cada uma vai virar 1 take).
 */
export function parseGSibling(section: string): { hooks: string[]; body: string } {
  const lines = section.split(/\r?\n/);
  // Pula header (primeira linha)
  let bodyMarkerIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^body$/i.test(lines[i].trim())) { bodyMarkerIdx = i; break; }
  }
  const beforeBody = bodyMarkerIdx >= 0 ? lines.slice(1, bodyMarkerIdx) : lines.slice(1);
  const afterBody = bodyMarkerIdx >= 0 ? lines.slice(bodyMarkerIdx + 1) : [];
  // Hooks = paragrafos nao-vazios antes de "Body"
  const hooks: string[] = [];
  let cur = '';
  for (const line of beforeBody) {
    if (line.trim()) {
      cur += (cur ? '\n' : '') + line;
    } else if (cur) {
      hooks.push(cur.trim());
      cur = '';
    }
  }
  if (cur) hooks.push(cur.trim());
  // Limpa markers tipo [dq], [dr] do fim
  const cleanedHooks = hooks.map((h) => h.replace(/\s*\[[a-z]{1,3}\]\s*$/i, '').trim()).filter((h) => h.length > 0);
  const body = afterBody.join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  return { hooks: cleanedHooks, body };
}

export type ParsedDarkoBriefing = {
  /** Base AD ID (ex "AD139GL") */
  baseAdId: string;
  /** Avatares extraidos da secao base (briefing) */
  avatars: ParsedAvatar[];
  /** Hooks em ordem: HOOK 1 (G1), HOOK 2 (G2), ... */
  hooks: Array<{ label: string; text: string; sourceG: number }>;
  /** Body (do sibling que tiver — geralmente o ultimo G) */
  body: string | null;
  /** G siblings encontrados (debug) */
  gSiblings: Array<{ gNum: number; heading: string }>;
};

/**
 * Parser completo dos docs DARKO LAB:
 * 1. Acha secao base (AD139GL) → avatares
 * 2. Acha todos siblings G[N] (G1, G2, ...) → cada um vira N hooks
 * 3. Body = primeiro sibling que tiver "Body" marker (ou todos concatenados)
 *
 * Retorna estrutura pronta pra dispatch: hooks como takes individuais + body
 * como bloco unico (ClickUp Pilot vai split em parts via splitCopyIntoParts).
 */
export function parseDarkoBriefing(fullDocText: string, baseAdId: string): ParsedDarkoBriefing | null {
  const baseSection = findAdSection(fullDocText, baseAdId);
  if (!baseSection) return null;
  const avatars = parseAvatars(baseSection);
  const siblings = findGSiblings(fullDocText, baseAdId);
  const hooks: Array<{ label: string; text: string; sourceG: number }> = [];
  let body: string | null = null;
  for (const sib of siblings) {
    const parsed = parseGSibling(sib.section);
    for (const hookText of parsed.hooks) {
      hooks.push({
        label: `HOOK ${hooks.length + 1}`,
        text: hookText,
        sourceG: sib.gNum,
      });
    }
    if (parsed.body && !body) {
      body = parsed.body;
    }
  }
  return {
    baseAdId,
    avatars,
    hooks,
    body,
    gSiblings: siblings.map(s => ({ gNum: s.gNum, heading: s.heading })),
  };
}

/** Match fuzzy de avatar HeyGen pelo username do briefing.
 *  Retorna o melhor candidato (ou null). */
export function matchAvatar(
  username: string,
  candidates: Array<{ id: string; name: string; groupName?: string }>,
): { id: string; name: string; groupName?: string; score: number } | null {
  if (!username || !candidates.length) return null;
  const u = username.toLowerCase().replace(/[^a-z0-9]/g, '');
  let best: { c: typeof candidates[0]; score: number } | null = null;
  for (const c of candidates) {
    const haystack = `${c.name} ${c.groupName || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!haystack) continue;
    let score = 0;
    if (haystack.includes(u)) score = 100; // username inteiro presente
    else {
      // Quebra username em tokens (renato + martins) e ve quantos batem
      const tokens = username.toLowerCase().split(/[._-]+|(?=\d)/).filter((t) => t.length >= 3);
      for (const t of tokens) {
        const tn = t.replace(/[^a-z0-9]/g, '');
        if (tn && haystack.includes(tn)) score += 30;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { c, score };
    }
  }
  return best ? { ...best.c, score: best.score } : null;
}
