/**
 * Testes da divisão do Lipsync Video to Video.
 *
 * O que precisa ficar provado: TODO trecho que vai pro motor respeita os dois
 * tetos (≤ MAX_SEG_SEC de fala, ≤ COPY_SEG_BUDGET de rosto quando copiado),
 * qualquer que seja a duração, o GOP e o bitrate — e o caso real que quebrou
 * em 07.10 (rosto HEVC 1080x1920 de 3:54 / 88MB) sai em 2 trechos por cópia,
 * cortado no keyframe colado na pausa.
 */
import {
  parseFramecrc,
  planFaceCuts,
  faceCoversAudio,
  bytesBetween,
  MAX_SEG_SEC,
  MIN_SEG_SEC,
  COPY_SEG_BUDGET,
  type FaceInfo,
  type Silence,
} from './lipsync-chunk-plan';

let fails = 0;
function ok(cond: boolean, label: string, extra?: unknown) {
  if (!cond) { console.error(`FAIL ${label}`, extra ?? ''); fails++; }
  else console.log(`ok   ${label}`);
}

/** Rosto sintético: `fps` constante, keyframe a cada `gop` s, `mbps` médios. */
function fakeFace(durSec: number, gop: number, mbps: number, fps = 30): FaceInfo {
  const packets = [];
  const n = Math.round(durSec * fps);
  const perFrame = (mbps * 1_000_000) / 8 / fps;
  const gopFrames = Math.max(1, Math.round(gop * fps));
  for (let i = 0; i < n; i++) {
    const key = i % gopFrames === 0;
    packets.push({ t: i / fps, size: Math.round(key ? perFrame * 4 : perFrame * 0.9), key });
  }
  return { codec: 'hevc', width: 1080, height: 1920, packets, durationSec: n / fps };
}

/** Confere os dois tetos de um plano contra o áudio e o rosto. */
function checkPlan(label: string, face: FaceInfo, audioSec: number, plan: ReturnType<typeof planFaceCuts>, quiet = false) {
  const audioBounds = [0, ...plan.cuts, audioSec];
  let good = true;
  for (let i = 0; i < audioBounds.length - 1; i++) {
    const len = audioBounds[i + 1] - audioBounds[i];
    if (len > MAX_SEG_SEC + 1e-6 || len < MIN_SEG_SEC - 1e-6) { good = false; console.error(`  trecho ${i} com ${len.toFixed(2)}s`); }
  }
  if (plan.mode === 'copy') {
    const faceBounds = [0, ...plan.cuts, plan.faceEnd ?? Infinity];
    for (let i = 0; i < faceBounds.length - 1; i++) {
      const b = bytesBetween(face.packets, faceBounds[i], faceBounds[i + 1]);
      if (b > COPY_SEG_BUDGET) { good = false; console.error(`  rosto ${i} com ${(b / 1048576).toFixed(1)}MB`); }
      const fl = Math.min(faceBounds[i + 1], face.durationSec) - faceBounds[i];
      if (fl > MAX_SEG_SEC + 1e-6) { good = false; console.error(`  rosto ${i} com ${fl.toFixed(1)}s`); }
    }
    const keys = new Set(face.packets.filter((p) => p.key).map((p) => p.t));
    if (!plan.cuts.every((c) => keys.has(c))) { good = false; console.error('  corte fora de keyframe'); }
  }
  if (quiet && good) return;
  ok(good, label, plan);
}

// ── 1. parseFramecrc: o formato real que o ffmpeg escreve ──
{
  const txt = [
    '#extradata 0:      100, 0x752818b8',
    '#software: Lavf62.6.101',
    '#tb 0: 1/15360',
    '#media_type 0: video',
    '#codec_id 0: hevc',
    '#dimensions 0: 1080x1920',
    '#sar 0: 0/1',
    '0,          0,          0,      512,    56102, 0xf5741b13',
    '0,        512,       1024,      512,     8123, 0x1a2b3c4d, F=0x0',
    '0,       1024,        512,      512,     7000, 0x1a2b3c4d, F=0x0',
    '0,      76800,      76800,      512,    50000, 0x00000001',
    '0,      77312,      77312,      512,     9000, 0x00000002, F=0x1',
  ].join('\n');
  const info = parseFramecrc(txt);
  ok(info.codec === 'hevc' && info.width === 1080 && info.height === 1920, 'framecrc: codec e dimensões');
  ok(info.packets.length === 5, 'framecrc: 5 pacotes');
  ok(info.packets.map((p) => p.key).join() === 'true,false,false,true,true', 'framecrc: keyframe = sem F= ou bit 0x1', info.packets);
  ok(Math.abs(info.packets[3].t - 5) < 1e-9, 'framecrc: pts na base de tempo (76800/15360 = 5s)');
  ok(Math.abs(info.durationSec - (77312 + 512) / 15360) < 1e-9, 'framecrc: duração = último pts + duração');
  ok(parseFramecrc('lixo\n\n').packets.length === 0, 'framecrc: texto sem tabela não quebra');
}

// ── 2. O CASO REAL de 07.10: "lip 03.mp4" (234,4s, HEVC, 2,8 Mbps, GOP 5s) ──
{
  // Pausas medidas no áudio real (silencedetect -32dB/0,35s).
  const silences: Silence[] = [
    { start: 110.773, end: 111.154 }, { start: 119.302, end: 119.756 }, { start: 123.464, end: 123.843 },
    { start: 128.015, end: 128.518 }, { start: 134.994, end: 135.533 }, { start: 139.838, end: 140.199 },
    { start: 147.765, end: 148.125 },
  ];
  const face = fakeFace(234.4, 5, 2.8);
  const plan = planFaceCuts({ face, silences, audioSec: 234.4, copyable: true });
  ok(plan.mode === 'copy', 'lip 03: vai por CÓPIA (sem re-encode)', plan);
  ok(plan.cuts.length === 1 && Math.abs(plan.cuts[0] - 120) < 1e-6, 'lip 03: 2 trechos, corte no keyframe 120s (colado na pausa 119,3–119,8)', plan.cuts);
  ok(plan.faceEnd === null, 'lip 03: rosto do tamanho do áudio vai até o fim');
  checkPlan('lip 03: os dois tetos', face, 234.4, plan);
}

// ── 3. Fonte que não dá pra copiar → re-encode, mesmos tetos ──
{
  const face = fakeFace(400, 2, 3);
  const plan = planFaceCuts({ face, silences: [], audioSec: 400, copyable: false });
  ok(plan.mode === 'encode', 'não-copiável: re-encode');
  checkPlan('não-copiável: os dois tetos', face, 400, plan);
}

// ── 4. Bitrate absurdo (trecho copiado nunca caberia) → re-encode ──
{
  const face = fakeFace(300, 1, 40);
  const plan = planFaceCuts({ face, silences: [], audioSec: 300, copyable: true });
  ok(plan.mode === 'encode', 'bitrate 40 Mbps: re-encode (cópia não cabe)', plan);
  checkPlan('bitrate 40 Mbps: os dois tetos', face, 300, plan);
}

// ── 5. GOP gigante (1 keyframe só) → re-encode ──
{
  const face = fakeFace(250, 1000, 2);
  const plan = planFaceCuts({ face, silences: [], audioSec: 250, copyable: true });
  ok(plan.mode === 'encode', 'GOP gigante: re-encode', plan);
  checkPlan('GOP gigante: os dois tetos', face, 250, plan);
}

// ── 6. Rosto MAIS LONGO que o áudio: para no keyframe depois da fala ──
{
  const face = fakeFace(420, 2, 2.5);
  const plan = planFaceCuts({ face, silences: [], audioSec: 260, copyable: true });
  ok(plan.mode === 'copy', 'rosto longo: cópia');
  ok(plan.faceEnd !== null && plan.faceEnd >= 260.5 && plan.faceEnd <= 262.5, 'rosto longo: para no 1º keyframe ≥ fim da fala + 0,5s', plan.faceEnd);
  checkPlan('rosto longo: os dois tetos', face, 260, plan);
}

// ── 7. Varredura: 400 casos aleatórios, NENHUM trecho fora dos tetos ──
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let bad = 0;
  let copies = 0;
  for (let i = 0; i < 400; i++) {
    const audioSec = 179 + rnd() * 421; // 179s..600s (o teto da UI é 10min)
    const gop = [0.5, 1, 2, 5, 8, 12][Math.floor(rnd() * 6)];
    const mbps = 0.8 + rnd() * 14;
    const face = fakeFace(audioSec + rnd() * 1.2, gop, mbps);
    const silences: Silence[] = [];
    for (let t = 1 + rnd() * 6; t < audioSec; t += 2 + rnd() * 9) silences.push({ start: t, end: t + 0.35 + rnd() * 0.6 });
    const plan = planFaceCuts({ face, silences, audioSec, copyable: rnd() > 0.15 });
    if (plan.mode === 'copy') copies++;
    const before = fails;
    checkPlan(`varredura #${i} (${audioSec.toFixed(0)}s, GOP ${gop}s, ${mbps.toFixed(1)} Mbps, ${plan.mode})`, face, audioSec, plan, true);
    if (fails > before) bad++;
  }
  ok(bad === 0, `varredura: 400/400 dentro dos tetos (${copies} por cópia)`);
}

// ── 8. Quem é video-to-video e quem é clipe de loop ──
ok(faceCoversAudio(234.4, 234.4), 'cobre: mesmo tamanho');
ok(faceCoversAudio(233.2, 234.4), 'cobre: até 1,5s mais curto');
ok(!faceCoversAudio(30, 234.4), 'loop: rosto de 30s com fala de 234s');
ok(!faceCoversAudio(0, 234.4), 'sem duração = não arrisca dividir');

if (fails) {
  console.error(`\n${fails} falha(s)`);
  process.exit(1);
}
console.log('\nlipsync-chunk-plan: tudo ok');
