/**
 * GARANTIA: a entrega do Pilot sai do zip SEM carregar o zip na memoria.
 *
 * O teste de ouro esta no fim: se houver um montado de verdade em disco
 * (D:\NOVOS DOWNLOADS\AD01_montado_decupado.zip, ~192 MB), ele e' lido e um
 * video e' extraido por streaming. E' o caso que quebrava em producao.
 */
import { openAsBlob } from 'fs';
import { existsSync } from 'fs';
import JSZip from 'jszip';
import { lerEntradasDoZip, videosDoZip, abrirEntrada, type ZipEntry } from './zip-entries';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg);
  } else {
    fail++;
    console.error('  FAIL', msg);
  }
}

/** Junta um stream num Uint8Array so — em teste o tamanho e' pequeno. */
async function juntar(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const partes: Uint8Array[] = [];
  const leitor = s.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (value) partes.push(value);
  }
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of partes) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function main() {
  // Conteudo que COMPRIME (deflate) e conteudo aleatorio (o zip guarda cru).
  const textao = Buffer.from('mesma linha repetida sem parar\n'.repeat(4000));
  const aleatorio = Buffer.alloc(3000);
  for (let i = 0; i < aleatorio.length; i++) aleatorio[i] = (i * 2654435761) & 255;

  const zip = new JSZip();
  zip.file('AD01G1.mp4', textao);
  zip.file('AD01G2.mp4', aleatorio, { compression: 'STORE' });
  zip.file('_DIAGNOSTICO.txt', 'relatorio da montagem');
  zip.folder('sobras')!.file('nota.txt', 'ignorar');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const blob = new Blob([bytes as BlobPart]);

  const entradas = await lerEntradasDoZip(blob);
  ok(entradas !== null, 'le o indice de um zip valido');
  if (!entradas) throw new Error('sem indice, nada mais a testar');

  const nomes = entradas.filter((e) => !e.pasta).map((e) => e.nome).sort();
  ok(
    JSON.stringify(nomes) === JSON.stringify(['AD01G1.mp4', 'AD01G2.mp4', '_DIAGNOSTICO.txt', 'sobras/nota.txt']),
    'acha todos os arquivos, inclusive dentro de pasta',
  );

  const videos = videosDoZip(entradas);
  ok(videos.length === 2, 'conta 2 videos (so os .mp4), ignorando txt e pasta');
  ok(
    videos.map((v) => v.nome).sort().join(',') === 'AD01G1.mp4,AD01G2.mp4',
    'os videos sao os .mp4 do zip',
  );

  // Extracao byte a byte: e' o que vai parar no disco do user.
  const g1 = entradas.find((e) => e.nome === 'AD01G1.mp4')!;
  ok(g1.metodo === 8, 'conteudo compressivel ficou em deflate (metodo 8)');
  const saiuG1 = await juntar(await abrirEntrada(blob, g1));
  ok(Buffer.from(saiuG1).equals(textao), 'entrada DEFLATE sai identica ao original');

  const g2 = entradas.find((e) => e.nome === 'AD01G2.mp4')!;
  ok(g2.metodo === 0, 'conteudo pedido como STORE ficou sem compressao (metodo 0)');
  const saiuG2 = await juntar(await abrirEntrada(blob, g2));
  ok(Buffer.from(saiuG2).equals(aleatorio), 'entrada STORE sai identica ao original');

  // Um zip com comentario empurra o EOCD pra longe do fim — a varredura tem
  // que achar mesmo assim, senao a entrega vira "arquivo invalido".
  const comComentario = await new JSZip()
    .file('AD01G1.mp4', textao)
    .generateAsync({ type: 'uint8array', comment: 'x'.repeat(5000) });
  const entradasCom = await lerEntradasDoZip(new Blob([comComentario as BlobPart]));
  ok(entradasCom !== null && entradasCom.length === 1, 'acha o indice mesmo com comentario grande no fim');

  // Arquivo que NAO e' zip: precisa dizer "nao sei" em vez de inventar.
  ok((await lerEntradasDoZip(new Blob([Buffer.alloc(9000, 7)]))) === null, 'arquivo que nao e zip devolve null');
  ok((await lerEntradasDoZip(new Blob([]))) === null, 'arquivo vazio devolve null');

  // Um MP4 de verdade nao e zip — o botao usa isso pra nao tratar video como pacote.
  const falsoMp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(4000)]);
  ok((await lerEntradasDoZip(new Blob([falsoMp4]))) === null, 'mp4 nao e confundido com zip');

  // ---- TESTE DE OURO: o montado real que quebrava em producao ----
  const real = 'D:\\NOVOS DOWNLOADS\\AD01_montado_decupado.zip';
  if (existsSync(real)) {
    const blobReal = await openAsBlob(real);
    const t0 = Date.now();
    const doReal = await lerEntradasDoZip(blobReal);
    const msIndice = Date.now() - t0;
    ok(doReal !== null, `le o indice do montado real de ${(blobReal.size / 1048576).toFixed(0)} MB`);
    if (doReal) {
      const vids = videosDoZip(doReal);
      ok(vids.length >= 2, `o montado real tem ${vids.length} videos (um por hook)`);
      // O ponto do modulo: ler o indice NAO pode custar o arquivo inteiro.
      ok(msIndice < 2000, `indice lido em ${msIndice} ms, sem carregar os ${(blobReal.size / 1048576).toFixed(0)} MB`);

      // Extrai UM video de verdade e confere o tamanho contra o indice.
      const v: ZipEntry = vids[0];
      let escritos = 0;
      const leitor = (await abrirEntrada(blobReal, v)).getReader();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        escritos += value ? value.length : 0;
      }
      ok(
        escritos === v.tamanhoOriginal,
        `${v.nome} saiu com ${escritos} bytes, igual ao que o indice promete (${v.tamanhoOriginal})`,
      );
    }
  } else {
    console.log('  --   pulado: montado real nao esta em disco (teste de ouro so roda com ele)');
  }

  console.log(`\n${pass} ok, ${fail} falhas`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('ERRO', e);
  process.exit(1);
});
