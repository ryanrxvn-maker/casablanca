/**
 * Testes da associação de INDICAÇÕES (comentários do Docs → Pilot).
 *
 * Dois tipos (revisão do Silas 29.08):
 *  · AVATAR (dourado): ancora na linha do avatar ou menciona @username.
 *  · COPY (azul): ancora no hook/body — sai com o TRECHO + o TAKE onde caiu.
 *
 * O cenário principal é o DOC REAL do teste (29.08): comentário ancorado no
 * HOOK do AD02G1GL - PRPB12.
 */
import { associarIndicacoes, linksDaIndicacao, resolverLinkIndicacao } from './pilot-indicacoes';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

// Estrutura FIEL ao doc ADGL - PRPB12 (linhas observadas ao vivo no export).
const DOC = [
  'AD1 à 6',
  'AD01GL - PRPB12',
  'BRIEFING: AD40G1GL-PRPB07 adaptado para o PRPB12',
  'Doutor: @drrobertokalil 1.mp4',
  'Como transformar um azeite de R$10 no seu próprio remédio.',
  'Body',
  'A maioria das pessoas usa azeite do jeito errado.',
  '',
  'AD02GL - PRPB12',
  'BRIEFING: AD79G1GL-PRPB07 adaptado para o PRPB12',
  'Observações: isso aqui não é fala[f]',
  '',
  'AD02G1GL - PRPB12',
  'Doutor:',
  'Para próstata inchada, não existe nada melhor do que isso daqui.[a]',
  ' ',
  'Body',
  'Tomar finasterida te leva pro buraco rapidinho.[b]',
  '',
  'AD03GL - PRPB12',
  'Mulher: @maria 2.mp4 [c]',
  'Hook da mulher aqui.',
].join('\n');

const PARTES_AD02 = [
  { label: 'HOOK 1', text: 'Para próstata inchada, não existe nada melhor do que isso daqui.' },
  { label: 'BODY 1', text: 'Tomar finasterida te leva pro buraco rapidinho. E se você já toma mais de 3 meses, é melhor me escutar.' },
];

console.log('— cenário REAL: comentário no HOOK vira indicação de COPY (não de avatar) —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02GL',
    comments: [{ marker: 'a', context: 'AD02G1GL - PRPB12 Doutor: Para próstata inchada, não existe nada melhor do que isso daqui.', body: 'COMENTARIO DE TESTE, CENARIO X' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
    partes: PARTES_AD02,
  });
  ok(r.copy.length === 1, 'vira indicação de copy');
  ok(r.copy[0]?.nota === 'COMENTARIO DE TESTE, CENARIO X', 'nota certa');
  ok(r.copy[0]?.take === 'HOOK 1', `trecho casado com o take HOOK 1 (veio ${r.copy[0]?.take})`);
  ok(r.copy[0]?.trecho.includes('Para próstata inchada'), 'trecho comentado preservado (sem o [a])');
  ok(!r.copy[0]?.trecho.includes('[a]'), 'marcador não vaza no trecho');
  ok(r.porSlot[0].length === 0, 'NÃO entra no indicador de avatar');
}

console.log('— comentário no BODY → copy com o take do body —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02G1GL',
    comments: [{ marker: 'b', context: 'Tomar finasterida te leva', body: 'TELA DIVIDIDA AQUI' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
    partes: PARTES_AD02,
  });
  ok(r.copy.length === 1 && r.copy[0].take === 'BODY 1', `body → take BODY 1 (veio ${r.copy[0]?.take})`);
}

console.log('— comentário fora da fala (Observações) → copy com take null —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02GL',
    comments: [{ marker: 'f', context: 'Observações: isso aqui não é fala', body: 'LEMBRETE GERAL DO AD' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
    partes: PARTES_AD02,
  });
  ok(r.copy.length === 1 && r.copy[0].take === null, 'sem take (âncora fora dos textos falados)');
  ok(r.copy[0].trecho.includes('Observações'), 'trecho é a linha da âncora');
}

console.log('— comentário na LINHA DO AVATAR → indicador de AVATAR (dourado) —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD03GL',
    comments: [{ marker: 'c', context: 'Mulher: @maria 2.mp4', body: 'AMBIENTE DE COZINHA' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }, { role: 'Mulher', username: 'maria 2' }],
    partes: [{ label: 'HOOK 1', text: 'Hook da mulher aqui.' }],
  });
  ok(r.porSlot[1].some((x) => x.nota === 'AMBIENTE DE COZINHA'), 'linha do avatar → slot da Mulher');
  ok(r.copy.length === 0, 'não duplica como copy');
}

console.log('— menção do @username no CORPO do comentário → avatar —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02GL',
    comments: [{ marker: 'b', context: 'Tomar finasterida te leva', body: 'trocar o look do @drrobertokalil 1' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
    partes: PARTES_AD02,
  });
  ok(r.porSlot[0].length === 1, 'menção no corpo → avatar mesmo ancorado no body');
  ok(r.copy.length === 0, 'não vira copy');
}

console.log('— o comentário não vaza pra outro AD —');
{
  const c = [{ marker: 'a', context: '...', body: 'CENARIO X' }];
  const r1 = associarIndicacoes({ docText: DOC, baseAdId: 'AD01GL', comments: c, slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }], partes: [] });
  ok(r1.copy.length === 0 && r1.porSlot[0].length === 0, 'AD01 não recebe o comentário do AD02');
  const r3 = associarIndicacoes({ docText: DOC, baseAdId: 'AD03GL', comments: c, slots: [{ role: 'Mulher', username: 'maria 2' }], partes: [] });
  ok(r3.copy.length === 0 && r3.porSlot[0].length === 0, 'AD03 não recebe o comentário do AD02');
}

console.log('— sem partes: copy sai com take null (nunca explode) —');
{
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02GL',
    comments: [{ marker: 'a', context: '', body: 'X' }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
  });
  ok(r.copy.length === 1 && r.copy[0].take === null, 'copy com take null sem partes');
}

console.log('— marcador inexistente / listas vazias —');
{
  const r = associarIndicacoes({ docText: DOC, baseAdId: 'AD02GL', comments: [{ marker: 'z', context: '', body: 'X' }], slots: [{ role: 'Doutor', username: null }], partes: [] });
  ok(r.copy.length === 0 && r.porSlot[0].length === 0, 'marcador inexistente é ignorado');
  const r2 = associarIndicacoes({ docText: DOC, baseAdId: 'AD02GL', comments: [], slots: [], partes: [] });
  ok(r2.copy.length === 0 && r2.daTask.length === 0, 'lista vazia ok');
}

console.log('— links citados na indicação: tipo + thumb —');
{
  const dv = resolverLinkIndicacao('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing');
  ok(dv.tipo === 'drive' && !!dv.thumb && dv.thumb.includes('thumbnail?id=1AbCdEfGhIjKlMnOpQrStUv'), 'Drive → thumb do arquivo');
  const yt = resolverLinkIndicacao('https://youtu.be/dQw4w9WgXcQ');
  ok(yt.tipo === 'youtube' && yt.thumb === 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'YouTube → thumb hqdefault');
  const sh = resolverLinkIndicacao('https://www.youtube.com/shorts/abc123XYZ_-');
  ok(sh.tipo === 'youtube' && !!sh.thumb, 'YouTube shorts também');
  const tk = resolverLinkIndicacao('https://www.tiktok.com/@fulano/video/7300000000');
  ok(tk.tipo === 'tiktok' && tk.thumb === null && tk.rotulo === 'TikTok', 'TikTok → glifo (sem thumb pública)');
  const ig = resolverLinkIndicacao('https://www.instagram.com/reel/Cxyz123/');
  ok(ig.tipo === 'instagram' && ig.rotulo === 'Instagram', 'Instagram identificado');
  const im = resolverLinkIndicacao('https://exemplo.com/frames/cena1.jpg?v=2');
  ok(im.tipo === 'imagem' && im.thumb === im.url, 'imagem direta → a própria URL é a thumb');
  const gd = resolverLinkIndicacao('https://www.google.com/url?q=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ&sa=D');
  ok(gd.tipo === 'youtube', 'redirect do Google é desembrulhado');
  const gen = resolverLinkIndicacao('https://exemplo.com/pagina');
  ok(gen.tipo === 'link' && gen.rotulo === 'exemplo.com', 'genérico → hostname como rótulo');
}
{
  const ls = linksDaIndicacao('referência aqui: https://youtu.be/dQw4w9WgXcQ e https://youtu.be/dQw4w9WgXcQ.', ['https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv']);
  ok(ls.length === 2, `dedupe + junta href do HTML com URL do texto (veio ${ls.length})`);
  ok(ls.some((l) => l.tipo === 'drive') && ls.some((l) => l.tipo === 'youtube'), 'os dois tipos presentes');
}
{
  // link só no HTML do comentário (texto hiperlinkado) chega via `links`
  const r = associarIndicacoes({
    docText: DOC,
    baseAdId: 'AD02GL',
    comments: [{ marker: 'a', context: '', body: 'faz igual a esta referência', links: ['https://youtu.be/dQw4w9WgXcQ'] }],
    slots: [{ role: 'Doutor', username: 'drrobertokalil 1' }],
    partes: PARTES_AD02,
  });
  ok(r.copy[0]?.links?.length === 1 && r.copy[0].links[0].tipo === 'youtube', 'href do comentário vira link resolvido na indicação');
}

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) FALHARAM`);
  process.exit(1);
}
console.log('\npilot-indicacoes: todos os testes passaram ✓');
