/**
 * Testes do reuso de takes entre hooks irmãos (DR MILLION).
 * O que precisa ficar provado: o vídeo certo cai no take certo, e o B2C
 * (dedup desligado) passa exatamente como antes.
 */
import { planejarDisparo, montarResultados, chaveConteudo } from './pilot-dedup';

let fails = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL ${label}\n  esperado: ${e}\n  veio:     ${a}`); fails++; }
  else console.log(`ok   ${label}`);
}

const AV = 'avatar_1';
const VOZ = 'voz_1';
// AD07G1: hook próprio + 3 takes de corpo (o corpo é igual nas 3 tasks)
const hook1 = { text: 'Hook um', avatarId: AV, voiceId: VOZ };
const hook2 = { text: 'Hook dois', avatarId: AV, voiceId: VOZ };
const corpo = [
  { text: 'Corpo A', avatarId: AV, voiceId: VOZ },
  { text: 'Corpo B', avatarId: AV, voiceId: VOZ },
  { text: 'Corpo C', avatarId: AV, voiceId: VOZ },
];

// ── B2C: dedup desligado, nada muda ──
{
  const partes = [hook1, ...corpo];
  const p = planejarDisparo(partes, { ativo: false, reservadas: new Set() });
  eq(p.minhasIdx, [0, 1, 2, 3], 'B2C dispara todas as partes');
  eq(p.herdadasIdx, [], 'B2C não herda nada');
  const enviados = [
    { index: 1, videoId: 'v1' },
    { index: 2, videoId: 'v2' },
    { index: 3, videoId: 'v3' },
    { index: 4, videoId: 'v4' },
  ];
  const r = montarResultados(4, p.minhasIdx, enviados, new Map(), false);
  eq(r, enviados, 'B2C: resultado é o MESMO array (zero mudança)');
}

// ── DR MILLION, 1ª task: gera tudo e reserva o corpo ──
const reservadas = new Set<string>();
{
  const partes = [hook1, ...corpo];
  const p = planejarDisparo(partes, { ativo: true, reservadas });
  eq(p.minhasIdx, [0, 1, 2, 3], 'task 1 gera hook + corpo inteiro');
  eq(p.herdadasIdx, [], 'task 1 não herda nada');
  eq([...p.novasChaves.keys()], [0, 1, 2, 3], 'task 1 reserva as 4 falas');
  for (const k of p.novasChaves.values()) reservadas.add(k);
}

// ── DR MILLION, 2ª task: só o hook é novo; o corpo vem da irmã ──
{
  const partes = [hook2, ...corpo];
  const p = planejarDisparo(partes, { ativo: true, reservadas });
  eq(p.minhasIdx, [0], 'task 2 só dispara o hook dela');
  eq(p.herdadasIdx, [1, 2, 3], 'task 2 herda os 3 takes do corpo');

  // HeyGen recebeu 1 job (o hook) e devolveu index 1
  const enviados = [{ index: 1, videoId: 'hook2_video' }];
  const herdados = new Map<number, string | null>([
    [1, 'corpoA_video'],
    [2, 'corpoB_video'],
    [3, 'corpoC_video'],
  ]);
  const r = montarResultados(4, p.minhasIdx, enviados, herdados, true);
  eq(r.map((x) => x.videoId), ['hook2_video', 'corpoA_video', 'corpoB_video', 'corpoC_video'],
    'cada vídeo cai no take certo (o alinhamento que não pode falhar)');
  eq(r.map((x) => x.index), [1, 2, 3, 4], 'índices sequenciais 1..N');
}

// ── corpo que não gerou: a irmã marca erro em vez de montar torto ──
{
  const partes = [hook2, ...corpo];
  const p = planejarDisparo(partes, { ativo: true, reservadas });
  const enviados = [{ index: 1, videoId: 'hook2_video' }];
  const herdados = new Map<number, string | null>([[1, null], [2, 'b'], [3, 'c']]);
  const r = montarResultados(4, p.minhasIdx, enviados, herdados, true);
  eq(r[1].videoId, null, 'take herdado que falhou fica sem vídeo');
  eq(!!r[1].error, true, 'take herdado que falhou traz erro (vira RETOMAR)');
  eq(r[2].videoId, 'b', 'os outros herdados seguem certos');
}

// ── parte VAZIA nunca é deduplicada ──
{
  const partes = [hook1, { text: '', avatarId: AV, voiceId: VOZ }, { text: '   ', avatarId: AV, voiceId: VOZ }];
  const p = planejarDisparo(partes, { ativo: true, reservadas: new Set() });
  eq(p.minhasIdx, [0, 1, 2], 'partes vazias seguem o fluxo normal');
  eq(p.herdadasIdx, [], 'parte vazia não herda');
}

// ── mesma fala com AVATAR diferente NÃO reusa ──
{
  const r1 = new Set<string>([chaveConteudo({ text: 'Corpo A', avatarId: 'avatar_1', voiceId: VOZ })]);
  const p = planejarDisparo([{ text: 'Corpo A', avatarId: 'avatar_2', voiceId: VOZ }], { ativo: true, reservadas: r1 });
  eq(p.minhasIdx, [0], 'avatar diferente gera de novo (não reusa vídeo de outro avatar)');
}

// ── mesma fala com VOZ diferente NÃO reusa ──
{
  const r1 = new Set<string>([chaveConteudo({ text: 'Corpo A', avatarId: AV, voiceId: 'voz_1' })]);
  const p = planejarDisparo([{ text: 'Corpo A', avatarId: AV, voiceId: 'voz_2' }], { ativo: true, reservadas: r1 });
  eq(p.minhasIdx, [0], 'voz diferente gera de novo');
}

// ── ordem preservada mesmo com herança no meio ──
{
  const reserv = new Set<string>([chaveConteudo(corpo[1])]); // só o "Corpo B" já existe
  const partes = [hook1, corpo[0], corpo[1], corpo[2]];
  const p = planejarDisparo(partes, { ativo: true, reservadas: reserv });
  eq(p.minhasIdx, [0, 1, 3], 'dispara as que faltam, pulando a herdada do meio');
  eq(p.herdadasIdx, [2], 'herda só a do meio');
  const enviados = [{ index: 1, videoId: 'h' }, { index: 2, videoId: 'a' }, { index: 3, videoId: 'c' }];
  const r = montarResultados(4, p.minhasIdx, enviados, new Map([[2, 'b']]), true);
  eq(r.map((x) => x.videoId), ['h', 'a', 'b', 'c'], 'herança NO MEIO não desalinha os vídeos');
}

// ── job que não voltou ──
{
  const p = planejarDisparo([hook1, corpo[0]], { ativo: true, reservadas: new Set() });
  const r = montarResultados(2, p.minhasIdx, [{ index: 1, videoId: 'h' }], new Map(), true);
  eq(r[1].videoId, null, 'take sem resposta do HeyGen fica sem vídeo');
  eq(!!r[1].error, true, 'e traz erro em vez de sumir');
}

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
