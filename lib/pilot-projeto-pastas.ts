/**
 * PASTAS do projeto editável (08.10) — o painel de mídia do CapCut e os bins
 * do Premiere chegam ORGANIZADOS, não com 200 arquivos soltos.
 *
 * Silas: *"tem que vir tudo categorizado por pasta certinho dentro do projeto:
 * SFX, take de tal coisa, de tal coisa e etc"*.
 *
 *   01 · AVATAR
 *   02 · TAKES ─┬─ CÉREBRO E MEMÓRIA
 *               ├─ IDOSOS
 *               └─ … (uma pasta por ASSUNTO do take)
 *   03 · SFX
 *   04 · TRILHA
 *   05 · LEGENDAS
 *   06 · HEADLINES
 *   07 · TRANSIÇÕES E EFEITOS
 *
 * O assunto do take sai do TÍTULO do catálogo (StockFrame: "CEREBRO REAL
 * SAUDAVEL", "VELHA COM SAUDE"…) ou do nome do arquivo. As regras casam por
 * PALAVRA INTEIRA (ou prefixo marcado com `*`), nunca por pedaço de palavra —
 * o kit_pool das edições aprendeu do jeito difícil que "dor" casa com
 * "computaDOR" e "atriz" com "cicATRIZes".
 *
 * Puro: sem DOM — testado em pilot-projeto-pastas.test.ts.
 */

export const PASTA = {
  avatar: '01 · AVATAR',
  takes: '02 · TAKES',
  sfx: '03 · SFX',
  trilha: '04 · TRILHA',
  legendas: '05 · LEGENDAS',
  headlines: '06 · HEADLINES',
  efeitos: '07 · TRANSIÇÕES E EFEITOS',
} as const;

/** Take sem assunto reconhecido (vai por último dentro de TAKES). */
export const TAKES_SEM_ASSUNTO = 'OUTROS TAKES';

/** minúsculas, sem acento, só letras/números separados por espaço */
export function normalizarTexto(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // "CEREBRO_REAL-SAUDAVEL(2).mp4" → palavras; separa número grudado em letra
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Taxonomia GENÉRICA (serve pra qualquer nicho), em ordem: a 1ª regra que
 * casa vence. Ordem pensada pro assunto principal do take: o sintoma e o
 * médico vêm antes da pessoa ("IDOSA COM DIARREIA" é sintoma, não "idosos";
 * "UROLOGISTA EXPLICANDO O SISTEMA REPRODUTOR" é médico, não anatomia).
 * Palavra com `*` = prefixo ("esquec*" pega esquecer, esquecimento…).
 */
export const REGRAS_DE_ASSUNTO: ReadonlyArray<{ pasta: string; chaves: readonly string[] }> = [
  { pasta: 'CÉREBRO E MEMÓRIA', chaves: ['cerebr*', 'neuroni*', 'neural', 'memoria*', 'alzheimer', 'demencia', 'esquec*', 'mente', 'raciocinio', 'brain', 'memory'] },
  { pasta: 'MÉDICOS E EXAMES', chaves: ['medico', 'medica', 'medicos', 'medicas', 'doutor*', 'dr', 'dra', 'urologista', 'cardiologista', 'neurologista', 'nutricionista', 'especialista', 'exame*', 'consulta*', 'consultorio', 'hospital*', 'clinica*', 'laboratorio*', 'cientista*', 'pesquisa*', 'pesquisador*', 'microscopio', 'enfermeir*', 'raio x', 'ultrassom', 'doctor', 'nurse', 'scientist*'] },
  { pasta: 'REMÉDIOS E SUPLEMENTOS', chaves: ['remedio*', 'comprimido*', 'capsula*', 'pilula*', 'farmacia*', 'suplemento*', 'medicamento*', 'injecao', 'injetando', 'caneta*', 'canetinha*', 'seringa*', 'colirio*', 'pomada*', 'xarope*', 'gotas', 'frasco*', 'vitamina*', 'laxante*', 'pill*', 'medicine'] },
  { pasta: 'CORPO E ANATOMIA', chaves: ['3 d', 'anatomia', 'animacao', 'celula*', 'sangue', 'veia*', 'arteria*', 'orgao*', 'figado', 'rim', 'rins', 'coracao', 'intestin*', 'estomago', 'prostata', 'bexiga', 'osso*', 'articula*', 'sistema', 'bacteria*', 'virus', 'inflamac*', 'corrente', 'blood', 'heart', 'cell*'] },
  { pasta: 'DOR E SINTOMAS', chaves: ['dor', 'dores', 'doendo', 'doi', 'sintoma*', 'cansad*', 'cansaco', 'tontura', 'tont*', 'diarreia', 'inchac*', 'inchad*', 'coceira', 'queimac*', 'ferida*', 'machucad*', 'doente*', 'sofrendo', 'febre', 'insonia', 'zumbido', 'varize*', 'neuropatia', 'formigamento', 'pain'] },
  { pasta: 'COMIDA E RECEITAS', chaves: ['receita*', 'comida*', 'alimento*', 'alimentac*', 'fruta*', 'legume*', 'verdura*', 'cha', 'suco*', 'liquidificador', 'batida', 'cozinha*', 'cozinhando', 'prato*', 'bebida*', 'bebendo', 'cafe', 'mel', 'limao', 'alho', 'gengibre', 'canela', 'vinagre', 'azeite', 'oleo', 'baking soda', 'bicarbonato', 'ovo', 'ovos', 'leite', 'mistura*', 'misturando', 'ingrediente*', 'panela*', 'colher*', 'restaurante*', 'comendo', 'dieta', 'food', 'recipe*'] },
  { pasta: 'PLANTAS E NATUREZA', chaves: ['planta*', 'erva*', 'folha*', 'raiz', 'raizes', 'semente*', 'natural', 'natureza', 'flor', 'flores', 'arvore*', 'jardim', 'floresta*', 'praia', 'mar', 'paisagem', 'plant*', 'nature'] },
  { pasta: 'IDOSOS', chaves: ['idos*', 'velh*', 'vovo*', 'avo', 'avos', 'terceira idade', 'aposentad*', 'senhor', 'senhora', 'elderly', 'old'] },
  { pasta: 'FAMÍLIA E CASAL', chaves: ['familia*', 'casal', 'casais', 'marido', 'esposa', 'filho*', 'filha*', 'neto*', 'neta*', 'crianca*', 'bebe', 'namorad*', 'beijo*', 'abraco*', 'abracando', 'briga', 'ciume*', 'gravida*', 'gestacao', 'family', 'couple'] },
  { pasta: 'DINHEIRO', chaves: ['dinheiro', 'nota', 'notas', 'reais', 'dolar*', 'pix', 'cartao', 'pagamento*', 'pagando', 'comprando', 'compra', 'carteira', 'rico*', 'riqueza', 'banco', 'investimento*', 'lucro*', 'renda', 'money', 'cash'] },
  { pasta: 'EXERCÍCIO E BEM-ESTAR', chaves: ['academia', 'exercicio*', 'corrida', 'correndo', 'caminhada', 'caminhando', 'alongamento*', 'alongando', 'yoga', 'fisioterapia', 'massagem', 'emagrec*', 'barriga', 'balanca', 'peso', 'saudavel', 'saude', 'disposicao', 'energia', 'comemorando', 'feliz', 'felizes', 'sorrindo', 'workout', 'healthy'] },
  { pasta: 'CASA E ROTINA', chaves: ['casa', 'sala', 'quarto', 'cama', 'dormindo', 'acordando', 'banho', 'banheiro', 'rotina', 'trabalho', 'trabalhando', 'escritorio', 'computador', 'celular', 'telefone', 'carro', 'dirigindo', 'mercado', 'supermercado'] },
  { pasta: 'TEXTOS E ELEMENTOS', chaves: ['seta*', 'texto*', 'grafico*', 'titulo*', 'logo*', 'icone*', 'elemento*', 'emoji*', 'moldura*', 'fundo', 'background', 'overlay', 'arrow'] },
  { pasta: 'PESSOAS', chaves: ['homem', 'homens', 'mulher', 'mulheres', 'pessoa*', 'jovem', 'jovens', 'rapaz', 'moca', 'garota*', 'garoto*', 'menina*', 'menino*', 'man', 'woman', 'people'] },
];

function casa(palavras: string[], chave: string): boolean {
  const partes = chave.split(' ');
  for (let i = 0; i + partes.length <= palavras.length; i++) {
    let ok = true;
    for (let k = 0; k < partes.length && ok; k++) {
      const p = partes[k];
      const w = palavras[i + k];
      ok = p.endsWith('*') ? w.startsWith(p.slice(0, -1)) : w === p;
    }
    if (ok) return true;
  }
  return false;
}

/** O assunto de um take a partir dos textos dele (título primeiro, nome do
 *  arquivo depois): a 1ª regra que casa em QUALQUER texto, na ordem dos textos. */
export function assuntoDoTake(...textos: Array<string | null | undefined>): string {
  for (const t of textos) {
    const palavras = normalizarTexto(t || '').split(' ').filter(Boolean);
    if (!palavras.length) continue;
    for (const r of REGRAS_DE_ASSUNTO) {
      if (r.chaves.some((c) => casa(palavras, c))) return r.pasta;
    }
  }
  return TAKES_SEM_ASSUNTO;
}

/** Título limpo pra nome de arquivo: ASCII, sem caractere proibido no Windows. */
export function tituloParaArquivo(s: string, max = 48): string {
  const limpo = (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/[^A-Za-z0-9()\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.slice(0, max).trim().replace(/[ .-]+$/, '');
}

/** "TAKE 03 - CEREBRO REAL SAUDAVEL.mp4" */
export function nomeDoTake(n: number, titulo: string, ext: string): string {
  const t = tituloParaArquivo(titulo);
  return `TAKE ${String(n).padStart(2, '0')}${t ? ` - ${t}` : ''}.${ext}`;
}

/** Onde cada arquivo mora quando ninguém disse (pelo nome que o exportador dá). */
export function pastaPadraoDoArquivo(a: { nome: string; tipo: 'video' | 'imagem' | 'audio' }): string[] {
  const n = a.nome;
  if (/^avatar/i.test(n)) return [PASTA.avatar];
  if (/^SFX - /.test(n)) return [PASTA.sfx];
  if (/^TRILHA - /.test(n)) return [PASTA.trilha];
  if (/^legenda_/i.test(n)) return [PASTA.legendas];
  if (/^headline_/i.test(n)) return [PASTA.headlines];
  if (/^(transicao_|linha_)/i.test(n)) return [PASTA.efeitos];
  return [PASTA.takes, TAKES_SEM_ASSUNTO];
}

/** Ordem canônica das pastas de cima (o CapCut ordena pela data de criação). */
const ORDEM_DE_CIMA: string[] = Object.values(PASTA);

/** Pastas que existem de verdade, na ordem: as de cima na ordem fixa e, dentro
 *  de TAKES, os assuntos em ordem alfabética com OUTROS TAKES por último. */
export function arvoreDePastas(caminhos: string[][]): string[][] {
  const vistos = new Map<string, string[]>();
  for (const c of caminhos) {
    for (let i = 1; i <= c.length; i++) {
      const p = c.slice(0, i);
      vistos.set(p.join('\u0000'), p);
    }
  }
  const peso = (p: string[]) => {
    const topo = ORDEM_DE_CIMA.indexOf(p[0]);
    return topo < 0 ? ORDEM_DE_CIMA.length : topo;
  };
  return [...vistos.values()].sort((a, b) => {
    const d = peso(a) - peso(b) || a[0].localeCompare(b[0], 'pt-BR');
    if (d) return d;
    if (a.length !== b.length) return a.length - b.length;
    const sa = a[a.length - 1];
    const sb = b[b.length - 1];
    if (sa === TAKES_SEM_ASSUNTO) return 1;
    if (sb === TAKES_SEM_ASSUNTO) return -1;
    return sa.localeCompare(sb, 'pt-BR');
  });
}

/** Nome de pasta EM DISCO (Premiere): ASCII, " - " no lugar do "·". */
export function pastaEmDisco(caminho: string[]): string {
  return caminho
    .map((p) => p.replace(/\s*·\s*/g, ' - ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim())
    .join('/');
}

function comoUuid(id: string): string {
  const h = id.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return id;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * O `draft_virtual_store.json` do CapCut — as PASTAS do painel de mídia
 * (schema lido de rascunhos reais; testado no CapCut 9.5 em 08.10, pasta
 * dentro de pasta e acento no nome funcionam):
 *  - type 0 = as pastas {id, display_name, creation_time…}; a 1ª é a raiz (vazia);
 *  - type 1 = a árvore {child_id, parent_id} — cada pasta E cada arquivo do
 *    painel (o `id` dele em draft_meta_info) é um nó; parent_id "" = raiz;
 *  - type 2 = [].
 * O CapCut ordena as pastas pela data de criação: um segundo a mais por pasta
 * mantém a ordem 01, 02, 03… (empate = ordem embaralhada a cada projeto).
 */
export function virtualStoreDoCapCut(
  itens: Array<{ id: string; pasta: string[] }>,
  agoraSeg: number,
  novoId: () => string,
): { draft_materials: unknown[]; draft_virtual_store: Array<{ type: number; value: unknown[] }> } {
  const arvore = arvoreDePastas(itens.map((i) => i.pasta));
  const idDaPasta = new Map<string, string>();
  const pastas = arvore.map((caminho, i) => {
    const id = comoUuid(novoId());
    idDaPasta.set(caminho.join('\u0000'), id);
    const t = Math.floor(agoraSeg) + i;
    return {
      creation_time: t, display_name: caminho[caminho.length - 1], filter_type: 0, id,
      import_time: t, import_time_us: t * 1_000_000, sort_sub_type: 0, sort_type: 0, subdraft_filter_type: 0,
    };
  });
  const relacoes: Array<{ child_id: string; parent_id: string }> = arvore.map((caminho) => ({
    child_id: idDaPasta.get(caminho.join('\u0000'))!,
    parent_id: caminho.length > 1 ? idDaPasta.get(caminho.slice(0, -1).join('\u0000'))! : '',
  }));
  for (const it of itens) relacoes.push({ child_id: it.id, parent_id: idDaPasta.get(it.pasta.join('\u0000')) || '' });
  const raiz = { creation_time: 0, display_name: '', filter_type: 0, id: '', import_time: 0, import_time_us: 0, sort_sub_type: 0, sort_type: 0, subdraft_filter_type: 0 };
  return {
    draft_materials: [],
    draft_virtual_store: [
      { type: 0, value: [raiz, ...pastas] },
      { type: 1, value: relacoes },
      { type: 2, value: [] },
    ],
  };
}

/* ═══════════════════════════ capa-assinatura ════════════════════════════
 * A capa do rascunho é um quadrado ROSA-CHOQUE com o nome do AD. Não é
 * enfeite: o Auto Edit Abrir (o app do PC que abre o projeto sozinho) acha o
 * projeto na tela inicial do CapCut por essa cor — é o único bloco desse tom
 * na tela — e clica nele. Depois que o projeto abre, o CapCut troca a capa
 * pelo 1º quadro do vídeo. Mudou a cor aqui = mudar no app (AutoEditAbrir.cs).
 */
export const CAPA_COR = { r: 255, g: 0, b: 170 } as const;
export const CAPA_ARQUIVO = 'draft_cover.jpg';
