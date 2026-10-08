/**
 * A copy dos cards de DESTAQUE do hub promete coisas concretas (limite de
 * arquivo, duração, o que anima, o que corrige). Este teste LÊ o código de
 * cada ferramenta e reprova se a promessa e a realidade se separarem — número
 * escrito à mão em card envelhece calado.
 *
 * Roda com: npx tsx lib/destaques-copy.test.ts
 */
import { readFileSync, readdirSync } from 'fs';
import { FAKEPRINT_TELEJORNAIS } from './numeros-do-site';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};
const ler = (p: string) => readFileSync(p, 'utf8');

const hub = ler('components/ToolsHub.tsx');
const lip = ler('components/tools/LipSyncTool.tsx');
const guia = ler('components/tool-guides/guides.tsx');

/** Recorta o bloco de texto de um objeto de detalhes pelo começo dele. */
function bloco(src: string, inicio: string, fim: string): string {
  const i = src.indexOf(inicio);
  const j = src.indexOf(fim, i + inicio.length);
  return i >= 0 && j > i ? src.slice(i, j) : '';
}

console.log('destaques: Lipsync');
const lipCopy = bloco(hub, "href: '/tools/lipsync',", 'icon: <IconHeyGenAuto');
ok(lipCopy.length > 0, 'achou a copy do Lipsync nos destaques');
ok(/300 \* 1024 \* 1024/.test(lip) && /até 300 MB/.test(lipCopy), 'copy diz 300 MB = MAX_VIDEO_BYTES do Lipsync');
ok(/const MAX_AUDIO_MS = 6 \* 60 \* 1000;/.test(lip), 'Lipsync tem teto de 6 minutos (MAX_AUDIO_MS)');
ok(
  lip.includes('if (audioPassaDoTeto(audioMs))') && lip.includes('return ms > MAX_AUDIO_MS + 500;'),
  'o Gerar barra áudio acima do teto (folga de 0,5 s)',
);
ok(lip.includes('if (audioPassaDoTeto(a.duration * 1000))'), 'escolher áudio longo já avisa');
ok(!/600_000/.test(lip), 'o teto antigo de 10 min saiu');
ok(/até 6 minutos de vídeo por vez/.test(lipCopy), 'copy diz 6 minutos por vez');
ok(/· até 6 min</.test(lip), 'campo de áudio mostra "até 6 min"');
ok(!/limpeza|limpo|ruído/i.test(lipCopy), 'copy NÃO fala da limpeza de áudio');
ok(/Limite: 6 minutos de áudio por lipsync/.test(guia) && !/Limite: 10 minutos/.test(guia), 'guia diz 6 minutos');

console.log('destaques: Legendas');
const legCopy = bloco(hub, 'const DETALHES_LEGENDAS', '};');
ok(/Corrigida pela copy/.test(legCopy), 'Legendas destaca a correção pela copy');
ok(legCopy.indexOf('Corrigida pela copy') < legCopy.indexOf("rotulo: 'Modelos'"), 'correção pela copy vem PRIMEIRO');
// Só o texto VISÍVEL (o comentário do código cita "sem risco" de propósito).
const legVisivel = (legCopy.match(/texto:\s*\n?\s*['`][^'`]*['`]/g) ?? []).join(' ');
ok(/Bem menos risco/.test(legVisivel) && !/sem risco/i.test(legVisivel), 'promete "bem menos risco", nunca "sem risco"');
ok(/export function correctBlocksByCopy/.test(ler('lib/typography/copy-fix.ts')), 'a correção pela copy existe no código');
ok(/<CopyFixPanel/.test(ler('app/tools/tipografia/page.tsx')), 'e está na tela das Legendas');
ok(/\$\{LEGENDAS_MODELOS\}/.test(legCopy), 'número de modelos vem de numeros-do-site');

console.log('destaques: FakePrint');
const fpCopy = bloco(hub, 'const DETALHES_FAKEPRINT', '};');
ok(/Headlines de telejornal/.test(fpCopy), 'FakePrint destaca as headlines de telejornal');
ok(fpCopy.indexOf('Headlines de telejornal') < fpCopy.indexOf("rotulo: 'Redes sociais'"), 'headlines vêm PRIMEIRO');
ok(/\$\{FAKEPRINT_TELEJORNAIS\}/.test(fpCopy), 'número de telejornais vem de numeros-do-site');
const news = readdirSync('app/tools/fakepass').filter((f) => /^model-news-.*\.tsx$/.test(f));
// Conta por MODELO, não por arquivo (model-news-cbs.tsx tem dois).
const conta = (re: RegExp) =>
  news.reduce((n, f) => n + (ler(`app/tools/fakepass/${f}`).match(re) ?? []).length, 0);
const modelos = conta(/category:\s*'news'/g);
const animados = conta(/anim:\s*true/g);
ok(modelos === FAKEPRINT_TELEJORNAIS, `catálogo tem ${modelos} telejornais (= ${FAKEPRINT_TELEJORNAIS})`);
ok(
  /quase todos animados/.test(fpCopy) && animados < modelos && animados / modelos >= 0.75,
  `"quase todos animados" é verdade: ${animados} de ${modelos} (se TODOS animarem, troque pra "todos")`,
);
ok(/'feed45'/.test(ler('app/tools/fakepass/site-kit.tsx')) && /desktop, feed, story ou 16:9/.test(fpCopy), 'sites nos 4 formatos que existem');

console.log('destaques: estilo');
for (const [nome, txt] of [['Lipsync', lipCopy], ['Legendas', legCopy], ['FakePrint', fpCopy]] as const) {
  const visivel = (txt.match(/(lead|texto):\s*\n?\s*['`][^'`]*['`]/g) ?? []).join(' ');
  ok(visivel.length > 0 && !/[—–]/.test(visivel), `${nome}: sem travessão no texto visível`);
}

if (falhas > 0) {
  console.error(`\nFAIL destaques-copy: ${falhas} falha(s)`);
  process.exit(1);
}
console.log('\nOK destaques-copy: tudo passou');
