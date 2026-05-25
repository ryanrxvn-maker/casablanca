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
  /^link\s+do\s+avatar\b/i,               // "Link do avatar:" → parseGlobalAvatarLinks
  /^avatar\s+do\s+video\b/i,              // "Avatar do video:"
  /^avatar\s+global\b/i,                  // "Avatar global:"
  /^avatar\s+padr[aã]o\b/i,               // "Avatar padrão:"
  /^link\s+avatar\b/i,                    // "Link avatar:"
  /^link\s+do\s+ad\b/i,                   // "Link do ad:" (VA briefing)
  /^depoimento\b/i,                       // "Depoimento com avatar:"
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
 *  Formatos aceitos (em ordem de prioridade):
 *    1. "Mulher: @vivian.lamounier1.mp4"                 — role: @user.mp4
 *    2. "Doutor: thethaetresmyarena.mp4"                 — sem @
 *    3. "Leandro (Homem depoimento): @kiko.urso3.mp4"    — role com parens
 *    4. "Mulher (Esposa de Leandro): @anapaulalima.mp4"
 *    5. "Voz do Homem: @manualdohomemsolo2.mp4"          — role com prep
 *    6. "1. Doutor: @x.mp4"                              — prefixo numerico
 *    7. "- Mulher: @x.mp4"                               — prefixo bullet
 *    8. "Avatar 1: @x.mp4" / "Avatar 2: @y"              — role genérico
 *    9. "Doutor: @kiko.urso3.mp4 (10s)"                  — comentario apos
 *   10. "@kiko.urso3.mp4" sozinho na linha                — sem role, infere "Avatar"
 *   11. Role na linha N + @user na linha N+1 (multi-line)
 *
 *  Filtra metadados ("Voz:", "Referência:", "Atenção:", "Caixinha:",
 *  "Avatar fala:", "Instruções:", "Observação:") que aparecem em briefings
 *  mas NAO sao avatares. */
export function parseAvatars(section: string): ParsedAvatar[] {
  const out: ParsedAvatar[] = [];
  const lines = section.split(/\r?\n/);

  // Regex 1: linha completa "[prefixo opcional] Role: <username>"
  // Onde <username> e:
  //   a. @user (com ou sem .mp4/.mov)
  //   b. user.mp4 ou user.mov (sem @, mas com extensao OBRIGATORIA)
  //   c. Display name com espacos + .mp4 (ex: "Dr. Marco Túlio.mp4")
  //
  // Role aceita ' - ' DENTRO (ex: "Homem - Ator pornô", "Doutor - Caixa de Pergunta",
  // "João - Homem Depoimento"). Acentos via À-ÿ.
  //
  // CRITICAL: tem que ter @ OU .mp4/.mov pra evitar match em narrativa
  // tipo "Mulher: voce ja sentiu..." que pega "voce" como username.
  // Cauda: parens, traco ou comentario opcional apos o filename.
  const reFullLine = /^[\s•\-*\d.)\]]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s()0-9\-]{0,58}?):\s*[^@a-zA-ZÀ-ÿ0-9_]*(?:@([A-Za-zÀ-ÿ0-9_][\w.À-ÿ_-]{2,})(?:\.(?:mp4|mov))?|([A-Za-zÀ-ÿ][\wÀ-ÿ.\s_-]{2,}?)\.(?:mp4|mov))\s*(?:[\s\-(.,].*)?$/i;

  // Regex 2: linha com SO @username (sem role), tipo "@manualdohomemsolo.mp4"
  const reOnlyMention = /^[\s•\-*\d.)\]]*@([A-Za-z0-9][\w._-]+?)(?:\.(?:mp4|mov))?\s*$/i;

  // Regex 3: linha que e SO um role (role unique without value), tipo "Doutor:" ou "Mulher (Esposa):"
  const reRoleOnly = /^[\s•\-*\d.)\]]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s()]{0,58}?):\s*$/i;

  // Estado pra multi-line: role detectado, esperando @ na linha seguinte
  let pendingRole: string | null = null;
  let pendingRoleLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      // Linha em branco invalida pending role
      if (pendingRole) {
        pendingRole = null;
        pendingRoleLine = -1;
      }
      continue;
    }

    // Pula linhas que parecem ser comentarios pesados (urls, etc)
    if (/^https?:\/\//.test(trimmed)) continue;

    // Tentativa 1: linha completa "Role: @user[.mp4]" OU "Role: user.mp4"
    // Grupo 2 = username com @, Grupo 3 = username sem @ (com extensao obrigatoria)
    const m1 = trimmed.match(reFullLine);
    if (m1) {
      const role = m1[1].trim();
      // Strip extensao .mp4/.mov caso o regex greedy tenha incluido
      let username = (m1[2] || m1[3] || '').trim().replace(/\.(mp4|mov)$/i, '');
      if (isPlausibleAvatarRole(role) &&
          username.length >= 3 &&
          !/^(http|https|www|exemplo|ex)$/i.test(username) &&
          !/^\d+$/.test(username) &&
          !/^AD\d+VN/i.test(username)) {
        out.push({ role, username, raw: trimmed });
        pendingRole = null;
        pendingRoleLine = -1;
        continue;
      }
    }

    // Tentativa 2: @username sozinho na linha — se temos pending role, casa
    const m2 = trimmed.match(reOnlyMention);
    if (m2) {
      const username = m2[1].trim();
      if (username.length >= 3 &&
          !/^(http|https|www|exemplo|ex)$/i.test(username) &&
          !/^\d+$/.test(username) &&
          !/^AD\d+VN/i.test(username)) {
        let role = pendingRole;
        // Se nao tem pending role, infere "Avatar"
        if (!role || (i - pendingRoleLine) > 2) {
          role = 'Avatar';
        }
        out.push({ role, username, raw: trimmed });
        pendingRole = null;
        pendingRoleLine = -1;
        continue;
      }
    }

    // Tentativa 3: role only (ex "Doutor:") — guarda pra proxima linha
    const m3 = trimmed.match(reRoleOnly);
    if (m3) {
      const role = m3[1].trim();
      if (isPlausibleAvatarRole(role)) {
        pendingRole = role;
        pendingRoleLine = i;
        continue;
      }
    }

    // Nada deu match — invalida pending role apos 2 linhas
    if (pendingRole && (i - pendingRoleLine) > 2) {
      pendingRole = null;
      pendingRoleLine = -1;
    }
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
 *
 *  Tambem aceita formato 2-linhas (Google Docs em tabela):
 *    Linha N:   "Link do avatar:"
 *    Linha N+1: "omédicodoshomens.mp4"  ← filename pode ser um <a> link
 */
export function parseGlobalAvatarLink(section: string): { role: string; username: string } | null {
  const all = parseGlobalAvatarLinks(section);
  return all.length > 0 ? all[0] : null;
}

/**
 * Versao MULTI-AVATAR de parseGlobalAvatarLink. Retorna TODOS os avatares
 * mencionados na linha "Link do avatar:".
 *
 * Suporta separadores: "+", ",", " e ", " / ", " | ".
 *
 * Ex doc AD05VN-VRWA01:
 *   "Link do avatar: monetzamoraa.mp4 + feliperocha3.mp4"
 *   → [{role:'Avatar 1', username:'monetzamoraa'},
 *      {role:'Avatar 2', username:'feliperocha3'}]
 *
 *  Quando body tem labels de speaker ("Mulher", "Doutor"), splitBySpeaker
 *  no body decide quem fala o que. Os roles aqui ficam como "Avatar N"
 *  generico — o user pode renomear pelo UI se quiser, ou o splitter
 *  associa pela ordem dos labels no body.
 */
export function parseGlobalAvatarLinks(section: string): Array<{ role: string; username: string }> {
  const lines = section.split(/\r?\n/);

  // Filename de avatar: @opcional + chars (incluindo acentos + espacos)
  // Aceita: @user.mp4 / user.mp4 / Dr. Marco Túlio.mp4
  const filenameTokenRe = /@?([a-zA-ZÀ-ÿ0-9_][a-zA-ZÀ-ÿ0-9._\s-]*?)\.(?:mp4|mov)\b/gi;

  // Pattern de header: "Link do avatar:" (varia: "Avatar do video:", etc)
  const headerRe = /^(?:link\s+do\s+avatar|avatar\s+do\s+video|avatar\s+global|avatar\s+padr[aã]o|link\s+avatar)\s*[:\-]?\s*(.*)$/i;

  const collect = (text: string, out: Array<{ role: string; username: string }>): void => {
    // Extrai TODOS os "<name>.mp4" da string (suporta "+", ",", " e ", etc.)
    filenameTokenRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = filenameTokenRe.exec(text)) !== null) {
      const u = m[1].trim();
      if (u.length >= 3 && !/^(http|https|www|drive|google)$/i.test(u)) {
        const role = out.length === 0 ? 'Avatar' : `Avatar ${out.length + 1}`;
        // Dedup por username
        if (!out.some((a) => a.username.toLowerCase() === u.toLowerCase())) {
          out.push({ role, username: u });
        }
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const mh = t.match(headerRe);
    if (!mh) continue;
    const out: Array<{ role: string; username: string }> = [];
    // Mesma linha (apos ":")
    const restOfLine = mh[1].trim();
    if (restOfLine) collect(restOfLine, out);
    // Proximas 3 linhas — caso tabela/multi-line
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (/^(instru[cç][oõ]es|aten[cç][aã]o|observa[cç][aã]o|caixinha)/i.test(next)) break;
      if (/^https?:\/\//.test(next)) continue;
      const sizeBefore = out.length;
      collect(next, out);
      if (out.length === sizeBefore) break; // linha sem filename — para
    }
    if (out.length > 0) {
      // Se 1 unico avatar, mantem role 'Avatar' (compat com parseGlobalAvatarLink).
      // Se >= 2, ja vem como 'Avatar 1', 'Avatar 2', ...
      if (out.length === 1) return out;
      return out.map((a, idx) => ({ role: `Avatar ${idx + 1}`, username: a.username }));
    }
  }
  return [];
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
  // Captura "Palavra" inicial (head do role — o nome principal). Apos isso
  // pode vir QUALQUER coisa antes do ":" enquanto for label de briefing:
  //   parens "(Homem depoimento)", trace " - Ator pornô", palavras extras.
  // Tudo ate o ":" e ignorado; so o head e retornado como role name.
  //
  // Patterns suportados:
  //   "Doutor:"
  //   "Leandro (Homem depoimento):"
  //   "Homem - Ator pornô:"
  //   "Mulher (Esposa de Leandro):"
  //   "Voz do Homem:"
  //   "Avatar 1:"
  const m = t.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)?)(?:[\s\-–—()][A-Za-zÀ-ÿ0-9 \-\(\)]{0,60})?\s*:/);
  if (!m) return null;
  const role = m[1].trim();
  if (role.length > 30) return null;
  return role;
}

/** Linha que e SO um role label (ex "Mulher:") ou role + mention (ex "Mulher: @x.mp4")
 *  ou so um mention solo (ex "@manualdohomemsolo1.mp4"). Descartar inteira. */
function isPureRoleOrMentionLine(line: string): boolean {
  // Normaliza trailing markers (" p", ".p", "[a]") que o copywriter coloca
  // como controle de paragrafo — nao sao texto da fala nem do label.
  const cleaned = (line || '')
    .replace(/\s*\[[a-z]{1,3}\]\s*$/i, '')
    .replace(/\s+[a-z]{1,2}\.?\s*$/i, '')
    .replace(/\.[a-z]{1,2}\s*$/i, '');
  const t = cleaned.trim();
  // Bloqueia frases reais — se tem virgula ANTES do primeiro ":" e provavel
  // fala ("Doutor, voce sabe que..." nao deve ser tratado como label).
  const colon = t.indexOf(':');
  if (colon > 0 && t.slice(0, colon).includes(',')) return false;

  // Pattern unico flexivel:
  //   <Role-head: 1-3 palavras alpha>
  //   <opcional: extras com parens / trace / palavras adicionais>
  //   ":"
  //   <opcional: mention @x.mp4 OU filename.mp4>
  //
  // Cobre: "Mulher:", "Voz do Homem:", "Leandro (Homem depoimento):",
  //        "Homem - Ator pornô:", "Mulher (Esposa de Leandro): @x.mp4",
  //        "Doutor: thethaetresmyarena.mp4"
  if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}(?:[\s\-–—()][A-Za-zÀ-ÿ0-9 \-\(\)]{0,60})?\s*:\s*(?:[^@\w]*@?[\w._\-À-ÿ]+(?:\.(?:mp4|mov))?)?\s*$/i.test(t)) {
    // Garante que o "head" (antes de qualquer separador) e curto
    const head = t.split(/[\s\-–—():]/)[0];
    if (head.length >= 2 && head.length <= 30) return true;
  }
  // "@x.mp4" — so mention solo
  if (/^@[\w._\-À-ÿ]+(?:\.(?:mp4|mov))?\s*$/i.test(t)) return true;
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
  /** Body CONCATENADO (todos os segmentos juntos) — pra UI display + bodyRaw.
   *  Pra dispatch, use bodySegments. */
  body: string | null;
  /** Quem fala o body (role do PRIMEIRO segmento — compat). */
  bodyRole: string | null;
  /** Body segmentado por SPEAKER. Cada item = um trecho falado por um role
   *  diferente. Usado pelo dispatch pra criar partTemplates por avatar.
   *  Quando body tem 1 unico speaker, bodySegments tem 1 item. */
  bodySegments: Array<{ role: string | null; text: string }>;
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
/**
 * SANITIZADOR AUTORITATIVO da fala (hook/body) — fonte unica de verdade.
 *
 * O briefing DARKO mistura, depois e DENTRO do roteiro falado, blocos que NAO
 * sao fala: nomenclatura do proximo AD ("AD15G2VN - PRPB06 - ..."), "Tela
 * dividida" + dezenas de links do Drive/TikTok, "Take logo de inicio", "Guia
 * N", "Link do avatar:", "Instruções para edição:", "Caixinha de perguntas:
 * ...", "Avatar fala: ...", "Doutor" (red, label de speaker), "Voz: ...",
 * "Referência: ...", "Atenção na Voz: ...", "Mulher (Esposa de X): @file.mp4"
 * (mention de speaker com filename inline). Antes isso vazava pra TTS e era
 * lido pelo avatar (filenames recitados, labels duplicados). Aqui cortamos
 * tudo de forma deterministica.
 *
 * Estrategia:
 *  1) Se houver marcador "BODY" isolado, comeca DEPOIS do ultimo.
 *  2) Corta na 1a ocorrencia de qualquer marcador de fim-de-fala
 *     (nomenclatura ADxGx, Guia N, Tela dividida, Take logo/de inicio,
 *     URL, Link do avatar:, Instruções para edição:), inclusive colado
 *     no fim da ultima frase ("...pra ver. Guia 4").
 *  3) Limpa linhas residuais: URLs, "Tela dividida", linhas de metadata
 *     ("Voz:", "Referência:", "Atenção:", "Observação:", "Nota:",
 *     "Instruções:"), label de speaker com OU sem mention/filename
 *     ("Mulher:", "Leandro (Homem depoimento): @kiko.urso3.mp4",
 *     "Doutor: tarena.mp4"), label de UI ("Caixinha de perguntas: ...",
 *     entire line — texto duplica "Avatar fala:" depois), mention solo
 *     (@x.mp4) e marcadores [a-z].
 *  4) Strip "Avatar fala:" prefix (essa LINHA contem a fala real).
 *  5) Strip role-only words (Doutor / Mulher / Leandro / etc) na sua linha.
 *  6) Normaliza espacos.
 *
 * @param raw      texto bruto
 * @param knownRoles  roles do briefing pra ajudar a identificar labels
 *                    soltos ("Doutor" sozinho na linha indica speaker, mas
 *                    sem essa lista nao da pra distinguir de fala normal).
 */
export function sanitizeSpokenCopy(raw: string, knownRoles: string[] = []): string {
  let s = (raw || '').replace(/\r/g, '');

  // (1) ancora no ultimo "BODY" isolado (linha "BODY" ou "BODY:")
  const bodyMarkerRe = /(?:^|\n)[ \t]*BODY[ \t]*:?[ \t]*(?:\n|$)/gi;
  let bm: RegExpExecArray | null;
  let lastBodyEnd = -1;
  while ((bm = bodyMarkerRe.exec(s)) !== null) lastBodyEnd = bm.index + bm[0].length;
  if (lastBodyEnd >= 0) s = s.slice(lastBodyEnd);

  // Set lowercased dos roles conhecidos pra detectar label solto ("Doutor"
  // sozinho na linha). Tambem inclui um conjunto core mesmo se knownRoles
  // vazio — cobre briefings sem avatares mapeados.
  const knownRoleSet = new Set<string>([
    'doutor', 'doutora', 'dr', 'dra',
    'mulher', 'homem',
    'narrador', 'narradora', 'locutor', 'locutora',
    'avatar', 'voz',
    'esposa', 'marido',
    'depoimento', 'entrevistador', 'entrevistadora',
    ...knownRoles.map((r) => r.toLowerCase().trim()),
    // Tambem o "core" da role (1a palavra) — ex "Leandro (Homem depoimento)"
    // → tambem matcha "leandro" sozinho.
    ...knownRoles.map((r) => r.toLowerCase().trim().split(/[\s(]/)[0]),
  ].filter(Boolean));

  // Padrao role label generico: 1-4 palavras letras+acentos, opcional
  // " (extras quaisquer)", terminando OU ":" + filename OU ":" sozinho
  // OU nada (label solto). Usado pra filtrar linhas residuais.
  //
  //   "Mulher:"
  //   "Mulher (Esposa de Leandro):"
  //   "Mulher (Esposa de Leandro): @anapaulalima1.mp4"
  //   "Leandro (Homem depoimento): @kiko.urso3.mp4"
  //   "Doutor: thethaetresmyarena.mp4"
  //   "Voz do Homem:"
  //   "Doutor"  ← label solto (red)
  const roleLineRe = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 \-]{0,40}?)(?:\s*\([^)]{0,80}\))?\s*(?::\s*(?:[^@a-zA-ZÀ-ÿ0-9]*@?[\w._\-À-ÿ]+(?:\.(?:mp4|mov))?)?)?\s*$/i;

  // (3) limpa linhas residuais que nao sao fala
  s = s
    .split('\n')
    .map((l) => {
      // Normaliza trailing markers (" p", ".p", "[a]") pro teste, mas mantem
      // o `l` original pra preservar formatacao quando a linha for de fala real.
      const cleaned = l
        .replace(/\s*\[[a-z]{1,3}\]\s*$/i, '')
        .replace(/\s+[a-z]{1,2}\.?\s*$/i, '')
        .replace(/\.[a-z]{1,2}\s*$/i, '');
      const t = cleaned.trim();
      if (!t) return l; // preserva paragrafos
      // URLs / referencias
      if (/(https?:\/\/|\bwww\.[a-z0-9-]+\.|drive\.google\.com|tiktok\.com)/i.test(t)) return null;
      // Markers
      if (/Tela\s*dividida/i.test(t)) return null;
      if (/^(Link\s+do\s+avatar|Instru[cç][õo]es)\s*[:\-]/i.test(t)) return null;
      // Metadata prefixes — entire line out
      if (/^(Voz(?:\s+(?:do|da|de|off|over)\s+\w+)?|Refer[eê]ncia|Aten[cç][aã]o(?:\s+\w+)?|Observa[cç][aã]o|Obs|Nota)\s*[:\-]/i.test(t)) return null;
      // "Caixinha de perguntas: ..." (entire line — texto duplica em "Avatar fala:")
      if (/^Caixinha\s+de\s+perguntas\s*[:\-]/i.test(t)) return null;
      // "Avatar fala: <texto>" — STRIP PREFIX, mantem texto
      const af = t.match(/^Avatar\s+fala\s*[:\-]\s*(.*)$/i);
      if (af) {
        const after = af[1].trim();
        return after ? l.replace(/^(\s*)Avatar\s+fala\s*[:\-]\s*/i, '$1') : null;
      }
      // mention solo (@x.mp4)
      if (/^@[\w._\-À-ÿ]+(?:\.(?:mp4|mov))?\s*$/i.test(t)) return null;
      // filename solto sem @ (ex "thethaetresmyarena.mp4" ou "kiko.urso3.mp4")
      if (/^[\w._\-À-ÿ]+\.(?:mp4|mov)\s*$/i.test(t)) return null;
      // METADATA MULTI-LABEL: linha que tem ":" + (.mp4|.mov|nomenclatura ADxxx).
      // Cobre o caso "Doutor: radyrahbanmd.mp4 - Voz do Doutor: AD600VN[T]-VFPB02-AVA01.mp4"
      // — multiplos labels + filenames combinados em UMA linha. NUNCA e fala.
      // Tambem cobre "Voz: AD600VN...mp4", "Referência: ARQUIVO.mp4". Speech real
      // nunca contem ".mp4" nem "AD<num>-" nomenclatura.
      if (/:/.test(t) && /(\.(?:mp4|mov)\b|\bAD\d{1,5}[A-Z0-9]*\s*[-_]\s*[A-Z]{2,})/i.test(t)) return null;
      // linha de role/speaker label — cobre TODAS variacoes:
      //   "Role:" / "Role: @file.mp4" / "Role: file.mp4" /
      //   "Role (extras):" / "Role (extras): @file.mp4" /
      //   "Role - extras:" / "Role - extras: @file.mp4"
      // CRITERIO: parte antes do ":" tem que parecer label (head curto, ate
      // 3 palavras antes de qualquer separador). Bloqueia fala ("Eu disse: oi"
      // tem head "Eu" e funcionaria, mas "Eu" raramente sera primeira linha).
      // Reject linhas que tem virgula ANTES do ":" — sinal de fala.
      const colonIdx = t.indexOf(':');
      const beforeColon = colonIdx > 0 ? t.slice(0, colonIdx) : '';
      const hasCommaBeforeColon = beforeColon.includes(',');
      if (!hasCommaBeforeColon && /^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}(?:[\s\-–—()][A-Za-zÀ-ÿ0-9 \-\(\)]{0,60})?\s*:\s*(?:[^@\w]*@?[\w._\-À-ÿ]+(?:\.(?:mp4|mov))?)?\s*$/i.test(t)) {
        // head = primeira palavra antes de qualquer separador
        const head = t.split(/[\s\-–—():]/)[0];
        if (head.length >= 2 && head.length <= 30) {
          return null;
        }
      }
      // role-label solto sem ":" — ex "Doutor" sozinho (red). Tem que matchar
      // role conhecido pra evitar false-positive em fala normal.
      // Aceita tambem "Homem - Ator pornô" (com trace).
      if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 \-\(\)]{0,40}$/.test(t)) {
        const head = t.split(/[\s\-–—():]/)[0].toLowerCase();
        if (knownRoleSet.has(head)) return null;
      }
      return l;
    })
    .filter((l): l is string => l !== null)
    .join('\n')
    .replace(/\s*\[[a-z]{1,3}\]/gi, ''); // marcadores [a]/[abc]

  // (4) AGORA corta no 1o marcador de fim-de-fala — depois do filtro de
  // metadata. Isso evita que a nomenclatura "AD600VN[T]-VFPB02" que vive
  // DENTRO de linha de metadata corte fala legitima que vem DEPOIS daquela
  // linha (bug real: hook "Tem algo bloqueando..." era descartado porque
  // o cut acontecia mid-line na linha "Doutor: x.mp4 - Voz: AD600VN...").
  const endMarkers: RegExp[] = [
    /\bAD\d{1,5}[A-Z0-9]*\s*-\s*[A-Z]{2,}\d*/, // nomenclatura ("AD15G2VN - PRPB06")
    /\bGuia\s*\d/i,
    /Tela\s*dividida/i,
    /Take\s+(?:logo|de\s+in[íi]cio)/i,
    /https?:\/\//i,
    /\bwww\.[a-z0-9-]+\./i,
    /drive\.google\.com/i,
    /tiktok\.com/i,
    /Link\s+do\s+avatar\s*:/i,
    /Instru[cç][õo]es\s+para\s+edi[cç][aã]o\s*:/i,
  ];
  let cut = s.length;
  for (const re of endMarkers) {
    const m = s.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  s = s.slice(0, cut);

  // (5) normaliza
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Detecta se uma linha e um "speaker label" — indica QUEM fala a partir dali.
 * Retorna o role normalizado (ex "Mulher", "Doutor", "Leandro") ou null.
 *
 * Aceita formatos:
 *   "Mulher:"                              → "Mulher"
 *   "Mulher: @x.mp4"                       → "Mulher"
 *   "Mulher (Esposa de Leandro): @x.mp4"   → "Mulher"
 *   "Leandro (Homem depoimento): @x.mp4"   → "Leandro"
 *   "Doutor"                               → "Doutor" (so se em knownRoles)
 *   "Voz do Homem:"                        → "Voz do Homem"
 *
 * REJEITA frases normais ("Eu disse: oi", "Doutor, voce sabe...").
 */
export function detectSpeakerLabelLine(line: string, knownRoles: string[] = []): string | null {
  // Tira marcadores [a]/[abc] e trailing curto (" p", " p.", " .p") que
  // alguns copywriters deixam no fim das linhas como controle de paragrafo.
  // Sem isso, "Mulher: @x.mp4 p" nao matcha como speaker label e a fala
  // dela vaza pro segmento anterior — bug real reportado pelo user.
  const cleaned = (line || '')
    .replace(/\s*\[[a-z]{1,3}\]\s*$/i, '')          // " [a]" / " [ab]"
    .replace(/\s+[a-z]{1,2}\.?\s*$/i, '')           // " p" / " pa" / " p."
    .replace(/\.[a-z]{1,2}\s*$/i, '');               // ".p" / ".pa"
  const t = cleaned.trim();
  if (!t) return null;
  // Reject linhas que tem virgula ANTES do ":" — provavelmente fala
  // (ex "Doutor, voce sabe...:").
  const colonIdx = t.indexOf(':');
  if (colonIdx > 0 && t.slice(0, colonIdx).includes(',')) return null;

  // Padrao: "Role-head[ extras: parens/trace/palavras][: opcional filename]"
  // Captura SO o head (primeira palavra ou 2-3 palavras alpha).
  // Aceita: "Doutor:", "Voz do Homem:", "Leandro (Homem depoimento):",
  //         "Homem - Ator pornô:", "Mulher (Esposa de Leandro): @x.mp4"
  const m = t.match(/^([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})(?:[\s\-–—()][A-Za-zÀ-ÿ0-9 \-\(\)]{0,60})?\s*(?::\s*(?:[^@a-zA-ZÀ-ÿ0-9]*@?[\w._\-À-ÿ]+(?:\.(?:mp4|mov))?)?)?\s*$/);
  if (!m) return null;
  const head = m[1].trim();
  if (!head) return null;
  const wordCount = head.split(/\s+/).length;
  if (wordCount > 3 || head.length > 40) return null;

  // Reject linhas que NAO terminam com ":", ".mp4" ou parens/trace — i.e.
  // palavras soltas sem indicador de label. Aceita SO se o head matcha
  // role conhecido.
  const hasColon = t.includes(':');
  const hasFilename = /\.(?:mp4|mov)\b/i.test(t);
  const hasParens = /\(/.test(t);
  const hasTrace = /\s[\-–—]\s/.test(t);

  if (!hasColon && !hasFilename && !hasParens && !hasTrace) {
    // Label solto — precisa matchar role conhecido
    const knownSet = new Set<string>([
      'doutor', 'doutora', 'dr', 'dra',
      'mulher', 'homem',
      'narrador', 'narradora', 'locutor', 'locutora',
      'avatar', 'voz',
      ...knownRoles.map((r) => r.toLowerCase().trim()),
      ...knownRoles.map((r) => r.toLowerCase().trim().split(/[\s(\-]/)[0]),
    ].filter(Boolean));
    if (!knownSet.has(head.toLowerCase())) return null;
  }

  return head;
}

/**
 * Segmenta um bloco de texto (body ou hook) em partes por SPEAKER.
 *
 * Cada vez que aparece um "speaker label" (linha "Role:" / "Role (extras):
 * @file.mp4" / "Role" solo), inicia uma nova sub-secao com aquele role.
 * Texto antes do primeiro speaker label vai pra primeira secao (com role
 * = firstRole se conhecido, senao null).
 *
 * Linhas que SAO speaker labels NAO entram na fala — sao descartadas.
 * Linhas "Avatar fala: X" tem o prefixo removido (X entra na fala).
 *
 * Saida: array de {role, text} — text ja sem labels mas SEM ainda passar
 * por sanitizeSpokenCopy (caller deve sanitizar cada segmento).
 */
export function splitBySpeaker(
  raw: string,
  knownRoles: string[] = [],
  firstRole: string | null = null,
): Array<{ role: string | null; text: string }> {
  const lines = (raw || '').replace(/\r/g, '').split('\n');
  const segments: Array<{ role: string | null; lines: string[] }> = [
    { role: firstRole, lines: [] },
  ];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) {
      segments[segments.length - 1].lines.push(ln);
      continue;
    }
    const role = detectSpeakerLabelLine(t, knownRoles);
    if (role) {
      // Inicia novo segmento. Se segment atual nao tem conteudo util,
      // sobrescreve o role dele (provavel caso da PRIMEIRA linha ser label).
      const cur = segments[segments.length - 1];
      const curHasText = cur.lines.some((l) => l.trim().length > 0);
      if (!curHasText) {
        cur.role = role;
      } else {
        segments.push({ role, lines: [] });
      }
      continue;
    }
    segments[segments.length - 1].lines.push(ln);
  }
  return segments
    .map((s) => ({ role: s.role, text: s.lines.join('\n').trim() }))
    .filter((s) => s.text.length > 0);
}

export function parseDarkoBriefing(fullDocText: string, baseAdId: string): ParsedDarkoBriefing | null {
  const baseSection = findAdSection(fullDocText, baseAdId);
  if (!baseSection) return null;
  let avatars = parseAvatars(baseSection);
  // Fallback: alguns ADs usam 'Link do avatar: <file>' em vez de 'Avatar:'
  // — vira avatar GLOBAL da copy (todos hooks + body desse avatar).
  // Suporta MULTIPLOS avatares na mesma linha separados por +/,/e:
  //   "Link do avatar: monetzamoraa.mp4 + feliperocha3.mp4"
  //   → 2 slots (Avatar 1, Avatar 2). Body com labels Mulher/Doutor
  //   vira 2 segmentos no splitBySpeaker — user atribui avatar por slot.
  if (avatars.length === 0) {
    const globals = parseGlobalAvatarLinks(baseSection);
    if (globals.length > 0) {
      avatars = globals.map((g) => ({
        role: g.role,
        username: g.username,
        raw: `Link do avatar: ${g.username}.mp4`,
      }));
    }
  }
  // Coleta roles do briefing pra ajudar o sanitizador a detectar labels
  // soltos ("Doutor", "Mulher" em vermelho — sem ":" nem filename).
  const knownRoles: string[] = [];
  for (const a of avatars) {
    if (a.role) knownRoles.push(a.role);
  }
  const siblings = findGSiblings(fullDocText, baseAdId);
  const hooks: ParsedDarkoBriefing['hooks'] = [];
  let body: string | null = null;
  let bodyRole: string | null = null;
  let bodySegments: Array<{ role: string | null; text: string }> = [];
  for (const sib of siblings) {
    const parsed = parseGSibling(sib.section);
    // CADA SIBLING = EXATAMENTE 1 HOOK (mesmo que tenha multiplos paragrafos).
    // Hook num = sourceG (G1 → HOOK 1, G2 → HOOK 2, etc). Garante alinhamento
    // 1:1 com a nomenclatura do briefing — NUNCA infla a contagem de hooks.
    if (parsed.hook) {
      // Hook costuma ter 1 speaker, mas o "Role (extras): @file.mp4" header
      // pode vir embutido — sanitize com knownRoles tira o resto.
      const hookText = sanitizeSpokenCopy(parsed.hook.text, knownRoles);
      if (hookText) {
        hooks.push({
          label: `HOOK ${sib.gNum}`,
          text: hookText,
          sourceG: sib.gNum,
          role: parsed.hook.role,
        });
      }
    }
    // Body geralmente esta no ultimo sibling. Sobrescreve pra pegar o ultimo
    // (caso mais de um sibling tenha body — improvavel mas seguro).
    if (parsed.body) {
      // Segmenta body POR SPEAKER antes de sanitizar — speaker labels viram
      // boundaries de segmento, nao sao lidos como fala.
      const segs = splitBySpeaker(parsed.body.text, knownRoles, parsed.body.role)
        .map((s) => ({ role: s.role, text: sanitizeSpokenCopy(s.text, knownRoles) }))
        .filter((s) => s.text.length > 0);
      if (segs.length > 0) {
        bodySegments = segs;
        body = segs.map((s) => s.text).join('\n\n');
        bodyRole = segs[0].role;
      }
    }
  }

  // RENAME AUTOMATICO: quando avatares vieram de "Link do avatar: a.mp4 + b.mp4"
  // (roles genericos "Avatar", "Avatar 2"...) E o body/hooks tem speaker labels
  // explicitos (ex "Mulher", "Doutor"), casa POR ORDEM DE APARICAO.
  //
  // Ex AD05VN: avatars=[Avatar 1: monetzamoraa, Avatar 2: feliperocha3]
  //   body: [Mulher: ..., Doutor: ...]
  //   → rename: [Mulher: monetzamoraa, Doutor: feliperocha3]
  //
  // Isso faz o slotsByRole no dispatch achar "mulher" → @monetzamoraa
  // direto. Sem isso, dispatch caia em firstSlot (sempre o 1o avatar)
  // pra tudo.
  const avatarsAreGeneric = avatars.length > 0 && avatars.every((a) => /^avatar(?:\s+\d+)?$/i.test(a.role.trim()));
  if (avatarsAreGeneric) {
    // Coleta roles unicos detectados em ordem (hooks primeiro, dps body)
    const detected: string[] = [];
    const seen = new Set<string>();
    const pushRole = (r: string | null) => {
      if (!r) return;
      const key = r.toLowerCase().trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      detected.push(r);
    };
    for (const h of hooks) pushRole(h.role);
    for (const s of bodySegments) pushRole(s.role);
    // Renomeia pelos labels detectados (ate o limite de avatars disponiveis)
    if (detected.length > 0) {
      avatars = avatars.map((a, i) => detected[i] ? { ...a, role: detected[i] } : a);
    }
  }

  return {
    baseAdId,
    avatars,
    hooks,
    body,
    bodyRole,
    bodySegments,
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

  // 0. EXTRAI AD CODE do task name (ex 'VA - AD07G1VN - PRPB06' → 'AD07G1VN')
  // CRITICAL: doc pode ter MULTIPLAS sections VA (uma por AD). Sem esse scope,
  // o parser sempre pegava a primeira section, mesmo que a task seja de outro AD.
  // Bug visto live em 2026-05-25: task "VA - AD07G1VN-PRPB06" deveria parsear
  // a section "AD07G1VN-PRPB06" (com AVA03+04), mas pegava a section "AD03G1VN"
  // (com AVA01-06). Fix: prioriza header que contenha o AD code da task.
  const adCodeMatch = baseAdIdOrTaskName.match(/AD\d+[A-Z]+/i);
  const adCode = adCodeMatch ? adCodeMatch[0].toUpperCase() : null;

  // 1. Detecta header VA: PRIORIZA linha que contenha AD code + "Variação de avatar".
  // Fallback: primeira linha com "Variação de avatar".
  //
  // CRITICAL — preferencia pela ULTIMA ocorrencia quando o mesmo AD code
  // aparece em multiplas LEVAS do doc (LEVA 01 antiga + LEVA 03 nova).
  // User esclareceu 2026-05-25: "caso tenha mesma nomenclatura de AD da
  // task repetindo na VA, 2 iguais no docs, nesse caso voce dar preferencia
  // a que foi colocada mais recente no docs".
  let vaHeaderIdx = -1;
  if (adCode) {
    // 1a) Acha header DESSE AD especifico — overwriting pra ficar com o ULTIMO
    const adRegex = new RegExp(adCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (let i = 0; i < lines.length; i++) {
      if (/varia[cç][aã]o\s+de\s+avatar/i.test(lines[i]) && adRegex.test(lines[i])) {
        vaHeaderIdx = i; // SEM break → pega o ULTIMO match (mais recente no doc)
      }
    }
  }
  if (vaHeaderIdx < 0) {
    // 1b) Fallback: primeira "Variação de avatar" — doc unico-AD mantem
    // comportamento antigo
    for (let i = 0; i < lines.length; i++) {
      if (/varia[cç][aã]o\s+de\s+avatar/i.test(lines[i])) {
        vaHeaderIdx = i;
        break;
      }
    }
  }
  if (vaHeaderIdx < 0) return null;

  // 2. Extrai base AD ID — primeira parte do header antes de "- Variação"
  // Ex: "AD31G1VN - ME - Variação de avatar - SILAS" → "AD31G1VN - ME"
  const header = lines[vaHeaderIdx].trim();
  const baseMatch = header.match(/^(.+?)\s*[-–—]\s*varia[cç][aã]o/i);
  const baseAdId = baseMatch ? baseMatch[1].trim() : baseAdIdOrTaskName;

  // 2.5 BOUND END OF SECTION: proxima ocorrencia de "Variação de avatar"
  // marca o inicio da section seguinte (outro AD). Sem isso, o parser
  // varria avatares e gancho/body de sections seguintes.
  let vaSectionEnd = lines.length;
  for (let i = vaHeaderIdx + 1; i < lines.length; i++) {
    if (/varia[cç][aã]o\s+de\s+avatar/i.test(lines[i])) {
      vaSectionEnd = i;
      break;
    }
  }

  // 3. Link do AD: linha "Link do ad: <filename>" ou similar.
  // Aceita filenames com acentos/cedilha (ex: AÇAFRÃO.mp4) — regex
  // permissivo (todos chars exceto espaço/<>"|) terminando em .mp4/.mov.
  let linkAdFilename: string | null = null;
  let linkAdFileId: string | null = null;
  for (let i = vaHeaderIdx; i < Math.min(vaHeaderIdx + 15, lines.length); i++) {
    const t = lines[i].trim();
    // 1) Tenta extrair filename completo (inclui acentos)
    const m = t.match(/^link\s+do\s+ad\s*[:\-]\s*[^\S\n]*([^\s<>"|]+?\.(?:mp4|mov))\b/i);
    if (m) {
      linkAdFilename = m[1];
      // Match nos driveLinks por:
      //   a) text === filename
      //   b) text inclui filename
      //   c) filename ASCII-normalizado match com text ASCII-normalizado
      const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const targetNorm = norm(linkAdFilename!);
      const dl = driveLinks.find((d) =>
        d.text === linkAdFilename ||
        d.text.includes(linkAdFilename!) ||
        norm(d.text).includes(targetNorm) ||
        targetNorm.includes(norm(d.text))
      );
      if (dl) linkAdFileId = dl.fileId;
      break;
    }
  }

  // 4. Avatares de variacao: linhas tipo "<base>-AVA<NN>" seguidas de "Avatar <filename>"
  // Tambem aceita: AVAxx + Avatar @username.mp4
  // SCOPED a section atual (vaSectionEnd = inicio da proxima section ou EOF)
  const allAvatares: VAAvatar[] = [];
  const seenAvaCodes = new Set<string>();
  for (let i = vaHeaderIdx; i < vaSectionEnd; i++) {
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
  // SCOPED a vaSectionEnd pra nao puxar gancho da section seguinte
  let hookText = '';
  const gIdx = lines.findIndex((l, i) => i > vaHeaderIdx && i < vaSectionEnd && /^gancho\s*$/i.test(l.trim()));
  if (gIdx >= 0) {
    let end = vaSectionEnd;
    for (let i = gIdx + 1; i < vaSectionEnd; i++) {
      const t = lines[i].trim();
      if (/^body\s*$/i.test(t) || /^depoimento\b/i.test(t)) { end = i; break; }
    }
    hookText = lines.slice(gIdx + 1, end).join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  }

  // 6. Body — SCOPED a vaSectionEnd
  let bodyText = '';
  const bIdx = lines.findIndex((l, i) => i > vaHeaderIdx && i < vaSectionEnd && /^body\s*$/i.test(l.trim()));
  if (bIdx >= 0) {
    let end = vaSectionEnd;
    for (let i = bIdx + 1; i < vaSectionEnd; i++) {
      const t = lines[i].trim();
      if (/^depoimento\b/i.test(t)) { end = i; break; }
    }
    bodyText = lines.slice(bIdx + 1, end).join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  }

  // 7. Depoimento (opcional) — SCOPED a vaSectionEnd
  let depoimentoText: string | null = null;
  let depoimentoUsername: string | null = null;
  let depoimentoFileId: string | null = null;
  const dIdx = lines.findIndex((l, i) => i > vaHeaderIdx && i < vaSectionEnd && /^depoimento\s+com\s+avatar\s*[:\-]/i.test(l.trim()));
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
