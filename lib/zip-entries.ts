/**
 * Leitor de ZIP que NAO carrega o arquivo na memoria.
 *
 * POR QUE ISTO EXISTE (17.09.2026): a entrega do Pilot com variacoes de hook e'
 * um .zip com um video montado por hook dentro (AD01G1.mp4, AD01G2.mp4...), e
 * esses zips passam de 200 MB. O caminho antigo do botao de download abria o
 * zip com JSZip — que precisa do arquivo INTEIRO em memoria — descomprimia os
 * N videos e re-zipava um pacote identico. Em maquina com pouca RAM livre isso
 * estourava, caia no catch e mandava o navegador baixar a URL crua: o download
 * morria com "Verifique a conexao com a Internet" e o user ficava sem a entrega.
 *
 * Aqui nada disso acontece. O indice do ZIP mora no FIM do arquivo, entao um
 * `blob.slice()` dos ultimos KB ja diz o que tem dentro (medido: 68 ms num zip
 * de 192 MB). E cada entrada sai como ReadableStream, descomprimida pelo
 * DecompressionStream nativo — memoria constante, sem teto de tamanho.
 *
 * Formato: APPNOTE.TXT (PKWARE). ZIP64 nao e' suportado de proposito — os zips
 * do Pilot nao chegam la, e um `null` honesto faz o chamador cair no caminho
 * antigo em vez de entregar arquivo torto.
 */

/** Assinaturas do formato, em little-endian. */
const SIG_EOCD = 0x06054b50; // fim do indice central
const SIG_CENTRAL = 0x02014b50; // cabecalho no indice central
const SIG_LOCAL = 0x04034b50; // cabecalho junto dos dados

/** Tamanho fixo de cada cabecalho, antes dos campos de tamanho variavel. */
const TAM_EOCD = 22;
const TAM_CENTRAL = 46;
const TAM_LOCAL = 30;

/** O comentario do zip cabe em 65535 bytes; o EOCD vem antes dele. */
const MAX_CAUDA = 65535 + TAM_EOCD;

/** Marcador de "este campo estourou 32 bits" — ou seja, ZIP64. */
const ESTOUROU_32 = 0xffffffff;
const ESTOUROU_16 = 0xffff;

export type ZipEntry = {
  nome: string;
  /** 0 = guardado sem compressao, 8 = deflate. Outros nao sao suportados. */
  metodo: number;
  tamanhoComprimido: number;
  tamanhoOriginal: number;
  /** Offset do cabecalho local, onde os dados desta entrada comecam. */
  offsetLocal: number;
  /** true quando o nome termina em '/' — pasta, nao arquivo. */
  pasta: boolean;
};

function lerBytes(blob: Blob, inicio: number, fim: number): Promise<Uint8Array> {
  return blob
    .slice(Math.max(0, inicio), Math.min(blob.size, fim))
    .arrayBuffer()
    .then((b) => new Uint8Array(b));
}

/** Acha o EOCD varrendo de tras pra frente. Devolve -1 se nao achar. */
function acharEOCD(buf: Uint8Array, dv: DataView): number {
  for (let i = buf.length - TAM_EOCD; i >= 0; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Le o indice central e devolve as entradas do zip, SEM descomprimir nada.
 * Devolve null quando o arquivo nao e' um zip legivel (ou e' ZIP64) — nesse
 * caso o chamador deve tratar o arquivo como opaco.
 */
export async function lerEntradasDoZip(blob: Blob): Promise<ZipEntry[] | null> {
  if (blob.size < TAM_EOCD) return null;

  const cauda = await lerBytes(blob, blob.size - Math.min(blob.size, MAX_CAUDA), blob.size);
  const dvCauda = new DataView(cauda.buffer, cauda.byteOffset, cauda.byteLength);
  const posEOCD = acharEOCD(cauda, dvCauda);
  if (posEOCD < 0) return null;

  const total = dvCauda.getUint16(posEOCD + 10, true);
  const tamIndice = dvCauda.getUint32(posEOCD + 12, true);
  const offIndice = dvCauda.getUint32(posEOCD + 16, true);
  // ZIP64: os campos de 32/16 bits vem saturados e o tamanho real mora num
  // registro separado que nao lemos. Melhor dizer que nao sabemos.
  if (total === ESTOUROU_16 || offIndice === ESTOUROU_32 || tamIndice === ESTOUROU_32) return null;
  if (offIndice + tamIndice > blob.size) return null;

  // O indice quase sempre ja veio na cauda; quando o zip tem muitos arquivos
  // ele pode comecar antes, e ai vale uma segunda leitura, ainda pequena.
  const inicioNaCauda = offIndice - (blob.size - cauda.length);
  const indice = inicioNaCauda >= 0
    ? cauda.subarray(inicioNaCauda, inicioNaCauda + tamIndice)
    : await lerBytes(blob, offIndice, offIndice + tamIndice);
  const dv = new DataView(indice.buffer, indice.byteOffset, indice.byteLength);

  const entradas: ZipEntry[] = [];
  let off = 0;
  for (let i = 0; i < total; i++) {
    if (off + TAM_CENTRAL > indice.length) return null;
    if (dv.getUint32(off, true) !== SIG_CENTRAL) return null;
    const metodo = dv.getUint16(off + 10, true);
    const tamanhoComprimido = dv.getUint32(off + 20, true);
    const tamanhoOriginal = dv.getUint32(off + 24, true);
    const tamNome = dv.getUint16(off + 28, true);
    const tamExtra = dv.getUint16(off + 30, true);
    const tamComentario = dv.getUint16(off + 32, true);
    const offsetLocal = dv.getUint32(off + 42, true);
    if (tamanhoComprimido === ESTOUROU_32 || tamanhoOriginal === ESTOUROU_32 || offsetLocal === ESTOUROU_32) {
      return null;
    }
    const nome = new TextDecoder().decode(indice.subarray(off + TAM_CENTRAL, off + TAM_CENTRAL + tamNome));
    entradas.push({
      nome,
      metodo,
      tamanhoComprimido,
      tamanhoOriginal,
      offsetLocal,
      pasta: nome.endsWith('/'),
    });
    off += TAM_CENTRAL + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}

/** So os arquivos .mp4 — o que a entrega do Pilot considera "video". */
export function videosDoZip(entradas: ZipEntry[]): ZipEntry[] {
  return entradas.filter((e) => !e.pasta && /\.mp4$/i.test(e.nome));
}

/**
 * Abre UMA entrada como stream de bytes ja descomprimidos.
 *
 * O cabecalho local repete nome e extra com tamanhos PROPRIOS — que podem
 * diferir dos do indice central (o extra costuma diferir). Por isso ele e'
 * lido aqui em vez de calcular o inicio dos dados pelo indice.
 */
export async function abrirEntrada(blob: Blob, entrada: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  if (entrada.metodo !== 0 && entrada.metodo !== 8) {
    throw new Error(`compressao nao suportada no zip (metodo ${entrada.metodo})`);
  }
  const cab = await lerBytes(blob, entrada.offsetLocal, entrada.offsetLocal + TAM_LOCAL);
  const dv = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
  if (cab.length < TAM_LOCAL || dv.getUint32(0, true) !== SIG_LOCAL) {
    throw new Error('cabecalho local do zip invalido');
  }
  const inicio = entrada.offsetLocal + TAM_LOCAL + dv.getUint16(26, true) + dv.getUint16(28, true);
  const dados = blob.slice(inicio, inicio + entrada.tamanhoComprimido);
  const bruto = dados.stream() as unknown as ReadableStream<Uint8Array>;
  // Guardado sem compressao: os bytes ja sao o arquivo.
  if (entrada.metodo === 0) return bruto;
  // Deflate CRU (sem cabecalho zlib) — e' o que o zip usa.
  return bruto.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

/** O navegador sabe escrever arquivo direto numa pasta escolhida pelo user? */
export function temEscritaEmPasta(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}
