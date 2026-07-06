'use client';

/**
 * FakePass — modelo WhatsApp (tela de conversa) — REFORMA FIDELIDADE 2024.
 *
 * A versão antiga tinha HEADER VERDE, que está ERRADO. O WhatsApp de 2024:
 *  • ESCURO:  header #1f2c34 / texto #e9edef; fundo do chat #0b141a.
 *  • CLARO:   header #f0f2f5 / texto #111b21; fundo do chat #efeae2 (bege).
 *
 * Fundo do chat com PADRÃO DE DOODLES (data-uri SVG sutil, opacity ~0.05).
 * StatusBar herda a cor do header (tone light no escuro, dark no claro).
 * Balões enviados/recebidos com hora, checks azuis de visto, balões de ÁUDIO
 * (waveform + play + tempo + microfone) e rodapé de input realista.
 */

import { useState, useEffect } from 'react';
import {
  StatusBar,
  Field,
  TextField,
  TextArea,
  Toggle,
  ImageUpload,
  Emo,
  FONT_STACK,
  type FakeModel,
  type StatusCfg,
} from './shared';

type S = {
  nome: string;
  status: string;
  conversa: string;
  dark: boolean;
  avatar: string;
  hora: string;
};

type Msg =
  | { kind: 'text'; t: string; me: boolean }
  | { kind: 'audio'; dur: string; me: boolean };

const AUDIO_RE = /^audio\s+(\d+:\d{2})/i;

function parseMsgs(txt: string): Msg[] {
  return txt
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .map((raw) => {
      const me = raw.startsWith('> ');
      const body = me ? raw.slice(2) : raw;
      const a = body.match(AUDIO_RE);
      if (a) return { kind: 'audio', dur: a[1], me } as Msg;
      return { kind: 'text', t: body, me } as Msg;
    });
}

/* ─────────────────────── Fundo (doodle pattern) ─────────────────────── */
// Padrão de rabiscos do WhatsApp. IMPORTANTE: o html2canvas (export) NÃO honra
// `background-size` em data-uri SVG — ele rasteriza o SVG no tamanho intrínseco
// e o padrão sai em escala errada (bug de "download bugado"). Solução: assar o
// SVG num <canvas> pra PNG data-uri (raster) — aí o html2canvas respeita
// background-size/repeat direitinho, e o download fica igual à prévia.
function doodleSvgMarkup(dark: boolean): string {
  const stroke = dark ? '#8696a0' : '#54656f';
  // Padrão de rabiscos estilo WhatsApp (recriação própria) — DENSO, pequeno e
  // SUTIL (como o fundo real do WhatsApp): ~30 ícones num tile de 300, opacidade
  // baixa (0.13). viewBox 300 = coords de design; o bake sai a 200px (ver RES em
  // useDoodlePng), então o tamanho intrínseco bate com background-size:200px e o
  // html2canvas (que ignora background-size e usa o intrínseco) tila IGUAL à
  // prévia — download = preview. Ícones espalhados em grade escalonada pra o
  // repeat não deixar "buracos" visíveis.
  const icons = [
    // linha 1
    `<path d='M22 20c-2.5-4-9-2.5-9 2 0 4.2 9 9.5 9 9.5s9-5.3 9-9.5c0-4.5-6.5-6-9-2z'/>`, // coração
    `<circle cx='68' cy='22' r='9'/><path d='M63 25a4 4 0 0 0 10 0'/><circle cx='65' cy='19' r='.9'/><circle cx='71' cy='19' r='.9'/>`, // carinha
    `<path d='M108 15h4l2-3h8l2 3h4a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-20a3 3 0 0 1-3-3V18a3 3 0 0 1 3-3z'/><circle cx='120' cy='24' r='5'/>`, // câmera
    `<path d='M156 12h20a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-12l-6 5v-5h-2a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z'/>`, // balão de fala
    `<path d='M206 30V13l11-2.5v14'/><circle cx='203' cy='30' r='3.4'/><circle cx='214' cy='24.5' r='3.4'/>`, // nota musical
    `<circle cx='258' cy='21' r='7.5'/><path d='M258 8v-4M258 42v-4M245 21h-4M279 21h-4M249 12l-3-3M270 33l-3-3M249 30l-3 3M270 12l-3 3'/>`, // sol
    // linha 2
    `<path d='M20 62l2 5 5.5.4-4.2 3.6 1.3 5.4-4.6-3-4.6 3 1.3-5.4-4.2-3.6 5.5-.4z'/>`, // estrela
    `<rect x='58' y='58' width='22' height='16' rx='2'/><path d='M58 64h22M69 58v16'/><path d='M69 58c-4-5-10-1-5 3M69 58c4-5 10-1 5 3'/>`, // presente
    `<path d='M104 74h18v9a9 9 0 0 1-18 0z'/><path d='M122 76h3a3.5 3.5 0 0 1 0 8h-3'/><path d='M108 68c0-2.5 2.5-2.5 2.5-5M116 68c0-2.5 2.5-2.5 2.5-5'/>`, // xícara de café
    `<path d='M150 78a6 6 0 0 1 0-11 8 8 0 0 1 15-2 5 5 0 0 1 1 13z'/>`, // nuvem
    `<circle cx='205' cy='68' r='8'/><path d='M200 71a4 4 0 0 0 10 0'/><circle cx='202' cy='65' r='.9'/><circle cx='208' cy='65' r='.9'/>`, // carinha 2
    `<path d='M250 58l3 7 8 .5-6 4.6 2 8-7-4.6-7 4.6 2-8-6-4.6 8-.5z'/>`, // estrela 2
    // linha 3
    `<circle cx='24' cy='112' r='11'/><circle cx='20' cy='109' r='1.1'/><circle cx='28' cy='109' r='1.1'/><path d='M19 115a7 7 0 0 0 10 0'/>`, // carinha grande
    `<path d='M60 100h20a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H68l-6 5v-5a4 4 0 0 1-4-4v-10a4 4 0 0 1 4-4z' transform='translate(0,0)'/>`, // chat
    `<path d='M104 118V101l11-2.5v14'/><circle cx='101' cy='118' r='3.4'/><circle cx='112' cy='112.5' r='3.4'/>`, // nota
    `<rect x='148' y='100' width='15' height='24' rx='3'/><path d='M153 120h5'/>`, // celular
    `<path d='M206 102c-2.5-4-9-2.5-9 2 0 4.2 9 9.5 9 9.5s9-5.3 9-9.5c0-4.5-6.5-6-9-2z'/>`, // coração 2
    `<path d='M252 122a6 6 0 0 1 0-11 8 8 0 0 1 15-2 5 5 0 0 1 1 13z'/>`, // nuvem 2
    // linha 4
    `<circle cx='22' cy='160' r='7.5'/><path d='M22 147v-4M22 181v-4M9 160H5M43 160h-4M13 151l-3-3M34 173l-3-3M13 169l-3 3M34 151l-3 3'/>`, // sol 2
    `<path d='M62 168l3 7 8 .5-6 4.6 2 8-7-4.6-7 4.6 2-8-6-4.6 8-.5z'/>`, // estrela 3
    `<path d='M104 150h18v9a9 9 0 0 1-18 0z'/><path d='M122 152h3a3.5 3.5 0 0 1 0 8h-3'/>`, // café 2
    `<rect x='148' y='148' width='22' height='16' rx='2'/><path d='M148 154h22M159 148v16'/>`, // presente 2
    `<circle cx='208' cy='160' r='9'/><path d='M203 163a4 4 0 0 0 10 0'/><circle cx='205' cy='157' r='.9'/><circle cx='211' cy='157' r='.9'/>`, // carinha 3
    `<path d='M250 150c-2.5-4-9-2.5-9 2 0 4.2 9 9.5 9 9.5s9-5.3 9-9.5c0-4.5-6.5-6-9-2z'/>`, // coração 3
    // linha 5
    `<path d='M20 200l2 5 5.5.4-4.2 3.6 1.3 5.4-4.6-3-4.6 3 1.3-5.4-4.2-3.6 5.5-.4z'/>`, // estrela 4
    `<path d='M60 195h20a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H68l-6 5v-5a4 4 0 0 1-4-4v-10a4 4 0 0 1 4-4z'/>`, // chat 2
    `<path d='M108 190h4l2-3h8l2 3h4a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-20a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3z'/><circle cx='120' cy='199' r='5'/>`, // câmera 2
    `<path d='M156 208a6 6 0 0 1 0-11 8 8 0 0 1 15-2 5 5 0 0 1 1 13z'/>`, // nuvem 3
    `<path d='M206 205V188l11-2.5v14'/><circle cx='203' cy='205' r='3.4'/><circle cx='214' cy='199.5' r='3.4'/>`, // nota 2
    `<circle cx='258' cy='198' r='7.5'/><path d='M258 185v-4M258 219v-4M245 198h-4M279 198h-4'/>`, // sol 3
    // linha 6
    `<circle cx='26' cy='250' r='9'/><path d='M21 253a4 4 0 0 0 10 0'/><circle cx='23' cy='247' r='.9'/><circle cx='29' cy='247' r='.9'/>`, // carinha 4
    `<path d='M64 240l3 7 8 .5-6 4.6 2 8-7-4.6-7 4.6 2-8-6-4.6 8-.5z'/>`, // estrela 5
    `<path d='M104 240h18v9a9 9 0 0 1-18 0z'/><path d='M122 242h3a3.5 3.5 0 0 1 0 8h-3'/>`, // café 3
    `<path d='M152 242c-2.5-4-9-2.5-9 2 0 4.2 9 9.5 9 9.5s9-5.3 9-9.5c0-4.5-6.5-6-9-2z'/>`, // coração 4
    `<rect x='200' y='240' width='22' height='16' rx='2'/><path d='M200 246h22M211 240v16'/>`, // presente 3
    `<path d='M252 250a6 6 0 0 1 0-11 8 8 0 0 1 15-2 5 5 0 0 1 1 13z'/>`, // nuvem 4
    // linha 7 (base, pra fechar o repeat)
    `<path d='M22 285l2 5 5.5.4-4.2 3.6 1.3 5.4-4.6-3-4.6 3 1.3-5.4-4.2-3.6 5.5-.4z'/>`, // estrela 6
    `<circle cx='70' cy='288' r='8'/><path d='M65 291a4 4 0 0 0 10 0'/><circle cx='67' cy='285' r='.9'/><circle cx='73' cy='285' r='.9'/>`, // carinha 5
    `<path d='M108 280h4l2-3h8l2 3h4a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-20a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3z'/><circle cx='120' cy='289' r='5'/>`, // câmera 3
    `<path d='M156 296a6 6 0 0 1 0-11 8 8 0 0 1 15-2 5 5 0 0 1 1 13z'/>`, // nuvem 5
    `<path d='M206 282c-2.5-4-9-2.5-9 2 0 4.2 9 9.5 9 9.5s9-5.3 9-9.5c0-4.5-6.5-6-9-2z'/>`, // coração 5
    `<path d='M250 280l3 7 8 .5-6 4.6 2 8-7-4.6-7 4.6 2-8-6-4.6 8-.5z'/>`, // estrela 7
  ];
  return `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300' viewBox='0 0 300 300'>
    <g fill='none' stroke='${stroke}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' opacity='0.13'>
      ${icons.join('')}
    </g>
  </svg>`;
}

// Assa o doodle num PNG data-uri já TILADO na ÁREA INTEIRA do chat (320×920) e a
// tela usa esse PNG como <img> (não como background-size).
//
// POR QUÊ: o html2canvas NÃO escala `background-size` direito no export (com o
// zoom/scale do download o padrão saía GRANDE e espaçado, diferente da prévia).
// Já um <img> ele desenha FIEL, escalando a imagem inteira pelo scale do export.
// Então pré-tilamos o padrão (tile de 280px) numa imagem grande e mandamos como
// <img width:100%> — aí prévia e download ficam IDÊNTICOS. Devolve '' enquanto
// não pronto; o baking roda no mount, pronto antes do clique.
function useDoodlePng(dark: boolean): string {
  const [png, setPng] = useState('');
  useEffect(() => {
    let alive = true;
    setPng('');
    const TILE = 280; // densidade do padrão (tamanho do tile)
    const W = 320; // largura da área de chat
    const H = 920; // altura generosa — cobre qualquer conversa; sobra é clipada
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      try {
        // 1) tile do doodle num canvas TILE×TILE
        const tc = document.createElement('canvas');
        tc.width = TILE;
        tc.height = TILE;
        const tctx = tc.getContext('2d');
        if (!tctx) return;
        tctx.drawImage(img, 0, 0, TILE, TILE);
        // 2) tila esse tile numa imagem GRANDE (a área toda do chat)
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const pat = ctx.createPattern(tc, 'repeat');
        if (pat) {
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, W, H);
        }
        setPng(c.toDataURL('image/png'));
      } catch {
        /* se falhar, fica sem doodle (fundo sólido) — nunca quebra o export */
      }
    };
    img.src = 'data:image/svg+xml,' + encodeURIComponent(doodleSvgMarkup(dark));
    return () => {
      alive = false;
    };
  }, [dark]);
  return png;
}

/* ─────────────────────────── Ícones ─────────────────────────── */

function ChevronBack({ color }: { color: string }) {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" fill="none" aria-hidden>
      <path
        d="M10 2L2 10l8 8"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VideoIcon({ color }: { color: string }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 15 6.5v11A2.5 2.5 0 0 1 12.5 20h-6A2.5 2.5 0 0 1 4 17.5v-11Zm13 3.1 3.4-2.3c.5-.35 1.2 0 1.2.62v10.16c0 .62-.7.97-1.2.62L17 16.4V9.6Z" />
    </svg>
  );
}

function PhoneIcon({ color }: { color: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M6.6 10.8a15.6 15.6 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.4.6 3.6.6.6 0 1 .5 1 1V20c0 .6-.4 1-1 1C10.9 21 3 13.1 3 3.4c0-.5.5-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.2 2.2Z" />
    </svg>
  );
}

function DotsIcon({ color }: { color: string }) {
  return (
    <svg width="5" height="20" viewBox="0 0 5 20" fill={color} aria-hidden>
      <circle cx="2.5" cy="3" r="2.1" />
      <circle cx="2.5" cy="10" r="2.1" />
      <circle cx="2.5" cy="17" r="2.1" />
    </svg>
  );
}

function DoubleCheck() {
  // dois checks azuis (visto)
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden style={{ display: 'block' }}>
      <path d="M1 5.7 3.7 8.4 9 2.6" stroke="#53bdeb" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.3 5.7 9 8.4 14.3 2.6" stroke="#53bdeb" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmojiIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" />
      <circle cx="9" cy="10" r="1.15" fill={color} />
      <circle cx="15" cy="10" r="1.15" fill={color} />
      <path d="M8.3 14.2a4.6 4.6 0 0 0 7.4 0" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ClipIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16.5 6.5 8.9 14.1a2.3 2.3 0 0 0 3.3 3.3l7.2-7.2a4 4 0 0 0-5.7-5.7l-7.3 7.3a5.7 5.7 0 0 0 8 8l6.4-6.3"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraIcon({ color }: { color: string }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8.5A2 2 0 0 1 6 6.5h1.6l.9-1.6c.2-.3.5-.5.9-.5h3.2c.4 0 .7.2.9.5l.9 1.6H18a2 2 0 0 1 2 2v8A2 2 0 0 1 18 18.5H6A2 2 0 0 1 4 16.5v-8Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.2" r="3.1" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6" stroke="#ffffff" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function PlayTriangle({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill={color} aria-hidden>
      <path d="M2.5 1.4 10 6l-7.5 4.6z" />
    </svg>
  );
}

function AudioMicSmall({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={color} aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────────────────────── Avatar ─────────────────────────── */

function Avatar({ src, size, nome }: { src: string; size: number; nome: string }) {
  const inicial = (nome.trim()[0] || '?').toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
        background: '#6a7d8a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ color: '#fff', fontSize: size * 0.42, fontWeight: 500 }}>{inicial}</span>
      )}
    </div>
  );
}

/* ─────────────────────────── Rabinho do balão ─────────────────────────── */
// Rabinho (tail) do WhatsApp na PRIMEIRA bolha de cada sequência: canto superior
// esquerdo no recebido, direito no enviado. SVG inline (renderiza no export).
function Tail({ me, color }: { me: boolean; color: string }) {
  return (
    <svg
      width="8"
      height="13"
      viewBox="0 0 8 13"
      aria-hidden
      style={{ position: 'absolute', top: 0, [me ? 'right' : 'left']: -6, display: 'block' }}
    >
      {me ? (
        <path d="M0 0 L0 12 L8 0 Z" fill={color} />
      ) : (
        <path d="M8 0 L8 12 L0 0 Z" fill={color} />
      )}
    </svg>
  );
}

/* ─────────────────────────── Waveform (áudio) ─────────────────────────── */

const WAVE_HEIGHTS = [
  5, 8, 4, 11, 7, 14, 9, 6, 12, 16, 10, 7, 5, 13, 9, 15, 8, 6, 11, 7, 4, 10, 13, 6, 9, 5,
];

function Waveform({ played, dim }: { played: string; dim: string }) {
  // played = cor das barras já ouvidas (progresso); dim = cor das restantes.
  const total = WAVE_HEIGHTS.length;
  const progressUpto = Math.round(total * 0.32); // ~1/3 ouvido
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 20, flex: 1, minWidth: 0 }}>
      {WAVE_HEIGHTS.map((h, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            height: h,
            borderRadius: 2,
            background: i < progressUpto ? played : dim,
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────── Balão de áudio ─────────────────────────── */

function AudioBubble({ m, hora, dark, tail }: { m: Extract<Msg, { kind: 'audio' }>; hora: string; dark: boolean; tail: boolean }) {
  const bg = m.me ? (dark ? '#005c4b' : '#d9fdd3') : dark ? '#202c33' : '#ffffff';
  const metaColor = dark ? '#8696a0' : '#667781';
  const waveDim = dark ? '#54656f' : '#c9d0d3';
  const wavePlayed = dark ? '#e9edef' : '#8696a0';
  const playColor = dark ? '#8696a0' : '#8696a0';
  // microfone azul no recebido, verde no enviado
  const micColor = m.me ? '#25d366' : '#53bdeb';

  return (
    <div style={{ display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start', marginTop: tail ? 4 : 0 }}>
      <div
        style={{
          position: 'relative',
          maxWidth: '78%',
          background: bg,
          borderRadius: 7.5,
          borderTopLeftRadius: tail && !m.me ? 0 : 7.5,
          borderTopRightRadius: tail && m.me ? 0 : 7.5,
          padding: '8px 10px 8px 8px',
          boxShadow: dark ? '0 1px 0.5px rgba(0,0,0,0.28)' : '0 1px 0.5px rgba(0,0,0,0.13)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: 200,
        }}
      >
        {tail ? <Tail me={m.me} color={bg} /> : null}
        {/* botão play */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <PlayTriangle color={playColor} />
        </div>
        {/* waveform + tempo */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Waveform played={wavePlayed} dim={waveDim} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 1 }}>
            <span style={{ fontSize: 11, color: metaColor, lineHeight: 1 }}>{m.dur}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: metaColor, lineHeight: 1 }}>{hora}</span>
              {m.me ? <DoubleCheck /> : null}
            </span>
          </div>
        </div>
        {/* microfone */}
        <div style={{ flexShrink: 0, alignSelf: 'flex-start' }}>
          <AudioMicSmall color={micColor} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Balão de texto ─────────────────────────── */

function TextBubble({
  m,
  hora,
  dark,
  emojiSet,
  tail,
}: {
  m: Extract<Msg, { kind: 'text' }>;
  hora: string;
  dark: boolean;
  emojiSet: 'apple' | 'google';
  tail: boolean;
}) {
  const bg = m.me ? (dark ? '#005c4b' : '#d9fdd3') : dark ? '#202c33' : '#ffffff';
  const color = dark ? '#e9edef' : '#111b21';
  const metaColor = dark ? '#8696a0' : '#667781';
  return (
    <div style={{ display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start', marginTop: tail ? 4 : 0 }}>
      <div
        style={{
          position: 'relative',
          maxWidth: '78%',
          background: bg,
          color,
          borderRadius: 7.5,
          borderTopLeftRadius: tail && !m.me ? 0 : 7.5,
          borderTopRightRadius: tail && m.me ? 0 : 7.5,
          padding: '6px 9px 8px',
          fontSize: 14.2,
          lineHeight: 1.32,
          boxShadow: dark ? '0 1px 0.5px rgba(0,0,0,0.28)' : '0 1px 0.5px rgba(0,0,0,0.13)',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {tail ? <Tail me={m.me} color={bg} /> : null}
        <span>
          <Emo t={m.t} set={emojiSet} />
        </span>
        <span
          style={{
            float: 'right',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            marginLeft: 8,
            marginTop: 4,
            fontSize: 11,
            color: metaColor,
            lineHeight: 1,
            position: 'relative',
            top: 3,
          }}
        >
          {hora}
          {m.me ? <DoubleCheck /> : null}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Tela ─────────────────────────── */

function Screen({ s, status }: { s: S; status: StatusCfg }) {
  const W = 320;
  const H = Math.round(W * 2.02);
  const dark = s.dark;

  const headerBg = dark ? '#1f2c34' : '#f0f2f5';
  const headerText = dark ? '#e9edef' : '#111b21';
  const headerSub = dark ? '#8696a0' : '#667781';
  const headerIcon = dark ? '#e9edef' : '#54656f';
  const chatBg = dark ? '#0b141a' : '#efeae2';
  const footerBg = dark ? '#1f2c34' : '#f0f2f5';
  const inputBg = dark ? '#2a3942' : '#ffffff';
  const inputText = dark ? '#8696a0' : '#8a8a8a';
  const inputIcon = dark ? '#8696a0' : '#54656f';
  const unreadColor = dark ? '#e9edef' : '#54656f';

  const emojiSet = status.os === 'android' ? 'google' : 'apple';
  const msgs = parseMsgs(s.conversa);
  const doodlePng = useDoodlePng(dark);

  return (
    <div
      style={{
        width: W,
        height: H,
        overflow: 'hidden',
        fontFamily: FONT_STACK,
        display: 'flex',
        flexDirection: 'column',
        WebkitFontSmoothing: 'antialiased',
        background: chatBg,
      }}
    >
      {/* StatusBar sobre o header — light no escuro, dark no claro */}
      <div style={{ background: headerBg, flexShrink: 0 }}>
        <StatusBar cfg={status} tone={dark ? 'light' : 'dark'} />
      </div>

      {/* HEADER */}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          background: headerBg,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px 0 6px',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ChevronBack color={headerIcon} />
          <span style={{ fontSize: 13, fontWeight: 500, color: unreadColor, marginRight: 3 }}>8</span>
        </div>
        <Avatar src={s.avatar} size={38} nome={s.nome} />
        {/* bloco do nome: SEM flex-coluna (o html2canvas erra justifyContent
            center e corta o "online"); a própria linha (alignItems center) já
            centraliza verticalmente. */}
        <div style={{ flex: 1, minWidth: 0, marginLeft: 9 }}>
          <div
            style={{
              fontSize: 16.5,
              fontWeight: 600,
              color: headerText,
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {s.nome}
          </div>
          {s.status.trim() !== '' ? (
            <div
              style={{
                fontSize: 12.5,
                color: headerSub,
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.status}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <VideoIcon color={headerIcon} />
          <PhoneIcon color={headerIcon} />
          <DotsIcon color={headerIcon} />
        </div>
      </div>

      {/* MENSAGENS — fundo bege/escuro + doodle como <img> (não background-size,
          que o html2canvas escala errado no export). O <img> fica ATRÁS (zIndex 0)
          e as mensagens num wrapper na frente (zIndex 1). */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: chatBg,
        }}
      >
        {doodlePng ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doodlePng}
            alt=""
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: 'auto',
              zIndex: 0,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : null}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: 3,
            padding: 10,
          }}
        >
          {msgs.map((m, i) => {
            const tail = i === 0 || msgs[i - 1].me !== m.me;
            return m.kind === 'audio' ? (
              <AudioBubble key={i} m={m} hora={s.hora} dark={dark} tail={tail} />
            ) : (
              <TextBubble key={i} m={m} hora={s.hora} dark={dark} emojiSet={emojiSet} tail={tail} />
            );
          })}
        </div>
      </div>

      {/* RODAPÉ */}
      <div
        style={{
          flexShrink: 0,
          background: footerBg,
          padding: '6px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: inputBg,
            borderRadius: 22,
            padding: '8px 12px',
            minHeight: 40,
            boxSizing: 'border-box',
          }}
        >
          <EmojiIcon color={inputIcon} />
          <span style={{ flex: 1, fontSize: 15, color: inputText }}>Mensagem</span>
          <ClipIcon color={inputIcon} />
          <CameraIcon color={inputIcon} />
        </div>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#00a884',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <MicIcon />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const MODEL: FakeModel<S> = {
  id: 'whatsapp',
  label: 'WhatsApp',
  category: 'chat',
  hue: 'rgba(37,211,102,0.4)',
  stageW: 320,
  ratio: 2.02,
  exportW: 1080,
  usesPhone: true,
  defaultState: {
    nome: 'Ana',
    status: 'online',
    conversa:
      'Oi, viu minha mensagem? 👀\nPreciso muito da sua resposta\n> Oi! Vi sim, tava sem sinal 😅\n> audio 0:07\nAh entendi! Fica tranquila então ❤️\n> Já te respondo tudo direitinho',
    dark: false,
    avatar: '',
    hora: '09:41',
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Nome">
        <TextField value={s.nome} onChange={(v) => set({ nome: v })} placeholder="Nome do contato" maxLength={40} />
      </Field>
      <Field label="Status" hint="Ex.: online, digitando…, visto por último hoje às 14:20">
        <TextField value={s.status} onChange={(v) => set({ status: v })} placeholder="online" maxLength={60} />
      </Field>
      <Field label="Foto do contato">
        <ImageUpload value={s.avatar} onChange={(v) => set({ avatar: v })} label="foto" round />
      </Field>
      <Field label="Hora">
        <TextField value={s.hora} onChange={(v) => set({ hora: v })} placeholder="09:41" maxLength={8} />
      </Field>
      <Field
        label="Conversa"
        hint='Uma linha por mensagem. > no início = sua. Escreva "audio 0:07" pra áudio.'
      >
        <TextArea value={s.conversa} onChange={(v) => set({ conversa: v })} rows={7} />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
    </div>
  ),
  Preview: ({ s, status }) => <Screen s={s} status={status} />,
};

export default [MODEL];
