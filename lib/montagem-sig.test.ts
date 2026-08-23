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

console.log('');
console.log(falhas ? falhas + ' FALHA(S)' : 'montagem-sig: tudo ok');
if (falhas) process.exit(1);
