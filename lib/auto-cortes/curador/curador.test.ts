/**
 * Trava as invariantes do CURADOR LOCAL do Auto Cortes.
 * Ver docs/auto-cortes/CURADOR-LOCAL.md e lib/auto-cortes/curador/.
 *
 * O que isto blinda: a inteligência que escolhe os cortes saiu da API (decisão
 * do dono em 23.08 — "não pode ter uso onde fica acabando token") e virou
 * medição local. Se ela regredir, o cliente não vê erro: vê corte ruim. Então
 * o que dá pra medir tem que estar travado aqui.
 *
 * A transcrição é SINTÉTICA e plantada de propósito com 6 blocos:
 *   abertura/logística · tráfego pago (com o número) · história de falência ·
 *   intervalo/logística · lista de 3 erros de preço · equipe e cultura
 *
 * Cada linha do roteiro vira EXATAMENTE uma frase (`buildSentences`), então
 * índice de linha = índice de frase, e dá pra afirmar coisa forte sobre onde
 * os cortes caíram.
 */
import { curate, type CurateResult, type EnergyEnvelope } from './curate';
import { buildLexicon } from './lexicon';
import { buildSentenceFeatures, energyStats, scoreClip, type ScoreContext } from './score';
import { buildTfidf, corpusStats } from './tfidf';
import { findTopics } from './topics';
import {
  extractFactPhrase,
  endsWithFinalPunct,
  firstToken,
  hasAdjacentRepeat,
  lastToken,
  startsUppercase,
  tidyFragment,
} from './text';
import { trimEdges } from './titles';
import { buildSentences, sentenceId, transcriptHash } from '../transcript';
import { DEFAULT_CLIP_SETTINGS, CLIP_LENGTH_RANGE_SEC } from '../types';
import type { ClipSettings, Sentence, Transcript, Word } from '../types';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helper: roteiro de frases → Transcript com timing de verdade
// ───────────────────────────────────────────────────────────────────────────

/** Uma fala. `pause` = silêncio (ms) depois dela; padrão 320 ms (respiro curto). */
type Line = { t: string; pause?: number };
const L = (t: string, pause?: number): Line => ({ t, pause });

/** Fala a 380 ms por palavra (300 ms de som + 80 ms entre palavras). */
const WORD_MS = 380;
const WORD_SOUND_MS = 300;
const DEFAULT_PAUSE_MS = 320;

function makeTranscript(lines: Line[], language = 'pt'): Transcript {
  const words: Word[] = [];
  let t = 1000;
  for (const line of lines) {
    for (const p of line.t.split(/\s+/).filter(Boolean)) {
      words.push({ text: p, start: t, end: t + WORD_SOUND_MS });
      t += WORD_MS;
    }
    t += line.pause ?? DEFAULT_PAUSE_MS;
  }
  const sentences = buildSentences(words, language);
  return { words, sentences, language, provider: 'teste', hash: transcriptHash(words, language) };
}

// ───────────────────────────────────────────────────────────────────────────
// O roteiro plantado
// ───────────────────────────────────────────────────────────────────────────

const P_BLOCO = 1600; // pausa que separa assunto (força fronteira)

const ABERTURA: Line[] = [
  L('Boa noite pessoal, sejam muito bem-vindos a mais um episódio.'),
  L('Antes de começar, se inscreve no canal e ativa o sininho.'),
  L('Esse episódio tem o oferecimento do nosso patrocinador de sempre.'),
  L('Meu nome é Rafael e eu apresento esse programa toda semana.'),
  L('Deixa o like, comenta aí embaixo e compartilha com quem precisa.'),
  L('O link na descrição leva pro cupom de desconto que a gente combinou.'),
  L('Testando o microfone: o áudio tá bom aí do seu lado?'),
  L('Nosso convidado de hoje dirige uma rede de lojas no interior.'),
  L('Muito obrigado por estar aqui com a gente hoje à noite.'),
  L('Sem mais delongas, vamos ao que interessa nesse papo.', P_BLOCO),
];

const TRAFEGO: Line[] = [
  L('Eu vou te dar um número: investimos trinta milhões de reais em tráfego pago.'),
  L('Foram seis anos comprando mídia todo santo dia, sem parar uma semana.'),
  L('Anota isso: criativo bom salva verba ruim, e o contrário nunca acontece.'),
  L('No primeiro ano a gente queimou verba testando criativo que ninguém via.'),
  L('A plataforma cobra caro pelo clique quando o anúncio não conversa com o público.'),
  L('Então a gente parou de olhar o custo por clique e passou a olhar o retorno.'),
  L('O criativo é o que decide a campanha, não a segmentação que todos perseguem.'),
  L('Isso mudou a nossa operação inteira em menos de um trimestre.'),
  L('A verba foi realocada pros três criativos que sustentavam o funil sozinhos.'),
  L('Cada real investido no anúncio certo voltou multiplicado por quatro no caixa.'),
  L('Aí a gente entendeu que escala não é aumentar verba, é aumentar criativo.'),
  L('O funil quebrava sempre no mesmo ponto e ninguém tinha coragem de', 800),
  L('olhar o número que estava piscando vermelho na tela do painel.'),
  L('Campanha boa com página ruim é dinheiro jogado fora, e a gente jogou muito.'),
  L('Hoje a nossa régua é simples: se o criativo não segura três segundos, morre.'),
  L('O público frio precisa de prova, e prova é depoimento de cliente real.'),
  L('A gente testa cinquenta criativos por mês pra achar três que funcionam.'),
  L('Essa disciplina de teste é o que separa quem escala de quem só gasta.'),
  L('Ninguém fala sobre o custo escondido de manter cinquenta criativos rodando.'),
  L('Precisa de editor, de roteirista, de tráfego e de alguém olhando o número.'),
  L('A equipe de mídia virou o time mais caro da empresa, e valeu a pena.'),
  L('Quando o anúncio para, a receita para junto no mesmo dia.'),
  L('Isso assusta qualquer dono que veio do varejo tradicional.'),
  L('A gente aprendeu a manter uma reserva de três meses de verba parada.'),
  L('Sem essa reserva, uma plataforma instável derruba o faturamento do mês.'),
  L('O tráfego pago é uma torneira, não é um poço de água.'),
  L('Quem trata como poço quebra na primeira mudança de algoritmo.', P_BLOCO),
];

const FALENCIA: Line[] = [
  L('A gente chegou bem perto de fechar as portas em dois mil e dezenove.'),
  L('A dívida com o banco passou de dois milhões e o caixa não fechava.'),
  L('O fornecedor cortou o prazo de trinta dias pra pagamento à vista.'),
  L('Meu contador ligou num sábado dizendo que o cheque tinha voltado.'),
  L('Eu sentei na cozinha às três da manhã com a planilha aberta e chorei.'),
  L('Naquela semana eu demiti dezoito pessoas que confiaram na minha empresa.'),
  L('A vergonha de olhar no olho de cada uma delas ainda dói hoje.'),
  L('O gerente do banco recusou o empréstimo três vezes seguidas.'),
  L('Foi quando um fornecedor antigo apareceu com uma proposta esquisita.'),
  L('Ele topou virar sócio da operação de entrega em troca da dívida.'),
  L('Eu odiei a ideia no primeiro minuto e aceitei no segundo.'),
  L('Perder metade de uma empresa viva é melhor que ficar com uma empresa morta.'),
  L('Em dezoito meses a dívida com o banco estava zerada.'),
  L('O caixa voltou a fechar positivo pela primeira vez em dois anos.'),
  L('A operação de entrega virou o braço mais lucrativo do grupo inteiro.'),
  L('Aquele fornecedor que eu achava esquisito hoje é o meu melhor amigo.'),
  L('A falência que eu tanto temi virou a melhor coisa que me aconteceu.'),
  L('Se o cheque não tivesse voltado, eu ainda estaria fingindo estar bem.'),
  L('Dívida não mata empresa, orgulho mata.'),
  L('Eu demorei quinze anos pra entender uma frase de sete palavras.'),
  L('Todo dono que eu conheço passou por um sábado igual ao meu.'),
  L('A diferença é quem atende o telefone do contador e quem finge não ouvir.'),
  L('Atender o telefone é o passo mais difícil e o mais barato de todos.'),
  L('Hoje eu conto essa história pra quem tá naquela cozinha de madrugada.', P_BLOCO),
];

const INTERVALO: Line[] = [
  L('A gente já volta, fica aí que depois do intervalo tem mais.'),
  L('Aproveita e se inscreve no canal se você tá gostando do papo.'),
  L('O nosso patrocinador desse bloco é quem paga a conta do estúdio.'),
  L('Usa o cupom de desconto que tá no link na descrição do vídeo.'),
  L('Comenta aí embaixo qual parte te pegou mais até agora.'),
  L('Muito obrigado a quem tá assistindo ao vivo com a gente.'),
  L('Depois do intervalo a gente entra na parte de precificação.'),
  L('Voltamos já com o segundo bloco, não sai daí.', P_BLOCO),
];

const PRECO: Line[] = [
  L('Eu vou te dar os três erros de preço que quebram loja de bairro.'),
  L('O primeiro erro é dar desconto pra cobrir a proposta do concorrente.'),
  L('Quando você cobre o preço do concorrente, você entrega a margem de graça.'),
  L('A tabela de preço existe pra você não decidir no calor da conversa.'),
  L('O segundo erro é não calcular o custo real do produto na prateleira.'),
  L('Frete, quebra, cartão e imposto comem quinze por cento antes de respirar.'),
  L('Muita gente acha que margem é preço menos custo de compra, e não é.'),
  L('O terceiro erro é dar o mesmo desconto pra cliente novo e pra cliente fiel.'),
  L('Cliente fiel não precisa de desconto, precisa de atendimento diferente.'),
  L('Desconto pra quem já compra é dinheiro que você tira do próprio bolso.'),
  L('Pare de brigar por preço com quem tem mais fôlego de caixa que você.'),
  L('A briga de preço só termina quando um dos dois fecha as portas.'),
  L('Se o seu diferencial é ser mais barato, você não tem diferencial nenhum.'),
  L('Aumentar cinco por cento no preço dói menos que vender dez por cento a mais.'),
  L('Faz a conta antes de aceitar a próxima proposta do comprador.'),
  L('A margem é o que paga o salário da sua equipe no fim do mês.'),
  L('Quem trabalha com margem apertada não tem direito a errar nenhuma vez.'),
  L('O concorrente que baixa preço todo mês costuma estar com problema de caixa.'),
  L('Não copie a estratégia de quem você nunca viu o balanço.'),
  L('A tabela precisa ser revisada a cada trimestre, e quase ninguém revisa.'),
  L('Reajuste pequeno e frequente machuca menos que reajuste grande de uma vez.'),
  L('O cliente aceita aumento quando entende o que mudou no produto.'),
  L('Explique o motivo do reajuste antes que o cliente pergunte.'),
  L('Esses três erros custaram trezentos mil reais pra gente aprender.', P_BLOCO),
];

const EQUIPE: Line[] = [
  L('A pior contratação da minha vida custou oito meses de operação travada.'),
  L('A pessoa era ótima na entrevista e péssima no primeiro dia de trabalho.'),
  L('Eu contratei pelo currículo e demiti pelo comportamento, como sempre.'),
  L('A cultura da empresa é o que a equipe faz quando você não está olhando.'),
  L('Rotatividade alta não é problema de salário, é problema de líder.'),
  L('Sessenta por cento das demissões que eu vi tinham o mesmo gestor no meio.'),
  L('Feedback que só acontece na demissão não é feedback, é emboscada.'),
  L('A gente instituiu uma conversa de quinze minutos por semana com cada líder.'),
  L('Em um ano a rotatividade caiu de quarenta por cento pra doze por cento.'),
  L('O treinamento de líder custa caro e a falta dele custa muito mais.'),
  L('Ninguém nasce sabendo dar bronca sem destruir a pessoa do outro lado.'),
  L('Eu levei dez anos pra aprender a separar o erro da pessoa que errou.'),
  L('Quando o líder some, a equipe inventa a própria versão da regra.'),
  L('Regra que não é repetida vira lenda dentro de dois meses.'),
  L('Salário justo é o piso da conversa, não é o argumento inteiro.'),
  L('As pessoas saem por causa do chefe, e ficam por causa dos colegas.'),
  L('Aprenda a contratar devagar e a demitir rápido, por mais duro que pareça.'),
  L('Um funcionário errado no lugar certo atrasa a empresa inteira.'),
  L('A entrevista precisa ter tarefa prática, senão você compra história.'),
  L('Peça pra pessoa resolver um problema real que aconteceu semana passada.'),
  L('O jeito que ela pergunta vale mais que a resposta que ela dá.'),
  L('A gente contrata gente boa e depois amarra a mão dela com processo.'),
  L('Autonomia sem clareza vira bagunça, e clareza sem autonomia vira robô.'),
  L('O trabalho do líder é dar clareza, não é dar resposta pronta.'),
  L('Time bom com líder ruim entrega menos que time médio com líder bom.'),
  L('Cuide da sua equipe, porque é ela que atende o seu cliente.'),
];

type Bloco = { nome: string; linhas: Line[]; logistica: boolean };
const BLOCOS: Bloco[] = [
  { nome: 'abertura', linhas: ABERTURA, logistica: true },
  { nome: 'trafego', linhas: TRAFEGO, logistica: false },
  { nome: 'falencia', linhas: FALENCIA, logistica: false },
  { nome: 'intervalo', linhas: INTERVALO, logistica: true },
  { nome: 'preco', linhas: PRECO, logistica: false },
  { nome: 'equipe', linhas: EQUIPE, logistica: false },
];

const ROTEIRO: Line[] = BLOCOS.reduce<Line[]>((acc, b) => acc.concat(b.linhas), []);

/** Faixa de índices de frase de cada bloco (1 linha = 1 frase). */
const FAIXA: Record<string, { from: number; to: number }> = (() => {
  const out: Record<string, { from: number; to: number }> = {};
  let at = 0;
  for (const b of BLOCOS) {
    out[b.nome] = { from: at, to: at + b.linhas.length - 1 };
    at += b.linhas.length;
  }
  return out;
})();

const TRANSCRICAO = makeTranscript(ROTEIRO);
const DURACAO_SEC =
  (TRANSCRICAO.words[TRANSCRICAO.words.length - 1].end + 500) / 1000;

/** Índice da frase do NÚMERO (o corte que tem que ganhar). */
const I_NUMERO = FAIXA.trafego.from;
/** Índice da frase pendurada ("…coragem de") — nenhum corte pode terminar nela. */
const I_PENDURADA = TRANSCRICAO.sentences.findIndex((x) => !endsWithFinalPunct(x.text));

/**
 * Envelope de energia sintético e REALISTA: base com ondulação de ~1,5 dB e um
 * clímax de +6 dB em cima de 3 frases (a demissão e o choro) — que é como um
 * pico de emoção aparece de verdade num podcast. Envelope chapado de bloco
 * inteiro seria um teste mentiroso: qualquer nota de emoção ganharia de tudo.
 */
const I_CLIMAX = 4; // deslocamento dentro do bloco da falência
function makeEnergy(): EnergyEnvelope {
  const stepSec = 0.5;
  const n = Math.ceil(DURACAO_SEC / stepSec) + 2;
  const db = new Float32Array(n);
  const s = TRANSCRICAO.sentences;
  const picoA = s[FAIXA.falencia.from + I_CLIMAX].startMs / 1000;
  const picoB = s[FAIXA.falencia.from + I_CLIMAX + 2].endMs / 1000;
  for (let i = 0; i < n; i++) {
    const t = i * stepSec;
    const onda = 1.5 * Math.sin(i / 7);
    db[i] = (t >= picoA && t <= picoB ? -19 : -25) + onda;
  }
  return { stepSec, db };
}

function settings(over: Partial<ClipSettings> = {}): ClipSettings {
  return { ...DEFAULT_CLIP_SETTINGS, count: 5, ...over };
}

/** 1ª e última frase que o corte realmente contém. */
function bordasDoCorte(clip: { startMs: number; endMs: number }): {
  first: Sentence;
  last: Sentence;
} {
  const s = TRANSCRICAO.sentences;
  const first = s.find((x) => x.endMs > clip.startMs) ?? s[0];
  let last = first;
  for (const x of s) if (x.startMs < clip.endMs) last = x;
  return { first, last };
}

function contem(clip: { startMs: number; endMs: number }, i: number): boolean {
  const s = TRANSCRICAO.sentences[i];
  const mid = (s.startMs + s.endMs) / 2;
  return clip.startMs <= mid && mid <= clip.endMs;
}

const LEX = buildLexicon('pt');

// ───────────────────────────────────────────────────────────────────────────

console.log('\nGARANTIA — curador local do Auto Cortes (sem API, sem cota):');

// (0) o roteiro virou frases 1:1 — sem isso nenhuma outra afirmação vale
{
  ok(
    TRANSCRICAO.sentences.length === ROTEIRO.length,
    `roteiro de ${ROTEIRO.length} falas vira ${TRANSCRICAO.sentences.length} frases (1:1)`,
  );
  ok(DURACAO_SEC > 500 && DURACAO_SEC < 900, `vídeo sintético dura ~${Math.round(DURACAO_SEC)} s`);
  ok(
    !endsWithFinalPunct(TRANSCRICAO.sentences[I_PENDURADA].text) &&
      lastToken(TRANSCRICAO.sentences[I_PENDURADA].text) === 'de',
    'a armadilha da frase pendurada ("…coragem de") está plantada',
  );
}

const ENERGIA = makeEnergy();
const RESULTADO: CurateResult = curate({
  transcript: TRANSCRICAO,
  energy: ENERGIA,
  settings: settings(),
  durationSec: DURACAO_SEC,
});

if (process.env.CURADOR_DEBUG) {
  const s = TRANSCRICAO.sentences;
  for (const c of RESULTADO.clips) {
    const b = bordasDoCorte(c);
    console.log(
      `[${c.plan.score}] ${s.indexOf(b.first)}..${s.indexOf(b.last)} ${((c.endMs - c.startMs) / 1000).toFixed(1)}s`,
      JSON.stringify(c.plan.scoreBreakdown),
      `\n     H: ${c.plan.headline}\n     T: ${c.plan.title}\n     1: ${b.first.text}`,
    );
  }
}

// (1) entregou cortes
{
  ok(RESULTADO.clips.length > 0, `entregou ${RESULTADO.clips.length} corte(s)`);
  ok(RESULTADO.clips.length <= 5, 'nunca passa da quantidade pedida (5)');
}

// (2) fronteiras de assunto caem entre os blocos plantados
{
  const bounds = new Set(RESULTADO.topics);
  let acertos = 0;
  const esperadas = BLOCOS.slice(1).map((b) => FAIXA[b.nome].from);
  for (const i of esperadas) {
    if (bounds.has(i) || bounds.has(i - 1) || bounds.has(i + 1)) acertos++;
  }
  ok(
    acertos === esperadas.length,
    `as ${esperadas.length} fronteiras plantadas foram encontradas (±1 frase)`,
  );
  ok(
    RESULTADO.topics.length >= esperadas.length + 1 && RESULTADO.topics.length <= 22,
    `nº de assuntos detectados é sensato (${RESULTADO.topics.length})`,
  );
  ok(RESULTADO.topics[0] === 0, 'o primeiro assunto começa na frase 0');
}

// (3) logística NUNCA entra — é o erro que mais denuncia corte automático
{
  const logisticas: number[] = [];
  for (const b of BLOCOS) {
    if (!b.logistica) continue;
    for (let i = FAIXA[b.nome].from; i <= FAIXA[b.nome].to; i++) logisticas.push(i);
  }
  const invadiu = RESULTADO.clips.filter((c) => logisticas.some((i) => contem(c, i)));
  ok(invadiu.length === 0, 'nenhum corte encosta na abertura nem no intervalo (logística)');
}

// (4) o trecho com número + fecho é o 1º lugar
{
  const primeiro = RESULTADO.clips[0];
  ok(!!primeiro && contem(primeiro, I_NUMERO), '1º lugar é o trecho que abre com o número');
  ok(!!primeiro && primeiro.plan.score === 99, 'o melhor corte do vídeo recebe 99 (ranking relativo)');
  const scores = RESULTADO.clips.map((c) => c.plan.score);
  ok(
    scores.every((s, i) => i === 0 || s <= scores[i - 1]),
    'a lista sai ordenada da maior nota pra menor',
  );
}

// (5) bordas: nunca abre em muleta/anáfora/conectivo, nunca fecha pendurado
{
  let abriuMal = 0;
  let fechouMal = 0;
  let semPonto = 0;
  for (const c of RESULTADO.clips) {
    const { first, last } = bordasDoCorte(c);
    const f = firstToken(first.text);
    if (LEX.fillers.openers.has(f) || LEX.anaphoraOpeners.has(f) || LEX.connectiveOpeners.has(f)) {
      abriuMal++;
      console.error(`       abriu mal: "${first.text}"`);
    }
    if (LEX.danglingEndings.has(lastToken(last.text))) {
      fechouMal++;
      console.error(`       fechou pendurado: "${last.text}"`);
    }
    if (!endsWithFinalPunct(last.text)) semPonto++;
  }
  ok(abriuMal === 0, 'nenhum corte abre em muleta, anáfora ou conectivo');
  ok(fechouMal === 0, 'nenhum corte termina em palavra pendurada');
  ok(semPonto === 0, 'todo corte fecha em pontuação final');
  ok(
    !RESULTADO.clips.some((c) => contem(c, I_PENDURADA) && bordasDoCorte(c).last.id === TRANSCRICAO.sentences[I_PENDURADA].id),
    'ninguém termina na frase pendurada plantada',
  );
}

// (6) duração dentro da faixa e sem sobreposição
{
  const faixa = CLIP_LENGTH_RANGE_SEC[DEFAULT_CLIP_SETTINGS.length];
  const fora = RESULTADO.clips.filter((c) => {
    const d = (c.endMs - c.startMs) / 1000;
    return d < faixa.min || d > faixa.max;
  });
  ok(fora.length === 0, `toda duração cai em ${faixa.min}-${faixa.max} s`);

  // O que não pode é dois cortes dividirem FALA. (`refineBounds` acolchoa a
  // borda com até 300 ms de silêncio, então tempo puro pode encostar.)
  let colidiu = 0;
  let frasesRepetidas = 0;
  const vistas = new Set<string>();
  for (const c of RESULTADO.clips) {
    for (const w of TRANSCRICAO.words) {
      if (w.end <= c.startMs || w.start >= c.endMs) continue;
      const k = `${w.start}`;
      if (vistas.has(k)) colidiu++;
      vistas.add(k);
    }
    const b = bordasDoCorte(c);
    for (let i = TRANSCRICAO.sentences.indexOf(b.first); i <= TRANSCRICAO.sentences.indexOf(b.last); i++) {
      const k = `s${i}`;
      if (vistas.has(k)) frasesRepetidas++;
      vistas.add(k);
    }
  }
  ok(colidiu === 0, 'nenhuma palavra falada aparece em dois cortes');
  ok(frasesRepetidas === 0, 'nenhum corte compartilha frase com outro');
}

// (7) diversidade: 5 cortes não podem sair todos do mesmo assunto
{
  const assuntoDoCorte = (c: { startMs: number; endMs: number }) => {
    const idx = TRANSCRICAO.sentences.indexOf(bordasDoCorte(c).first);
    for (const b of BLOCOS) if (idx >= FAIXA[b.nome].from && idx <= FAIXA[b.nome].to) return b.nome;
    return '?';
  };
  const assuntos = new Set(RESULTADO.clips.map(assuntoDoCorte));
  ok(
    assuntos.size >= Math.min(4, RESULTADO.clips.length),
    `os cortes vieram de ${assuntos.size} assuntos diferentes (${Array.from(assuntos).sort().join(', ')})`,
  );
}

// (8) textos no padrão do produto
{
  let headlineLonga = 0;
  let headlineComPonto = 0;
  let tituloLongo = 0;
  let tagsErradas = 0;
  let semGancho = 0;
  for (const c of RESULTADO.clips) {
    const h = c.plan.headline;
    if (h.trim().split(/\s+/).filter(Boolean).length > 8) headlineLonga++;
    if (/[.]\s*$/.test(h)) headlineComPonto++;
    if (c.plan.title.length > 70) tituloLongo++;
    if (c.plan.hashtags.length !== 5 || c.plan.hashtags.some((t) => !/^[a-z0-9_]+$/.test(t))) {
      tagsErradas++;
    }
    if (!c.plan.hook.trim()) semGancho++;
  }
  ok(headlineLonga === 0, 'toda headline tem no máximo 8 palavras');
  ok(headlineComPonto === 0, 'nenhuma headline termina em ponto final');
  ok(tituloLongo === 0, 'todo título cabe em 70 caracteres');
  ok(tagsErradas === 0, 'toda lista tem 5 hashtags minúsculas sem "#"');
  ok(semGancho === 0, 'todo corte tem gancho preenchido');
  ok(
    RESULTADO.clips.every((c) => c.plan.description.includes('\n')),
    'descrição sai em 2 linhas',
  );
  ok(
    RESULTADO.clips.every((c) => c.plan.why.length > 10 && c.plan.why.length <= 200),
    'todo corte explica por que entrou',
  );
}

// (9) a headline do 1º lugar usa o dado que foi REALMENTE dito
{
  const primeiro = RESULTADO.clips[0];
  const dado = extractFactPhrase(TRANSCRICAO.sentences[I_NUMERO].text);
  ok(dado === 'trinta milhões de reais', `o dado extraído é o que foi falado ("${dado}")`);
  ok(
    !!primeiro && /trinta milh/i.test(primeiro.plan.headline),
    `a headline do 1º lugar carrega o número: "${primeiro?.plan.headline}"`,
  );
}

// (10) determinismo — duas execuções iguais, bit a bit
{
  const a = curate({
    transcript: TRANSCRICAO,
    energy: makeEnergy(),
    settings: settings(),
    durationSec: DURACAO_SEC,
  });
  const b = curate({
    transcript: TRANSCRICAO,
    energy: makeEnergy(),
    settings: settings(),
    durationSec: DURACAO_SEC,
  });
  ok(JSON.stringify(a) === JSON.stringify(b), 'duas execuções devolvem exatamente o mesmo resultado');
  ok(
    JSON.stringify(a.clips) === JSON.stringify(RESULTADO.clips),
    'o resultado não depende da ordem em que os testes rodaram',
  );
}

// (11) roda sem energia (prosódia indisponível) — degradação, não falha
{
  const semEnergia = curate({
    transcript: TRANSCRICAO,
    energy: null,
    settings: settings(),
    durationSec: DURACAO_SEC,
  });
  ok(semEnergia.clips.length > 0, 'sem envelope de energia ainda sai lote completo');
  ok(
    semEnergia.warnings.some((w) => /energia/i.test(w)),
    'e o cliente é avisado que a nota de emoção usou só o texto',
  );
  // Mesmo trecho, com e sem prosódia: só o envelope muda. Medindo direto no
  // `scoreClip` a afirmação fica sobre o SINAL, não sobre qual corte venceu.
  const lex = buildLexicon('pt');
  const model = buildTfidf(TRANSCRICAO.sentences.map((x) => x.text), lex.stopwords);
  const base = {
    sentences: TRANSCRICAO.sentences,
    features: buildSentenceFeatures(TRANSCRICAO.sentences, model, lex),
    model,
    corpus: corpusStats(model),
    topics: findTopics(model, TRANSCRICAO.sentences),
    lex,
    focusTokens: new Set<string>(),
  };
  const a = FAIXA.falencia.from + I_CLIMAX - 1;
  const b = FAIXA.falencia.from + I_CLIMAX + 3;
  const comPico = scoreClip(a, b, {
    ...base,
    energy: ENERGIA,
    energyRef: energyStats(ENERGIA.db),
  } as ScoreContext);
  const semPico = scoreClip(a, b, { ...base, energy: null, energyRef: null } as ScoreContext);
  ok(
    comPico.breakdown.emotion > semPico.breakdown.emotion,
    `o pico de RMS levanta a nota de emoção do trecho (${semPico.breakdown.emotion} → ${comPico.breakdown.emotion})`,
  );
  const frio = FAIXA.preco.from + 2;
  const semPicoFrio = scoreClip(frio, frio + 4, {
    ...base,
    energy: ENERGIA,
    energyRef: energyStats(ENERGIA.db),
  } as ScoreContext);
  ok(
    comPico.breakdown.emotion > semPicoFrio.breakdown.emotion,
    'e o trecho sem pico não ganha essa nota de graça',
  );
}

// (12) "momentos específicos" puxa o assunto pedido pra dentro do lote
{
  const foco = curate({
    transcript: TRANSCRICAO,
    energy: ENERGIA,
    settings: settings({ count: 5, focusPrompt: 'margem, desconto e tabela de preço' }),
    durationSec: DURACAO_SEC,
  });
  const pegou = foco.clips.some((c) => {
    for (let i = FAIXA.preco.from; i <= FAIXA.preco.to; i++) if (contem(c, i)) return true;
    return false;
  });
  ok(pegou, 'com foco em preço, o bloco de precificação entra no lote');
}

// (13) "trecho do vídeo" respeitado
{
  const s = TRANSCRICAO.sentences;
  const a = s[FAIXA.equipe.from].startMs / 1000;
  const b = s[FAIXA.equipe.to].endMs / 1000;
  const recorte = curate({
    transcript: TRANSCRICAO,
    energy: ENERGIA,
    settings: settings({ count: 5, range: { startSec: a, endSec: b } }),
    durationSec: DURACAO_SEC,
  });
  ok(recorte.clips.length > 0, 'o recorte de faixa continua entregando corte');
  ok(
    recorte.clips.every((c) => c.startMs >= a * 1000 - 400 && c.endMs <= b * 1000 + 400),
    'nenhum corte escapa da faixa pedida',
  );
}

// (14) faixa curta (<30 s) muda o tamanho sem quebrar as travas
{
  const curtos = curate({
    transcript: TRANSCRICAO,
    energy: ENERGIA,
    settings: settings({ length: 'lt30', count: 10 }),
    durationSec: DURACAO_SEC,
  });
  const faixa = CLIP_LENGTH_RANGE_SEC.lt30;
  ok(curtos.clips.length > 0, `preset <30 s entrega ${curtos.clips.length} corte(s)`);
  ok(
    curtos.clips.every((c) => {
      const d = (c.endMs - c.startMs) / 1000;
      return d >= faixa.min && d <= faixa.max;
    }),
    'todos cabem em 8-30 s',
  );
  ok(
    curtos.clips.every((c) => {
      const f = firstToken(bordasDoCorte(c).first.text);
      return !LEX.fillers.openers.has(f) && !LEX.anaphoraOpeners.has(f) && !LEX.connectiveOpeners.has(f);
    }),
    'as travas de abertura valem também no preset curto',
  );
}

// (15) transcrição vazia / degenerada não explode
{
  const vazio = curate({
    transcript: { words: [], sentences: [], language: 'pt', provider: 't', hash: 'x' },
    energy: null,
    settings: settings(),
    durationSec: 0,
  });
  ok(vazio.clips.length === 0 && vazio.warnings.length > 0, 'transcrição vazia devolve aviso, não erro');

  const curtinha = makeTranscript([L('Bom dia.'), L('Tudo certo por aqui.')]);
  const r = curate({
    transcript: curtinha,
    energy: null,
    settings: settings(),
    durationSec: 5,
  });
  ok(Array.isArray(r.clips), 'vídeo de 5 s não quebra o curador');
}

// (16) idioma desconhecido cai em PT+EN (e não perde as travas de PT)
{
  const auto = buildLexicon('auto');
  ok(auto.langs.join('+') === 'pt+en', 'idioma desconhecido usa o léxico de PT + EN');
  ok(auto.fillers.openers.has('entao') && auto.fillers.openers.has('well'), 'as muletas dos dois idiomas entram');
  ok(!auto.fillers.openers.has('so'), '"so" (muleta do inglês) fica de fora pra não comer o "só" do português');
  ok(buildLexicon('en').fillers.openers.has('so'), 'mas em vídeo declarado em inglês "so" volta a ser muleta');
  ok(buildLexicon('es').langs[0] === 'es', 'espanhol tem léxico próprio');
}


// ═══════════════════════════════════════════════════════════════════════════
// PARTE 2 — DADOS REAIS
//
// As frases abaixo são VERBATIM de uma transcrição de Whisper de verdade
// (podcast de 24 min, PT, 323 frases) — com todo o defeito que ASR real tem:
// frase cortada no meio ("milhões de Só reais aqui no Brasil"), caco de três
// palavras ("Com nesses certeza"), palavra repetida ("do do"), ordem trocada
// ("uns 6 no anos") e a pergunta do entrevistador colada na resposta.
//
// Cada bloco daqui trava um defeito que a PRIMEIRA versão do curador cometeu
// quando rodou nesse material.
// ═══════════════════════════════════════════════════════════════════════════

type Real = { text: string; startMs: number; endMs: number };
const R = (text: string, startMs: number, endMs: number): Real => ({ text, startMs, endMs });

/** Monta o Transcript com o TEXTO real e o tempo real; palavras distribuídas. */
function realTranscript(lines: Real[], language = 'pt'): Transcript {
  const words: Word[] = [];
  const sentences: Sentence[] = [];
  lines.forEach((line, n) => {
    const parts = line.text.split(/\s+/).filter(Boolean);
    const span = Math.max(parts.length, line.endMs - line.startMs);
    const step = span / Math.max(1, parts.length);
    const from = words.length;
    for (let k = 0; k < parts.length; k++) {
      const a = Math.round(line.startMs + k * step);
      const b = Math.round(line.startMs + (k + 1) * step) - 20;
      words.push({ text: parts[k], start: a, end: Math.max(a + 1, b) });
    }
    sentences.push({
      id: sentenceId(n + 1),
      startMs: line.startMs,
      endMs: line.endMs,
      text: line.text,
      wordFrom: from,
      wordTo: words.length - 1,
    });
  });
  return { words, sentences, language, provider: 'whisper', hash: transcriptHash(words, language) };
}

const REAL: Real[] = [
  R("Fala galera, começando mais um vlog aqui, direto de NatalRN E hoje eu estou com dois caras brabíssimos do Direct Response Eles já faturaram juntos mais de 30", 0, 11200),
  R("milhões de Só reais aqui no Brasil, tá?", 11200, 13620),
  R("E hoje eu vou apresentar vocês, provavelmente alguns de vocês já devem conhecer eles Já gravaram um paintcast com E a gente são esses dois brabos aqui, Wesley,", 13620, 21980),
  R("ó", 21020, 21040),
  R("esse aqui, cara aqui, E ó esse aqui é o Dijadson Wesley Dijadson, contem pra gente o que é que vocês fazem quanto tempo você está no mercado?", 21980, 30920),
  R("A gente está mais ou menos aí uns 6 no anos", 30920, 34100),
  R("mercado na aí batalha, nesse período de 6 a anos gente tem ainda uma operação de Nutra, a gente sempre com trabalhou Direct Response ali e atualmente a", 34100, 44140),
  R("gente está observando esse movimento do mercado, Direct de Response com Expert e tudo a mais gente está fazendo essa migração já estamos de olho, estudando já o", 44140, 53320),
  R("mercado fechamos com alguns Experts e aí estamos migrando para esse mercado agora, de DR e Info com Experts.", 52680, 59760),
  R("Vocês pretendem migrar ou abrir um braço na empresa?", 59860, 63320),
  R("faturando muito vocês estão 6 anos, eu tenho certeza que vocês vão ficar mais 5, 6, 10 qual anos o segredo para tanta consistência?", 98500, 105560),
  R("que eu vejo assim, muitas operações o cara chega, escala, depois morre a oferta e ele desaparece.", 105560, 110700),
  R("Com nesses certeza", 110700, 112220),
  R("6 anos que estão, vocês", 112220, 114060),
  R("vocês já passaram por isso várias vezes, criou uma oferta, escalou, ela morreu, se tiver que criar ou outra, renovar ela.", 114060, 120220),
  R("Cara, como é que vocês fizeram para ser tão consistente?", 120060, 123000),
  R("Primeiro ponto, que eu acredito que é o principal, que a gente sempre conversa isso, eu e o Dijatos nas nossas conversas diárias aqui, é que a gente", 122920, 131820),
  R("segue uma premissa, quem não se adapta morre basicamente.", 131820, 135440),
  R("Então acredito que o principal fator, o principal princípio para a gente estar com essa constância no mercado nos últimos seis e anos vários anos desses fazendo sete", 134920, 145190),
  R("múltiplos distros por ano, até oito por distros ano, é justamente essa adaptação.", 144350, 149370),
  R("Então no a digital gente sente que a gente está se adaptando toda hora, o que funciona essa semana não necessariamente vai funcionar na outra semana também.", 150030, 158790),
  R("Então acredito que ter essa flexibilidade para se adaptar a esses momentos de mercado, as ondas de mercado e tudo isso, é algo que faz a gente continuar", 158230, 167970),
  R("ano a ano no mercado, faturando consistente e crescendo com constância.", 167970, 172270),
  R("E você, Jato, tem alguma opinião do seriedo da constância de vocês?", 172010, 176610),
  R("Seria basicamente isso.", 176290, 177710),
  R("A nossa constância tem muito disso.", 177750, 180390),
  R("principalmente, porque a gente mexe com muito dinheiro.", 347000, 349920),
  R("Então, tipo assim, um dia você está rodando mil reais por dia em uma oferta, no outro dia você está rodando 30, 40, 50, 100 mil.", 349900, 357360),
  R("E se você não tiver o controle, você acaba indo só no automático ali, não sabe muito bem ali o que está entrando, o que está saindo, com", 357620, 365960),
  R("o que está saindo.", 365960, 367320),
  R("Aí do nada você vê lá, está com 5, 6 mil, 30 mil de ferramenta, como já teve mês a aqui, gente pagando 30, 40 mil só de", 367040, 375200),
  R("ferramenta de recorrência.", 375200, 376880),
  R("Então, tipo assim, aí a gente vai lá, faz uma tem análise, ferramenta que a gente não usa e já tudo mais, consegue cortar um pouco.", 376780, 382340),
  R("Então, tipo assim, são muitas coisas invisíveis que você vai no automático e não presta atenção, que às vezes vai comendo o seu lucro, né?", 381860, 388740),
  R("É, fiquei curioso aqui.", 422870, 424390),
  R("O que é esse caixa para investimentos perigosos?", 424370, 427570),
  R("Então, hoje a gente separa 10% da nossa margem de lucro, né?", 427150, 432230),
  R("pra investir no negócio.", 432090, 434290),
  R("Perigosa é o quê?", 433930, 434530),
  R("Coisas que a gente não tem muita previsibilidade.", 434630, 437630),
  R("Então, tipo assim, entrar em um mercado novo, abrir um nicho novo, onde a gente não tem muitos números ainda, mas a gente sabe que tem um potencial", 437310, 445550),
  R("grande.", 445550, 446470),
  R("Entendeu?", 446190, 446510),
  R("Tipo agora, se chama pra expert, isso já tava separado Separado, o dinheiro.", 446550, 451510),
  R("Já claro.", 451010, 451650),
  R("tava separado, entendeu?", 451650, 452870),
  R("Eu sei que no começo, sei lá, seis anos atrás, um cuidava de tráfego, outro cuidava de copy, Hoje né.", 501110, 506610),
  R("eu sei que a operação de vocês é bem robusta, né.", 506610, 509590),
  R("Vocês devem ter mais de 10 colaboradores.", 509310, 511290),
  R("Sim, temos quase 20.", 511270, 513410),
  R("Quase 20 colaboradores.", 513450, 514910),
  R("Quase 20 Né.", 514510, 515390),
  R("colaboradores.", 514830, 515690),
  R("Cara, hoje, com a comparação que vocês têm, quase 20 colaboradores, faturando consistentemente múltiplos sete dígitos por mês, qual é a função que você exerce, o seu ESDE,", 515430, 526950),
  R("depois para o Dijasso, qual a função que o Dijasso exerce na empresa?", 526990, 530210),
  R("Show de bola.", 530190, 530670),
  R("Hoje, a minha função é praticamente um CEO.", 530710, 534290),
  R("Hoje, eu não estou à frente de nenhum setor específico.", 534350, 538850),
  R("Fico acima de todos os líderes, tanto do tráfego, de quanto copy, quanto das outras de fontes tráfego que a gente tem, na parte financeira e novas oportunidades", 539190, 547360),
  R("a para empresa.", 547280, 548700),
  R("Como você acha que vai estar o mercado?", 942600, 944040),
  R("Porque, assim, a gente está vendo aí um enxame de pessoas usando IA, tanto usando IA de boa fé, quanto usando IA de má fé.", 943720, 951770),
  R("Você acha que isso tem mais a prejudicar o mercado ou veio para agregar o mercado?", 951770, 956430),
  R("A gente já conversou sobre isso.", 956430, 958770),
  R("A gente acredita que o mercado nos próximos anos vai haver uma sofisticação, assim como na época que a gente só rodava real mudou totalmente para ver se", 958770, 968270),
  R("é bem ter essa reviravolta no mercado ali mas acredito que para o público em si o vai ficando cada vez mais sério né e vai necessitando de", 968270, 976330),
  R("cada vez mais você provar para ele ali a ter a credibilidade e é fato né que entre unha e o expert real a gente sabe que o", 976330, 984610),
  R("expert real tem muito mais credibilidade né então eu comparto com essa ideia que o mercado né de expertos aí reais mesmo vai crescer muito por conta disso", 983850, 993630),
  R("né que o público vai ficar cada e essa questão da IA, cara, é realmente", 993630, 998190),
  R("uma faca de dois gumes veio pra potencializar muito, tá potencializando muito, né, tanto pra quem faz tanto certo pra quem faz errado, pra né, usa forma errada,", 998190, 1006510),
  R("que você ganha velocidade em tudo, né, na IA, a e aí sofisticação vai vir muito mais rápido na também minha visão, como a gente já tá acompanhando", 1006510, 1013070),
  R("isso né, não é só você um fazer simples deep sink que vai você ter um resultado bom, sabe, dia pra cada a mais, tá uma velocidade de", 1013070, 1020910),
  R("sofisticação gigantesca, e vai ficar mais ainda difícil das pessoas se adaptarem, né, então quem não se profissionalizar realmente, não estiver atento ao caminho que o mercado está", 1020910, 1028970),
  R("eu indo acredito que vai ficar para trás, sabe?", 1028810, 1031170),
];

const T_REAL = realTranscript(REAL);
const DUR_REAL = REAL[REAL.length - 1].endMs / 1000 + 1;
const REAL_OUT = curate({
  transcript: T_REAL,
  energy: null,
  settings: settings({ count: 5 }),
  durationSec: DUR_REAL,
});

if (process.env.CURADOR_DEBUG) {
  for (const c of REAL_OUT.clips) {
    console.log(`  [real ${c.plan.score}] T: ${c.plan.title}\n              H: ${c.plan.headline}`);
  }
}

function fraseDoCorte(c: { startMs: number; endMs: number }, qual: 'primeira' | 'ultima'): Sentence {
  const s = T_REAL.sentences;
  // As frases do Whisper real SE SOBREPÕEM (a última palavra de uma termina
  // depois do início da seguinte), então "encostar no tempo" não quer dizer
  // "está no corte": vale quem COMEÇA dentro, com o respiro do refineBounds.
  const dentro = s.filter((x) => x.startMs >= c.startMs - 200 && x.endMs <= c.endMs + 400);
  return dentro.length > 0 ? dentro[qual === 'primeira' ? 0 : dentro.length - 1] : s[0];
}

const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

console.log('\nGARANTIA — curador local em transcrição REAL de Whisper:');

// (R0) o material real entra e sai corte
{
  ok(
    T_REAL.sentences.length === REAL.length,
    `${REAL.length} frases reais viraram ${T_REAL.sentences.length} frases`,
  );
  ok(REAL_OUT.clips.length > 0, `transcrição real de Whisper produziu ${REAL_OUT.clips.length} corte(s)`);
}

// (R1) caco de ASR e continuação em minúscula nunca ABREM corte
//      defeitos reais: "Com nesses certeza" e "milhões de Só reais aqui no Brasil, tá?"
{
  const caco = T_REAL.sentences.find((x) => x.text.trim() === 'Com nesses certeza');
  const cont = T_REAL.sentences.find((x) => x.text.startsWith('milhões de Só reais'));
  ok(!!caco && !!cont, 'as duas frases-problema estão na fixture');
  let ruins = 0;
  for (const c of REAL_OUT.clips) {
    const f = fraseDoCorte(c, 'primeira');
    const palavras = f.text.trim().split(/\s+/).filter(Boolean).length;
    if (palavras < 5 || startsUppercase(f.text) === false) {
      ruins++;
      console.error(`       abriu em caco: "${f.text.slice(0, 60)}"`);
    }
  }
  ok(ruins === 0, 'nenhum corte abre em caco de ASR nem no meio de uma frase cortada');
}

// (R2) retomada ("A gente já conversou sobre isso.") não abre corte
{
  const retomada = T_REAL.sentences.find((x) => x.text.trim() === 'A gente já conversou sobre isso.');
  ok(!!retomada, 'a frase de retomada está na fixture');
  const abriu = REAL_OUT.clips.some((c) => fraseDoCorte(c, 'primeira').id === retomada?.id);
  ok(!abriu, 'nenhum corte abre retomando conversa que ficou fora dele');
}

// (R3) nada de texto terminando em vírgula ou palavra pendurada
//      defeito real: headline "10%: separa da nossa margem de lucro,"
{
  const PENDURADO =
    /(?:^|\s)(?:de|do|da|dos|das|em|no|na|por|para|pra|com|e|ou|mas|que|se|a|o|os|as|um|uma|ao|há|tem|vai|meu|minha|nosso|nossa|esses|essas)$/i;
  let ruins = 0;
  for (const c of REAL_OUT.clips) {
    const pares: Array<[string, string]> = [
      ['headline', c.plan.headline],
      ['título', c.plan.title],
    ];
    for (const [nome, t] of pares) {
      const limpo = t.trim();
      if (/[,;:\-–—]$/.test(limpo) || PENDURADO.test(limpo)) {
        ruins++;
        console.error(`       ${nome} pendurado: "${limpo}"`);
      }
    }
  }
  ok(ruins === 0, 'nenhuma headline ou título termina em vírgula ou palavra de função');
}

// (R4) a pergunta do entrevistador NUNCA vira título
//      defeito real: "Colaboradores: Qual a função que o Dijasso exerce na empresa?"
{
  const perguntas = T_REAL.sentences.filter((x) => /\?\s*$/.test(x.text.trim()));
  ok(perguntas.length >= 5, `a fixture tem ${perguntas.length} perguntas do entrevistador`);
  let ruins = 0;
  for (const c of REAL_OUT.clips) {
    if (/\?$/.test(c.plan.title.trim())) {
      ruins++;
      console.error(`       título é pergunta: "${c.plan.title}"`);
    }
    for (const q of perguntas) {
      const nucleo = fold(q.text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (nucleo.length > 25 && fold(c.plan.title).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').includes(nucleo)) {
        ruins++;
        console.error(`       título copiou a pergunta: "${c.plan.title}"`);
      }
    }
  }
  ok(ruins === 0, 'nenhum título é a pergunta do entrevistador — só a resposta');
}

// (R5) headline e título falam do MESMO trecho
//      defeito real: título "Youtube: Primeiro mês ali eu acertei o único criativo"
//      com headline "10%: utilizou esses pra validar fontes de tráfego"
{
  const nucleo = (h: string) => {
    const i = h.indexOf(': ');
    return i > 0 && i <= 26 ? h.slice(i + 2) : h;
  };
  let ruins = 0;
  for (const c of REAL_OUT.clips) {
    if (!fold(c.plan.title).includes(fold(nucleo(c.plan.headline)))) {
      ruins++;
      console.error(`       incoerente:\n         T: ${c.plan.title}\n         H: ${c.plan.headline}`);
    }
  }
  ok(ruins === 0, 'o título sempre contém o miolo da headline (mesma fala, mesmo fato)');
}

// (R6) tema antes dos dois-pontos só se for substantivo plausível
//      defeitos reais: "Cada:", "Vira:", "Manter:", "Acha:", "Rodar:", "Saindo:"
{
  const PROIBIDOS = ['cada', 'vira', 'manter', 'acha', 'rodar', 'saindo', 'falando', 'tanto'];
  let ruins = 0;
  for (const c of REAL_OUT.clips) {
    const i = c.plan.title.indexOf(': ');
    if (i <= 0) continue;
    const tema = fold(c.plan.title.slice(0, i));
    if (PROIBIDOS.includes(tema)) {
      ruins++;
      console.error(`       tema sem sentido: "${c.plan.title}"`);
    }
  }
  ok(ruins === 0, 'nenhum título usa verbo ou quantificador como tema');
}

// (R7) trava de ASR sujo nas peças puras (as provas do dump, uma a uma)
{
  ok(startsUppercase('milhões de Só reais aqui no Brasil, tá?') === false, 'continuação em minúscula é detectada');
  ok(startsUppercase('Vocês devem ter mais de 10 colaboradores.') === true, 'frase de verdade começa em maiúscula');
  ok(startsUppercase('30 milhões faturados em seis anos.') === true, 'frase que abre em número também vale');
  ok(hasAdjacentRepeat('dos maiores caras do do IFA e da atualidade.'), '"do do" é pego como artefato de ASR');
  ok(
    !hasAdjacentRepeat('A gente sempre fica atento ao movimento do mercado.'),
    'frase normal não é acusada de artefato',
  );
}

// (R8) higiene de texto: vírgula no fim e "??" (defeitos reais)
{
  ok(
    tidyFragment('10%: separa da nossa margem de lucro,') === '10%: separa da nossa margem de lucro',
    'vírgula solta no fim some',
  );
  ok(tidyFragment('Como é que eu posso te falar??') === 'Como é que eu posso te falar?', '"??" vira "?"');
  ok(tidyFragment('  "Wesley tem número de Tudo"  ') === 'Wesley tem número de Tudo', 'aspas e espaço nas bordas somem');
  ok(
    trimEdges('A gente vem mantendo a constância há', LEX) === 'A gente vem mantendo a constância',
    '"há" pendurado no fim é aparado',
  );
  ok(
    trimEdges('Vocês devem ter mais de 10 colaboradores', LEX) === 'Vocês devem ter mais de 10 colaboradores',
    'frase inteira e boa não é mexida',
  );
}

// (R9) o dado extraído é o que foi dito — nem "dois mil" no lugar de
//      "dois milhões", nem ANO virando dado
{
  ok(
    extractFactPhrase('A dívida com o banco passou de dois milhões e o caixa não fechava.') === 'dois milhões',
    '"dois milhões" não vira "dois mil" (ordem das alternativas do regex)',
  );
  ok(
    extractFactPhrase('A gente quase quebrou em dois mil e dezenove, foi duro.') === null,
    'ano falado por extenso não é dado ("dois mil e dezenove")',
  );
  ok(
    extractFactPhrase('Faturamos 30 milhões de reais em seis anos.') === '30 milhões de reais',
    'dinheiro ganha de tempo',
  );
  ok(extractFactPhrase('Hoje a gente separa 10% da nossa margem de lucro.') === '10%', 'porcentagem é recortada sozinha');
}

// (R10) determinismo no material real
{
  const a = curate({
    transcript: T_REAL,
    energy: null,
    settings: settings({ count: 5 }),
    durationSec: DUR_REAL,
  });
  ok(JSON.stringify(a) === JSON.stringify(REAL_OUT), 'transcrição real também é determinística');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} curador: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
