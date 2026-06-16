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
 *
 * Aceita 3 níveis de match (do mais estrito ao mais relaxado):
 *   1. EXATO/PREFIX: linha === task OU starts-with (já era)
 *   2. CONTAINMENT por chars: mesmos chars alfa-num em qualquer ordem.
 *      Resolve casos onde o copywriter reorganiza o ID:
 *        Task:        "AD23VN - RIPSZ - G1"
 *        Doc heading: "AD23G1VN-RIPSZ"
 *      → mesmos chars (A,D,2,3,V,N,R,I,P,S,Z,G,1), só ordem mudou. MATCH.
 *   3. PREFIX por base (fallback final): "AD135GL" prefix → casa qualquer
 *      heading que comece com isso (já era).
 *
 * User esclareceu 2026-05-27: copywriter às vezes funde sufixos no meio
 * do AD code (G1 → AD23G1VN). Parser tem que ser inteligente.
 */
function adIdChars(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of s.toUpperCase().replace(/[^A-Z0-9]/g, '')) {
    m.set(c, (m.get(c) || 0) + 1);
  }
  return m;
}

/** Extrai o número do AD (ex "AD23VN" → "23", "AD234ABC" → "234").
 *  Crítico pra distinguir AD23 de AD234 — chars containment não basta. */
function extractAdNumber(s: string): string | null {
  const m = s.toUpperCase().match(/^AD(\d+)/);
  return m ? m[1] : null;
}

/** Heading match fuzzy: mesmos chars + mesmo número de AD.
 *  Ex válido:    "AD23VN" ↔ "AD23G1VN-RIPSZ"  (chars task ⊆ chars heading, mesmo AD23)
 *  Ex inválido:  "AD23"   ↔ "AD234ABCDE"       (AD23 ≠ AD234, mesmo containment)
 *  Ex inválido:  "AD23VN" ↔ "AD23QR-XYZ"      (sem V e N no heading)  */
function headingMatchesTaskFuzzy(heading: string, taskId: string): boolean {
  const taskNum = extractAdNumber(taskId);
  const headNum = extractAdNumber(heading);
  if (!taskNum || !headNum || taskNum !== headNum) return false;
  const taskChars = adIdChars(taskId);
  const headChars = adIdChars(heading);
  for (const [c, n] of taskChars) {
    if ((headChars.get(c) || 0) < n) return false;
  }
  return true;
}

/** Encontra o próximo heading AD após startIdx (delimita section). */
function findNextAdHeading(lines: string[], startIdx: number): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (AD_HEADING_RE.test(lines[i].trim())) return i;
  }
  return lines.length;
}

/** Heurística: section tem conteúdo de copy (hooks/body)?
 *  Usado pra escolher a melhor entre candidatas — intro (só link/instruções)
 *  perde pra body (com HOOK/BODY headings). */
function sectionHasCopyContent(section: string): boolean {
  return /^\s*(hook\b|h\d+\b|body\b|parte\s*\d+|texto\b)/im.test(section);
}

/**
 * Extrai o TOKEN DE VARIANTE de um nome de task/heading (ex "F2", "P1",
 * "AVA05"). Docs reais poem VARIAS variantes do mesmo AD num doc so:
 *   "AD14GL - VRWA02 - F2 (Variação de Formato)"   ← avatar Mulher
 *   "AD14GL - VFPB04 - F2"                          ← copy (homens)
 *   "AD14GL - VRWA02 - P1 (Mudança de Perspectiva)" ← avatar Homem
 *   "AD14GL - VFPB04 - P1"                          ← copy (mulheres)
 * Todas casam o baseAdId "AD14GL" e o findAdSection FUNDIA todas numa secao
 * so, poçando avatares/copy de variantes diferentes. O token de variante (o
 * sufixo curto final) e o discriminador real — o miolo (VRWA02/VFPB04) varia.
 *
 * Regra: ultimo token "-"-separado (sem parenteticos) que seja 1-3 letras +
 * 1-3 digitos (F2, P1, AVA05). EXCLUI G<n> (G-sibling tem tratamento proprio)
 * e codigos AD/nicho (VRWA02/VFPB04 tem 4 letras → nao casam).
 */
export function extractVariantToken(taskName: string): string | null {
  if (!taskName) return null;
  const noParen = taskName.replace(/\([^)]*\)/g, ' ').replace(/\([^)]*\)/g, ' ').trim();
  const tokens = noParen.split(/\s*[-–—]\s*/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1].toUpperCase();
  if (/^G\d+$/.test(last)) return null;     // G-sibling — nao e variante
  if (/^AD\d/.test(last)) return null;       // codigo AD
  if (/^[A-Z]{1,3}\d{1,3}$/.test(last)) return last;
  return null;
}

/** True se a heading contem o token de variante (match exato de token,
 *  case-insensitive). variant null/'' = sem filtro (sempre true). */
function headingHasVariant(headingLine: string, variant: string | null | undefined): boolean {
  if (!variant) return true;
  const tokens = headingLine.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return tokens.includes(variant.toUpperCase());
}

export function findAdSection(text: string, adIdOrPrefix: string, variant?: string | null): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const targetUp = adIdOrPrefix.toUpperCase().trim();

  // Coleta TODOS os candidatos com score + tamanho da section + presença
  // de copy. Em empate de score, prefere quem tem hook/body real.
  type Cand = { idx: number; score: number; line: string; sectionLen: number; hasCopy: boolean };
  const cands: Cand[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toUpperCase();
    if (!AD_HEADING_RE.test(line)) continue;
    // Filtro de VARIANTE: docs com varias variantes do mesmo AD (F2/P1/AVA05)
    // — so casa headings da variante pedida. Sem variant = sem filtro. Isso
    // impede o merge de poçar avatares/copy de variantes diferentes.
    if (!headingHasVariant(line, variant)) continue;
    let score = 0;
    if (line === targetUp) {
      score = 100;
    } else if (line.startsWith(targetUp + ' ') || line.startsWith(targetUp + '-')) {
      score = 90;
    } else if (headingMatchesTaskFuzzy(line, targetUp)) {
      // Mesmo AD número + chars task ⊆ chars heading. Cobre o caso onde o
      // copywriter funde sufixo no meio (AD23VN-RIPSZ-G1 ↔ AD23G1VN-RIPSZ)
      // OU usa heading completo onde o target é só base AD (AD23VN ↔ AD23G1VN-RIPSZ).
      const taskLen = targetUp.replace(/[^A-Z0-9]/g, '').length;
      const headLen = line.replace(/[^A-Z0-9]/g, '').length;
      const extra = headLen - taskLen;
      score = Math.max(60, 80 - Math.floor(extra / 2));
    }
    if (score === 0) continue;
    const endIdx = findNextAdHeading(lines, i);
    const section = lines.slice(i, endIdx).join('\n');
    cands.push({
      idx: i,
      score,
      line,
      sectionLen: endIdx - i,
      hasCopy: sectionHasCopyContent(section),
    });
  }

  if (cands.length === 0) return null;

  // MERGE de headings consecutivos do mesmo AD.
  //
  // Quando copywriter escreve:
  //   AD23VN - RIPSZ         ← intro (Link do avatar)
  //   AD23G1VN-RIPSZ         ← body (HOOK, BODY)
  //   AD24VN - RIPSZ         ← OUTRO AD
  //
  // Ambos os primeiros são candidates do task AD23VN. A section deve incluir
  // AMBOS (avatar tá no intro, copy tá no body). Estratégia: start = primeiro
  // candidato, end = próximo heading que NÃO é candidato (= outro AD).
  cands.sort((a, b) => a.idx - b.idx);
  const candIdxSet = new Set(cands.map((c) => c.idx));
  const startIdx = cands[0].idx;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (AD_HEADING_RE.test(lines[i].trim()) && !candIdxSet.has(i)) {
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
  /^observa[cç][oõ]es?\b/i,               // "Observação:" / "Observações:"
  /^nota\b/i,                             // "Nota:"
  /^obs\b/i,                              // "OBS:"
  /^link\s+do\s+avatar\b/i,               // "Link do avatar:" → parseGlobalAvatarLinks
  /^avatar\s+do\s+video\b/i,              // "Avatar do video:"
  /^avatar\s+global\b/i,                  // "Avatar global:"
  /^avatar\s+padr[aã]o\b/i,               // "Avatar padrão:"
  /^link\s+avatar\b/i,                    // "Link avatar:"
  /^link\s+do\s+ad\b/i,                   // "Link do ad:" (VA briefing)
  /^depoimento\b/i,                       // "Depoimento com avatar:"
  // — Metadados de PRODUCAO/EDICAO que apontam pra mp4 mas NAO sao avatares.
  // User reportou bug: "Música de fundo: 📎 Scary Piano.mp4" virava avatar
  // "@Scary Piano" porque o regex aceitava a linha como Role:Username. Aqui:
  /^m[uú]sica(\s+|$)/i,                   // "Música de fundo:", "Música:", "Música ambiente:"
  /^[aá]udio\b/i,                         // "Áudio:", "Áudio referência:"
  /^cen[aá]rio\b/i,                       // "Cenário:"
  /^edi[cç][aã]o\b/i,                     // "Edição:" (sem confundir com "Editor")
  /^tipo\s+de\s+legenda\b/i,              // "Tipo de Legenda:"
  /^legenda\b/i,                          // "Legenda:" (estilo de legenda, nao avatar)
  /^trilha\b/i,                           // "Trilha sonora:", "Trilha:"
  /^sfx\b/i,                              // "SFX:"
  /^bgm\b/i,                              // "BGM:"
  /^sound(\s+|$)/i,                       // "Sound effect:", "Sound:"
  /^background(\s+|$)/i,                  // "Background music:"
  /^thumb\b/i,                            // "Thumb:", "Thumbnail:"
  /^cor(es)?\b/i,                         // "Cor:", "Cores:"
  /^estilo\b/i,                           // "Estilo:"
  /^formato\b/i,                          // "Formato:"
  /^dura[cç][aã]o\b/i,                    // "Duração:"
  /^arquivo\b/i,                          // "Arquivo:"
  /^v[ií]deo\s+(de\s+)?refer[eê]ncia\b/i, // "Video de Referência:"
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

  // Regex 1b: linha "Role: <attachment chip do ClickUp>" — formato menos
  // estruturado onde o filename tem parens, espacos, acentos OU vem TRUNCADO
  // por "..." (ClickUp renderiza link como chip e nao mostra .mp4).
  //
  // User reportou (29/05/2026): docs reais tem
  //   "Doutor: 📎 Viva Saudável_1330239768979913 (32 ativos).mp4"
  //   "Doutor: 📎 Dicas Saude_1454126032545043 (17 dias - lateral)..."
  // reFullLine nao casava por causa dos parens no nome + ".mp4" depois.
  //
  // Estrategia: gatilho = 📎 OU .mp4/.mov OU "..." no final.
  // Pega o que vier depois do ":" como nome bruto, normaliza depois.
  const reAttachmentChip = /^[\s•\-*\d.)\]]*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s()0-9\-]{0,58}?):\s*(.+?)\s*$/;

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
      // Talking-photo do HeyGen tem ID 100% numerico (ex "7558713641210531102").
      // O guard !/^\d+$/ existe pra barrar numero solto ("Doutor: 10" = duracao),
      // mas quando a linha tem .mp4/.mov o numero E o filename do avatar — aceita.
      const hadVideoExt = /\.(mp4|mov)\b/i.test(trimmed);
      if (isPlausibleAvatarRole(role) &&
          username.length >= 3 &&
          !/^(http|https|www|exemplo|ex)$/i.test(username) &&
          (!/^\d+$/.test(username) || hadVideoExt) &&
          !/^AD\d+VN/i.test(username)) {
        out.push({ role, username, raw: trimmed });
        pendingRole = null;
        pendingRoleLine = -1;
        continue;
      }
    }

    // Tentativa 1b: ClickUp attachment chip — "Role: 📎 <filename com parens>.mp4"
    // ou truncado "Role: 📎 <filename>..." (sem extensao visivel). Gatilho:
    // presenca de 📎 OU .mp4/.mov OU "..." no final. NON_AVATAR_PREFIXES ja
    // bloqueia "Música de fundo", "Referência", etc — sem risco de matar
    // narrativa "Mulher: voce..." (sem gatilho).
    const hasAttachmentTrigger =
      /📎/.test(trimmed) ||
      /\.(mp4|mov)\b/i.test(trimmed) ||
      /\.{3,}\s*$/.test(trimmed);
    if (hasAttachmentTrigger) {
      const m1b = trimmed.match(reAttachmentChip);
      if (m1b) {
        const role = m1b[1].trim();
        // Normaliza filename:
        //   - strip 📎 lead + espacos
        //   - strip @ inicial
        //   - strip .mp4/.mov
        //   - strip trailing "..." ou unico "."
        //   - strip trailing "(...)" (ex "(32 ativos)" / "(17 dias - lateral)")
        let raw = m1b[2].trim();
        // CRITICAL: ordem importa. Remove "..." ANTES de "(...)" porque
        // ClickUp truncated chips ficam "(17 dias...)..." — sem o strip do
        // "..." primeiro, a regex de parens nao detecta o trailing block.
        const username = raw
          .replace(/^📎\s*/, '')
          .replace(/^@/, '')
          .replace(/\.(mp4|mov)\b.*$/i, '')   // tudo depois de .mp4 vai junto
          .replace(/\s*\.{2,}\s*$/g, '')      // "..." trailing primeiro
          .replace(/\s*\(.*?\)\s*$/g, '')     // " (32 ativos)" trailing
          .replace(/\s*\.{2,}\s*$/g, '')      // "..." que possa ter sobrado
          .replace(/[,\s]+$/, '')             // virgula/espaco trailing
          .replace(/\s+/g, ' ')
          .trim();
        // Talking-photo numerico ("Doutor: 7558713641210531102.mp4") e avatar
        // valido — so relaxa o guard de all-digit quando ha extensao de video.
        const hadVideoExt = /\.(mp4|mov)\b/i.test(raw);
        if (isPlausibleAvatarRole(role) &&
            username.length >= 3 &&
            !/^(http|https|www|exemplo|ex)$/i.test(username) &&
            (!/^\d+$/.test(username) || hadVideoExt) &&
            !/^AD\d+VN/i.test(username)) {
          out.push({ role, username, raw: trimmed });
          pendingRole = null;
          pendingRoleLine = -1;
          continue;
        }
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
      // linha attachment chip "Doutor: 📎 Viva Saudável.mp4" ou truncada
      // "Doutor: 📎 Dicas Saude_123 (17 dias)..." — tambem skip pra nao vazar
      // pro body text.
      if (/^[\wÀ-ÿ ()0-9\-]+?:\s*(?:📎|.*?\.(?:mp4|mov)\b|.*?\.{3,}\s*$)/.test(trimmed)) continue;
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

/**
 * Extrai TODOS os usernames de avatar (sem extensao) de um trecho de texto.
 * Varre cada "<nome>.mp4|.mov" — entao suporta MULTIPLOS avatares por linha
 * com QUALQUER separador ("+", " e ", ",", "/", "|"). O "@" inicial e
 * ignorado; filenames com espaco/acento ("Dr. Marco Túlio.mp4") sao aceitos.
 * Descarta tokens que sao codigo de AD (ex "AD02G1VN - PRPB07" do "Link do ad")
 * ou esquema de URL. Dedup case-insensitive, preserva ordem.
 */
export function extractAvatarFileTokens(text: string): string[] {
  const re = /@?([a-zA-ZÀ-ÿ0-9_][a-zA-ZÀ-ÿ0-9._\s-]*?)\.(?:mp4|mov)\b/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const u = m[1].trim();
    if (
      u.length >= 3 &&
      !/^AD\d/i.test(u) &&
      !/^(?:https?|www|drive|google)$/i.test(u) &&
      !out.some((x) => x.toLowerCase() === u.toLowerCase())
    ) {
      out.push(u);
    }
  }
  return out;
}

/* ============= Convencao G[N] = Hook[N] (DARKO LAB briefings) ============= */

/**
 * Encontra todos os siblings AD<base>G<N>GL-<rest> dado um base ID
 * (ex "AD139GL" → ["AD139G1GL-VFPB04", "AD139G2GL-VFPB04", ...]).
 * Retorna em ordem numerica de N.
 */
export function findGSiblings(fullDocText: string, baseAdId: string, variant?: string | null): Array<{ gNum: number; heading: string; section: string }> {
  if (!fullDocText) return [];
  // Extrai numero + sufixo do base. Normaliza removendo espacos/traco antes
  // (cobre 2 convencoes DARKO):
  //   "AD139GL"      → num "AD139", suffix "GL"   (sufixo colado)
  //   "AD01 - PV"    → num "AD01",  suffix "PV"   (sufixo apos " - ")
  const norm = baseAdId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = norm.match(/^(AD\d+)([A-Z]+)$/);
  if (!m) return [];
  const numPart = m[1]; // "AD139" | "AD01"
  const suffix = m[2]; // "GL" | "PV"
  // Procura headings de sibling em AMBAS as convencoes:
  //   "AD139G1GL-XXX"  (sufixo colado no G)
  //   "AD01G1-PV"      (sufixo apos traco/espaco depois do G<N>)
  // O separador [-\s]? entre G<N> e o sufixo e OPCIONAL.
  const lines = fullDocText.split(/\r?\n/);
  const re = new RegExp(`^${numPart}G(\\d+)[-\\s]?${suffix}\\b`, 'i');
  const found: Array<{ gNum: number; lineStart: number; heading: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const mm = t.match(re);
    if (mm && headingHasVariant(t, variant)) {
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
  // Marker "Gancho"/"Hook" dentro do beforeBody: a fala do hook comeca DEPOIS
  // dele. Sem isso, metadados que precedem o gancho ("Link do avatar:",
  // "Instruções para edição:") fazem o sanitizer cortar a fala inteira — bug
  // real: doc com "Link do avatar / GANCHO / BODY" caia em "0 hooks".
  let hookLines = beforeBody;
  const ganchoIdx = beforeBody.findIndex((l) => /^(gancho|hook)\b/i.test(l.trim()));
  if (ganchoIdx >= 0) hookLines = beforeBody.slice(ganchoIdx + 1);
  const hook = extractTextBlock(hookLines);
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
   *  Quando body tem 1 unico speaker, bodySegments tem 1 item.
   *  `username` (quando presente) e o avatar declarado que fala esse
   *  segmento — vem do chip/filename que separa os blocos no body (formato
   *  "Link do avatar" multi-avatar). Consumer mapeia username → slot. */
  bodySegments: Array<{ role: string | null; username?: string | null; text: string }>;
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

  // (1.5) Corta o RODAPE de producao/edicao: tudo a partir do 1o marcador que
  // nunca e fala. Bug real (AD31 PRPB06): viravam BODY extras — "AD32 à 34",
  // "Os criativos são para META...", "Fazer camuflagem...", "CRIATIVOS".
  // Marcadores ancorados no inicio da linha pra NAO cortar fala legitima.
  const footerCut = s.search(
    /(?:^|\n)[ \t]*(?:os\s+criativos\s+s[aã]o\b|criativos\s*:?\s*$|instru[cç][oõ]es?\s+(?:gerais|para)\b|segue\s+o\s+link\s+da\s+pasta\b|AD\s*\d+\s*[àáaÀÁ]\s*\d+\b|fazer\s+camuflagem\b)/im,
  );
  if (footerCut >= 0) s = s.slice(0, footerCut);

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
      // filename COM espacos/parens no fim da linha (indicativo de avatar):
      // ex "Viva Saudável_1330239768979913 (32 ativos).mp4". Fala NUNCA
      // termina em .mp4/.mov, entao qualquer linha assim e indicativo, nao copy.
      if (/\.(?:mp4|mov)\s*$/i.test(t)) return null;
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

/** Normaliza um username/filename de avatar pra comparacao robusta:
 *  lowercase, sem @, sem extensao .mp4/.mov, so letras+digitos.
 *  Ex "@Nany_uwu.mp4" → "nanyuwu"; "7494773934441762056.mp4" → "7494...". */
export function normAvatarKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\.(mp4|mov)$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Detecta uma linha que e SO o chip/filename de um avatar — usada como
 *  boundary de speaker quando o briefing separa as falas por filename do
 *  avatar (formato "Link do avatar: a + b + c" no topo + chip do avatar
 *  antes de cada bloco no body) em vez de labels "Mulher:"/"Doutor:".
 *
 *  Formatos cobertos (linha INTEIRA, sem fala depois):
 *    "monetzamoraa3.mp4"            (filename puro)
 *    "@nanychan_uwu.mp4"            (com @)
 *    "📎 gihribeiroo20.mp4"         (chip do ClickUp/Docs)
 *    "7494773934441762056.mp4"     (talking-photo numerico)
 *
 *  GUARD-RAIL: so vira boundary se o basename normalizado casar com um dos
 *  avatares DECLARADOS (avatarKeys). Isso evita que "Música de fundo:
 *  Scary Piano.mp4" ou qualquer filename de producao vire um speaker.
 *
 *  Retorna o username DECLARADO casado (pra vincular o segmento ao avatar)
 *  ou null. */
function detectAvatarFilenameLine(line: string, avatarKeys: Map<string, string>): string | null {
  const t = (line || '').trim();
  if (!t || avatarKeys.size === 0) return null;
  // Linha = [prefixo opcional: whitespace/emoji-chip/bullet/@] <basename>.mp4|.mov
  // e NADA mais (a fala real nunca termina em .mp4).
  // IMPORTANTE: o prefixo NAO inclui digitos/pontos/letras — senao um
  // basename numerico ("7494773934441762056.mp4") ou acentuado teria o
  // comeco engolido pelo prefixo guloso e o capture sairia errado.
  const m = t.match(
    /^[\s\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}•·▪◦*\-]*@?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ.\s-]*?)\.(?:mp4|mov)\s*$/iu,
  );
  if (!m) return null;
  const key = normAvatarKey(m[1]);
  if (!key) return null;
  return avatarKeys.get(key) || null;
}

/**
 * Segmenta um bloco de texto (body ou hook) em partes por SPEAKER.
 *
 * Cada vez que aparece um "speaker label" (linha "Role:" / "Role (extras):
 * @file.mp4" / "Role" solo) OU um chip/filename de avatar declarado
 * ("monetzamoraa3.mp4" sozinho na linha), inicia uma nova sub-secao.
 * Texto antes do primeiro boundary vai pra primeira secao (com role
 * = firstRole se conhecido, senao null).
 *
 * Boundaries por filename vinculam o segmento ao `username` do avatar (o
 * consumer mapeia username → slot do avatar, sem depender de role textual).
 *
 * Linhas que SAO boundaries NAO entram na fala — sao descartadas.
 * Linhas "Avatar fala: X" tem o prefixo removido (X entra na fala).
 *
 * @param avatarUsernames usernames dos avatares declarados no briefing
 *        (habilita boundary por chip/filename). Vazio = so labels textuais.
 *
 * Saida: array de {role, username, text} — text ja sem labels mas SEM ainda
 * passar por sanitizeSpokenCopy (caller deve sanitizar cada segmento).
 */
export function splitBySpeaker(
  raw: string,
  knownRoles: string[] = [],
  firstRole: string | null = null,
  avatarUsernames: string[] = [],
): Array<{ role: string | null; username: string | null; text: string }> {
  const avatarKeys = new Map<string, string>();
  for (const u of avatarUsernames) {
    const k = normAvatarKey(u);
    if (k && !avatarKeys.has(k)) avatarKeys.set(k, u);
  }
  const lines = (raw || '').replace(/\r/g, '').split('\n');
  const segments: Array<{ role: string | null; username: string | null; lines: string[] }> = [
    { role: firstRole, username: null, lines: [] },
  ];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) {
      segments[segments.length - 1].lines.push(ln);
      continue;
    }
    // 1) Boundary por chip/filename de avatar declarado (formato "Link do
    //    avatar" multi-avatar — o avatar de cada bloco vem como filename).
    const avUser = detectAvatarFilenameLine(t, avatarKeys);
    if (avUser) {
      const cur = segments[segments.length - 1];
      const curHasText = cur.lines.some((l) => l.trim().length > 0);
      if (!curHasText) {
        // PRIMEIRA linha (ou segmento ainda vazio) — vincula o avatar a ele.
        cur.username = avUser;
      } else {
        segments.push({ role: null, username: avUser, lines: [] });
      }
      continue;
    }
    // 2) Boundary por speaker label textual ("Mulher:", "Doutor:", ...).
    const role = detectSpeakerLabelLine(t, knownRoles);
    if (role) {
      // Inicia novo segmento. Se segment atual nao tem conteudo util,
      // sobrescreve o role dele (provavel caso da PRIMEIRA linha ser label).
      const cur = segments[segments.length - 1];
      const curHasText = cur.lines.some((l) => l.trim().length > 0);
      if (!curHasText) {
        cur.role = role;
      } else {
        segments.push({ role, username: null, lines: [] });
      }
      continue;
    }
    segments[segments.length - 1].lines.push(ln);
  }
  return segments
    .map((s) => ({ role: s.role, username: s.username, text: s.lines.join('\n').trim() }))
    .filter((s) => s.text.length > 0);
}

/** Localiza o bloco de copy sob a heading BASE (sem G<n>) de um AD.
 *  Alguns docs INVERTEM a convencao DARKO: metadados+avatar ficam sob a
 *  heading G1 (ex "AD14G1GL - VRWA02 - AVA05") e o hook+body ficam DIRETO sob
 *  a heading base ("AD14GL - VRWA02 - AVA05"). findGSiblings so olha headings
 *  com G<digito>, entao a copy se perdia (0 hooks + 0 body). Retorna o bloco
 *  (heading + copy) ou null se nao houver copy real.
 *
 *  startsWith(normBase) ja exclui os G-siblings: "AD14G1GL" NAO comeca com
 *  "AD14GL" (bate ate "AD14G", diverge no proximo char), e o limite
 *  digito→sufixo evita casar AD vizinho (AD140GL nao comeca com AD14GL). */
function findBaseCopyBlock(fullDocText: string, baseAdId: string, variant?: string | null): string | null {
  if (!fullDocText) return null;
  const lines = fullDocText.split(/\r?\n/);
  const normBase = baseAdId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normBase) return null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!AD_HEADING_RE.test(t)) continue;
    // Variante: a copy pode estar sob heading com miolo de nicho diferente
    // ("AD14GL - VFPB04 - F2") mas SEMPRE carrega o token de variante. Filtra
    // por ele pra nao pegar a copy de outra variante (P1/AVA05).
    if (!headingHasVariant(t, variant)) continue;
    const normHead = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Quando ha variante, o miolo do nicho pode divergir do baseAdId — entao
    // basta o AD-numero+sufixo aparecer; senao exige startsWith do base.
    const adNum = (normBase.match(/^AD\d+[A-Z]*/) || [''])[0];
    const matchesBase = variant ? normHead.startsWith(adNum) : normHead.startsWith(normBase);
    if (!matchesBase) continue;
    const end = findNextAdHeading(lines, i);
    const block = lines.slice(i, end).join('\n');
    if (sectionHasCopyContent(block)) return block;
  }
  return null;
}

export function parseDarkoBriefing(fullDocText: string, baseAdId: string, variant?: string | null): ParsedDarkoBriefing | null {
  const baseSection = findAdSection(fullDocText, baseAdId, variant);
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
  const siblings = findGSiblings(fullDocText, baseAdId, variant);
  const hooks: ParsedDarkoBriefing['hooks'] = [];
  let body: string | null = null;
  let bodyRole: string | null = null;
  let bodySegments: Array<{ role: string | null; username?: string | null; text: string }> = [];
  const avatarUsernames = avatars.map((a) => a.username).filter(Boolean);
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
      const segs = splitBySpeaker(parsed.body.text, knownRoles, parsed.body.role, avatarUsernames)
        .map((s) => ({ role: s.role, username: s.username ?? null, text: sanitizeSpokenCopy(s.text, knownRoles) }))
        .filter((s) => s.text.length > 0);
      if (segs.length > 0) {
        bodySegments = segs;
        body = segs.map((s) => s.text).join('\n\n');
        bodyRole = segs[0].role;
      }
    }
  }

  // FALLBACK convencao INVERTIDA: metadados sob a heading G1 e hook+body DIRETO
  // sob a heading base (ex "AD14GL - VRWA02 - AVA05"). findGSiblings so via a
  // G1 (metadata) -> hook junk (prosa de instrucao vaza) + sem body. A base
  // tem um marker "Body" REAL — sinal inequivoco de copy. Quando a base tem
  // body real E os siblings nao produziram body (= eram metadata), a base e a
  // fonte AUTORITATIVA: sobrescreve o hook junk. Bug reportado (13/06/2026,
  // AD14GL): painel mostrava "0 hooks + 0 body splits" com 1 avatar.
  if (!body) {
    const baseBlock = findBaseCopyBlock(fullDocText, baseAdId, variant);
    if (baseBlock) {
      const parsed = parseGSibling(baseBlock);
      const baseBodySegs = parsed.body
        ? splitBySpeaker(parsed.body.text, knownRoles, parsed.body.role, avatarUsernames)
            .map((s) => ({ role: s.role, username: s.username ?? null, text: sanitizeSpokenCopy(s.text, knownRoles) }))
            .filter((s) => s.text.length > 0)
        : [];
      if (baseBodySegs.length > 0) {
        // Limpa qualquer hook junk vindo da G1 de metadata e refaz da base.
        hooks.length = 0;
        if (parsed.hook) {
          const hookText = sanitizeSpokenCopy(parsed.hook.text, knownRoles);
          if (hookText) hooks.push({ label: 'HOOK 1', text: hookText, sourceG: 1, role: parsed.hook.role });
        }
        bodySegments = baseBodySegs;
        body = baseBodySegs.map((s) => s.text).join('\n\n');
        bodyRole = baseBodySegs[0].role;
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

/** Um PAPEL dentro de uma variacao VA (formato novo de doc, 2026-06).
 *  Ex secao VA01 com 2 papeis:
 *    'Doutor: radyrahbanmd.mp4'           → papel principal (fala mais)
 *    'Depoimento Mulher: gihribeiroo20.mp4' → depoimento (trecho menor)
 *  O pipeline diariza o audio do AD original e manda cada trecho de fala
 *  pro lipsync com o avatar do papel correspondente. */
export type VAAvatarRole = {
  /** Label do papel como esta no doc ('Doutor', 'UGC', 'Depoimento Mulher') */
  role: string;
  /** Username/filename sem extensao */
  username: string;
  /** Drive file ID (se resolvido nos driveLinks) */
  fileId: string | null;
  /** True se o papel e depoimento (fala menos — mapeia pro locutor secundario) */
  isDepoimento: boolean;
};

export type VAAvatar = {
  /** Numero da variacao (3 → AVA03) */
  avaNum: number;
  /** Codigo completo: 'AVA03', 'AVA04' */
  avaCode: string;
  /** Username sem extensao (ex 'lara', '7508150707225251077') */
  username: string;
  /** Drive file ID se houver link na linha */
  fileId: string | null;
  /** URL do YouTube quando o avatar e referenciado por link (ex briefing
   *  "Avatar: https://youtube.com/...  (clonar a voz)") em vez de @file.mp4.
   *  Tipico em criativos YouTube "sem edicao" + clone de voz. */
  youtubeUrl?: string | null;
  /** Thumbnail pra UI. Derivado: YouTube → img.youtube.com/vi/<id>/hqdefault.jpg.
   *  (Avatar de Drive segue usando fileId pra montar a thumb na UI.) */
  thumbUrl?: string | null;
  /** TODOS os papeis da variacao (formato novo). roles[0] = principal
   *  (mesmo username/fileId acima). 2+ papeis → pipeline multi-locutor
   *  (diarizacao). Ausente/1 papel = comportamento classico. */
  roles?: VAAvatarRole[];
};

export type ParsedVABriefing = {
  /** Base AD ID, ex 'AD31G1VN-ME' */
  baseAdId: string;
  /** Filename do video original referenciado (ex 'AD31G1VN-ME.mp4') */
  linkAdFilename: string | null;
  /** Drive file ID do video original (se link Drive presente) */
  linkAdFileId: string | null;
  /** Google Doc ID da "Link da Copy" (o ROTEIRO que o avatar principal
   *  fala). GROUND TRUTH pra atribuicao de locutor: trechos que casam com
   *  a copy = principal; o resto = depoimento. Null se o doc nao tem. */
  linkCopyDocId: string | null;
  /** Texto do link da copy ('ADGL - VFPB04 - 2026') — debug/UI */
  linkCopyText: string | null;
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

/** Marcadores que indicam o FIM do texto falado (copy) dentro de uma
 *  section VA. Dali pra frente eh rodape de PRODUCAO/EDICAO ou a proxima
 *  LEVA — nada disso eh fala do avatar e NAO deve entrar no hook/body.
 *  Bug reportado: body puxava "LEVA 02 - META", "Instruções gerais para
 *  edição", "Segue o link da pasta dos criativos: CRIATIVOS". */
const COPY_END_BOUNDARIES: RegExp[] = [
  // "LEVA 02 - META" — ancora em LEVA + numero pra NAO cortar fala tipo
  // "Leva só dois minutos".
  /^leva\s+\d/i,
  // "Instruções gerais para edição:" / "Instruções para edição:" — ancora em
  // gerais|para pra evitar falso positivo improvavel.
  /^instru[cç][oõ]es?\s+(gerais|para)\b/i,
  /^segue\s+o\s+link\s+da\s+pasta\b/i,   // "Segue o link da pasta dos criativos:"
  /pasta\s+dos\s+criativos/i,            // "...pasta dos criativos: CRIATIVOS"
  /^observa[cç][oõ]es?\s+gerais\b/i,     // "Observações gerais:"
];
/** True se a linha marca o inicio do rodape de producao (fim da copy). */
function isCopyEndBoundary(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return COPY_END_BOUNDARIES.some((re) => re.test(t));
}

/** Detecta se uma task ou doc e do tipo Variacao de Avatar.
 *  Check: nome contem 'Variação de avatar' OU comeca com 'VA -'/'VA-'
 *  OU com 'VA<nums>' (numeros dos avatares embutidos no prefixo).
 *
 *  Formatos reais vistos (user reportou 2026-06-10):
 *    'VA - AD03G1VN - PRPB06 - AVA05 e 06 - Silas'  → prefixo 'VA -'
 *    'VA01 e 02 - AD19G1GL - PRPB06'                → prefixo 'VA01 e 02 -'
 *    'VA01 e 02 - AD126G1GL - VFPB04'
 *    'VA 01, 02 e 03 - AD10G1VN - ...'              → com espaco/virgula
 */
export function isVATask(taskName: string): boolean {
  if (!taskName) return false;
  const t = taskName.trim();
  if (/^VA\s*[-–—]/i.test(t)) return true;
  // 'VA01 e 02 - ...' / 'AVA01 e 02 - ...' / 'VA 01, 02 - ...' — (A)VA
  // seguido DIRETO de numeros. Copywriters alternam os prefixos VA/AVA
  // (doc real 2026-06-11: 'VA01 - AD126...' e 'AVA01 e 02 - AD97...').
  // Exige o dash depois do bloco de numeros pra nao pegar palavra começando
  // com VA (ex 'VAGA 2 - ...' nao casa: 'GA' quebra o \d apos VA).
  if (/^A?VA\s*\d+(?:\s*(?:e|,|\/)\s*\d+)*\s*[-–—]/i.test(t)) return true;
  if (/varia[cç][aã]o\s+de\s+avatar/i.test(taskName)) return true;
  return false;
}

/**
 * Detecta tasks de TROCA DE ÁUDIO (variação do áudio WHITE).
 *
 * Nomenclatura tipica: "TROCA DE ÁUDIO - AD138G2GL - VFPB04 - VRWA02".
 * Essas tasks NAO tem doc de copy — so o link do criativo original no Drive
 * (em comentario/descricao/custom field) e um novo audio WHITE upado pelo
 * user. Pipeline: baixa o AD, descamufla (tira o WHITE antigo), recamufla
 * com o novo WHITE.
 */
export function isTrocaAudioTask(taskName: string): boolean {
  if (!taskName) return false;
  return /\btroca\s+de\s+[áa]udio\b/i.test(taskName.trim());
}

/** Extrai os codigos AVA mencionados na NOMENCLATURA da task.
 *
 * Ex: 'VA - AD03G1VN - PRPB06 - AVA05 e 06 - Silas' → [5, 6]
 *     'VA - AD02G1VN - PRPB06 - AVA03 e 04 - Silas' → [3, 4]
 *     'VA - AD10G1VN - AVA01, 02 e 03 - SILAS'      → [1, 2, 3]
 *     'VA01 e 02 - AD19G1GL - PRPB06'               → [1, 2] (nums no prefixo VA)
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
  // Fallback: prefixo 'VA01 e 02 - ...' — numeros embutidos direto no 'VA'
  // do inicio do nome (sem a palavra AVA). Mesmo significado: AVA01 e AVA02.
  const m = taskName.match(/AVA\s*([\d\s,e/]+?)(?:\s*[-–—]|$)/i)
    || taskName.trim().match(/^VA\s*([\d\s,e/]+?)(?:\s*[-–—]|$)/i);
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

/** Extrai o video ID de uma URL do YouTube. Tolerante a:
 *   - youtube.com/watch?v=ID  (e o typo "wath?v=ID" visto em briefing real)
 *   - youtu.be/ID
 *   - youtube.com/shorts/ID  /  /embed/ID  /  /live/ID
 *  Retorna o ID (11 chars padrao, mas aceita 6+) ou null. */
export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  // youtu.be/<id> ou /shorts|embed|live/<id>
  let m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:shorts|embed|live|v)\/)([A-Za-z0-9_-]{6,})/i);
  if (m) return m[1];
  // ...?v=<id> (cobre "watch?v=" e o typo "wath?v=")
  m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
  if (m) return m[1];
  return null;
}

/** Thumb padrao do YouTube pra um video ID. */
export function youTubeThumb(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/** Parse VA briefing. Retorna null se nao for VA detectavel.
 *
 *  IMPORTANTE: aceita filterAvaNums pra restringir quais AVAs vao pro
 *  resultado. Quando a task name diz "AVA05 e 06", so esses 2 retornam
 *  (mesmo que o doc tenha AVA01-06). User esclareceu 12/05/2026. */
export function parseVABriefing(
  fullDocText: string,
  baseAdIdOrTaskName: string,
  driveLinks: Array<{ text: string; fileId: string; isFolder?: boolean }> = [],
  filterAvaNums: number[] = [],
): ParsedVABriefing | null {
  if (!fullDocText) return null;
  const lines = fullDocText.split(/\r?\n/);

  // 0. EXTRAI AD CODE COMPLETO + VARIANT do task name.
  //
  // Ex 'VA - AD07G1VN - PRPB06':
  //   adCode   = 'AD07G1VN'  (alfanumerico depois de AD\d+)
  //   variant  = 'PRPB06'    (discriminador segundo nivel)
  //
  // CRITICAL: doc pode ter MULTIPLAS sections VA mesmo dentro do mesmo AD code
  // (uma por variant: PRPB04, PRPB05, PRPB06). Sem casar AMBOS, parser pegava
  // a ultima section do AD ignorando o variant correto.
  //
  // Bug visto live em 2026-05-25 (segunda iteracao): task "VA - AD07G1VN - PRPB06"
  // deveria parsear "AD07G1VN-PRPB06" (com AVA03+04), mas regex antiga `AD\d+[A-Z]+`
  // capturava só "AD07G" (parava no dígito '1'), e sem o variant pegava qualquer
  // section AD07G* — geralmente a errada.
  //
  // Fix: regex `AD\d+[A-Z0-9]+` captura alfanumericos completos (AD07G1VN).
  // E adicionamos extracao do variant (PRPB\d+, VFPB\d+, ME\d* etc.).
  const adCodeMatch = baseAdIdOrTaskName.match(/AD\d+[A-Z0-9]*/i);
  const adCode = adCodeMatch ? adCodeMatch[0].toUpperCase() : null;

  // Variant: PRPB##, VFPB##, VRWA##, MEPB##, ME##, etc. — qualquer token
  // alfanumerico de 2+ letras + digitos APOS o AD code.
  let variant: string | null = null;
  if (adCode) {
    const afterAd = baseAdIdOrTaskName.slice(
      baseAdIdOrTaskName.toUpperCase().indexOf(adCode) + adCode.length,
    );
    const variantMatch = afterAd.match(/\b([A-Z]{2,}\d+)\b/i);
    if (variantMatch) variant = variantMatch[1].toUpperCase();
  }

  // ===== FORMATO NOVO (visto live 2026-06-10) =====
  // Doc real (task 'VA01 e 02 - AD126G1GL - VFPB04'):
  //
  //   VA01 - AD126G1GL - VFPB04 (Variação de Avatar)
  //   Fonte de Tráfego: Meta Ads
  //   INSTRUÇÕES PARA EDIÇÃO:
  //   Link do AD: AD126G1GL-VFPB04.mp4
  //   Link da Copy: ADGL - VFPB04 - 2026
  //   Avatar e Vozes:
  //   Doutor: radyrahbanmd.mp4[a]
  //   Depoimento Mulher: gihribeiroo20.mp4
  //   Manter o mesmo áudio do criativo validado, ...
  //   Edição: A mesma coisa do original.
  //   VA02 - AD126G1GL - VFPB04 (Variação de Avatar)
  //   ...
  //
  // Diferencas do formato legado:
  //  - Cada "VA0N - <AD> (Variação de Avatar)" e UMA variacao (1 video de
  //    saida) com bloco "Avatar e Vozes:" proprio — nao existem linhas AVA0N.
  //  - SEM Gancho/Body no doc: o audio espelha o AD original ("Link do AD" +
  //    "Manter o mesmo áudio do criativo validado") → lipsync pipeline.
  //  - Papel do avatar prefixa o filename ("Doutor:", "UGC:"); papel
  //    "Depoimento ..." NAO e o avatar principal da variacao.
  //  - Doc pode ter VARIOS ADs, cada um com suas VA01/VA02 → escopo por
  //    adCode (+variant quando presente no header).
  // Header de secao: 'VA01 - ...' OU 'AVA01 - ...' — copywriters usam os
  // DOIS prefixos (visto live 2026-06-11: doc com 'VA01 - AD126...' E
  // 'AVA01 - AD97...' no MESMO arquivo). Sem o A? opcional, as secoes
  // AVA0N nao eram fronteira e os papeis delas VAZAVAM pra secao anterior
  // (AD137 ganhou 'Doutor: surgery-2' e 'Doutor: doutorjapa' do AD97).
  const newSecRe = /^A?VA\s*(\d+)\s*[-–—]/i;
  const isNewSectionHeader = (line: string) =>
    newSecRe.test(line) && /varia[cç][aã]o\s+de\s+avatar/i.test(line);
  const newSecs: Array<{ idx: number; avaNum: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!isNewSectionHeader(t)) continue;
    const up = t.toUpperCase();
    if (adCode && !up.includes(adCode)) continue;
    if (adCode && variant && !up.includes(variant)) continue;
    const sm = t.match(newSecRe);
    if (sm) newSecs.push({ idx: i, avaNum: parseInt(sm[1], 10) });
  }
  if (newSecs.length > 0) {
    // Boundary de section: proximo header (A)VA0N, header doc-level
    // 'VA - AD...' OU titulo de bloco-task '(A)VA01 e 02 - AD97...'
    // (doc multi-AD: cada AD anexado comeca com esse titulo).
    const isAnyBoundary = (line: string) => {
      const t = line.trim();
      return isNewSectionHeader(t)
        || /^VA\s*[-–—]\s*AD\d/i.test(t)
        || /^A?VA\s*\d+(?:\s*(?:e|,|\/)\s*\d+)*\s*[-–—]\s*AD\d/i.test(t);
    };
    // FIM DURO de secao: separador '____', 'Edição:' ou footnote '[a]...'.
    // Cinto de seguranca: papel NUNCA aparece depois dessas linhas — mesmo
    // que um formato novo de header nao seja reconhecido como boundary,
    // o scan para aqui e nada vaza da secao seguinte.
    const isHardSectionEnd = (t: string) =>
      /^_{8,}\s*$/.test(t) || /^edi[cç][aã]o\s*:/i.test(t) || /^\[[a-z]\]/i.test(t);
    const normDl = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const findDl = (name: string) => {
      const target = normDl(name);
      if (!target) return null;
      return (
        driveLinks.find((d) => {
          const dt = normDl(d.text);
          return dt === target || dt.includes(target) || target.includes(dt);
        }) || null
      );
    };
    const avatares: VAAvatar[] = [];
    let linkAdFilename: string | null = null;
    let linkAdFileId: string | null = null;
    let linkCopyDocId: string | null = null;
    let linkCopyText: string | null = null;
    for (const sec of newSecs) {
      let end = lines.length;
      for (let i = sec.idx + 1; i < lines.length; i++) {
        if (isAnyBoundary(lines[i])) { end = i; break; }
      }
      // Coleta os papeis da secao ('Doutor: x.mp4', 'Depoimento Mulher:
      // y.mp4', 'UGC: z.mp4'). Principal = primeiro nao-depoimento.
      //
      // ASSERTIVIDADE (bug 2026-06-11: AD137 ganhou avatares do AD97):
      //  1. Papel so conta DENTRO do bloco 'Avatar e Vozes:' (quando o
      //     bloco existe — todos os docs do formato novo tem). Linha
      //     nao-papel fecha o bloco.
      //  2. Scan para no FIM DURO ('____' / 'Edição:' / footnote) — papel
      //     jamais existe depois disso dentro da mesma secao.
      //  3. Fallback (secao sem 'Avatar e Vozes:'): aceita papel em
      //     qualquer linha da secao, ainda limitado pelos fins duros.
      const blockRoles: VAAvatarRole[] = [];
      const fallbackRoles: VAAvatarRole[] = [];
      let inAvatarBlock = false;
      let sawAvatarBlock = false;
      for (let i = sec.idx + 1; i < end; i++) {
        const t = lines[i].trim();
        if (isHardSectionEnd(t)) break;
        if (!t) continue; // linha vazia nao fecha o bloco
        // 'Link do AD: AD126G1GL-VFPB04.mp4' — fonte do audio do lipsync.
        // Primeiro encontrado (escopado nas sections da task) vale.
        const linkM = t.match(/^link\s+do\s+ad\s*[:\-]\s*([^\s<>"|]+?\.(?:mp4|mov))\b/i);
        if (linkM) {
          if (!linkAdFilename) {
            linkAdFilename = linkM[1];
            const dl = findDl(linkM[1]);
            if (dl) linkAdFileId = dl.fileId;
          }
          continue;
        }
        // 'Link da Copy: ADGL - VFPB04 - 2026' — o ROTEIRO que o avatar
        // principal fala (Google Doc). GROUND TRUTH pra atribuir locutor:
        // casa o texto do link com os driveLinks pra pegar o docId. Aceita
        // SO doc (nao mp4/mov — esses sao avatar).
        const copyM = t.match(/^link\s+da\s+copy\s*[:\-]\s*(.+?)\s*$/i);
        if (copyM && !linkCopyDocId) {
          const copyName = copyM[1].trim();
          if (!/\.(mp4|mov)$/i.test(copyName)) {
            linkCopyText = copyName;
            const dl = findDl(copyName);
            if (dl && !dl.isFolder) linkCopyDocId = dl.fileId;
          }
          continue;
        }
        if (/^avatar(es)?\s+e\s+vozes\s*:/i.test(t)) {
          inAvatarBlock = true;
          sawAvatarBlock = true;
          continue;
        }
        // Papel: 'Doutor: arquivo.mp4[a]' / 'UGC: @kiko.urso1.mp4' /
        // 'UGC: 7554583824735194398.mp4'. Footnote [a] colado ou com espaco
        // depois do .mp4 e ignorado pelo \b. 'Link da Copy: <doc>' nao casa
        // (valor nao termina em .mp4/.mov).
        const roleM = t.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]{1,40}):\s*@?([^\s<>"|]+?)\.(?:mp4|mov)\b/i);
        if (roleM && !/^link\b/i.test(roleM[1].trim())) {
          const role = roleM[1].trim();
          const uname = roleM[2];
          const target = inAvatarBlock ? blockRoles : fallbackRoles;
          if (!target.some((r) => r.username === uname)) {
            const dl = findDl(uname);
            target.push({
              role,
              username: uname,
              fileId: dl ? dl.fileId : null,
              isDepoimento: /^depoimento/i.test(role),
            });
          }
          continue;
        }
        // Linha que nao e papel fecha o bloco 'Avatar e Vozes:'
        // (ex 'Manter o mesmo áudio do criativo validado...')
        if (inAvatarBlock) inAvatarBlock = false;
      }
      const secRoles = sawAvatarBlock ? blockRoles : fallbackRoles;
      // Principal primeiro (primeiro nao-depoimento; se so tem depoimento,
      // usa ele mesmo como principal)
      secRoles.sort((a, b) => Number(a.isDepoimento) - Number(b.isDepoimento));
      const primary = secRoles[0];
      if (!primary) continue;
      if (avatares.some((a) => a.avaNum === sec.avaNum)) continue;
      avatares.push({
        avaNum: sec.avaNum,
        avaCode: `AVA${String(sec.avaNum).padStart(2, '0')}`,
        username: primary.username,
        fileId: primary.fileId,
        youtubeUrl: null,
        thumbUrl: null,
        roles: secRoles,
      });
    }
    const filteredNew = filterAvaNums.length > 0
      ? avatares.filter((a) => filterAvaNums.includes(a.avaNum))
      : avatares;
    if (filteredNew.length > 0) {
      return {
        baseAdId: adCode && variant ? `${adCode}-${variant}` : (adCode || baseAdIdOrTaskName),
        linkAdFilename,
        linkAdFileId,
        linkCopyDocId,
        linkCopyText,
        avatares: filteredNew,
        // Formato novo nao tem copy no doc — audio vem do AD original
        // (lipsync). hookText/bodyText vazios sao VALIDOS aqui.
        hookText: '',
        bodyText: '',
        depoimentoText: null,
        depoimentoUsername: null,
        depoimentoFileId: null,
      };
    }
    // Sections novas existiam mas nenhum avatar extraido → tenta o legado.
  }

  // 1. Detecta header VA: PRIORIZA linha que contenha AD code + variant +
  // "Variação de avatar". Fallback: só AD code. Fallback: primeira VA do doc.
  //
  // CRITICAL — preferencia pela ULTIMA ocorrencia quando o MESMO AD code +
  // variant aparece em multiplas LEVAS do doc (LEVA 01 antiga + LEVA 03 nova).
  // User esclareceu 2026-05-25: "caso tenha mesma nomenclatura de AD da
  // task repetindo na VA, 2 iguais no docs, nesse caso voce dar preferencia
  // a que foi colocada mais recente no docs".
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let vaHeaderIdx = -1;
  if (adCode && variant) {
    // 1a) AD code + variant — exige AMBOS no header → match exato da task
    const adRe = new RegExp(escape(adCode), 'i');
    const vrRe = new RegExp(escape(variant), 'i');
    for (let i = 0; i < lines.length; i++) {
      if (
        /varia[cç][aã]o\s+de\s+avatar/i.test(lines[i]) &&
        adRe.test(lines[i]) &&
        vrRe.test(lines[i])
      ) {
        vaHeaderIdx = i; // SEM break → ULTIMA ocorrencia (mais recente)
      }
    }
  }
  if (vaHeaderIdx < 0 && adCode) {
    // 1b) Só AD code (variant ausente ou nao bateu) — ainda preferindo ultimo
    const adRe = new RegExp(escape(adCode), 'i');
    for (let i = 0; i < lines.length; i++) {
      if (/varia[cç][aã]o\s+de\s+avatar/i.test(lines[i]) && adRe.test(lines[i])) {
        vaHeaderIdx = i;
      }
    }
  }
  if (vaHeaderIdx < 0) {
    // 1c) Fallback final: primeira "Variação de avatar" do doc
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
    // 1) Tenta extrair filename completo (inclui acentos E ESPACOS — ex
    // "Link do ad: AD02G1VN - PRPB07.mp4"). A regex antiga usava [^\s] e
    // parava no primeiro espaco → "AD não detectado" em filenames com espaco.
    const m = t.match(/^link\s+do\s+ad\s*[:\-]\s*([^\n<>"|]+?\.(?:mp4|mov))\b/i);
    if (m) {
      linkAdFilename = m[1].trim();
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

  // 4. Avatares de variacao: linhas "<base>-AVA<NN>" seguidas de "Avatar: <file>".
  // SUPORTA MULTIPLOS avatares por AVA — ex "Avatar: rady.mp4 + @roberto.mp4"
  // (Doutor + Homem). 2+ avatares → diarizacao multi-locutor (roles[]); 1
  // avatar = comportamento classico (roles ausente). SCOPED a vaSectionEnd.
  //
  // Bug 2026-06-16 (este doc, AD02G1VN-PRPB07): a regex antiga so pegava 1
  // filename E exigia a linha terminar logo apos o .mp4 → a linha "x.mp4 +
  // @y.mp4" NAO casava, o AVA ficava sem username e o look-ahead capturava
  // "GANCHO" como avatar (card mostrava "1 avatar · @GANCHO"). O extrator
  // global por .mp4 resolve os dois: pega TODOS os files e ignora "GANCHO"
  // (sem .mp4).
  const allAvatares: VAAvatar[] = [];
  const seenAvaCodes = new Set<string>();
  for (let i = vaHeaderIdx; i < vaSectionEnd; i++) {
    const t = lines[i].trim();
    const avaCodeMatch = t.match(/^(?:.*[-–—]\s*)?AVA\s*(\d+)\b/i);
    if (!avaCodeMatch) continue;
    const avaNum = parseInt(avaCodeMatch[1], 10);
    const avaCode = `AVA${String(avaNum).padStart(2, '0')}`;
    if (seenAvaCodes.has(avaCode)) continue;
    // Coleta os avatares nas linhas seguintes ate o proximo codigo AVA, um
    // marcador de copy (Gancho/Body) ou um run de linhas sem avatar.
    const usernames: string[] = [];
    let youtubeUrl: string | null = null;
    let thumbUrl: string | null = null;
    for (let j = i + 1; j < Math.min(i + 6, vaSectionEnd); j++) {
      const nl = lines[j].trim();
      if (!nl) { if (usernames.length) break; else continue; }
      // proximo AVA OU marcador de copy fecha o bloco de avatares
      if (/^(?:.*[-–—]\s*)?AVA\s*\d+\b/i.test(nl)) break;
      if (/^[\s•\-*]*(?:gancho|hook|body|corpo|depoimento)\b/i.test(nl)) break;
      // Avatar por LINK do YouTube (clone de voz, sem @file.mp4)
      if (/youtu\.?be/i.test(nl)) {
        const ytId = extractYouTubeId(nl);
        if (ytId) {
          usernames.push(ytId);
          youtubeUrl = `https://www.youtube.com/watch?v=${ytId}`;
          thumbUrl = youTubeThumb(ytId);
          break;
        }
      }
      const toks = extractAvatarFileTokens(nl);
      if (toks.length) {
        for (const u of toks) {
          if (!usernames.some((x) => x.toLowerCase() === u.toLowerCase())) usernames.push(u);
        }
        continue;
      }
      // Linha sem avatar: se ja temos avatares, fecha; senao (ex "Avatar:"
      // vazio em linha propria, com os files nas linhas seguintes) continua.
      if (usernames.length) break;
    }
    if (usernames.length === 0) continue;
    seenAvaCodes.add(avaCode);
    const resolveFileId = (u: string): string | null => {
      const dl = driveLinks.find((d) => d.text.includes(u));
      return dl ? dl.fileId : null;
    };
    const primary = usernames[0];
    const primaryFileId = youtubeUrl ? null : resolveFileId(primary);
    // 2+ avatares → roles[] generico "Avatar N" (o splitter de diarizacao
    // mapeia quem fala o que pelos labels do body). 1 avatar → roles ausente
    // = comportamento classico, nada muda nos docs de 1 avatar.
    const roles: VAAvatarRole[] | undefined = usernames.length >= 2
      ? usernames.map((u, idx) => ({
          role: `Avatar ${idx + 1}`,
          username: u,
          fileId: youtubeUrl && idx === 0 ? null : resolveFileId(u),
          isDepoimento: false,
        }))
      : undefined;
    allAvatares.push({ avaNum, avaCode, username: primary, fileId: primaryFileId, youtubeUrl, thumbUrl, roles });
  }

  // FILTRO: se task name diz quais AVAs gerar (ex 'AVA05 e 06'), restringe.
  // Sem filterAvaNums OR filter vazio: passa todos.
  const avatares = filterAvaNums.length > 0
    ? allAvatares.filter((a) => filterAvaNums.includes(a.avaNum))
    : allAvatares;

  // Marcadores de secao de copy — LENIENTES. O copywriter escreve o rotulo do
  // hook de varias formas e o ANTIGO regex exigia a linha EXATAMENTE "gancho"
  // (/^gancho\s*$/), entao "Gancho:", "Gancho 1", "GANCHO 1:", "• Gancho" ou
  // "Gancho[a]" (footnote) passavam batido e o HOOK SUMIA do disparo. Aqui
  // casa todas essas formas — mas ancorado em linha-SO-marcador (rotulo +
  // numero + ":" opcionais) pra NUNCA casar uma frase falada que por acaso
  // comece com "gancho"/"body". Aceita tambem o alias EN "Hook"/"Corpo".
  const HOOK_MARK_RE = /^[\s•\-*]*(?:gancho|hook)\s*\d*\s*[:.\-]?\s*(?:\[[a-z]{1,3}\]\s*)?$/i;
  const BODY_MARK_RE = /^[\s•\-*]*(?:body|corpo)\s*\d*\s*[:.\-]?\s*(?:\[[a-z]{1,3}\]\s*)?$/i;

  // 5/6. Indices dos marcadores (SCOPED a vaSectionEnd pra nao puxar da
  // section seguinte).
  const gIdx = lines.findIndex((l, i) => i > vaHeaderIdx && i < vaSectionEnd && HOOK_MARK_RE.test(l.trim()));
  const bIdx = lines.findIndex((l, i) => i > vaHeaderIdx && i < vaSectionEnd && BODY_MARK_RE.test(l.trim()));

  // 5. Gancho (texto): apos o marcador "Gancho" ate a proxima heading
  // (Body/Depoimento) ou fim de copy.
  let hookText = '';
  if (gIdx >= 0) {
    let end = vaSectionEnd;
    for (let i = gIdx + 1; i < vaSectionEnd; i++) {
      const t = lines[i].trim();
      if (BODY_MARK_RE.test(t) || /^depoimento\b/i.test(t) || isCopyEndBoundary(t)) { end = i; break; }
    }
    hookText = lines.slice(gIdx + 1, end).join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  } else if (bIdx >= 0) {
    // FALLBACK — doc SEM rotulo "Gancho" mas COM "Body". Estilo visto live
    // (screenshot AD07G1GL): heading "AD07G1GL-RIPCTWA" + "Doutor: x.mp4" +
    // <texto do hook> + "Body" + ... — sem a palavra "Gancho". O hook e a
    // fala ANTES do Body. So dispara quando o hook estaria VAZIO (gIdx<0) E
    // existe Body, entao NUNCA regride um doc que ja funcionava. Descarta
    // linhas de heading/metadata/role/avatar pra sobrar so a fala.
    const hookLines: string[] = [];
    for (let i = vaHeaderIdx + 1; i < bIdx; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      if (isCopyEndBoundary(t)) break;
      if (AD_HEADING_RE.test(t)) continue;                          // sub-heading AD (ex "AD07G1GL-RIPCTWA")
      if (/^varia[cç][aã]o\s+de\s+avatar/i.test(t)) continue;
      if (/^link\s+(?:do\s+ad|da\s+copy|do\s+avatar|avatar)\b/i.test(t)) continue;
      if (/^avatar\b/i.test(t)) continue;                            // "Avatar @x.mp4" / "Avatar e Vozes:" / "Avatar: ..."
      if (/^fonte\s+de\s+tr[aá]fego\b/i.test(t)) continue;
      if (/^instru[cç][oõ]es\b/i.test(t)) continue;
      if (/^(?:.*[-–—]\s*)?AVA\s*\d+\b/i.test(t)) continue;          // linha de codigo AVA
      if (/\.(?:mp4|mov)\b/i.test(t)) continue;                      // qualquer referencia de arquivo (avatar/AD) — fala nunca tem .mp4
      if (isPureRoleOrMentionLine(t)) continue;                      // "Doutor: x.mp4", "@x.mp4"
      hookLines.push(lines[i]);
    }
    hookText = hookLines.join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  }

  // 6. Body — SCOPED a vaSectionEnd
  let bodyText = '';
  if (bIdx >= 0) {
    let end = vaSectionEnd;
    for (let i = bIdx + 1; i < vaSectionEnd; i++) {
      const t = lines[i].trim();
      if (/^depoimento\b/i.test(t) || isCopyEndBoundary(t)) { end = i; break; }
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
    let depEnd = lines.length;
    for (let i = dIdx + 1; i < lines.length; i++) {
      if (isCopyEndBoundary(lines[i])) { depEnd = i; break; }
    }
    depoimentoText = lines.slice(dIdx + 1, depEnd).join('\n').trim().replace(/\s*\[[a-z]{1,3}\]/gi, '');
  }

  // Validacao minima: precisa ter pelo menos 1 avatar.
  if (avatares.length === 0) return null;
  // Hook OU body e EXIGIDO no fluxo normal (avatar .mp4) — sua ausencia indica
  // parse quebrado. EXCECAO: criativos YouTube "sem edicao" + clone de voz, onde
  // o avatar e um link do YouTube e nao ha copy falada no doc. Nesse caso o
  // briefing e valido mesmo sem hook/body (so nao bloqueia o card com erro).
  const hasYouTubeAvatar = avatares.some((a) => !!a.youtubeUrl);
  if (!hasYouTubeAvatar && !hookText && !bodyText) return null;

  return {
    baseAdId,
    linkAdFilename,
    linkAdFileId,
    linkCopyDocId: null, // formato legado nao usa copy-anchor
    linkCopyText: null,
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
): { id: string; name: string; groupName?: string; score: number; matchedBy?: 'voice_name_exact' | 'voice_name_fuzzy' | 'name_exact' | 'name_contains' | 'group_exact' | 'group_contains' | 'name_tokens' | 'voice_name_contains' | 'id_exact' | 'id_contains' } | null {
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
    // ID do avatar/look HeyGen — alguns briefings referenciam o avatar pelo
    // ID cru (ex "@749477393444762056" = talking-photo id). matchAvatar antes
    // so olhava nome/voz/grupo e perdia esses. Agora casa pelo id tambem.
    const idn = norm(c.id || '');

    // EXACT matches (220-200) — usuario nomeou identico ao briefing
    if (vnNorm && vnNorm === u) { score = 220; matchedBy = 'voice_name_exact'; }
    else if (idn && idn === u) { score = 215; matchedBy = 'id_exact'; }
    else if (nm && nm === u) { score = 210; matchedBy = 'name_exact'; }
    else if (gn && gn === u) { score = 200; matchedBy = 'group_exact'; }
    // CONTAINS matches (180-140) — substring de qualquer lado
    else if (vnNorm && (vnNorm.includes(u) || u.includes(vnNorm))) { score = 180; matchedBy = 'voice_name_contains'; }
    // id_contains: so pra ids longos (evita falso-positivo com numero curto)
    else if (idn && u.length >= 8 && (idn.includes(u) || u.includes(idn))) { score = 175; matchedBy = 'id_contains'; }
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
