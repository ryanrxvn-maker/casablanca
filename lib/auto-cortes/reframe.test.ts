/**
 * Trava as invariantes do PLANEJADOR de reenquadro do AUTO CORTES.
 * Ver lib/auto-cortes/reframe-plan.ts e docs/auto-cortes/ARQUITETURA.md §3.4.
 *
 * O que isto blinda: o enquadro automático é a parte que mais "parece bug"
 * quando erra — crop que treme com o jitter do detector, crop que desliza por
 * cima de um corte de cena, crop que dispara atrás de um rosto que se moveu.
 * Cada cenário aqui é um desses defeitos, escrito ANTES de existir.
 */
import { strict as assert } from 'node:assert';
import {
  ASPECT_AR,
  DEAD_ZONE,
  SCENE_CUT_DIFF,
  VMAX_PER_SEC,
  boxAtTime,
  buildTracks,
  cropSizeFor,
  histDiff,
  iou,
  liveTracks,
  planCrop,
  sceneCuts,
  simplifyKeyframes,
  splitHalfAR,
  splitOrientation,
  type CropKeyframe,
  type FaceSample,
  type HistSample,
  type NormBox,
} from './reframe-plan';

let passed = 0;
let failed = 0;
function ok(label: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${label}`);
    console.error('       ' + (e instanceof Error ? e.message.split('\n')[0] : String(e)));
  }
}

// ── cenário base: fonte 1920x1080 (16:9) virando 9:16, 5 amostras por segundo
const SRC = { srcW: 1920, srcH: 1080 };
const STEP = 0.2;
const FACE_W = 0.08;
const FACE_H = 0.14;

function face(cx: number, cy: number, score = 0.95) {
  return { x: cx - FACE_W / 2, y: cy - FACE_H / 2, w: FACE_W, h: FACE_H, score };
}

/** amostras com N rostos, posição dada por função do índice */
function samplesOf(n: number, at: (i: number) => Array<ReturnType<typeof face>>): FaceSample[] {
  const out: FaceSample[] = [];
  for (let i = 0; i < n; i++) out.push({ tSec: i * STEP, faces: at(i) });
  return out;
}

function cx(box: NormBox): number {
  return box.x + box.w / 2;
}

function single(plan: ReturnType<typeof planCrop>) {
  assert.equal(plan.layout, 'single', 'esperava layout single');
  return plan as { layout: 'single'; mode: string; keyframes: CropKeyframe[] };
}

console.log('\nGARANTIA — planejador de reenquadro (AUTO CORTES):');

// (1) geometria do crop
ok('9:16 saindo de 16:9 corta a LARGURA e mantém a altura inteira', () => {
  const { cw, ch } = cropSizeFor(1920 / 1080, ASPECT_AR['9:16']);
  assert.equal(ch, 1);
  assert.ok(Math.abs(cw - (1080 / 1920) / (1920 / 1080)) < 1e-9);
  assert.ok(cw > 0.31 && cw < 0.32);
});

ok('16:9 saindo de 9:16 corta a ALTURA e mantém a largura inteira', () => {
  const { cw, ch } = cropSizeFor(1080 / 1920, ASPECT_AR['16:9']);
  assert.equal(cw, 1);
  assert.ok(ch > 0.31 && ch < 0.32);
});

// (2) mesmo aspecto = não mexe em nada
ok('aspecto igual ao da fonte devolve layout none', () => {
  const plan = planCrop([], [], { srcW: 1080, srcH: 1920, aspect: '9:16', mode: 'auto' });
  assert.equal(plan.layout, 'none');
});

ok('"ajustar" devolve fit mesmo quando o aspecto muda', () => {
  const plan = planCrop([], [], { ...SRC, aspect: '9:16', mode: 'ajustar' });
  assert.equal(plan.layout, 'fit');
});

ok('"ajustar" vence até o atalho do aspecto igual (é escolha do cliente)', () => {
  const plan = planCrop([], [], { srcW: 1080, srcH: 1920, aspect: '9:16', mode: 'ajustar' });
  assert.equal(plan.layout, 'fit');
});

// (3) nenhum rosto → centro
ok('sem nenhum rosto o plano é o crop CENTRAL, com 1 keyframe só', () => {
  const s = samplesOf(40, () => []);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'auto' }));
  assert.equal(plan.mode, 'centro');
  assert.equal(plan.keyframes.length, 1);
  assert.ok(Math.abs(cx(plan.keyframes[0].box) - 0.5) < 1e-9, 'crop central');
});

ok('modo "centro" ignora o rosto que existe', () => {
  const s = samplesOf(40, () => [face(0.8, 0.4)]);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'centro' }));
  assert.equal(plan.mode, 'centro');
  assert.ok(Math.abs(cx(plan.keyframes[0].box) - 0.5) < 1e-9);
});

// (4) 1 rosto parado → crop FIXO (nada de tremer com o jitter do detector)
ok('1 rosto parado gera crop FIXO (keyframes idênticos)', () => {
  const s = samplesOf(50, () => [face(0.5, 0.4)]);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'auto' }));
  assert.equal(plan.mode, 'seguir');
  assert.ok(plan.keyframes.length <= 2, 'crop parado não precisa de mais que 2 keyframes');
  const first = plan.keyframes[0].box;
  for (const k of plan.keyframes) {
    assert.ok(Math.abs(k.box.x - first.x) < 1e-9 && Math.abs(k.box.y - first.y) < 1e-9);
  }
});

ok('jitter do detector abaixo da zona morta NÃO move o crop', () => {
  const { cw } = cropSizeFor(1920 / 1080, ASPECT_AR['9:16']);
  const jitter = DEAD_ZONE * cw * 0.4; // metade da zona morta
  const s = samplesOf(40, (i) => [face(0.5 + (i % 2 === 0 ? jitter : -jitter), 0.4)]);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'seguir' }));
  const first = plan.keyframes[0].box;
  for (const k of plan.keyframes) {
    assert.ok(Math.abs(k.box.x - first.x) < 1e-9, 'crop não pode tremer com jitter');
  }
});

// (5) headroom: o rosto fica no terço SUPERIOR do crop
ok('headroom põe o rosto acima do meio do crop (16:9 saindo de 9:16)', () => {
  const s = samplesOf(30, () => [face(0.5, 0.5)]);
  const plan = single(planCrop(s, [], { srcW: 1080, srcH: 1920, aspect: '16:9', mode: 'seguir' }));
  const box = plan.keyframes[0].box;
  const centroCrop = box.y + box.h / 2;
  assert.ok(centroCrop > 0.5, 'o crop desce pra deixar ar em cima do rosto');
  const rostoNoCrop = (0.5 - box.y) / box.h;
  assert.ok(Math.abs(rostoNoCrop - 1 / 3) < 0.02, `rosto a ${rostoNoCrop.toFixed(3)} do topo`);
});

// (6) rosto andando devagar → segue, mas só depois da zona morta
ok('rosto andando devagar: crop segura no começo (zona morta) e alcança no fim', () => {
  const s = samplesOf(60, (i) => [face(0.35 + i * 0.008, 0.4)]); // 0.35 -> 0.822 em 12 s
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'seguir' }));
  const kfs = plan.keyframes;
  const x0 = kfs[0].box.x;
  assert.ok(
    Math.abs(boxAtTime(kfs, STEP).x - x0) < 1e-6,
    'na 2ª amostra o alvo ainda está dentro da zona morta',
  );
  // no fim, o crop tem que estar em cima do rosto — a menos da própria zona
  // morta (o alvo só recompromete quando o rosto anda mais que ela)
  const fimRosto = 0.35 + 59 * 0.008;
  const fimCrop = cx(kfs[kfs.length - 1].box);
  const maxCx = 1 - kfs[0].box.w / 2;
  const folga = DEAD_ZONE * kfs[0].box.w + 0.02;
  assert.ok(Math.abs(fimCrop - Math.min(fimRosto, maxCx)) < folga, `crop parou em ${fimCrop}`);
  // e nunca andou pra trás
  for (let i = 1; i < kfs.length; i++) {
    assert.ok(kfs[i].box.x >= kfs[i - 1].box.x - 1e-9, 'crop não pode voltar');
  }
});

// (7) velocidade máxima
ok('rosto que TELEPORTA sem corte de cena respeita a velocidade máxima', () => {
  const s = samplesOf(60, (i) => [face(i < 20 ? 0.25 : 0.75, 0.4)]);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'seguir' }));
  const kfs = plan.keyframes;
  for (let i = 1; i < kfs.length; i++) {
    const dt = kfs[i].tSec - kfs[i - 1].tSec;
    const dx = Math.abs(kfs[i].box.x - kfs[i - 1].box.x);
    assert.ok(dx <= VMAX_PER_SEC * dt + 1e-9, `passo ${dx} em ${dt}s estourou a vmax`);
  }
  // no primeiro instante depois do salto o crop AINDA não chegou
  const logoDepois = boxAtTime(kfs, 20 * STEP);
  assert.ok(cx(logoDepois) < 0.4, 'o crop não pode teleportar junto');
});

// (8) corte de cena = salto instantâneo
ok('corte de cena faz o crop SALTAR (sem deslizar por cima do corte)', () => {
  const s = samplesOf(60, (i) => [face(i < 20 ? 0.25 : 0.75, 0.4)]);
  const tCorte = 20 * STEP;
  const plan = single(planCrop(s, [tCorte], { ...SRC, aspect: '9:16', mode: 'seguir' }));
  const noCorte = boxAtTime(plan.keyframes, tCorte);
  assert.ok(Math.abs(cx(noCorte) - 0.75) < 1e-6, `devia estar em 0.75 e está em ${cx(noCorte)}`);
});

ok('clipe com 2 planos: o enquadro segue quem está em cena (não centraliza)', () => {
  const s = samplesOf(60, (i) => [face(i < 24 ? 0.25 : 0.78, 0.4)]);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'seguir' }));
  assert.ok(
    Math.abs(cx(plan.keyframes[0].box) - 0.25) < 1e-6,
    'o 1º plano tem que nascer enquadrado no rosto dele',
  );
  const fim = cx(plan.keyframes[plan.keyframes.length - 1].box);
  assert.ok(Math.abs(fim - 0.78) < 0.02, 'e terminar no rosto do 2º plano');
});

// (9) tela dividida
ok('2 rostos estáveis e distantes viram tela DIVIDIDA no modo auto', () => {
  const s = samplesOf(50, () => [face(0.22, 0.45), face(0.78, 0.45)]);
  const plan = planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'auto' });
  assert.equal(plan.layout, 'split');
  if (plan.layout !== 'split') return;
  assert.equal(plan.tracks.length, 2);
  const esq = plan.tracks[0][0].box;
  const dir = plan.tracks[1][0].box;
  assert.ok(cx(esq) < cx(dir), 'a pessoa da esquerda vem primeiro');
  // cada metade tem o DOBRO da proporção da saída (9:16 empilha)
  const halfAR = (esq.w * SRC.srcW) / (esq.h * SRC.srcH);
  assert.ok(Math.abs(halfAR - ASPECT_AR['9:16'] * 2) < 1e-6);
});

ok('2 rostos PERTO não viram tela dividida (viram um crop só)', () => {
  const s = samplesOf(50, () => [face(0.45, 0.45), face(0.58, 0.45)]);
  const plan = planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'auto' });
  assert.equal(plan.layout, 'single');
});

ok('"dividir" pedido com 1 rosto só degrada pra seguir (nunca clona a pessoa)', () => {
  const s = samplesOf(40, () => [face(0.4, 0.45)]);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'dividir' }));
  assert.equal(plan.mode, 'seguir');
});

ok('rosto que aparece em menos de 40 % das amostras não conta como pessoa', () => {
  const s = samplesOf(50, (i) => (i < 10 ? [face(0.3, 0.4)] : []));
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'auto' }));
  assert.equal(plan.mode, 'centro');
});

ok('9:16 empilha as metades; as outras proporções ficam lado a lado', () => {
  assert.equal(splitOrientation('9:16'), 'stacked');
  assert.equal(splitOrientation('1:1'), 'side');
  assert.equal(splitOrientation('4:5'), 'side');
  assert.equal(splitOrientation('16:9'), 'side');
  assert.ok(Math.abs(splitHalfAR('1:1') - 0.5) < 1e-9);
  assert.ok(Math.abs(splitHalfAR('9:16') - 1.125) < 1e-9);
});

// (10) rastreamento
ok('IoU associa a MESMA pessoa entre amostras e separa duas pessoas', () => {
  assert.ok(iou(face(0.5, 0.5), face(0.505, 0.5)) > 0.3);
  assert.equal(iou(face(0.2, 0.5), face(0.8, 0.5)), 0);
  const s = samplesOf(30, () => [face(0.25, 0.4), face(0.75, 0.4)]);
  const tracks = liveTracks(buildTracks(s));
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((t) => t.presence === 1));
});

ok('a ordem dos rostos na amostra não cria track novo', () => {
  const s = samplesOf(20, (i) =>
    i % 2 === 0 ? [face(0.25, 0.4), face(0.75, 0.4)] : [face(0.75, 0.4), face(0.25, 0.4)],
  );
  const tracks = buildTracks(s);
  assert.equal(tracks.length, 2);
});

// (11) corte de cena por histograma
ok('sceneCuts marca a troca de imagem e ignora variação pequena', () => {
  const escuro = new Array(16).fill(0).map((_, i) => (i < 4 ? 0.25 : 0));
  const claro = new Array(16).fill(0).map((_, i) => (i >= 12 ? 0.25 : 0));
  const quase = escuro.slice();
  quase[0] += 0.05;
  quase[1] -= 0.05;
  const hists: HistSample[] = [
    { tSec: 0, hist: escuro },
    { tSec: 0.2, hist: quase },
    { tSec: 0.4, hist: claro },
    { tSec: 0.6, hist: claro },
  ];
  assert.deepEqual(sceneCuts(hists), [0.4]);
  assert.ok(histDiff(escuro, claro) > SCENE_CUT_DIFF);
  assert.ok(histDiff(escuro, quase) < SCENE_CUT_DIFF);
});

// (12) interpolação e simplificação
ok('boxAtTime interpola linear e segura nas pontas', () => {
  const kfs: CropKeyframe[] = [
    { tSec: 10, box: { x: 0, y: 0, w: 0.3, h: 1 } },
    { tSec: 20, box: { x: 0.4, y: 0, w: 0.3, h: 1 } },
  ];
  assert.equal(boxAtTime(kfs, 5).x, 0);
  assert.equal(boxAtTime(kfs, 25).x, 0.4);
  assert.ok(Math.abs(boxAtTime(kfs, 15).x - 0.2) < 1e-9);
});

ok('simplifyKeyframes preserva as pontas e o formato da curva', () => {
  const kfs: CropKeyframe[] = [];
  for (let i = 0; i <= 10; i++) kfs.push({ tSec: i, box: { x: i * 0.02, y: 0, w: 0.3, h: 1 } });
  const s = simplifyKeyframes(kfs);
  assert.equal(s.length, 2, 'reta vira 2 pontos');
  assert.equal(s[0].tSec, 0);
  assert.equal(s[s.length - 1].tSec, 10);
});

// (13) pureza
ok('planCrop é determinístico (mesma entrada, mesma saída)', () => {
  const s = samplesOf(40, (i) => [face(0.3 + i * 0.005, 0.4)]);
  const a = planCrop(s, [1.0], { ...SRC, aspect: '4:5', mode: 'auto' });
  const b = planCrop(s, [1.0], { ...SRC, aspect: '4:5', mode: 'auto' });
  assert.deepEqual(a, b);
});

ok('o crop nunca sai do frame', () => {
  const s = samplesOf(60, (i) => [face(i < 30 ? 0.02 : 0.98, 0.03)]);
  const plan = single(planCrop(s, [], { ...SRC, aspect: '9:16', mode: 'seguir' }));
  for (const k of plan.keyframes) {
    assert.ok(k.box.x >= -1e-9 && k.box.x + k.box.w <= 1 + 1e-9, 'estourou na horizontal');
    assert.ok(k.box.y >= -1e-9 && k.box.y + k.box.h <= 1 + 1e-9, 'estourou na vertical');
  }
});

console.log(`\n${passed} ok, ${failed} falharam\n`);
if (failed > 0) process.exit(1);
