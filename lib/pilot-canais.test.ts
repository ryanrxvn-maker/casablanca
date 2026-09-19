/**
 * O chip de canal (YOUTUBE/META/KWAI) não pode sumir do card.
 *
 * Caso real (2026-09-19): o Silas move a task pra "revisão vídeo" no ClickUp,
 * ela sai do filtro de status, o board deixa de conhecê-la — e o chip some de
 * um AD que continua na fila, pronto. Ligando o olho (incluir revisão) volta.
 */
import {
  canaisDoCard,
  precisaGravarCanais,
  mesmosCanais,
  idDoBoardParaCanal,
  resolverCanaisDaTask,
  type CanalChip,
} from './pilot-canais';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; console.error(`  FAIL ${msg}`); }
}

const YT: CanalChip[] = [{ label: 'YOUTUBE', color: '#e11d48' }];
const META: CanalChip[] = [{ label: 'META', color: '#2563eb' }];

console.log('CHIP DE CANAL — o que já se sabe nunca é apagado por quem não sabe:');

// ── O BUG, em uma linha ────────────────────────────────────────────────────
ok(
  canaisDoCard(YT, []).length === 1,
  'task saiu do filtro (board vazio): o chip CONTINUA — era aqui que sumia',
);
ok(
  canaisDoCard(YT, [])[0].label === 'YOUTUBE',
  'e continua sendo o canal certo, não um genérico',
);
ok(
  precisaGravarCanais(YT, []) === false,
  'board vazio NUNCA sobrescreve o snapshot (lista vazia é "não sei", não "não tem")',
);

// ── O caminho normal, intacto ──────────────────────────────────────────────
ok(
  canaisDoCard(undefined, YT)[0].label === 'YOUTUBE',
  'card sem snapshot ainda lê do board (comportamento de hoje)',
);
ok(
  precisaGravarCanais(undefined, YT) === true,
  'board sabe e o registro não: grava o snapshot',
);
ok(
  precisaGravarCanais(undefined, []) === false,
  'ninguém sabe: não grava nada (e não fica gravando em loop)',
);
ok(
  canaisDoCard(undefined, undefined).length === 0,
  'sem snapshot e sem board: lista vazia, sem quebrar',
);
ok(
  canaisDoCard([], YT)[0].label === 'YOUTUBE',
  'snapshot VAZIO (card antigo) não trava o preenchimento pelo board',
);

// ── O snapshot manda, mesmo divergindo do board ────────────────────────────
ok(
  canaisDoCard(YT, META)[0].label === 'YOUTUBE',
  'snapshot do DISPARO vence o board (o card conta o que era quando disparou)',
);

// ── Task irmã de 2ª versão herda o canal da mãe ────────────────────────────
ok(
  idDoBoardParaCanal('86akhtjye-yt') === '86akhtjye',
  '2ª versão procura o canal pelo id da MÃE (o id "-yt" não existe no ClickUp)',
);
ok(
  idDoBoardParaCanal('86akhtjye') === '86akhtjye',
  'task normal procura por ela mesma',
);
ok(
  idDoBoardParaCanal('86akhtjye-ytx') === '86akhtjye-ytx',
  'id que só TERMINA parecido não é confundido com a irmã',
);

// ── Guarda de igualdade (evita regravar estado a cada render) ──────────────
ok(mesmosCanais(YT, [{ label: 'YOUTUBE', color: '#e11d48' }]), 'mesmo conteúdo = iguais');
ok(!mesmosCanais(YT, META), 'canais diferentes = diferentes');
ok(!mesmosCanais(YT, []), 'lista vazia não é igual a lista com chip');
ok(mesmosCanais(undefined, []), 'ausente e vazio são a mesma coisa pra comparação');

// ── Uma regra única lê o campo CANAL no card e na migração do histórico ──
const ytDoClickUp = resolverCanaisDaTask({
  custom_fields: [{
    name: 'CANAL',
    value: 1,
    type_config: { options: [{ orderindex: 1, name: 'YouTube', color: '#f00000' }] },
  }],
});
ok(ytDoClickUp[0]?.label === 'YOUTUBE', 'dropdown do ClickUp vira YOUTUBE no histórico');
ok(ytDoClickUp[0]?.color === '#f00000', 'preserva a cor configurada no ClickUp');

const tiktokDireto = resolverCanaisDaTask({ custom_fields: [{ name: 'Plataforma', value: 'TikTok' }] });
ok(tiktokDireto[0]?.label === 'TIKTOK', 'valor textual legado também vira chip');
ok(tiktokDireto[0]?.color === '#FF2D55', 'valor textual recebe a cor oficial de fallback');
ok(
  resolverCanaisDaTask({ custom_fields: [{ name: 'CANAL', value: null }] }).length === 0,
  'campo realmente vazio não inventa canal',
);

console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed > 0) process.exit(1);
