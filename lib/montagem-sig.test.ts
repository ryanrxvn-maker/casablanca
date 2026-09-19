import { assinaturaMontagem, partesDesatualizadas, takesPendentesDe, partesForaDoPlano } from './montagem-sig';

let falhas = 0;
function ok(cond: boolean, nome: string) {
  if (cond) { console.log('  ok  ' + nome); }
  else { console.log('  FALHOU  ' + nome); falhas++; }
}

// ── o caso real do AD06 (23.08) ──────────────────────────────────────────
const antes = [
  { label: 'HOOK 1', videoId: 'v-hook-velho', videoStatus: 'completed' },
  { label: 'BODY 1', videoId: 'v-body-1', videoStatus: 'completed' },
  { label: 'BODY 2', videoId: 'v-body-2', videoStatus: 'completed' },
];
const sig = assinaturaMontagem(antes);

const depois = antes.map((p) =>
  p.label === 'HOOK 1' ? { ...p, videoId: 'v-hook-CORRIGIDO' } : p);

ok(partesDesatualizadas({ parts: antes, montagemSig: sig }).length === 0,
   'montagem fresca: nenhuma parte desatualizada');

ok(partesDesatualizadas({ parts: depois, montagemSig: sig }).join() === 'HOOK 1',
   'take corrigido acusa desatualizado MESMO SEM dirtyParts (o bug do AD06)');

ok(partesDesatualizadas({ parts: depois, montagemSig: sig, dirtyParts: [] }).length === 1,
   'dirtyParts vazio (limpo por um Retomar) nao esconde a mudanca');

// ── a URL que expira NAO pode acusar mudanca ─────────────────────────────
const urlNova = antes.map((p) => ({ ...p, videoUrl: 'https://heygen/novo-token' }));
ok(partesDesatualizadas({ parts: urlNova, montagemSig: sig }).length === 0,
   'URL do HeyGen renovada nao vira falso alarme (assina videoId, nao URL)');

// ── legado: batch montado antes da assinatura existir ────────────────────
ok(partesDesatualizadas({ parts: depois }).length === 0,
   'sem montagemSig (batch legado) segue o comportamento antigo');
ok(partesDesatualizadas({ parts: depois, dirtyParts: ['BODY 1'] }).join() === 'BODY 1',
   'sem montagemSig o flag antigo continua valendo');

// ── take novo (label que nao existia) nao acende alarme ──────────────────
const comNovo = [...antes, { label: 'BODY 3', videoId: 'v-novo', videoStatus: 'completed' }];
ok(partesDesatualizadas({ parts: comNovo, montagemSig: sig }).length === 0,
   'label ausente da assinatura nao conta como mudanca');

// ── take que VOLTOU pra fila ─────────────────────────────────────────────
const naFila = antes.map((p) =>
  p.label === 'BODY 2' ? { label: 'BODY 2', videoId: null, videoStatus: 'pending' } : p);
ok(takesPendentesDe({ parts: naFila }) === 1, 'take pendente e contado');
ok(takesPendentesDe({ parts: antes }) === 0, 'todos completos = zero pendentes');
ok(partesDesatualizadas({ parts: naFila, montagemSig: sig }).join() === 'BODY 2',
   'take que voltou pra fila tambem invalida a montagem');

// ── vazios ───────────────────────────────────────────────────────────────
ok(assinaturaMontagem([]) === '' && assinaturaMontagem(undefined) === '',
   'sem partes = assinatura vazia');
ok(partesDesatualizadas({}).length === 0, 'batch sem nada nao quebra');

// ── take que ficou pra tras do plano (o caso AD06, 23.08) ───────────────
const takesGerados = [
  { label: 'HOOK 1', videoId: 'v1', usouAvatarId: 'catia-VELHO', usouEngine: 'III' },
  { label: 'BODY 1', videoId: 'v2', usouAvatarId: 'catia-VELHO', usouEngine: 'III' },
];
const planoNovo = [
  { label: 'HOOK 1', avatarId: 'catia-CORRIGIDO', engine: 'IV' },
  { label: 'BODY 1', avatarId: 'catia-CORRIGIDO', engine: 'III' },
];
ok(partesForaDoPlano(takesGerados, planoNovo).length === 2,
   'plano trocou o avatar e os takes nao foram re-gerados: acusa os dois');

const planoIgual = [
  { label: 'HOOK 1', avatarId: 'catia-VELHO', engine: 'III' },
  { label: 'BODY 1', avatarId: 'catia-VELHO', engine: 'III' },
];
ok(partesForaDoPlano(takesGerados, planoIgual).length === 0,
   'plano igual ao que gerou: nao acusa nada');

ok(partesForaDoPlano(takesGerados, [
   { label: 'HOOK 1', avatarId: 'catia-VELHO', engine: 'IV' },
   { label: 'BODY 1', avatarId: 'catia-VELHO', engine: 'III' },
 ]).join() === 'HOOK 1', 'so' + String.fromCharCode(39) + ' o motor mudou: acusa so a parte dele');

const semCarimbo = [{ label: 'HOOK 1', videoId: 'v1' }];
ok(partesForaDoPlano(semCarimbo, planoNovo).length === 0,
   'take de disparo antigo (sem carimbo) nao vira alarme falso');

ok(partesForaDoPlano(takesGerados, []).length === 0 && partesForaDoPlano([], planoNovo).length === 0,
   'sem plano ou sem takes nao quebra');

// ── take re-gerado DURANTE a montagem (a corrida) ────────────────────────
// Montar leva minutos. Se um take e' re-gerado nesse meio tempo, ele NAO esta'
// no arquivo — e carimbar a assinatura no FIM diria que esta'. Por isso a
// assinatura e' a do que ENTROU, e o dirty que sobra e' calculado contra ela.
const antesDeMontar = [
  { label: 'HOOK 1', videoId: 'v1', videoStatus: 'completed' },
  { label: 'BODY 1', videoId: 'v2', videoStatus: 'completed' },
];
const sigEntrou = assinaturaMontagem(antesDeMontar);
const durante = [
  { label: 'HOOK 1', videoId: 'v1', videoStatus: 'completed' },
  { label: 'BODY 1', videoId: 'v2-REGERADO', videoStatus: 'completed' },
];
ok(partesDesatualizadas({ parts: durante, montagemSig: sigEntrou }).join() === 'BODY 1',
   'take re-gerado durante a montagem continua sujo (nao entrou no arquivo)');
ok(partesDesatualizadas({ parts: antesDeMontar, montagemSig: sigEntrou }).length === 0,
   'nada mudou durante a montagem: dirty zerado');

// ── AD COM 2 HOOKS: label REPETIDO nao pode virar alarme eterno ─────────
// Caso real (18.09, AD41VN - PRWA10, 9 takes / 2 montagens): as duas partes
// se chamam "HOOK 1". A assinatura por LABEL sobrescrevia a 1a pela 2a e o
// card acusava "Montagem desatualizada — 1 take mudou" pra sempre, com o
// Baixar travado, numa montagem que estava perfeitamente certa.
const doisHooks = [
  { label: 'HOOK 1', videoId: 'hookA', videoStatus: 'completed' },
  { label: 'HOOK 1', videoId: 'hookB', videoStatus: 'completed' },
  { label: 'BODY 1', videoId: 'b1', videoStatus: 'completed' },
];
const sigDois = assinaturaMontagem(doisHooks);
ok(partesDesatualizadas({ parts: doisHooks, montagemSig: sigDois }).length === 0,
   'AD com 2 hooks (label repetido): nada sujo quando nada mudou');
const doisHooksRegerado = [
  { label: 'HOOK 1', videoId: 'hookA', videoStatus: 'completed' },
  { label: 'HOOK 1', videoId: 'hookB-REGERADO', videoStatus: 'completed' },
  { label: 'BODY 1', videoId: 'b1', videoStatus: 'completed' },
];
ok(partesDesatualizadas({ parts: doisHooksRegerado, montagemSig: sigDois }).join() === 'HOOK 1',
   'AD com 2 hooks: re-gerar o 2o hook AINDA acusa (nao perdeu sensibilidade)');
const doisHooksPrimeiro = [
  { label: 'HOOK 1', videoId: 'hookA-REGERADO', videoStatus: 'completed' },
  { label: 'HOOK 1', videoId: 'hookB', videoStatus: 'completed' },
  { label: 'BODY 1', videoId: 'b1', videoStatus: 'completed' },
];
ok(partesDesatualizadas({ parts: doisHooksPrimeiro, montagemSig: sigDois }).join() === 'HOOK 1',
   'AD com 2 hooks: re-gerar o 1o hook tambem acusa');

// LEGADO: assinatura gravada antes de 18.09 (sem posicao). Label unico segue
// funcionando igual; label repetido fica CALADO em vez de mentir.
const sigLegadoUnico = 'HOOK 1=v1|BODY 1=v2';
ok(partesDesatualizadas({
  parts: [
    { label: 'HOOK 1', videoId: 'v1', videoStatus: 'completed' },
    { label: 'BODY 1', videoId: 'v2-NOVO', videoStatus: 'completed' },
  ],
  montagemSig: sigLegadoUnico,
}).join() === 'BODY 1', 'assinatura LEGADA com label unico continua acusando');
const sigLegadoDuplo = 'HOOK 1=hookA|HOOK 1=hookB|BODY 1=b1';
ok(partesDesatualizadas({ parts: doisHooks, montagemSig: sigLegadoDuplo }).length === 0,
   'assinatura LEGADA com label repetido nao acusa falso (o bug do AD41)');

console.log('');
console.log(falhas ? falhas + ' FALHA(S)' : 'montagem-sig: tudo ok');
if (falhas) process.exit(1);
