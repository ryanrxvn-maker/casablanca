'use client';

/**
 * SELO DE INSERT POR ORIGEM (20.09).
 *
 * O card em produção mostrava UM selo azul de "insert" pra tudo — o que o Silas
 * subiu à mão, o que veio do StockFrame e o que o Flow gerou. Olhando o card
 * pronto não dava pra saber de onde veio o b-roll daquele AD.
 *
 * Agora cada origem tem o SEU selo, com o símbolo da própria ferramenta:
 * StockFrame e Flow aparecem com a marca deles, e o azul genérico volta a
 * significar só o que foi importado na mão. Usou as duas? Aparecem as duas.
 *
 * A contagem é a dos inserts que REALMENTE entram na montagem (a lista já vem
 * filtrada por `insertsAtivosNaMontagem`), então o selo nunca promete b-roll
 * que foi desligado.
 */

export type OrigemDoSelo = 'insert' | 'stockframe' | 'flow';

/** Só o que o selo precisa saber de um insert. */
export type InsertParaSelo = {
  ancora?: string;
  source?: string | null;
};

export type SeloDeInsert = {
  tipo: OrigemDoSelo;
  quantidade: number;
  /** Âncoras (trechos da copy) onde esses inserts entram, sem repetir. */
  ancoras: string[];
};

/** Ordem no card: mão primeiro, depois as ferramentas, sempre a mesma. */
const ORDEM: OrigemDoSelo[] = ['insert', 'stockframe', 'flow'];

function origemDoInsert(insert: InsertParaSelo): OrigemDoSelo {
  if (insert.source === 'stockframe') return 'stockframe';
  if (insert.source === 'flow') return 'flow';
  // Sem `source` = importado na mão pelo estúdio de inserts. Qualquer origem
  // NOVA que apareça um dia cai aqui e continua visível — melhor um selo
  // genérico do que o b-roll sumir do card.
  return 'insert';
}

/**
 * Agrupa os inserts da montagem por origem. Origem sem nenhum insert não vira
 * selo (não se anuncia o que não está no vídeo).
 */
export function selosDeInserts(inserts: ReadonlyArray<InsertParaSelo>): SeloDeInsert[] {
  const porOrigem = new Map<OrigemDoSelo, SeloDeInsert>();
  for (const insert of inserts) {
    const tipo = origemDoInsert(insert);
    const atual = porOrigem.get(tipo) || { tipo, quantidade: 0, ancoras: [] };
    atual.quantidade += 1;
    const ancora = (insert.ancora || '').trim();
    if (ancora && !atual.ancoras.includes(ancora)) atual.ancoras.push(ancora);
    porOrigem.set(tipo, atual);
  }
  return ORDEM.filter((tipo) => porOrigem.has(tipo)).map((tipo) => porOrigem.get(tipo)!);
}

/** Singular e plural escritos à mão: o "s" no fim da frase daria "take do
 *  StockFrames". O plural cai no SUBSTANTIVO, não no nome da ferramenta. */
const NOME_DA_ORIGEM: Record<OrigemDoSelo, { um: string; varios: string }> = {
  insert: { um: 'insert', varios: 'inserts' },
  stockframe: { um: 'take do StockFrame', varios: 'takes do StockFrame' },
  flow: { um: 'insert do Flow', varios: 'inserts do Flow' },
};

/** Texto do hover: conta o que entrou e onde, na língua do Silas. */
export function tituloDoSeloDeInsert(selo: SeloDeInsert): string {
  const nome = NOME_DA_ORIGEM[selo.tipo];
  const quantos = selo.quantidade === 1 ? nome.um : nome.varios;
  const onde = selo.ancoras.length > 0 ? ` — ${selo.ancoras.join(', ')}` : '';
  return `${selo.quantidade} ${quantos} na montagem${onde}`;
}
