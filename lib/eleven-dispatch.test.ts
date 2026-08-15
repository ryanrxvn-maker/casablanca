/**
 * Testes do disparo de voz do DR MILLION.
 *
 * O que PRECISA ficar provado (é onde o dinheiro do user está):
 *   - o corpo é gerado UMA vez, não importa quantos ganchos entrem;
 *   - cada gancho marcado vira exatamente um arquivo "gancho + corpo";
 *   - gancho repetido não vira geração repetida;
 *   - se um gancho falha, os outros arquivos continuam saindo.
 */
import {
  planElevenDispatch,
  runElevenDispatch,
  BODY_ID,
  type ElevenPlanInput,
} from './eleven-dispatch';
import { DEFAULT_VOICE_SETTINGS } from './elevenlabs-api-direct';

let fails = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}\n  esperado: ${e}\n  veio:     ${a}`);
    fails++;
  } else console.log(`ok   ${label}`);
}

const BODY = 'Este é o corpo do anúncio. Ele é longo e vale pros três ganchos.';
const base = (over: Partial<ElevenPlanInput> = {}): ElevenPlanInput => ({
  groupId: 'AD07',
  bodyText: BODY,
  hooks: [
    { taskId: 't1', adId: 'AD07G1GL', text: 'Gancho um.', selected: true },
    { taskId: 't2', adId: 'AD07G2GL', text: 'Gancho dois.', selected: true },
    { taskId: 't3', adId: 'AD07G3GL', text: 'Gancho três.', selected: true },
  ],
  ...over,
});

/* ── 3 ganchos: 1 corpo + 3 ganchos = 4 gerações, 3 entregas ── */
{
  const p = planElevenDispatch(base());
  eq(p.jobs.filter((j) => j.kind === 'body').length, 1, 'corpo entra UMA vez em jobs');
  eq(p.jobs.filter((j) => j.kind === 'hook').length, 3, 'um job por gancho');
  eq(p.assemblies.length, 3, 'três arquivos finais');
  eq(
    p.assemblies.map((a) => a.filename),
    ['AD07G1GL.mp3', 'AD07G2GL.mp3', 'AD07G3GL.mp3'],
    'nome do arquivo sai do código do AD do gancho',
  );
  eq(
    p.assemblies.every((a) => a.pieces.length === 2 && a.pieces[1] === BODY_ID),
    true,
    'toda entrega é gancho + o MESMO corpo, nessa ordem',
  );
  const hooksChars = 'Gancho um.'.length + 'Gancho dois.'.length + 'Gancho três.'.length;
  eq(p.charsToGenerate, BODY.length + hooksChars, 'cobra o corpo uma vez só');
  eq(p.charsNaive, BODY.length * 3 + hooksChars, 'o jeito ingênuo pagaria 3 corpos');
  eq(p.charsSaved, BODY.length * 2, 'economia = 2 corpos');
  eq(p.issues, [], 'sem avisos');
}

/* ── só 1 gancho marcado: não gera os outros ── */
{
  const input = base();
  input.hooks[1].selected = false;
  input.hooks[2].selected = false;
  const p = planElevenDispatch(input);
  eq(p.jobs.length, 2, 'corpo + o único gancho marcado');
  eq(p.assemblies.map((a) => a.adId), ['AD07G1GL'], 'entrega só o gancho marcado');
  eq(p.charsSaved, 0, 'com um gancho só não há o que economizar');
}

/* ── 2 ganchos marcados de 3 ── */
{
  const input = base();
  input.hooks[1].selected = false;
  const p = planElevenDispatch(input);
  eq(p.jobs.filter((j) => j.kind === 'hook').map((j) => j.id), ['AD07G1GL', 'AD07G3GL'], 'gera só os marcados');
  eq(p.assemblies.length, 2, 'duas entregas');
  eq(p.charsSaved, BODY.length, 'economiza um corpo');
}

/* ── gancho repetido: uma geração, duas entregas ── */
{
  const input = base({
    hooks: [
      { taskId: 't1', adId: 'AD07G1GL', text: 'Mesmo gancho.', selected: true },
      { taskId: 't2', adId: 'AD07G2GL', text: '  MESMO   gancho.  ', selected: true },
    ],
  });
  const p = planElevenDispatch(input);
  eq(p.jobs.filter((j) => j.kind === 'hook').length, 1, 'texto igual = UMA geração de gancho');
  eq(p.jobs.find((j) => j.kind === 'hook')?.alsoServes, ['AD07G2GL'], 'a geração serve o irmão também');
  eq(p.assemblies.length, 2, 'mesmo assim saem dois arquivos');
}

/* ── gancho vazio: avisa e não entrega ── */
{
  const input = base();
  input.hooks[1].text = '   ';
  const p = planElevenDispatch(input);
  eq(p.assemblies.length, 2, 'gancho vazio não vira arquivo');
  eq(p.issues.length, 1, 'e aparece como aviso');
  eq(/AD07G2GL/.test(p.issues[0]), true, 'o aviso diz QUAL gancho');
}

/* ── nenhum gancho marcado: entrega o corpo sozinho ── */
{
  const input = base();
  input.hooks.forEach((h) => (h.selected = false));
  const p = planElevenDispatch(input);
  eq(p.assemblies.map((a) => a.filename), ['AD07.mp3'], 'corpo sozinho sai com o nome do grupo');
  eq(p.jobs.length, 1, 'só o corpo é gerado');
}

/* ── sem gancho e sem corpo: não inventa entrega ── */
{
  const p = planElevenDispatch({ groupId: 'AD07', bodyText: '  ', hooks: [] });
  eq(p.assemblies, [], 'nada pra entregar');
  eq(p.issues.length, 1, 'e diz o porquê');
}

/* ── sem corpo, só ganchos: entrega cada gancho puro ── */
{
  const p = planElevenDispatch(base({ bodyText: '' }));
  eq(p.assemblies.every((a) => a.pieces.length === 1), true, 'sem corpo, a entrega é só o gancho');
  eq(p.charsSaved, 0, 'nada a economizar sem corpo');
}

/* ═══════════════ execução ═══════════════ */

const blob = (s: string) => new Blob([s], { type: 'audio/mpeg' });
const settings = { ...DEFAULT_VOICE_SETTINGS };

async function textoDe(b: Blob): Promise<string> {
  return await b.text();
}

async function testesDeExecucao() {
/* ── corpo gerado UMA vez de verdade; entregas = gancho + corpo ── */
{
  const p = planElevenDispatch(base());
  const geracoes: string[] = [];
  const r = await runElevenDispatch(p, {
    voiceId: 'v1',
    modelId: 'm1',
    settings,
    deps: {
      generate: async ({ text }) => {
        geracoes.push(text);
        return { blob: blob(`[${text}]`), chars: text.length };
      },
      concat: async (parts) => {
        const txt = await Promise.all(parts.map(textoDe));
        return blob(txt.join('+'));
      },
    },
  });
  eq(geracoes.filter((t) => t === BODY).length, 1, 'o ElevenLabs recebeu o corpo UMA vez');
  eq(geracoes.length, 4, 'quatro gerações no total (1 corpo + 3 ganchos)');
  eq(r.deliverables.length, 3, 'três MP3 entregues');
  eq(await textoDe(r.deliverables[0].blob), `[Gancho um.]+[${BODY}]`, 'gancho vem ANTES do corpo');
  eq(await textoDe(r.deliverables[2].blob), `[Gancho três.]+[${BODY}]`, 'cada entrega usa o mesmo corpo');
  eq(r.failures, [], 'sem falhas');
  eq(r.charsSaved, BODY.length * 2, 'economia reportada pro user');
}

/* ── gancho que falha derruba só o arquivo dele ── */
{
  const p = planElevenDispatch(base());
  const r = await runElevenDispatch(p, {
    voiceId: 'v1',
    modelId: 'm1',
    settings,
    deps: {
      generate: async ({ text }) => {
        if (text === 'Gancho dois.') throw new Error('estourou a cota');
        return { blob: blob(`[${text}]`), chars: text.length };
      },
      concat: async (parts) => blob((await Promise.all(parts.map(textoDe))).join('+')),
    },
  });
  eq(r.deliverables.map((d) => d.adId), ['AD07G1GL', 'AD07G3GL'], 'os outros dois saem normalmente');
  eq(r.failures.map((f) => f.adId), ['AD07G2GL'], 'e o que falhou fica registrado');
}

/* ── corpo que falha aborta tudo (não entrega áudio capenga) ── */
{
  const p = planElevenDispatch(base());
  let erro = '';
  try {
    await runElevenDispatch(p, {
      voiceId: 'v1',
      modelId: 'm1',
      settings,
      deps: {
        generate: async ({ text }) => {
          if (text === BODY) throw new Error('sessão expirou');
          return { blob: blob(`[${text}]`), chars: text.length };
        },
        concat: async (parts) => blob((await Promise.all(parts.map(textoDe))).join('+')),
      },
    });
  } catch (e) {
    erro = (e as Error).message;
  }
  eq(/corpo não foi gerado/i.test(erro), true, 'falha do corpo sobe como erro, não vira entrega parcial');
  eq(/sessão expirou/.test(erro), true, 'e carrega o motivo real');
}

/* ── gancho repetido: uma geração serve os dois arquivos ── */
{
  const p = planElevenDispatch(
    base({
      hooks: [
        { taskId: 't1', adId: 'AD07G1GL', text: 'Mesmo gancho.', selected: true },
        { taskId: 't2', adId: 'AD07G2GL', text: 'Mesmo gancho.', selected: true },
      ],
    }),
  );
  let n = 0;
  const r = await runElevenDispatch(p, {
    voiceId: 'v1',
    modelId: 'm1',
    settings,
    deps: {
      generate: async ({ text }) => {
        n++;
        return { blob: blob(`[${text}]`), chars: text.length };
      },
      concat: async (parts) => blob((await Promise.all(parts.map(textoDe))).join('+')),
    },
  });
  eq(n, 2, 'duas gerações: o corpo e UM gancho');
  eq(r.deliverables.length, 2, 'mas dois arquivos entregues');
}
}

testesDeExecucao().then(
  () => {
    console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
    process.exit(fails ? 1 : 0);
  },
  (e) => {
    console.error('ERRO INESPERADO NO TESTE:', e);
    process.exit(1);
  },
);
