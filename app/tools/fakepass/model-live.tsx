'use client';

/**
 * FakePass — LIVES (TikTok / Instagram).
 *
 * Diferente dos outros modelos (DOM + html2canvas), a live é DESENHADA num
 * <canvas> 1080×1920 com animação contínua (reações subindo + comentários
 * rolando) — o mesmo motor do template aprovado de overlay de live. Vantagens:
 *  • o PNG baixado é o PRÓPRIO canvas rasterizado — não existe re-layout,
 *    logo não existe desalinhamento possível entre prévia e download;
 *  • export de VÍDEO .webm (captureStream + MediaRecorder) pra sobrepor a
 *    live animada em cima do criativo no CapCut;
 *  • fundo verde opcional (chroma key) pra remover no editor;
 *  • emojis Apple (CDN) desenhados como IMAGEM no canvas — o print sai com o
 *    emoji do iPhone em qualquer máquina.
 */

import { useEffect, useRef, useState } from 'react';
import { logHistory } from '@/lib/history';
import {
  Field,
  TextField,
  TextArea,
  Toggle,
  RangeField,
  Swatches,
  ImageUpload,
  VideoUpload,
  FONT_STACK,
  EMOJI_RE,
  toUnified,
  type FakeModel,
} from './shared';

/* ─────────────────────────── Tipos / estado ─────────────────────────── */

type LiveKind = 'tiktok' | 'ig';

type LiveS = {
  username: string; // só o Instagram mostra
  verified: boolean; // idem
  viewers: string;
  comments: string; // uma linha por comentário: "usuário: mensagem"
  avatar: string; // data URL (fica no navegador)
  accent: string; // cor do selo LIVE / AO VIVO
  chroma: boolean; // fundo verde pra chroma key
  bgVideo: string; // Object URL do vídeo DE FUNDO (opcional; vence o chroma)
  segundos: number; // duração do vídeo exportado
};

const W = 1080;
const H = 1920;

/* ────────────────── Emojis Apple desenhados no canvas ────────────────── */
// Mesma fonte de imagem do resto da ferramenta (emoji-datasource-apple), só
// que via drawImage — o canvas não depende da fonte de emoji do sistema.

const emojiImgs = new Map<string, HTMLImageElement>();

function emojiImg(e: string): HTMLImageElement | null {
  let img = emojiImgs.get(e);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/${toUnified(e)}.png`;
    emojiImgs.set(e, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Dispara o download de todos os emojis de um texto (prontos no 1º frame). */
function prefetchEmojis(text: string) {
  const re = new RegExp(EMOJI_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex += 1;
    emojiImg(m[0]);
  }
}

type Run = { t: string; emoji: boolean };

function splitRuns(text: string): Run[] {
  const re = new RegExp(EMOJI_RE);
  const runs: Run[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex += 1;
    if (m.index > last) runs.push({ t: text.slice(last, m.index), emoji: false });
    runs.push({ t: m[0], emoji: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ t: text.slice(last), emoji: false });
  return runs;
}

function fontPx(font: string): number {
  return parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '30');
}

/** Desenha texto com emojis Apple embutidos; devolve a largura desenhada. */
function drawRich(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
): number {
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = 'left';
  const fs = fontPx(font);
  let cx = x;
  for (const r of splitRuns(text)) {
    if (!r.emoji) {
      ctx.fillText(r.t, cx, y);
      cx += ctx.measureText(r.t).width;
    } else {
      const size = fs * 1.16;
      const img = emojiImg(r.t);
      if (img) ctx.drawImage(img, cx + fs * 0.04, y - size * 0.84, size, size);
      cx += size + fs * 0.08;
    }
  }
  return cx - x;
}

function measureRich(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  ctx.font = font;
  const fs = fontPx(font);
  let w = 0;
  for (const r of splitRuns(text)) {
    if (!r.emoji) w += ctx.measureText(r.t).width;
    else w += fs * 1.16 + fs * 0.08;
  }
  return w;
}

/* ─────────────────────────── Primitivos ─────────────────────────── */

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ícones de linha (mesmos traços do template aprovado) */

function iconMic(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  rr(ctx, cx - s * 0.22, cy - s * 0.55, s * 0.44, s * 0.6, s * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + 0.05 * s, s * 0.4, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + 0.42 * s);
  ctx.lineTo(cx, cy + 0.65 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 0.22 * s, cy + 0.65 * s);
  ctx.lineTo(cx + 0.22 * s, cy + 0.65 * s);
  ctx.stroke();
}

function iconCamera(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.09;
  ctx.lineJoin = 'round';
  rr(ctx, cx - s * 0.4, cy - s * 0.28, s * 0.62, s * 0.56, s * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.22, cy - s * 0.05);
  ctx.lineTo(cx + s * 0.5, cy - s * 0.22);
  ctx.lineTo(cx + s * 0.5, cy + s * 0.22);
  ctx.lineTo(cx + s * 0.22, cy + s * 0.05);
  ctx.closePath();
  ctx.stroke();
}

function iconFlip(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.38, -0.6 * Math.PI, 0.3 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.38, 0.4 * Math.PI, 1.4 * Math.PI);
  ctx.stroke();
  ctx.save();
  ctx.translate(cx + s * 0.36, cy - s * 0.22);
  ctx.rotate(0.3 * Math.PI);
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, 0);
  ctx.lineTo(s * 0.1, 0);
  ctx.lineTo(0, s * 0.16);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}

function iconSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#fff';
  const star = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  };
  star(cx + s * 0.05, cy, s * 0.4);
  star(cx - s * 0.32, cy + s * 0.28, s * 0.18);
}

function iconPlus(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.28, cy);
  ctx.lineTo(cx + s * 0.28, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.28);
  ctx.lineTo(cx, cy + s * 0.28);
  ctx.stroke();
}

function iconSend(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.4, cy - s * 0.32);
  ctx.lineTo(cx + s * 0.42, cy);
  ctx.lineTo(cx - s * 0.4, cy + s * 0.32);
  ctx.lineTo(cx - s * 0.22, cy);
  ctx.closePath();
  ctx.fill();
}

function iconEye(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, 16, 10, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function iconClose(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s);
  ctx.lineTo(cx + s, cy + s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + s, cy - s);
  ctx.lineTo(cx - s, cy + s);
  ctx.stroke();
}

/* ícones do Instagram */

function iconHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.075;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy + 0.38 * s);
  ctx.bezierCurveTo(cx - 0.66 * s, cy - 0.12 * s, cx - 0.38 * s, cy - 0.5 * s, cx, cy - 0.22 * s);
  ctx.bezierCurveTo(cx + 0.38 * s, cy - 0.5 * s, cx + 0.66 * s, cy - 0.12 * s, cx, cy + 0.38 * s);
  ctx.closePath();
  ctx.stroke();
}

function iconPlane(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const u = s / 24;
  ctx.save();
  ctx.translate(cx - 12 * u, cy - 12 * u);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.9 * u;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(22 * u, 2 * u);
  ctx.lineTo(11 * u, 13 * u);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(22 * u, 2 * u);
  ctx.lineTo(15 * u, 22 * u);
  ctx.lineTo(11 * u, 13 * u);
  ctx.lineTo(2 * u, 9 * u);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function iconQuestion(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, fam: string) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.075;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(s * 0.58)}px ${fam}`;
  ctx.fillText('?', cx, cy + s * 0.21);
}

function badgeVerified(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // selo serrilhado do Instagram (12 pontas) + check branco
  ctx.fillStyle = '#3897f0';
  ctx.beginPath();
  const teeth = 12;
  for (let i = 0; i < teeth * 2; i++) {
    const rad = i % 2 === 0 ? r : r * 0.82;
    const a = (i * Math.PI) / teeth - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.24;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.08, cy + r * 0.36);
  ctx.lineTo(cx + r * 0.44, cy - r * 0.3);
  ctx.stroke();
}

/* ─────────────────────────── Cena / animação ─────────────────────────── */

type Reaction = {
  x: number;
  y: number;
  vy: number;
  drift: number;
  life: number;
  maxLife: number;
  emoji: string;
  size: number;
};

type Anim = { t: number; scroll: number; reactions: Reaction[] };

const REACTION_EMOJIS: Record<LiveKind, string[]> = {
  tiktok: ['🔥', '❤️', '✨', '🔥', '💯'],
  ig: ['❤️', '❤️', '❤️', '🧡', '💜', '😍', '🔥'],
};

function spawnReaction(anim: Anim, kind: LiveKind) {
  const set = REACTION_EMOJIS[kind];
  anim.reactions.push({
    x: W * (kind === 'tiktok' ? 0.86 : 0.9) + (Math.random() * 40 - 20),
    y: H - (kind === 'tiktok' ? 260 : 240),
    vy: -(2.4 + Math.random() * 1.2),
    drift: Math.random() * 1.4 - 0.7,
    life: 0,
    maxLife: 110 + Math.random() * 40,
    emoji: set[Math.floor(Math.random() * set.length)],
    size: 44 + Math.random() * 18,
  });
}

function parseComments(raw: string): { user: string; text: string }[] {
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return { user: line.trim(), text: '' };
      return { user: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim() };
    });
}

/** Fundo da live: vídeo enviado em COVER (1080×1920) — ou o fill de sempre. */
function drawLiveBg(ctx: CanvasRenderingContext2D, s: LiveS, bgVideo: HTMLVideoElement | null) {
  if (bgVideo && bgVideo.readyState >= 2 && bgVideo.videoWidth && bgVideo.videoHeight) {
    const sc = Math.max(W / bgVideo.videoWidth, H / bgVideo.videoHeight);
    const sw = W / sc;
    const sh = H / sc;
    ctx.drawImage(bgVideo, (bgVideo.videoWidth - sw) / 2, (bgVideo.videoHeight - sh) / 2, sw, sh, 0, 0, W, H);
    return;
  }
  ctx.fillStyle = s.chroma ? '#00FF00' : '#000000';
  ctx.fillRect(0, 0, W, H);
}

function drawAvatarCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  img: HTMLImageElement | null,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const sc = Math.max((r * 2) / img.width, (r * 2) / img.height);
    ctx.drawImage(img, cx - (img.width * sc) / 2, cy - (img.height * sc) / 2, img.width * sc, img.height * sc);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#3a3a3a');
    g.addColorStop(1, '#111');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Reações flutuando (emojis Apple subindo com fade in/out). */
function drawReactions(ctx: CanvasRenderingContext2D, anim: Anim, kind: LiveKind) {
  if (anim.t % (kind === 'tiktok' ? 22 : 18) === 0) spawnReaction(anim, kind);
  for (let i = anim.reactions.length - 1; i >= 0; i--) {
    const r = anim.reactions[i];
    r.y += r.vy;
    r.x += r.drift;
    r.life += 1;
    const alpha = r.life < 20 ? r.life / 20 : Math.max(0, 1 - (r.life - r.maxLife + 30) / 30);
    const img = emojiImg(r.emoji);
    if (img) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.drawImage(img, r.x - r.size / 2, r.y - r.size, r.size, r.size);
      ctx.restore();
    }
    if (r.life > r.maxLife) anim.reactions.splice(i, 1);
  }
}

/** Comentários rolando pra cima com fade (mesma cinemática do template). */
function drawComments(
  ctx: CanvasRenderingContext2D,
  s: LiveS,
  anim: Anim,
  fam: string,
  baseY: number,
  userFont: string,
  userFill: string,
) {
  anim.scroll += 0.55;
  const comments = parseComments(s.comments);
  const cycleH = 118;
  const totalH = comments.length * cycleH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, baseY - 360, W * 0.78, 380);
  ctx.clip();

  comments.forEach((c, i) => {
    const y = baseY - ((anim.scroll + i * cycleH) % (totalH + cycleH));
    if (y < baseY - 380 || y > baseY + 40) return;
    const distFromBottom = baseY - y;
    const alpha = Math.max(0, 1 - distFromBottom / 340);

    ctx.globalAlpha = alpha;
    const ax = 64;
    const ay = y;
    const g = ctx.createLinearGradient(ax - 24, ay - 24, ax + 24, ay + 24);
    g.addColorStop(0, '#555');
    g.addColorStop(1, '#222');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ax, ay, 26, 0, Math.PI * 2);
    ctx.fill();

    drawRich(ctx, c.user, ax + 44, ay - 6, userFont, userFill);
    drawRich(ctx, c.text, ax + 44, ay + 32, `400 30px ${fam}`, 'rgba(255,255,255,0.88)');

    ctx.globalAlpha = 1;
  });
  ctx.restore();
}

/* ─────────────────────────── TikTok ─────────────────────────── */

function drawTikTok(
  ctx: CanvasRenderingContext2D,
  s: LiveS,
  anim: Anim,
  fam: string,
  avatarImg: HTMLImageElement | null,
  bgVideo: HTMLVideoElement | null,
) {
  // fundo (vídeo enviado > chroma/preto)
  drawLiveBg(ctx, s, bgVideo);

  // ── barra do topo ──
  const topY = 90;
  drawAvatarCircle(ctx, 90, topY, 42, avatarImg);

  // chevron
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(500, topY - 8);
  ctx.lineTo(516, topY + 8);
  ctx.lineTo(532, topY - 8);
  ctx.stroke();

  // selo LIVE
  ctx.font = `800 30px ${fam}`;
  const liveW = 108;
  const liveH = 48;
  ctx.fillStyle = s.accent;
  rr(ctx, 600, topY - liveH / 2, liveW, liveH, 8);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText('LIVE', 600 + liveW / 2, topY + 11);

  // pílula de visualizações
  ctx.font = `600 28px ${fam}`;
  const vw = ctx.measureText(s.viewers).width + 70;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  rr(ctx, 724, topY - 30, vw, 60, 30);
  ctx.fill();
  iconEye(ctx, 724 + 30, topY);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.font = `600 28px ${fam}`;
  ctx.fillText(s.viewers, 724 + 56, topY + 10);

  // três pontinhos
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(940, topY - 16 + i * 16, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // fechar
  iconClose(ctx, 994, topY, 18);

  // ── trilho de ícones da direita ──
  const railX = W - 90;
  iconMic(ctx, railX, 270, 60);
  iconCamera(ctx, railX, 390, 60);
  iconFlip(ctx, railX, 510, 60);
  iconSparkle(ctx, railX, 630, 60);

  // ── reações + comentários ──
  drawReactions(ctx, anim, 'tiktok');
  drawComments(ctx, s, anim, fam, H - 210, `700 30px ${fam}`, '#ffffff');

  // ── barra de comentário ──
  const barY = H - 100;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  rr(ctx, 48, barY - 40, W * 0.56, 80, 40);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  rr(ctx, 48, barY - 40, W * 0.56, 80, 40);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `400 28px ${fam}`;
  ctx.textAlign = 'left';
  ctx.fillText('Adicionar comentário…', 80, barY + 10);

  iconPlus(ctx, W * 0.62, barY, 56);
  const bust = emojiImg('👤');
  if (bust) ctx.drawImage(bust, W * 0.71 - 24, barY - 28, 48, 48);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `700 34px ${fam}`;
  ctx.fillText('?', W * 0.8, barY + 12);
  iconSend(ctx, W * 0.9, barY, 56);
}

/* ─────────────────────────── Instagram ─────────────────────────── */

function drawInstagram(
  ctx: CanvasRenderingContext2D,
  s: LiveS,
  anim: Anim,
  fam: string,
  avatarImg: HTMLImageElement | null,
  bgVideo: HTMLVideoElement | null,
) {
  drawLiveBg(ctx, s, bgVideo);

  // ── barra do topo ──
  const topY = 96;

  // anel gradiente de story em volta do avatar
  const ring = ctx.createLinearGradient(40, topY + 52, 148, topY - 52);
  ring.addColorStop(0, '#f9ce34');
  ring.addColorStop(0.5, '#ee2a7b');
  ring.addColorStop(1, '#6228d7');
  ctx.strokeStyle = ring;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(94, topY, 51, 0, Math.PI * 2);
  ctx.stroke();
  drawAvatarCircle(ctx, 94, topY, 43, avatarImg);

  // usuário + selo verificado
  const userFont = `700 34px ${fam}`;
  const uw = drawRich(ctx, s.username, 168, topY + 12, userFont, '#ffffff');
  if (s.verified) badgeVerified(ctx, 168 + uw + 26, topY, 16);

  // fechar (canto direito)
  iconClose(ctx, 1006, topY, 18);

  // pílula de visualizações (encostada no X)
  ctx.font = `600 28px ${fam}`;
  const vw = ctx.measureText(s.viewers).width + 70;
  const vx = 962 - vw;
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  rr(ctx, vx, topY - 30, vw, 60, 30);
  ctx.fill();
  iconEye(ctx, vx + 30, topY);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.font = `600 28px ${fam}`;
  ctx.fillText(s.viewers, vx + 56, topY + 10);

  // selo AO VIVO
  ctx.font = `800 26px ${fam}`;
  const vivoW = ctx.measureText('AO VIVO').width + 36;
  const vivoX = vx - 14 - vivoW;
  ctx.fillStyle = s.accent;
  rr(ctx, vivoX, topY - 24, vivoW, 48, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText('AO VIVO', vivoX + vivoW / 2, topY + 9);

  // ── reações + comentários ──
  drawReactions(ctx, anim, 'ig');
  drawComments(ctx, s, anim, fam, H - 230, `600 30px ${fam}`, 'rgba(255,255,255,0.95)');

  // ── barra de comentário ──
  const barY = H - 100;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  rr(ctx, 48, barY - 42, 640, 84, 42);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2.5;
  rr(ctx, 48, barY - 42, 640, 84, 42);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `400 30px ${fam}`;
  ctx.textAlign = 'left';
  ctx.fillText('Comente...', 96, barY + 11);

  iconHeart(ctx, 760, barY, 62);
  iconPlane(ctx, 878, barY, 54);
  iconQuestion(ctx, 996, barY, 60, fam);
}

/* ─────────────────────────── Screen (React) ─────────────────────────── */

// A prévia é o próprio canvas 1080×1920 exibido a 360×640. O shell exporta o
// PNG via html2canvas, que copia o canvas pixel-a-pixel — prévia === download.
// O botão de vídeo (nos controles) alcança o canvas por este registro.
const liveCanvas: Partial<Record<LiveKind, HTMLCanvasElement | null>> = {};
// idem pro <video> de fundo (o export reinicia ele do zero antes de gravar)
const liveBgVideo: Partial<Record<LiveKind, HTMLVideoElement | null>> = {};

function LiveScreen({ s, kind }: { s: LiveS; kind: LiveKind }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const vidRef = useRef<HTMLVideoElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const sRef = useRef(s);
  sRef.current = s;
  const famRef = useRef<string>("'Inter', sans-serif");
  const avatarRef = useRef<{ url: string; img: HTMLImageElement | null }>({ url: '', img: null });

  // registro do vídeo de fundo (o export reinicia ele antes de gravar)
  useEffect(() => {
    liveBgVideo[kind] = s.bgVideo ? vidRef.current : null;
    return () => {
      if (liveBgVideo[kind] === vidRef.current) liveBgVideo[kind] = null;
    };
  }, [kind, s.bgVideo]);

  // avatar (data URL) → HTMLImageElement em cache
  useEffect(() => {
    if (!s.avatar) {
      avatarRef.current = { url: '', img: null };
      return;
    }
    const url = s.avatar;
    avatarRef.current = { url, img: null };
    const img = new Image();
    img.onload = () => {
      if (avatarRef.current.url === url) avatarRef.current.img = img;
    };
    img.src = url;
  }, [s.avatar]);

  // pré-carrega os emojis usados (comentários + reações + boneco do rodapé)
  useEffect(() => {
    prefetchEmojis(s.comments + REACTION_EMOJIS[kind].join('') + '👤');
  }, [s.comments, kind]);

  // resolve a fonte REAL da página (a Inter do next/font tem nome com hash e o
  // canvas não resolve var(--font-fp)) e garante os pesos carregados — o
  // fillText NÃO dispara download de fonte sozinho.
  useEffect(() => {
    const probe = probeRef.current;
    if (probe) {
      const fam = getComputedStyle(probe).fontFamily;
      if (fam) famRef.current = fam;
    }
    if (typeof document !== 'undefined' && document.fonts?.load) {
      ['400', '600', '700', '800'].forEach((w) => {
        document.fonts.load(`${w} 30px ${famRef.current}`).catch(() => {});
      });
    }
  }, []);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    liveCanvas[kind] = cv;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const anim: Anim = { t: 0, scroll: 0, reactions: [] };
    let raf = 0;
    const tick = () => {
      anim.t += 1;
      const bgv = sRef.current.bgVideo ? vidRef.current : null;
      if (kind === 'tiktok') drawTikTok(ctx, sRef.current, anim, famRef.current, avatarRef.current.img, bgv);
      else drawInstagram(ctx, sRef.current, anim, famRef.current, avatarRef.current.img, bgv);
    };
    // 1º frame SÍNCRONO: aba em segundo plano não dispara rAF — sem isso o
    // canvas ficaria em branco até a aba ganhar foco (e o PNG sairia vazio).
    tick();
    (cv as any).__fpTick = (n = 1) => {
      for (let i = 0; i < n; i++) tick();
    };
    const loop = () => {
      // __fpPause: o export RÁPIDO avança a animação na mão (frame a frame);
      // o rAF pausa pra não competir e não acelerar a cinemática.
      if (!(cv as any).__fpPause) tick();
      // carimbo pro export de vídeo saber se o rAF está VIVO (aba de fundo
      // suspende o rAF — aí o gravador avança a animação por conta própria)
      (cv as any).__fpLastRaf = performance.now();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      delete (cv as any).__fpTick;
      if (liveCanvas[kind] === cv) liveCanvas[kind] = null;
    };
  }, [kind]);

  return (
    <div style={{ position: 'relative', width: 360, height: 640 }}>
      <span ref={probeRef} aria-hidden style={{ fontFamily: FONT_STACK, position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} />
      {/* vídeo de fundo (oculto): decodifica os frames que o canvas desenha */}
      {s.bgVideo ? (
        <video
          ref={vidRef}
          src={s.bgVideo}
          muted
          loop
          autoPlay
          playsInline
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      ) : null}
      <canvas ref={cvRef} width={W} height={H} style={{ width: 360, height: 640, display: 'block' }} />
    </div>
  );
}

/* ──────────────────── Export de vídeo (.webm) ──────────────────── */

function VideoExportButton({ kind, seconds }: { kind: LiveKind; seconds: number }) {
  const [gravando, setGravando] = useState(false);
  const [msg, setMsg] = useState('');

  const baixa = (blob: Blob, ext: string) => {
    void import('@/lib/audio-engine').then(({ downloadBlob }) =>
      downloadBlob(blob, `fakepass-live-${kind === 'tiktok' ? 'tiktok' : 'instagram'}.${ext}`, {
        tool: 'fakepass',
      }),
    );
    setMsg('Vídeo baixado ✓');
    logHistory({
      tool: 'fakepass',
      kind: 'export',
      title: `Live ${kind === 'tiktok' ? 'TikTok' : 'Instagram'} — vídeo exportado`,
    });
  };

  const gravar = async () => {
    const cv = liveCanvas[kind];
    if (!cv || gravando) return;

    // vídeo de fundo: garante tocando (mudo) e DO COMEÇO — export pega o take inteiro
    const bgv = liveBgVideo[kind];
    if (bgv) {
      try {
        bgv.muted = true;
        bgv.currentTime = 0;
        await bgv.play().catch(() => {});
      } catch {}
    }

    // ── caminho RÁPIDO (WebCodecs): sem vídeo de fundo os frames são
    // determinísticos — codifica na velocidade máxima (30s saem em segundos)
    // em vez de esperar o relógio. Com vídeo de fundo, segue o tempo real.
    if (!bgv) {
      setGravando(true);
      setMsg('Renderizando o vídeo em alta velocidade…');
      try {
        const { encodeCanvasVideo } = await import('./video-export');
        (cv as any).__fpPause = true;
        const fast = await encodeCanvasVideo(cv, {
          seconds: Math.max(1, seconds),
          drawFrame: () => (cv as any).__fpTick?.(2),
        });
        (cv as any).__fpPause = false;
        if (fast) {
          baixa(fast.blob, fast.ext);
          setGravando(false);
          return;
        }
      } catch {
        (cv as any).__fpPause = false;
      }
      setGravando(false);
    }

    // ⚠ Mesma blindagem do video-export.ts: rAF morre com a aba em segundo
    // plano — captura MANUAL (captureStream(0) + requestFrame) com clock num
    // Worker, e a animação avança na mão quando o rAF do preview congela.
    let recorder: MediaRecorder;
    let track: any = null;
    let manualPush = false;
    try {
      let stream = cv.captureStream(0);
      track = stream.getVideoTracks()[0];
      manualPush = typeof track?.requestFrame === 'function';
      if (!manualPush) {
        track?.stop?.();
        stream = cv.captureStream(30);
        track = stream.getVideoTracks()[0];
      }
      let mime = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    } catch {
      setMsg('Este navegador não grava vídeo — o PNG continua disponível. No Chrome funciona.');
      return;
    }
    setGravando(true);
    setMsg(`Gravando ${seconds} segundos de animação…`);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      baixa(new Blob(chunks, { type: 'video/webm' }), 'webm');
      setGravando(false);
    };

    const t0 = performance.now();
    let worker: Worker | null = null;
    let fallbackId: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      try {
        worker?.terminate();
      } catch {}
      if (fallbackId) clearInterval(fallbackId);
      if (recorder.state !== 'inactive') recorder.stop();
    };
    const tickRec = () => {
      if (stopped) return;
      const now = performance.now();
      // rAF do preview parado (aba de fundo)? Avança 2 frames ≈ ritmo 60fps.
      if (now - ((cv as any).__fpLastRaf || 0) > 120) (cv as any).__fpTick?.(2);
      try {
        if (manualPush) track.requestFrame();
      } catch {}
      if ((now - t0) / 1000 >= Math.max(1, seconds)) finish();
    };
    try {
      const src = 'let id=0;onmessage=()=>{id=setInterval(()=>postMessage(0),33)}';
      const wurl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      worker = new Worker(wurl);
      URL.revokeObjectURL(wurl);
      worker.onmessage = tickRec;
      worker.postMessage('start');
    } catch {
      fallbackId = setInterval(tickRec, 33);
    }
    recorder.addEventListener('error', finish);
    recorder.start(1000);
    tickRec();
    // backstop: se algo travar o clock, encerra e entrega o que tiver
    setTimeout(finish, Math.max(1, seconds) * 1000 + 15_000);
  };

  return (
    <div>
      <button
        type="button"
        onClick={gravar}
        disabled={gravando}
        className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-white/15 px-5 py-3 text-[13.5px] font-bold text-white transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          fontFamily: 'var(--font-tech)',
          background: 'linear-gradient(180deg,#fb7185 0%,#e11d48 100%)',
          boxShadow: '0 8px 22px -8px rgba(244,63,94,0.65), inset 0 1px 0 rgba(255,255,255,0.3)',
        }}
      >
        {gravando ? (
          <>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
            Renderizando…
          </>
        ) : (
          <>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
              <path d="M15.5 10.5 21 7v10l-5.5-3.5" />
            </svg>
            Exportar vídeo
          </>
        )}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-dim">
        {msg ||
          'O vídeo sai animado (reações subindo + comentários rolando) — perfeito pra sobrepor no editor. Com o fundo verde ligado, é só aplicar chroma key.'}
      </p>
    </div>
  );
}

/* ─────────────────────────── Controles ─────────────────────────── */

const SWATCHES: Record<LiveKind, string[]> = {
  tiktok: ['#FE2C55', '#7C5CFF', '#E8B14B', '#38E1C6'],
  ig: ['#FF3040', '#C13584', '#7C5CFF', '#E8B14B'],
};

function LiveControls({
  kind,
  s,
  set,
}: {
  kind: LiveKind;
  s: LiveS;
  set: (p: Partial<LiveS>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {kind === 'ig' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Usuário">
            <TextField value={s.username} onChange={(v) => set({ username: v })} maxLength={28} placeholder="seu.perfil" />
          </Field>
          <Field label="Visualizações">
            <TextField value={s.viewers} onChange={(v) => set({ viewers: v })} maxLength={10} placeholder="1.024" />
          </Field>
        </div>
      ) : (
        <Field label="Visualizações">
          <TextField value={s.viewers} onChange={(v) => set({ viewers: v })} maxLength={10} placeholder="2266" />
        </Field>
      )}
      {kind === 'ig' ? (
        <Toggle on={s.verified} onChange={(v) => set({ verified: v })} label="Selo verificado" />
      ) : null}
      <Field label="Comentários" hint="Um por linha, no formato usuário: mensagem.">
        <TextArea value={s.comments} onChange={(v) => set({ comments: v })} rows={6} withEmoji placeholder={'usuário: mensagem'} />
      </Field>
      <Field label="Foto de perfil">
        <ImageUpload round value={s.avatar} onChange={(v) => set({ avatar: v })} label="foto" />
      </Field>
      <Field label={kind === 'tiktok' ? 'Cor do selo LIVE' : 'Cor do selo AO VIVO'}>
        <Swatches value={s.accent} colors={SWATCHES[kind]} onChange={(v) => set({ accent: v })} />
      </Field>
      <Field
        label="Vídeo de fundo (opcional)"
        hint="Aparece por baixo da live inteira — no PNG e no vídeo exportado. Com vídeo, o chroma é ignorado."
      >
        <VideoUpload value={s.bgVideo} onChange={(v) => set({ bgVideo: v })} label="vídeo" />
      </Field>
      {!s.bgVideo ? (
        <Toggle on={s.chroma} onChange={(v) => set({ chroma: v })} label="Fundo verde (chroma key)" />
      ) : null}
      <RangeField
        label="Duração do vídeo"
        value={s.segundos}
        min={3}
        max={30}
        onChange={(v) => set({ segundos: v })}
        display={(v) => v + 's'}
      />
      <VideoExportButton kind={kind} seconds={s.segundos} />
    </div>
  );
}

/* ─────────────────────────── Modelos ─────────────────────────── */

const TIKTOK_LIVE: FakeModel<LiveS> = {
  id: 'live-tiktok',
  label: 'Live do TikTok',
  category: 'live',
  hue: 'rgba(254,44,85,0.4)',
  stageW: 360,
  ratio: 16 / 9,
  exportW: 1080,
  usesPhone: false,
  defaultState: {
    username: '',
    verified: false,
    viewers: '2266',
    comments:
      'Mystic_Snaps: Whaaaat???\nVelvetOrbit: I wasn’t ready for that 🔥🔥🔥\nDrift Queen: This is Amazing !\nLo・Fi・Petals: What$$$^^???',
    avatar: '',
    accent: '#FE2C55',
    chroma: false,
    bgVideo: '',
    segundos: 6,
  },
  Controls: ({ s, set }) => <LiveControls kind="tiktok" s={s} set={set} />,
  Preview: ({ s }) => <LiveScreen s={s} kind="tiktok" />,
};

const IG_LIVE: FakeModel<LiveS> = {
  id: 'live-instagram',
  label: 'Live do Instagram',
  category: 'live',
  hue: 'rgba(238,42,123,0.4)',
  stageW: 360,
  ratio: 16 / 9,
  exportW: 1080,
  usesPhone: false,
  defaultState: {
    username: 'ana.oliveira',
    verified: true,
    viewers: '1.024',
    comments:
      'Ana Clara: adorei esse look 😍\nJuliana: manda salve pro RJ 🙌\nCarlos Eduardo: melhor live 🔥🔥\nBia: comprei ontem e amei ❤️',
    avatar: '',
    accent: '#FF3040',
    chroma: false,
    bgVideo: '',
    segundos: 6,
  },
  Controls: ({ s, set }) => <LiveControls kind="ig" s={s} set={set} />,
  Preview: ({ s }) => <LiveScreen s={s} kind="ig" />,
};

export default [TIKTOK_LIVE, IG_LIVE];
