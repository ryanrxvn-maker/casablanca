/**
 * FONTES DE TASK DO PILOT (05.09) — de onde uma task pode nascer.
 *
 * Até aqui o Pilot só conhecia UMA origem: a task do ClickUp. Tudo que vem
 * depois (análise, avatares, versões, legenda, zoom, inserts, decupagem,
 * disparo, montagem) lê de `tasks[]` + `taskAnalyses` e nunca mais volta ao
 * ClickUp. Então pra abrir DUAS origens novas, o que muda é só o NASCIMENTO
 * da task:
 *
 *   · DOCS    — um Google Docs (link ou arquivo) que contém N anúncios vira N
 *               tasks, uma por nomenclatura, do mesmo jeito que o ClickUp
 *               listaria. O parser é o MESMO da produção.
 *   · CREATOR — o editor cria a task do zero e cola a copy.
 *
 * Este módulo é PURO (sem React, sem DOM além do que é opcional) pra ser
 * testado em Node contra docs reais. A página só liga os fios.
 *
 * Regras do id de uma task local — todas vêm de onde o resto do Pilot lê:
 *   · só `[A-Za-z0-9_]`: `:` quebra os prefixos do IndexedDB (`pilot:<id>:`)
 *     e `-` no fim viraria sufixo de versão (`-yt`, `-v3` → taskIdBaseDaVersao)
 *   · não começar com `heygenauto` (o Pilot ignora esse prefixo no restore)
 *   · estável entre sessões: a fila (`batches`), o `dispatched` e o cache do
 *     IndexedDB são todos chaveados por ele
 */

import { buildDisparosFromDoc, extractAdIds } from './doc-to-disparos';
import type { ClickUpTask } from './clickup-client';

/* ───────────────────────────── tipos ───────────────────────────── */

export type ModoPilot = 'clickup' | 'docs' | 'creator';

export type OrigemDoc = 'link' | 'arquivo' | 'colado';

/** O doc como a extensão entrega — é isto que o parser de produção consome. */
export type DocLocal = {
  /** chave estável (hash do texto) — as tasks do mesmo doc apontam pra ela */
  key: string;
  text: string;
  driveLinks: Array<{ text: string; fileId: string | null; url?: string | null }>;
  headings: Array<{ id: string; text: string }>;
  comments: Array<{ marker: string; context: string; body: string }>;
  origem: OrigemDoc;
  /** só quando veio por link (serve pro botão "abrir doc") */
  docUrl?: string;
  nomeArquivo?: string;
  criadoEm: number;
};

/** Uma task que nasceu fora do ClickUp. Mora ao lado da `ClickUpTask`
 *  sintética e diz de onde ela veio. */
export type TaskLocal = {
  id: string;
  modo: Exclude<ModoPilot, 'clickup'>;
  nome: string;
  baseAdId: string;
  /** chave do DocLocal com a copy (DOCS: o doc inteiro; CREATOR: o colado) */
  docKey: string | null;
  teamId: string | null;
  criadoEm: number;
};

/* ───────────────────────────── ids ───────────────────────────── */

const PREFIXO_DOCS = 'pilot_docs_';
const PREFIXO_CREATOR = 'pilot_creator_';

/** Uma task nasceu no DOCS ou no CREATOR? (tudo que não é do ClickUp) */
export function isTaskLocal(id: string | null | undefined): boolean {
  return !!id && (id.startsWith(PREFIXO_DOCS) || id.startsWith(PREFIXO_CREATOR));
}

export function modoDaTaskLocal(id: string): Exclude<ModoPilot, 'clickup'> | null {
  if (id.startsWith(PREFIXO_DOCS)) return 'docs';
  if (id.startsWith(PREFIXO_CREATOR)) return 'creator';
  return null;
}

/** Só caracteres que nenhum prefixo/sufixo do Pilot interpreta. */
function limparToken(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Hash curto e determinístico (djb2) — chave do doc e parte do id da task. */
export function hashCurto(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function idTaskDoDoc(docKey: string, baseAdId: string): string {
  return `${PREFIXO_DOCS}${limparToken(docKey)}_${limparToken(baseAdId)}`;
}

export function idTaskCreator(agora = Date.now(), aleatorio = Math.random()): string {
  return `${PREFIXO_CREATOR}${agora.toString(36)}_${Math.floor(aleatorio * 1e9).toString(36)}`;
}

/* ─────────────────────── doc → N tasks ─────────────────────── */

const AD_HEADING_RE = /^AD\d+[A-Z0-9]*(?:\[[A-Z0-9]{1,6}\])?\s*[-–—]\s*[A-Z0-9]+/i;

export type TaskDoDoc = { baseAdId: string; nome: string; sufixo: string | null };

/**
 * Enumera os anúncios de um doc como tasks, com o NOME no padrão do ClickUp:
 * `AD12VN - VRWA06`. Cobre os dois dialetos do doc (com heading de grupo, ou
 * só com os headings dos hooks `AD12G1VN - VRWA06`): o infixo G<n> é tirado
 * do nome, exatamente como a task do ClickUp é batizada.
 */
export function enumerarTasksDoDoc(text: string): TaskDoDoc[] {
  if (!text) return [];
  // Pelo PARSER DE PRODUÇÃO, não por heading: um doc real tem headings que são
  // só referência ("AD65VN[T] - VFPB02" citado dentro de outro AD) e não têm
  // copy — o parser os descarta, e a lista aqui tem que ser a MESMA que o
  // ClickUp Pilot analisaria. Medido no RIPTVWA: 53 headings, 51 ADs.
  // O parser devolve o base já normalizado quase sempre; num heading fora do
  // padrão (RIPTVWA "AD87G1VN - RIPTVWA") ele vaza o heading inteiro. Normaliza
  // como a análise faria (token AD<n><suf>, sem infixo G<n>) e dedupe.
  const bases = Array.from(
    new Set(
      buildDisparosFromDoc(text, [])
        .disparos.map((d) => (baseAdIdDoNome(d.baseAdId) ?? '').replace(/G\d+/g, ''))
        .filter((b) => /^AD\d+/.test(b)), // sem heading nenhum o parser devolve 'COPY'
    ),
  );
  if (bases.length === 0) return [];
  // primeiro heading de cada base → de lá sai o sufixo da nomenclatura
  const sufixoPorBase = new Map<string, string | null>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!AD_HEADING_RE.test(line)) continue;
    const cabeca = line.match(/^(AD\d+[A-Z0-9]*)(?:\[[A-Z0-9]{1,6}\])?\s*[-–—]\s*([A-Z0-9]+)/i);
    if (!cabeca) continue;
    const base = extractAdIds(cabeca[1].toUpperCase().replace(/G\d+/, '')).baseAdId;
    if (!base || sufixoPorBase.has(base)) continue;
    sufixoPorBase.set(base, cabeca[2] ? cabeca[2].toUpperCase() : null);
  }
  return bases.map((baseAdId) => {
    const sufixo = sufixoPorBase.get(baseAdId) ?? null;
    return { baseAdId, sufixo, nome: sufixo ? `${baseAdId} - ${sufixo}` : baseAdId };
  });
}

/* ─────────────────── a task sintética (shape do ClickUp) ─────────────────── */

/** O que o card, a seleção e a análise leem de uma task. Nada além disto é
 *  consultado pelo fluxo pós-carregamento (medido em 05.09). */
export function taskSintetica(local: TaskLocal, doc?: DocLocal | null): ClickUpTask {
  const rotulo = local.modo === 'docs' ? 'docs' : 'creator';
  return {
    id: local.id,
    name: local.nome,
    status: { status: rotulo, color: local.modo === 'docs' ? '#22d3ee' : '#a78bfa', type: 'custom' },
    url: '',
    team_id: local.teamId || undefined,
    assignees: [],
    priority: null,
    due_date: undefined,
    // Sem link não há nada aqui — o texto vem do DocLocal, não do ClickUp.
    custom_fields: doc?.docUrl
      ? [{ id: 'doc-local', name: 'DOC DA COPY', type: 'url', value: doc.docUrl }]
      : [],
  };
}

/** Constrói as tasks locais de um doc já lido. */
export function tasksDoDoc(doc: DocLocal, teamId: string | null, agora = Date.now()): TaskLocal[] {
  return enumerarTasksDoDoc(doc.text).map((t) => ({
    id: idTaskDoDoc(doc.key, t.baseAdId),
    modo: 'docs' as const,
    nome: t.nome,
    baseAdId: t.baseAdId,
    docKey: doc.key,
    teamId,
    criadoEm: agora,
  }));
}

/** O baseAdId exatamente como a ANÁLISE extrai do nome da task
 *  (`AD01 - CREATOR` → `AD01`; `AD12VN - VRWA06` → `AD12VN`). É este que
 *  batiza os arquivos entregues. */
export function baseAdIdDoNome(nome: string): string | null {
  const m = nome.match(/\b(AD\d+[A-Z0-9]*)/i);
  return m ? m[1].toUpperCase() : null;
}

/** O nome padrão da próxima task do CREATOR: AD01, AD02… sem colidir com as
 *  que já existem (o número é o que o resto do fluxo usa pra batizar os
 *  arquivos — `AD03G1.mp4`). */
export function proximoNomeCreator(existentes: Array<{ nome: string }>): string {
  const usados = new Set<number>();
  for (const t of existentes) {
    const m = t.nome.match(/\bAD(\d+)/i);
    if (m) usados.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (usados.has(n)) n++;
  return `AD${String(n).padStart(2, '0')} - CREATOR`;
}

/** A copy colada no CREATOR vira um "doc" de um AD só: o heading é o nome da
 *  task, então o MESMO parser da produção (parseDarkoBriefing) acha a seção,
 *  os rótulos de locutor, HOOK/BODY — igual a um doc de verdade. */
export function docDaCopyColada(nomeTask: string, copy: string, agora = Date.now()): DocLocal {
  const corpo = copy.replace(/\r\n/g, '\n').trim();
  // Se o editor já colou com o heading da nomenclatura, respeita; senão põe.
  const jaTemHeading = AD_HEADING_RE.test(corpo.split('\n')[0]?.trim() || '');
  const text = jaTemHeading ? corpo : `${nomeTask}\n${corpo}`;
  return {
    key: `colado_${hashCurto(text)}`,
    text,
    driveLinks: [],
    headings: [],
    comments: [],
    origem: 'colado',
    criadoEm: agora,
  };
}

/* ─────────────────── leitura de arquivo (.docx / .txt) ─────────────────── */

/** Decodifica entidades XML do .docx (aspas curvas do Docs vêm como &#8220;). */
export function decodificarXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** `word/document.xml` → texto com um parágrafo por linha (o que o parser lê). */
export function textoDeDocumentXml(xml: string): string {
  // ⚠ Tab e quebra ficam FORA dos <w:t>. Juntar só os runs (como o Hey Auto
  // fazia) engolia os dois: "Doutor:\t@x.mp4" virava "Doutor:@x.mp4" e a
  // quebra de linha dentro do parágrafo sumia. Tokeniza em ORDEM.
  // `<w:t(?:\s[^>]*)?>` e não `<w:t[^>]*>`: o segundo engole `<w:tab/>` como
  // se fosse abertura de run e come tudo até o próximo </w:t>.
  const TOKEN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>/g;
  const paras = xml.split(/<\/w:p>/).map((seg) => {
    let out = '';
    for (const m of seg.matchAll(TOKEN)) {
      if (m[1] !== undefined) out += m[1];
      else if (m[0] === '<w:tab/>') out += '\t';
      else out += '\n';
    }
    return out;
  });
  return decodificarXml(paras.join('\n'));
}

/** Lê um arquivo importado (.docx pelo XML; qualquer outro como texto). */
export async function textoDeArquivo(file: Blob & { name?: string }): Promise<string> {
  const nome = (file.name || '').toLowerCase();
  if (nome.endsWith('.docx')) {
    // O jszip exporta de dois jeitos conforme o empacotador (default no Next,
    // módulo direto no commonjs da suíte) — aceita os dois.
    const mod = (await import('jszip')) as unknown as { default?: typeof import('jszip') } & typeof import('jszip');
    const JSZip = mod.default ?? mod;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw new Error('Arquivo .docx inválido (sem word/document.xml).');
    return textoDeDocumentXml(xml);
  }
  return await file.text();
}

/** Monta o DocLocal de um texto vindo de arquivo ou de link (só texto). */
export function docDeTexto(
  text: string,
  origem: OrigemDoc,
  extra: Partial<Pick<DocLocal, 'driveLinks' | 'headings' | 'comments' | 'docUrl' | 'nomeArquivo'>> = {},
  agora = Date.now(),
): DocLocal {
  const limpo = text.replace(/\r\n/g, '\n');
  return {
    key: `${origem}_${hashCurto(limpo)}`,
    text: limpo,
    driveLinks: extra.driveLinks || [],
    headings: extra.headings || [],
    comments: extra.comments || [],
    origem,
    docUrl: extra.docUrl,
    nomeArquivo: extra.nomeArquivo,
    criadoEm: agora,
  };
}

/* ───────────────────────── persistência local ───────────────────────── */

export const TASKS_LOCAIS_KEY = 'darkolab:clickup-pilot:tasks-locais';
export const DOCS_LOCAIS_KEY = 'darkolab:clickup-pilot:docs-locais';
/** Docs inteiros pesam (um lote B2C tem ~40-200KB). Guarda os mais recentes. */
const MAX_DOCS_GUARDADOS = 6;

type Armazem = { getItem(k: string): string | null; setItem(k: string, v: string): void };

function armazem(): Armazem | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function lerTasksLocais(store: Armazem | null = armazem()): TaskLocal[] {
  if (!store) return [];
  try {
    const arr = JSON.parse(store.getItem(TASKS_LOCAIS_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((t) => t && typeof t.id === 'string' && isTaskLocal(t.id)) : [];
  } catch {
    return [];
  }
}

export function salvarTasksLocais(tasks: TaskLocal[], store: Armazem | null = armazem()): void {
  if (!store) return;
  try {
    store.setItem(TASKS_LOCAIS_KEY, JSON.stringify(tasks));
  } catch {
    /* sem espaço: vale só nesta sessão */
  }
}

export function lerDocsLocais(store: Armazem | null = armazem()): Record<string, DocLocal> {
  if (!store) return {};
  try {
    const obj = JSON.parse(store.getItem(DOCS_LOCAIS_KEY) || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/** Grava o doc e poda os mais velhos que NENHUMA task local usa. */
export function salvarDocLocal(
  doc: DocLocal,
  tasks: TaskLocal[],
  store: Armazem | null = armazem(),
): Record<string, DocLocal> {
  const docs = lerDocsLocais(store);
  docs[doc.key] = doc;
  const emUso = new Set(tasks.map((t) => t.docKey).filter(Boolean) as string[]);
  emUso.add(doc.key);
  const ordenados = Object.values(docs).sort((a, b) => b.criadoEm - a.criadoEm);
  const manter: Record<string, DocLocal> = {};
  let n = 0;
  for (const d of ordenados) {
    if (emUso.has(d.key) || n < MAX_DOCS_GUARDADOS) {
      manter[d.key] = d;
      n++;
    }
  }
  if (store) {
    try {
      store.setItem(DOCS_LOCAIS_KEY, JSON.stringify(manter));
    } catch {
      // Estourou a cota: guarda só os docs em uso, sem os antigos.
      const soEmUso: Record<string, DocLocal> = {};
      for (const k of emUso) if (manter[k]) soEmUso[k] = manter[k];
      try {
        store.setItem(DOCS_LOCAIS_KEY, JSON.stringify(soEmUso));
      } catch {
        /* nem assim: fica só em memória */
      }
    }
  }
  return manter;
}
