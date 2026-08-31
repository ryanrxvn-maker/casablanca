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
  Toggle,
  ImageUpload,
  Emo,
  FONT_STACK,
  type FakeModel,
  type StatusCfg,
} from './shared';
import { ChatBuilder, toMsgs, newMsg, type ChatMsg } from './builder';

type S = {
  nome: string;
  status: string;
  /** ChatMsg[] (construtor visual). String antiga ainda é aceita — ver toMsgs. */
  conversa: ChatMsg[] | string;
  dark: boolean;
  avatar: string;
  hora: string;
};

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

function DoubleCheck({ color = '#53bdeb' }: { color?: string }) {
  // dois checks azuis (visto) — brancos quando ficam POR CIMA de uma mídia
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden style={{ display: 'block' }}>
      <path d="M1 5.7 3.7 8.4 9 2.6" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.3 5.7 9 8.4 14.3 2.6" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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

function AudioBubble({ m, hora, dark, tail }: { m: ChatMsg; hora: string; dark: boolean; tail: boolean }) {
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

/**
 * Hora + checks do balão.
 *
 * ⚠ ANTES era `float: right` dentro do texto — e o html2canvas NÃO reproduz
 * float: no download a hora caía numa linha própria e empurrava o fim do texto
 * (o emoji ❤️ "quebrava" pra baixo). Agora é o mesmo truque do WhatsApp Web:
 * um ESPAÇADOR inline reserva o buraco na ÚLTIMA linha e a hora vai ABSOLUTA no
 * canto — posição absoluta o html2canvas desenha exata, então download = prévia.
 */
function metaWidth(hora: string, me: boolean) {
  return Math.round(hora.length * 5.9) + (me ? 19 : 0) + 10;
}

function MetaSpacer({ hora, me }: { hora: string; me: boolean }) {
  return <span aria-hidden style={{ display: 'inline-block', width: metaWidth(hora, me), height: 1 }} />;
}

function MetaStamp({
  hora,
  me,
  color,
  checkColor,
  onMedia,
}: {
  hora: string;
  me: boolean;
  color: string;
  checkColor?: string;
  onMedia?: boolean;
}) {
  return (
    <span
      style={{
        position: 'absolute',
        right: onMedia ? 8 : 9,
        bottom: onMedia ? 8 : 5,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11,
        lineHeight: 1,
        color,
        ...(onMedia
          ? { background: 'rgba(0,0,0,0.4)', borderRadius: 9, padding: '3px 6px' }
          : null),
      }}
    >
      {hora}
      {me ? <DoubleCheck color={checkColor} /> : null}
    </span>
  );
}

function TextBubble({
  m,
  hora,
  dark,
  emojiSet,
  tail,
}: {
  m: ChatMsg;
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
          // 85% (era 78%): no balão estreito uma frase curta com emoji no fim
          // já estourava e o emoji caía sozinho na 2ª linha — no WhatsApp real
          // ela cabe inteira e só a HORA desce. Com 85% quem desce é o
          // espaçador da hora, que é o comportamento certo.
          maxWidth: '85%',
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
          <Emo t={m.text} set={emojiSet} />
        </span>
        <MetaSpacer hora={hora} me={m.me} />
        <MetaStamp hora={hora} me={m.me} color={metaColor} />
      </div>
    </div>
  );
}

/* ─────────────────────── Balão de mídia (imagem/vídeo) ─────────────────────── */

/** Placeholder quando ainda não subiram a imagem (mantém o layout do print). */
function MediaEmpty({ dark, video }: { dark: boolean; video: boolean }) {
  return (
    <div
      style={{
        width: 210,
        height: 158,
        borderRadius: 6,
        background: dark ? '#0e1a20' : '#e3e6e5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: dark ? '#54656f' : '#a9b3b6',
      }}
    >
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {video ? (
          <>
            <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
            <path d="M15.5 10.5 21 7v10l-5.5-3.5" />
          </>
        ) : (
          <>
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <circle cx="8.5" cy="9.5" r="1.6" />
            <path d="M4 17l4.5-4.2a1.5 1.5 0 0 1 2 0L15 16l1.7-1.5a1.5 1.5 0 0 1 2 0L20 16" />
          </>
        )}
      </svg>
    </div>
  );
}

/**
 * Foto ou VÍDEO na conversa. O vídeo é a MESMA foto (a thumb do print) com o
 * play redondo no centro e o selo de duração no topo — igual ao WhatsApp, e
 * imune ao export porque é tudo <img> + caixas absolutas (nada de <video>).
 */
function MediaBubble({
  m,
  hora,
  dark,
  emojiSet,
  tail,
}: {
  m: ChatMsg;
  hora: string;
  dark: boolean;
  emojiSet: 'apple' | 'google';
  tail: boolean;
}) {
  const bg = m.me ? (dark ? '#005c4b' : '#d9fdd3') : dark ? '#202c33' : '#ffffff';
  const color = dark ? '#e9edef' : '#111b21';
  const metaColor = dark ? '#8696a0' : '#667781';
  const video = m.kind === 'video';
  const legenda = m.text.trim() !== '';
  return (
    <div style={{ display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start', marginTop: tail ? 4 : 0 }}>
      <div
        style={{
          position: 'relative',
          background: bg,
          borderRadius: 7.5,
          borderTopLeftRadius: tail && !m.me ? 0 : 7.5,
          borderTopRightRadius: tail && m.me ? 0 : 7.5,
          padding: 3,
          boxShadow: dark ? '0 1px 0.5px rgba(0,0,0,0.28)' : '0 1px 0.5px rgba(0,0,0,0.13)',
        }}
      >
        {tail ? <Tail me={m.me} color={bg} /> : null}
        {/* mídia */}
        <div style={{ position: 'relative', display: 'flex', borderRadius: 6, overflow: 'hidden' }}>
          {m.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.src}
              alt=""
              style={{ display: 'block', width: 210, height: 'auto', maxHeight: 260, objectFit: 'cover' }}
            />
          ) : (
            <MediaEmpty dark={dark} video={video} />
          )}
          {video ? (
            <>
              {/* play central */}
              <span
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  marginLeft: -21,
                  marginTop: -21,
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.45)',
                  border: '1.5px solid rgba(255,255,255,0.9)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="#ffffff" aria-hidden style={{ display: 'block', marginLeft: 3 }}>
                  <path d="M3 1.5 13 8 3 14.5z" />
                </svg>
              </span>
              {/* selo de duração */}
              <span
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'rgba(0,0,0,0.4)',
                  borderRadius: 9,
                  padding: '3px 7px',
                  fontSize: 11,
                  lineHeight: 1,
                  color: '#ffffff',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#ffffff" aria-hidden style={{ display: 'block' }}>
                  <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h6A2.5 2.5 0 0 1 15 7.5v9A2.5 2.5 0 0 1 12.5 19h-6A2.5 2.5 0 0 1 4 16.5v-9Zm13 2.6 3.3-2.2c.4-.3 1 0 1 .5v7.2c0 .5-.6.8-1 .5L17 13.9v-3.8Z" />
                </svg>
                {m.dur}
              </span>
            </>
          ) : null}
          {/* sem legenda: hora POR CIMA da mídia (pílula escura, igual ao app) */}
          {!legenda ? (
            <MetaStamp hora={hora} me={m.me} color="#ffffff" checkColor="#ffffff" onMedia />
          ) : null}
        </div>
        {/* legenda: vira um bloco de texto embaixo, com a hora no canto */}
        {legenda ? (
          <div
            style={{
              position: 'relative',
              maxWidth: 210,
              padding: '5px 6px 6px',
              color,
              fontSize: 14.2,
              lineHeight: 1.32,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}
          >
            <span>
              <Emo t={m.text} set={emojiSet} />
            </span>
            <MetaSpacer hora={hora} me={m.me} />
            <span
              style={{
                position: 'absolute',
                right: 6,
                bottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 11,
                lineHeight: 1,
                color: metaColor,
              }}
            >
              {hora}
              {m.me ? <DoubleCheck /> : null}
            </span>
          </div>
        ) : null}
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
  const msgs = toMsgs(s.conversa);
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
            if (m.kind === 'audio') return <AudioBubble key={m.id || i} m={m} hora={s.hora} dark={dark} tail={tail} />;
            if (m.kind === 'image' || m.kind === 'video')
              return <MediaBubble key={m.id || i} m={m} hora={s.hora} dark={dark} emojiSet={emojiSet} tail={tail} />;
            return <TextBubble key={m.id || i} m={m} hora={s.hora} dark={dark} emojiSet={emojiSet} tail={tail} />;
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
    conversa: [
      newMsg({ kind: 'text', me: false, text: 'Oi, viu minha mensagem? 👀' }),
      newMsg({ kind: 'text', me: false, text: 'Preciso muito da sua resposta' }),
      newMsg({ kind: 'text', me: true, text: 'Oi! Vi sim, tava sem sinal 😅' }),
      newMsg({ kind: 'audio', me: true, dur: '0:07' }),
      newMsg({ kind: 'text', me: false, text: 'Ah entendi! Fica tranquila então ❤️' }),
      newMsg({ kind: 'text', me: true, text: 'Já te respondo tudo direitinho' }),
    ],
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
        hint="Monte a conversa: some texto, áudio, foto ou vídeo, escolha o lado e arraste a ordem pelas setas."
      >
        <ChatBuilder value={s.conversa} onChange={(v) => set({ conversa: v })} meLabel="Eu" themLabel="Contato" />
      </Field>
      <Toggle on={s.dark} onChange={(v) => set({ dark: v })} label="Modo escuro" />
    </div>
  ),
  Preview: ({ s, status }) => <Screen s={s} status={status} />,
};

export default [MODEL];
