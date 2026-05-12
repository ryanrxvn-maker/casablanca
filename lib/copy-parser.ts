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
  /** Drive file ID do video referenciado (preenchido externamente apos parse) */
  videoFileId?: string | null;
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

/** Lista de prefixos de role que NAO sao avatares — sao metadados sobre
 *  voz/referencia/instrucao que aparecem em briefings DARKO LAB.
 *
 *  Exemplos do briefing real (AD144GL):
 *    "Voz: AD600VN[T]-VFPB02-AVA02.mp4"           ← REFERENCIA voz pra TTS
 *    "Referência: AD600VN[T]-VFPB02-AVA02.mp4"    ← REFERENCIA visual
 *    "Atenção na Voz: Gerar..."                    ← INSTRUCAO
 *    "Caixinha de perguntas: Doutor, quem..."      ← UI ELEMENT
 *    "Avatar fala: Doutor..."                      ← INSTRUCAO de dialogo
 *
 *  Esses NAO devem virar slots de avatar. */
const NON_AVATAR_PREFIXES = [
  /^voz\b/i,                              // "Voz:", "Voz da Mulher:"...
                                          // CUIDADO: "Voz do Homem:" PODE ser avatar
                                          // — diferenciamos via mention @x.mp4 presente
                                          // ou nao no value
  /^refer[eê]ncia\b/i,                    // "Referência:"
  /^aten[cç][aã]o\b/i,                    // "Atenção na Voz:"
  /^caixinha\b/i,                         // "Caixinha de perguntas:"
  /^avatar fala\b/i,                      // "Avatar fala:"
  /^instru[cç][oõ]es?\b/i,                // "Instruções para edição:"
  /^observa[cç][aã]o\b/i,                 // "Observação:"
  /^nota\b/i,                             // "Nota:"
  /^obs\b/i,                              // "OBS:"
];

/** Heuristica: o que parece role label valido pra avatar?
 *  Aceita ate 4 palavras + opcional parentesis ("Leandro (Homem depoimento)").
 *  Ex validos: "Mulher", "Homem", "Doutor", "Voz do Homem", "Leandro (Homem depoimento)",
 *              "Mulher (Esposa de Leandro)", "Narrador" */
function isPlausibleAvatarRole(role: string): boolean {
  const r = role.trim();
  if (r.length === 0 || r.length > 60) return false;
  // Bloqueia prefixos de metadados (Voz, Referencia, etc) — INCLUSIVE
  // 'Voz do Homem', 'Voz da Mulher', etc. Esses sao referencias de VOZ
  // pra TTS, NAO avatares visuais separados (user esclareceu 12/05/2026).
  for (const re of NON_AVATAR_PREFIXES) {
    if (re.test(r)) return false;
  }
  return true;
}

/** Extrai avatares mencionados em formato flexivel.
 *
 *  Formatos aceitos:
 *    "Mulher: @vivian.lamounier1.mp4"
 *    "Doutor: thethaetresmyarena.mp4"                  ← sem @
 *    "Leandro (Homem depoimento): @kiko.urso3.mp4"     ← role com parens
 *    "Mulher (Esposa de Leandro): @anapaulalima.mp4"
 *    "Voz do Homem: @manualdohomemsolo2.mp4"           ← role com prep
 *
 *  Filtra metadados ("Voz:", "Referência:", "Atenção:", "Caixinha:",
 *  "Avatar fala:", "Instruções:", "Observação:") que aparecem em briefings
 *  mas NAO sao avatares. */
export function parseAvatars(section: string): ParsedAvatar[] {
  const out: ParsedAvatar[] = [];
  const lines = section.split(/\r?\n/);

  // Regex permissivo: aceita filename com ou sem @, com .mp4/.mov opcional.
  // Role: 1-4 palavras + opcional (parens).
  // Mention: @ opcional, depois caracteres validos de filename.
  const re = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s()]{0,58}?):\s*[^@\w]*@?([A-Za-z0-9][\w._-]+?)(?:\.mp4|\.mov)?\s*$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(re);
    if (!m) continue;
    const role = m[1].trim();
    const username = m[2].trim();

    // Filtros de qualidade:
    if (!isPlausibleAvatarRole(role)) continue;
    if (/^(http|https|www|exemplo|ex)$/i.test(username)) continue;
    // username muito curto = provavel falso positivo
    if (username.length < 3) continue;
    // username so com digitos = NAO e mention de avatar
    if (/^\d+$/.test(username)) continue;
    // Bloqueia padroes de referencia conhecidos (AD<num>VN[T]-VFPBxx-AVAxx)
    if (/^AD\d+VN/i.test(username)) continue;

    out.push({ role, username, raw: trimmed });
  }

  // Dedup por (role + username): se mesma combinacao aparecer 2x, mantem 1
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = `${a.role.toLowerCase()}::${a.username.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

/** Detecta linha 'Link do avatar: <file>.mp4' (formato alternativo usado em
 *  alguns ADs onde o avatar GLOBAL da copy inteira eh declarado no topo,
 *  sem 'Avatar:' por hook). Retorna {role: 'Avatar', username} ou null.
 *
 *  Ex doc AD15VN - PRPB06:
 *    "Link do avatar:  omédicodoshomens.mp4"
 *  → { role: 'Avatar', username: 'omédicodoshomens' }
 */
export function parseGlobalAvatarLink(section: string): { role: string; username: string } | null {
  const lines = section.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    // "Link do avatar: <filename>" — com ou sem @, .mp4/.mov opcional
    const m = t.match(/^link\s+do\s+avatar\s*[:\-]\s*[^@a-z0-9]*@?([a-zA-ZÀ-ÿ0-9_][a-zA-ZÀ-ÿ0-9._-]+?)(?:\.(?:mp4|mov))?\s*$/i);
    if (m) {
      return { role: 'Avatar', username: m[1] };
    }
  }
  return null;
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
 * Roles conhecidos do briefing DARKO LAB. Quando aparece num bloco de texto
 * antes do conteudo (ou inline), e DESCARTADO — e identificacao de QUEM fala,
 * nao parte da fala.
 */
const KNOWN_ROLES_RE = /^(Mulher|Homem|Doutor[a]?|Voz|Narrador[a]?|Avatar|Locutor[a]?)\s*:/i;

/** Tenta extrair role da linha. Retorna 'Mulher', 'Homem', 'Doutor', etc
 *  ou null. Usado pra propagar identidade do speaker pra metadata.
 *
 *  Match patterns:
 *   "Mulher:"                       → "Mulher"
 *   "Mulher: @x.mp4"                → "Mulher"
 *   "Mulher: Texto direto"          → "Mulher"
 *   "Voz do Homem:" / "Voz Off:"    → "Voz do Homem" / "Voz Off"
 *   "@x.mp4" (mention solo)         → null (sem role explicito)
 *
 *  Aceita roles de 1-3 palavras antes do ":" (cobre "Voz do Homem", "Voz Off").
 */
function detectRoleFromLine(line: string): string | null {
  const t = line.trim();
  // "Palavra:" / "Palavra Palavra:" / "Palavra Palavra Palavra:" — opcionalmente seguido de mention/texto
  const m = t.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})\s*:/);
  if (!m) return null;
  const role = m[1].trim();
  // Filtro: roles validos sao palavras curtas (< 30 chars). Frases comuns tipo
  // "Hoje:" sao improvaveis num briefing, mas se vier "Eu disse: blah" rejeita
  // por seguranca (mais de 3 palavras antes do : ja excluido pelo regex).
  if (role.length > 30) return null;
  return role;
}

/** Linha que e SO um role label (ex "Mulher:") ou role + mention (ex "Mulher: @x.mp4")
 *  ou so um mention solo (ex "@manualdohomemsolo1.mp4"). Descartar inteira. */
function isPureRoleOrMentionLine(line: string): boolean {
  const t = line.trim();
  // "Mulher:" / "Voz do Homem:" — 1-3 palavras + ":"
  if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}\s*:\s*$/.test(t)) return true;
  // "Mulher: @x.mp4" / "Voz do Homem: @x.mp4" — role + mention
  if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}\s*:\s*[^@\w]*@[\w._-]+(\.(mp4|mov))?\s*$/i.test(t)) return true;
  // "@x.mp4" — so mention
  if (/^@[\w._-]+(\.(mp4|mov))?\s*$/i.test(t)) return true;
  return false;
}

/** Se a linha comeca com role conhecido + texto na mesma linha
 *  (ex "Mulher: Eu nao to..."), retorna apenas o texto. Caso contrario null. */
function stripLeadingRoleLabel(line: string): string | null {
  const m = line.match(KNOWN_ROLES_RE);
  if (!m) return null;
  const after = line.slice(m[0].length).trim();
  return after || ''; // string vazia significa "era role line pura"
}

/** Extrai bloco de texto pulando linha de role (se houver) e markers [a-z].
 *  PRESERVA paragrafos (linhas vazias) pra que body splitter possa quebrar
 *  certinho depois. Tambem RETORNA o role detectado (pra dispatch saber
 *  qual avatar fala esse bloco) — esse e o ponto critico: descartamos a
 *  linha de role do texto pra TTS, mas guardamos a info em metadata. */
function extractTextBlock(rawLines: string[]): { text: string; role: string | null } {
  const lines = [...rawLines];
  // Skip leading empty lines
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) return { text: '', role: null };

  let detectedRole: string | null = null;
  const first = lines[0].trim();
  if (isPureRoleOrMentionLine(first)) {
    // Linha role pura — captura role antes de descartar
    detectedRole = detectRoleFromLine(first);
    lines.shift();
  } else {
    // Pode ser "Mulher: texto..." — corta so o prefixo role
    const stripped = stripLeadingRoleLabel(first);
    if (stripped !== null) {
      detectedRole = detectRoleFromLine(first);
      if (stripped === '') {
        lines.shift();
      } else {
        lines[0] = stripped;
      }
    }
  }
  // Skip leading empty novamente
  while (lines.length && !lines[0].trim()) lines.shift();

  const cleaned = lines.join('\n').replace(/\s*\[[a-z]{1,3}\]/gi, '');
  return { text: cleaned.trim(), role: detectedRole };
}

/**
 * Parse de um G[N] sibling DARKO LAB.
 *
 * REGRA: cada G[N] = 1 HOOK UNICO (mesmo que multi-paragrafo). Body opcional
 * vem depois do marker "Body". Linha de role (Mulher:/Homem:/etc) e descartada
 * — e identificacao de quem fala, nao texto da copy.
 *
 * Estrutura esperada:
 *   AD<base>G<N><suffix>-<rest>     ← heading (ja consumido pelo caller)
 *   Mulher:                          ← role (descartada)
 *   Texto do hook paragrafo 1.
 *
 *   Texto do hook paragrafo 2.       ← MESMO hook, multi-paragrafo
 *
 *   Body                             ← marker opcional
 *   Homem:                           ← role (descartada)
 *   Texto do body completo.
 */
export function parseGSibling(section: string): {
  hook: { text: string; role: string | null } | null;
  body: { text: string; role: string | null } | null;
} {
  const lines = section.split(/\r?\n/);
  let bodyMarkerIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^body$/i.test(lines[i].trim())) { bodyMarkerIdx = i; break; }
  }
  const beforeBody = bodyMarkerIdx >= 0 ? lines.slice(1, bodyMarkerIdx) : lines.slice(1);
  const afterBody = bodyMarkerIdx >= 0 ? lines.slice(bodyMarkerIdx + 1) : [];
  const hook = extractTextBlock(beforeBody);
  const body = extractTextBlock(afterBody);
  return {
    hook: hook.text ? hook : null,
    body: body.text ? body : null,
  };
}

export type ParsedDarkoBriefing = {
  /** Base AD ID (ex "AD139GL") */
  baseAdId: string;
  /** Avatares extraidos da secao base (briefing) */
  avatars: ParsedAvatar[];
  /** Hooks em ordem: HOOK 1 (G1), HOOK 2 (G2), ...
   *  role = quem fala (extraido da linha "Mulher:"/"Homem:"/etc do briefing).
   *  Pode ser null se nao havia indicacao explicita. Usado pra mapear avatar. */
  hooks: Array<{ label: string; text: string; sourceG: number; role: string | null }>;
  /** Body (do sibling que tiver — geralmente o ultimo G) */
  body: string | null;
  /** Quem fala o body (extraido da linha apos "Body" marker — geralmente "Homem"). */
  bodyRole: string | null;
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
  let avatars = parseAvatars(baseSection);
  // Fallback: alguns ADs usam 'Link do avatar: <file>' em vez de 'Avatar:'
  // — vira avatar GLOBAL da copy (todos hooks + body desse avatar).
  if (avatars.length === 0) {
    const global = parseGlobalAvatarLink(baseSection);
    if (global) {
      avatars = [{ role: global.role, username: global.username, raw: `Link do avatar: ${global.username}.mp4` }];
    }
  }
  const siblings = findGSiblings(fullDocText, baseAdId);
  const hooks: ParsedDarkoBriefing['hooks'] = [];
  let body: string | null = null;
  let bodyRole: string | null = null;
  for (const sib of siblings) {
    const parsed = parseGSibling(sib.section);
    // CADA SIBLING = EXATAMENTE 1 HOOK (mesmo que tenha multiplos paragrafos).
    // Hook num = sourceG (G1 → HOOK 1, G2 → HOOK 2, etc). Garante alinhamento
    // 1:1 com a nomenclatura do briefing — NUNCA infla a contagem de hooks.
    if (parsed.hook) {
      hooks.push({
        label: `HOOK ${sib.gNum}`,
        text: parsed.hook.text,
        sourceG: sib.gNum,
        role: parsed.hook.role,
      });
    }
    // Body geralmente esta no ultimo sibling. Sobrescreve pra pegar o ultimo
    // (caso mais de um sibling tenha body — improvavel mas seguro).
    if (parsed.body) {
      body = parsed.body.text;
      bodyRole = parsed.body.role;
    }
  }
  return {
    baseAdId,
    avatars,
    hooks,
    body,
    bodyRole,
    gSiblings: siblings.map(s => ({ gNum: s.gNum, heading: s.heading })),
  };
}

/* ============================ VARIACAO DE AVATAR (VA) ============================
 *
 * Briefings VA tem estrutura DIFERENTE dos comuns:
 *   - 1 unico Gancho + 1 Body (mesma copy pra todos avatares)
 *   - N avatares de VARIACAO (2-10), cada um gera 1 video final
 *   - NAO usa TTS — gera lipsync com voz extraida do video original do AD
 *   - Opcional: depoimento com avatar adicional
 *
 * Formato do doc:
 *   AD31G1VN - ME - Variação de avatar - SILAS    ← header com 'Variação de avatar'
 *   Link do ad: 📎 AD31G1VN-ME.mp4                ← video original (extrai voz daqui)
 *
 *   Instruções para edição: ...
 *
 *   AD31G1VN-ME-AVA03                              ← nomenclatura avatar variacao 1
 *   Avatar lara.mp4
 *
 *   AD31G1VN-ME-AVA04                              ← nomenclatura avatar variacao 2
 *   Avatar 7508150707225251077.mp4
 *
 *   Gancho                                         ← UNICO gancho (texto pra info, voz vem do AD)
 *   [texto do gancho]
 *
 *   Body                                           ← UNICO body
 *   [texto do body]
 *
 *   Depoimento com avatar: 📎 omsteve.mp4         ← opcional
 *   [texto do depoimento]
 *
 * Output esperado da ferramenta: ZIP com
 *   AD31G1VN-ME-AVA03.mp4 (lipsync video original + avatar lara)
 *   AD31G1VN-ME-AVA04.mp4 (lipsync video original + avatar 7508...)
 *   (opcional) AD31G1VN-ME-DEPOIMENTO-AVA<X>.mp4 (depoimento)
 */

export type VAAvatar = {
  /** Numero da variacao (3 → AVA03) */
  avaNum: number;
  /** Codigo completo: 'AVA03', 'AVA04' */
  avaCode: string;
  /** Username sem extensao (ex 'lara', '7508150707225251077') */
  username: string;
  /** Drive file ID se houver link na linha */
  fileId: string | null;
};

export type ParsedVABriefing = {
  /** Base AD ID, ex 'AD31G1VN-ME' */
  baseAdId: string;
  /** Filename do video original referenciado (ex 'AD31G1VN-ME.mp4') */
  linkAdFilename: string | null;
  /** Drive file ID do video original (se link Drive presente) */
  linkAdFileId: string | null;
  /** Avatares de variacao em ordem (2-10) */
  avatares: VAAvatar[];
  /** Texto do unico Gancho */
  hookText: string;
  /** Texto do unico Body */
  bodyText: string;
  /** Texto do depoimento (opcional) */
  depoimentoText: string | null;
  /** Avatar do depoimento (opcional) */
  depoimentoUsername: string | null;
  depoimentoFileId: string | null;
};

/** Detecta se uma task ou doc e do tipo Variacao de Avatar.
 *  Check: nome contem 'Variação de avatar' OU comeca com 'VA -'/'VA-' */
export function isVATask(taskName: string): boolean {
  if (!taskName) return false;
  if (/^VA\s*[-–—]/i.test(taskName.trim())) return true;
  if (/varia[cç][aã]o\s+de\s+avatar/i.test(taskName)) return true;
  return false;
}

/** Extrai os codigos AVA mencionados na NOMENCLATURA da task.
 *
 * Ex: 'VA - AD03G1VN - PRPB06 - AVA05 e 06 - Silas' → [5, 6]
 *     'VA - AD02G1VN - PRPB06 - AVA03 e 04 - Silas' → [3, 4]
 *     'VA - AD10G1VN - AVA01, 02 e 03 - SILAS'      → [1, 2, 3]
 *     'AD138GL - VFPB04'                            → [] (nao tem AVAs)
 *
 * User esclareceu (12/05/2026): nome da task DELIMITA quais AVAs gerar,
 * mesmo que o doc tenha mais. Se task diz "AVA05 e 06", so esses 2 saem
 * — outros do doc sao ignorados. */
export function extractAvaNumsFromTaskName(taskName: string): number[] {
  if (!taskName) return [];
  // Match completo: "AVA<num>" no taskName + numeros adicionais separados por
  // 'e', ',' ou '/'. Ex: "AVA05 e 06" → captura 5 e depois 06.
  // Strategy: encontra TODOS numeros que seguem AVA ou seguem o anterior via 'e'/'/' /','.
  // Simples: extrai segmento entre "AVA" e o proximo elemento da task name (delimitado por dash).
  const m = taskName.match(/AVA\s*([\d\s,e/]+?)(?:\s*[-–—]|$)/i);
  if (!m) return [];
  const segment = m[1];
  // Acha todos numeros no segmento
  const nums: number[] = [];
  const numRe = /(\d+)/g;
  let nm;
  while ((nm = numRe.exec(segment)) !== null) {
    const n = parseInt(nm[1], 10);
    if (!isNaN(n) && n > 0 && n < 100) nums.push(n);
  }
  // Dedup + sort
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/** Parse VA briefing. Retorna null se nao for VA detectavel.
 *
 *  IMPORTANTE: aceita filterAvaNums pra restringir quais AVAs vao pro
 *  resultado. Quando a task name diz "AVA05 e 06", so esses 2 retornam
 *  (mesmo que o doc tenha AVA01-06). User esclareceu 12/05/2026. */
export function parseVABriefing(
  fullDocText: string,
  baseAdIdOrTaskName: string,
  driveLinks: Array<{ text: string; fileId: string }> = [],
  filterAvaNums: number[] = [],
): ParsedVABriefing | null {
  if (!fullDocText) return null;
  const lines = fullDocText.split(/\r?\n/);

  // 1. Detecta header VA: linha que contem 'Variação de avatar'
  let vaHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/varia[cç][aã]o\s+de\s+avatar/i.test(lines[i])) {
      vaHeaderIdx = i;
      break;
    }
  }
  if (vaHeaderIdx < 0) return null;

  // 2. Extrai base AD ID — primeira parte do header antes de "- Variação"
  // Ex: "AD31G1VN - ME - Variação de avatar - SILAS" → "AD31G1VN - ME"
  const header = lines[vaHeaderIdx].trim();
  const baseMatch = header.match(/^(.+?)\s*[-–—]\s*varia[cç][aã]o/i);
  const baseAdId = baseMatch ? baseMatch[1].trim() : baseAdIdOrTaskName;

  // 3. Link do AD: linha "Link do ad: <filename>" ou similar
  let linkAdFilename: string | null = null;
  let linkAdFileId: string | null = null;
  for (let i = vaHeaderIdx; i < Math.min(vaHeaderIdx + 15, lines.length); i++) {
    const t = lines[i].trim();
    const m = t.match(/^link\s+do\s+ad\s*[:\-]\s*[^a-zA-Z0-9]*([a-zA-Z0-9_.\-]+\.(?:mp4|mov))/i);
    if (m) {
      linkAdFilename = m[1];
      // Tenta achar fileId nos driveLinks pelo texto
      const dl = driveLinks.find((d) => d.text.includes(linkAdFilename!) || d.text === linkAdFilename);
      if (dl) linkAdFileId = dl.fileId;
      break;
    }
  }

  // 4. Avatares de variacao: linhas tipo "<base>-AVA<NN>" seguidas de "Avatar <filename>"
  // Tambem aceita: AVAxx + Avatar @username.mp4
  const allAvatares: VAAvatar[] = [];
  const seenAvaCodes = new Set<string>();
  for (let i = vaHeaderIdx; i < lines.length; i++) {
    const t = lines[i].trim();
    // Match codigo AVA: base + -AVA<NN>
    const avaCodeMatch = t.match(/^(?:.*[-–—]\s*)?AVA\s*(\d+)\b/i);
    if (!avaCodeMatch) continue;
    const avaNum = parseInt(avaCodeMatch[1], 10);
    const avaCode = `AVA${String(avaNum).padStart(2, '0')}`;
    if (seenAvaCodes.has(avaCode)) continue;
    // Procura linha seguinte (1-3 linhas abaixo) com "Avatar <filename>" ou "@<file>"
    let username: string | null = null;
    let fileId: string | null = null;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const nl = lines[j].trim();
      if (!nl) continue;
      // "Avatar lara.mp4" ou "Avatar @x.mp4" ou "@x.mp4"
      const m = nl.match(/^(?:Avatar\s*)?[^@a-z0-9]*@?([a-zA-Z0-9_][a-zA-Z0-9._-]+?)(?:\.(?:mp4|mov))?\s*$/i);
      if (m && m[1].length >= 3 && !/^AD\d+/i.test(m[1])) {
        username = m[1];
        const dl = driveLinks.find((d) => d.text.includes(username!));
        if (dl) fileId = dl.fileId;
        break;
      }
    }
    if (!username) continue;
    seenAvaCodes.add(avaCode);
    allAvatares.push({ avaNum, avaCode, username, fileId });
  }

  // FILTRO: se task name diz quais AVAs gerar (ex 'AVA05 e 06'), restringe.
  // Sem filterAvaNums OR filter vazio: passa todos.
  const avatares = filterAvaNums.length > 0
    ? allAvatares.filter((a) => filterAvaNums.includes(a.avaNum))
    : allAvatares;

  // 5. Gancho (texto): seccao apos "Gancho" ate proxima heading (Body/Depoimento)
  let hookText = '';
  const gIdx = lines.findIndex((l, i) => i > vaHeaderIdx && /^gancho\s*$/i.test(l.trim()));
  if (gIdx >= 0) {
    let end = lines.length;
    for (let i = gIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^body\s*$/i.test(t) || /^depoimento\b/i.test(t)) { end = i; break; }
    }
    hookText = lines.slice(gIdx + 1, end).join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  }

  // 6. Body
  let bodyText = '';
  const bIdx = lines.findIndex((l, i) => i > vaHeaderIdx && /^body\s*$/i.test(l.trim()));
  if (bIdx >= 0) {
    let end = lines.length;
    for (let i = bIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^depoimento\b/i.test(t)) { end = i; break; }
    }
    bodyText = lines.slice(bIdx + 1, end).join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  }

  // 7. Depoimento (opcional)
  let depoimentoText: string | null = null;
  let depoimentoUsername: string | null = null;
  let depoimentoFileId: string | null = null;
  const dIdx = lines.findIndex((l, i) => i > vaHeaderIdx && /^depoimento\s+com\s+avatar\s*[:\-]/i.test(l.trim()));
  if (dIdx >= 0) {
    const depLine = lines[dIdx].trim();
    const mUser = depLine.match(/depoimento\s+com\s+avatar\s*[:\-]\s*[^@a-z0-9]*@?([a-zA-Z0-9_][a-zA-Z0-9._-]+?)(?:\.(?:mp4|mov))?\s*$/i);
    if (mUser) {
      depoimentoUsername = mUser[1];
      const dl = driveLinks.find((d) => d.text.includes(depoimentoUsername!));
      if (dl) depoimentoFileId = dl.fileId;
    }
    depoimentoText = lines.slice(dIdx + 1).join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  }

  // Validacao minima: precisa ter pelo menos 1 avatar + hook OU body
  if (avatares.length === 0 || (!hookText && !bodyText)) return null;

  return {
    baseAdId,
    linkAdFilename,
    linkAdFileId,
    avatares,
    hookText,
    bodyText,
    depoimentoText,
    depoimentoUsername,
    depoimentoFileId,
  };
}

/** Match fuzzy de avatar HeyGen pelo username do briefing.
 *  Estrategia em ordem de prioridade (score):
 *   220 voice_name_exact: voice_name == @username (igual depois de normalizar)
 *   210 name_exact: avatar.name == @username
 *   200 group_exact: avatar.groupName == @username
 *   180 voice_name_contains: voice_name contem username (com @ ou .mp4)
 *   170 name_contains: avatar.name contem username
 *   150 voice_name_fuzzy: mesmo core (versao diferente: malvar1 vs malvar2)
 *   140 group_contains: avatar.groupName contem username
 *   100 nome+grupo concat contem username
 *    30 tokens partidos (renato, martins) — fraco, ultimo recurso
 *
 *  Voltamos o melhor candidato (ou null).
 *  Threshold de aceite: >= 100 (so confiavel). User selecionou avatar com
 *  exato mesmo nome do briefing? Deve bater 100% via uma das exact paths. */
export function matchAvatar(
  username: string,
  candidates: Array<{ id: string; name: string; groupName?: string; voiceName?: string | null }>,
): { id: string; name: string; groupName?: string; score: number; matchedBy?: 'voice_name_exact' | 'voice_name_fuzzy' | 'name_exact' | 'name_contains' | 'group_exact' | 'group_contains' | 'name_tokens' | 'voice_name_contains' } | null {
  if (!username || !candidates.length) return null;
  // Normaliza username: tira @, .mp4/.mov, mantem letras+digitos
  const norm = (s: string) => s.toLowerCase().replace(/^@/, '').replace(/\.mp4$|\.mov$/i, '').replace(/[^a-z0-9]/g, '');
  const stripVer = (s: string) => s.toLowerCase().replace(/^@/, '').replace(/\.mp4$|\.mov$/i, '').replace(/\d+$/, '');
  const u = norm(username);
  const uCore = norm(stripVer(username));

  let best: { c: typeof candidates[0]; score: number; matchedBy: any } | null = null;
  for (const c of candidates) {
    let score = 0;
    let matchedBy: any = null;

    const vn = c.voiceName || '';
    const vnNorm = norm(vn);
    const vnCore = norm(stripVer(vn));
    const nm = norm(c.name || '');
    const gn = norm(c.groupName || '');

    // EXACT matches (220-200) — usuario nomeou identico ao briefing
    if (vnNorm && vnNorm === u) { score = 220; matchedBy = 'voice_name_exact'; }
    else if (nm && nm === u) { score = 210; matchedBy = 'name_exact'; }
    else if (gn && gn === u) { score = 200; matchedBy = 'group_exact'; }
    // CONTAINS matches (180-140) — substring de qualquer lado
    else if (vnNorm && (vnNorm.includes(u) || u.includes(vnNorm))) { score = 180; matchedBy = 'voice_name_contains'; }
    else if (nm && (nm.includes(u) || u.includes(nm))) { score = 170; matchedBy = 'name_contains'; }
    else if (vnCore && uCore && vnCore === uCore) { score = 150; matchedBy = 'voice_name_fuzzy'; }
    else if (gn && (gn.includes(u) || u.includes(gn))) { score = 140; matchedBy = 'group_contains'; }
    else {
      // Tokens (30/token, fraco)
      const haystack = `${nm} ${gn}`;
      const tokens = username.toLowerCase().split(/[._-]+|(?=\d)/).filter((t) => t.length >= 3);
      for (const t of tokens) {
        const tn = norm(t);
        if (tn && haystack.includes(tn)) score += 30;
      }
      if (score > 0) matchedBy = 'name_tokens';
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { c, score, matchedBy };
    }
  }
  return best ? { ...best.c, score: best.score, matchedBy: best.matchedBy } : null;
}
