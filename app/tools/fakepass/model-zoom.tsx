'use client';

/**
 * FakePass — REUNIÃO DO ZOOM (fiel ao app do iPad/tablet).
 * Dois modos no MESMO modelo:
 *  • REUNIÃO (grade): galeria de participantes com borda VERDE em quem fala,
 *    mic vermelho cortado em quem está mutado e o nome no cantinho de cada
 *    quadro — última fileira incompleta centralizada, igual ao Zoom real.
 *  • APRESENTANDO: tela compartilhada ocupando tudo, faixa VERDE "Você está
 *    visualizando a tela de …" + "Opções de exibição", e o filmstrip de
 *    participantes na direita.
 * Barra de status do tablet + toolbar do Zoom (Encerrar / Mudo / Parar vídeo /
 * Compartilhar conteúdo / Participantes / Mais) desenhadas do zero. Quadro sem
 * foto = TELA VERDE (encaixa vídeo por chroma) ou quadro escuro com a inicial.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Field, TextField, TextArea, Toggle, Segmented, ImageUpload, FONT_STACK, type FakeModel, type StageDims } from './shared';
import { LineBuilder } from './builder';

/* ─────────────────────────── Tipos / parse ─────────────────────────── */

type ZoomOrient = '169' | '43';
type ZoomMode = 'grid' | 'share';
type ZoomLang = 'pt' | 'en';

type S = {
  orient: ZoomOrient;
  mode: ZoomMode;
  idioma: ZoomLang;
  hora: string;
  bateria: string;
  meetingId: string;
  participantes: string;
  imgs: string[];
  vazioVerde: boolean;
  telaImg: string;
  apresentador: string;
  filmstrip: boolean;
};

type Participante = { nome: string; falando: boolean; mutado: boolean };

/** Uma linha por participante. `*` no fim = falando (borda verde); `!` = mutado. */
function parseParticipantes(txt: string): Participante[] {
  return txt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 9)
    .map((l) => {
      let nome = l;
      let falando = false;
      let mutado = false;
      // marcadores no fim, em qualquer ordem: "Nancy *", "Kai !", "Ana *!"
      for (;;) {
        if (nome.endsWith('*')) { falando = true; nome = nome.slice(0, -1).trim(); continue; }
        if (nome.endsWith('!')) { mutado = true; nome = nome.slice(0, -1).trim(); continue; }
        break;
      }
      return { nome, falando, mutado };
    });
}

/** Fileiras da galeria, igual ao Zoom: 2→1×2, 3-4→2×2, 5-6→3+resto, 7-9→3×3. */
function gridRows(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 2) return [n];
  if (n <= 4) return [2, n - 2];
  if (n <= 6) return [3, n - 3];
  if (n <= 8) return [3, 3, n - 6];
  return [3, 3, 3];
}

const ZOOM_GREEN_BORDER = '#23d959';
const CHROMA_GREEN = '#00b140';
const TILE_DARK = '#1b1c20';

/** Cor determinística do avatar de inicial (paleta do Zoom). */
const AVATAR_CORES = ['#0e72ed', '#e8ad12', '#12a1b8', '#7a53d1', '#e0533d', '#18a957', '#d1568e'];
function corAvatar(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}

/* ─────────────────────────── Textos por idioma ─────────────────────────── */

const T = {
  pt: {
    end: 'Encerrar',
    mute: 'Mudo',
    video: 'Parar vídeo',
    share: 'Compartilhar conteúdo',
    people: 'Participantes',
    more: 'Mais',
    viewing: 'Você está visualizando a tela de',
    viewOpts: 'Opções de exibição',
  },
  en: {
    end: 'End Meeting',
    mute: 'Mute',
    video: 'Stop Video',
    share: 'Share Content',
    people: 'Participants',
    more: 'More',
    viewing: "You are viewing", // + nome + "'s screen"
    viewOpts: 'View Options',
  },
};

/* ─────────────────────────── Ícones (SVG) ─────────────────────────── */

function icoProps(size: number, stroke = '#fff') {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const, stroke, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { display: 'block' } as CSSProperties };
}

function MicIcon({ size, color = '#fff', slash = false }: { size: number; color?: string; slash?: boolean }) {
  return (
    <svg {...icoProps(size, color)}>
      <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3.5" />
      {slash ? <path d="M4 3l16 18" stroke={color} strokeWidth="2" /> : null}
    </svg>
  );
}

function CamIcon({ size, color = '#fff' }: { size: number; color?: string }) {
  return (
    <svg {...icoProps(size, color)}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5l6-3.5v10l-6-3.5" />
    </svg>
  );
}

function ShareUpIcon({ size, color = '#fff' }: { size: number; color?: string }) {
  return (
    <svg {...icoProps(size, color)}>
      <rect x="4" y="8" width="16" height="13" rx="2.5" />
      <path d="M12 14V2.5" />
      <path d="M8.5 6L12 2.5 15.5 6" />
    </svg>
  );
}

function PeopleIcon({ size, color = '#fff' }: { size: number; color?: string }) {
  return (
    <svg {...icoProps(size, color)}>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3.5 20a6 6 0 0 1 12 0" />
      <path d="M16 5.4a3.5 3.5 0 0 1 0 5.2" />
      <path d="M17.5 14.6a6 6 0 0 1 3 5.4" />
    </svg>
  );
}

function MoreIcon({ size, color = '#fff' }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: 'block' }}>
      <circle cx="5" cy="12" r="1.8" fill={color} />
      <circle cx="12" cy="12" r="1.8" fill={color} />
      <circle cx="19" cy="12" r="1.8" fill={color} />
    </svg>
  );
}

function FlipCamIcon({ size, color = '#fff' }: { size: number; color?: string }) {
  return (
    <svg {...icoProps(size, color)}>
      <path d="M4 8.5V6a1.5 1.5 0 0 1 1.5-1.5h2L9 2.5h6L16.5 4.5h2A1.5 1.5 0 0 1 20 6v2.5" />
      <path d="M19 14a7 7 0 0 1-13.2 3" />
      <path d="M5 20.5V17h3.5" />
      <path d="M5 14a7 7 0 0 1 13.2-3" />
      <path d="M19 7.5V11h-3.5" />
    </svg>
  );
}

function GridSwitchIcon({ size, color = '#fff' }: { size: number; color?: string }) {
  return (
    <svg {...icoProps(size, color)}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function WifiIcon({ size, color = '#fff' }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden style={{ display: 'block' }}>
      <path d="M12 5c3.7 0 7.1 1.4 9.7 3.8l-2 2.1A11 11 0 0 0 12 8a11 11 0 0 0-7.7 2.9l-2-2.1A14 14 0 0 1 12 5z" />
      <path d="M12 10.5c2.2 0 4.2.8 5.7 2.2l-2.1 2.2a5.3 5.3 0 0 0-7.2 0l-2.1-2.2a8.3 8.3 0 0 1 5.7-2.2z" />
      <circle cx="12" cy="17.8" r="2" />
    </svg>
  );
}

function BatteryIcon({ k, pct }: { k: number; pct: number }) {
  const lvl = Math.max(0, Math.min(100, pct));
  const fill = lvl <= 20 ? '#ff453a' : '#fff';
  return (
    <svg width={22 * k} height={11 * k} viewBox="0 0 27 13" fill="none" aria-hidden style={{ display: 'block' }}>
      <rect x="0.5" y="0.5" width="22" height="12" rx="3" stroke="#fff" strokeOpacity="0.45" />
      <rect x="2" y="2" width={(lvl / 100) * 19} height="9" rx="1.6" fill={fill} />
      <rect x="24" y="4" width="2.2" height="5" rx="1.1" fill="#fff" opacity="0.5" />
    </svg>
  );
}

/* ─────────────────────────── Pedaços da UI ─────────────────────────── */

/** Barra de status do tablet (fina, preta): wifi · hora · bateria. */
function TabletStatusBar({ k, hora, bateria }: { k: number; hora: string; bateria: string }) {
  const pct = parseInt(bateria.replace(/\D/g, ''), 10);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 17 * k, padding: `0 ${10 * k}px`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 * k }}>
        <WifiIcon size={11 * k} />
      </div>
      <span style={{ color: '#fff', fontWeight: 600, fontSize: 10 * k, lineHeight: 1 }}>{hora}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 * k }}>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 9.5 * k, lineHeight: 1 }}>{Number.isFinite(pct) ? `${pct}%` : bateria}</span>
        <BatteryIcon k={k} pct={Number.isFinite(pct) ? pct : 80} />
      </div>
    </div>
  );
}

function ToolButton({ k, icon, label }: { k: number; icon: ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 * k, minWidth: 34 * k }}>
      {icon}
      <span style={{ color: '#fff', fontWeight: 500, fontSize: 7.5 * k, lineHeight: 1, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

/** Toolbar do Zoom: Encerrar à esquerda, ID no centro, ações à direita. */
function ZoomToolbar({ k, s, parts }: { k: number; s: S; parts: Participante[] }) {
  const t = T[s.idioma];
  const eu = parts[0];
  const euMutado = eu ? eu.mutado : false;
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 40 * k, padding: `0 ${14 * k}px`, flexShrink: 0, borderBottom: `1px solid rgba(255,255,255,0.07)` }}>
      <span style={{ color: '#ff453a', fontWeight: 600, fontSize: 12.5 * k, lineHeight: 1, flexShrink: 0 }}>{t.end}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
        {s.meetingId.trim() ? (
          <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 600, fontSize: 11.5 * k, letterSpacing: 1 * k, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.meetingId}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 * k, flexShrink: 0 }}>
        <ToolButton k={k} icon={<MicIcon size={15 * k} color={euMutado ? '#ff453a' : '#fff'} slash={euMutado} />} label={t.mute} />
        <ToolButton k={k} icon={<CamIcon size={15 * k} />} label={t.video} />
        <ToolButton k={k} icon={<ShareUpIcon size={15 * k} color="#23d959" />} label={t.share} />
        <ToolButton k={k} icon={<PeopleIcon size={15 * k} />} label={t.people} />
        <ToolButton k={k} icon={<MoreIcon size={15 * k} />} label={t.more} />
      </div>
    </div>
  );
}

/** Chip do nome no canto do quadro (com mic vermelho se mutado). */
function NomeChip({ k, p, small = false }: { k: number; p: Participante; small?: boolean }) {
  const fs = (small ? 8 : 9.5) * k;
  return (
    <span
      style={{
        position: 'absolute',
        left: 4 * k,
        bottom: 4 * k,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3.5 * k,
        maxWidth: '86%',
        background: 'rgba(0,0,0,0.6)',
        borderRadius: 3 * k,
        padding: `${2.5 * k}px ${6 * k}px`,
        lineHeight: 1,
      }}
    >
      {p.mutado ? <MicIcon size={fs} color="#ff453a" slash /> : null}
      <span style={{ color: '#fff', fontWeight: 500, fontSize: fs, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome}</span>
    </span>
  );
}

/** Um quadro de participante: foto (cover) OU verde de chroma OU escuro c/ inicial. */
function Tile({ k, p, img, vazioVerde, style, small }: { k: number; p: Participante; img: string; vazioVerde: boolean; style: CSSProperties; small?: boolean }) {
  const temImg = !!img;
  const fundo = temImg ? `url("${img}") center/cover no-repeat` : vazioVerde ? CHROMA_GREEN : TILE_DARK;
  const av = 34 * k;
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: fundo,
        boxSizing: 'border-box',
        border: p.falando ? `${2.5 * k}px solid ${ZOOM_GREEN_BORDER}` : undefined,
        ...style,
      }}
    >
      {!temImg && !vazioVerde ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span
            style={{
              width: av,
              height: av,
              borderRadius: '50%',
              background: corAvatar(p.nome),
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              fontSize: av * 0.44,
              lineHeight: 1,
            }}
          >
            {(p.nome.trim()[0] || '?').toUpperCase()}
          </span>
        </div>
      ) : null}
      <NomeChip k={k} p={p} small={small} />
    </div>
  );
}

/* ─────────────────────────── Palco ─────────────────────────── */

function zoomDims(orient: ZoomOrient): StageDims {
  if (orient === '43') return { stageW: 600, ratio: 3 / 4, exportW: 1920 };
  return { stageW: 640, ratio: 9 / 16, exportW: 1920 };
}

function ZoomStage({ s }: { s: S }) {
  const d = zoomDims(s.orient);
  const W = d.stageW;
  const H = Math.round(W * d.ratio);
  const k = W / 640;
  const parts = parseParticipantes(s.participantes);
  const t = T[s.idioma];
  const gap = Math.max(2, Math.round(2 * k));

  const rows = gridRows(parts.length);
  const maxCols = rows.length ? Math.max(...rows) : 1;
  let idx = 0;

  const stripParts = parts.slice(0, 4);

  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: H,
        overflow: 'hidden',
        background: '#000',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        display: 'flex',
        flexDirection: 'column',
        lineHeight: 1.1,
      }}
    >
      <TabletStatusBar k={k} hora={s.hora} bateria={s.bateria} />
      <ZoomToolbar k={k} s={s} parts={parts} />

      {s.mode === 'grid' ? (
        <>
          {/* GALERIA: fileiras iguais, última incompleta centralizada */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap, padding: `${gap}px 0` }}>
            {rows.map((cols, r) => {
              const fila = parts.slice(idx, idx + cols);
              idx += cols;
              return (
                <div key={r} style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', gap }}>
                  {fila.map((p, c) => (
                    <Tile
                      key={c}
                      k={k}
                      p={p}
                      img={s.imgs[idx - cols + c] || ''}
                      vazioVerde={s.vazioVerde}
                      style={{ width: `calc(${100 / maxCols}% - ${gap}px)`, height: '100%' }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* botões flutuantes da esquerda (trocar câmera / trocar visão) */}
          <div style={{ position: 'absolute', left: 8 * k, top: 68 * k, display: 'flex', flexDirection: 'column', gap: 6 * k }}>
            {[<FlipCamIcon key="a" size={14 * k} />, <GridSwitchIcon key="b" size={14 * k} />].map((ic, i) => (
              <span key={i} style={{ width: 30 * k, height: 30 * k, borderRadius: 6 * k, background: 'rgba(40,42,48,0.85)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {ic}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {/* TELA COMPARTILHADA (imagem ou verde de chroma) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: s.telaImg ? `url("${s.telaImg}") center/cover no-repeat` : CHROMA_GREEN,
            }}
          />

          {/* faixa verde "Você está visualizando a tela de …" */}
          <div style={{ position: 'absolute', top: 8 * k, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'stretch', borderRadius: 5 * k, overflow: 'hidden', boxShadow: `0 ${1 * k}px ${6 * k}px rgba(0,0,0,0.35)` }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', background: '#13a13f', color: '#fff', fontWeight: 600, fontSize: 10 * k, padding: `${5 * k}px ${10 * k}px`, lineHeight: 1, whiteSpace: 'nowrap' }}>
                {s.idioma === 'en' ? `${t.viewing} ${s.apresentador}'s screen` : `${t.viewing} ${s.apresentador}`}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 * k, background: '#0e7a30', color: '#fff', fontWeight: 600, fontSize: 10 * k, padding: `${5 * k}px ${10 * k}px`, lineHeight: 1, whiteSpace: 'nowrap' }}>
                {t.viewOpts}
                <svg width={7 * k} height={7 * k} viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" aria-hidden style={{ display: 'block' }}>
                  <path d="M1.5 3.5L5 7l3.5-3.5" />
                </svg>
              </span>
            </span>
          </div>

          {/* filmstrip de participantes à direita */}
          {s.filmstrip && stripParts.length ? (
            <div style={{ position: 'absolute', top: 34 * k, right: 6 * k, display: 'flex', flexDirection: 'column', gap: 4 * k, width: Math.round(W * 0.2) }}>
              {stripParts.map((p, i) => (
                <Tile
                  key={i}
                  k={k}
                  p={p}
                  img={s.imgs[i] || ''}
                  vazioVerde={s.vazioVerde}
                  small
                  style={{ width: '100%', height: Math.round(((W * 0.2) * 9) / 16), borderRadius: 4 * k, boxShadow: `0 ${1 * k}px ${5 * k}px rgba(0,0,0,0.45)` }}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const DEFAULT_PARTICIPANTES = ['Você', 'Scott', 'Nancy *', 'Kai !', 'Nishita', 'Vanessa !', 'Karina', 'Blake'].join('\n');

const ZOOM: FakeModel<S> = {
  id: 'zoom-meeting',
  label: 'Reunião do Zoom',
  category: 'meet',
  hue: 'rgba(14,114,237,0.42)',
  stageW: 640,
  ratio: 9 / 16,
  exportW: 1920,
  usesPhone: false,
  dims: (s) => zoomDims(s.orient),
  defaultState: {
    orient: '169',
    mode: 'grid',
    idioma: 'pt',
    hora: '11:28',
    bateria: '64%',
    meetingId: '974-203-885',
    participantes: DEFAULT_PARTICIPANTES,
    imgs: [],
    vazioVerde: true,
    telaImg: '',
    apresentador: 'Scott',
    filmstrip: true,
  },
  Controls: ({ s, set }) => {
    const parts = parseParticipantes(s.participantes);
    const setImg = (i: number, v: string) => {
      const next = [...(s.imgs || [])];
      next[i] = v;
      set({ imgs: next });
    };
    return (
      <div className="flex flex-col gap-4">
        <Field label="Modo">
          <Segmented
            value={s.mode}
            options={[
              { value: 'grid', label: 'Reunião (grade)' },
              { value: 'share', label: 'Apresentando' },
            ]}
            onChange={(v) => set({ mode: v })}
          />
        </Field>
        <Field label="Formato" hint="16:9 = notebook/TV · 4:3 = tablet.">
          <Segmented
            value={s.orient}
            options={[
              { value: '169', label: '16:9' },
              { value: '43', label: '4:3 (tablet)' },
            ]}
            onChange={(v) => set({ orient: v })}
          />
        </Field>
        <Field label="Idioma da interface">
          <Segmented
            value={s.idioma}
            options={[
              { value: 'pt', label: 'Português' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(v) => set({ idioma: v })}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Hora"><TextField value={s.hora} onChange={(v) => set({ hora: v })} placeholder="11:28" maxLength={8} /></Field>
          <Field label="Bateria"><TextField value={s.bateria} onChange={(v) => set({ bateria: v })} placeholder="64%" maxLength={5} /></Field>
          <Field label="ID da reunião"><TextField value={s.meetingId} onChange={(v) => set({ meetingId: v })} placeholder="974-203-885" maxLength={16} /></Field>
        </div>
        <Field
          label="Participantes (máx. 9)"
          hint="Use os botões FALA e MUDO de cada linha. O 1º da lista é você (reflete no botão Mudo)."
        >
          <LineBuilder
            value={s.participantes}
            onChange={(v) => set({ participantes: v })}
            placeholder="Nome do participante"
            addLabel="Participante"
            max={9}
            chips={[
              { mark: '*', label: 'FALA', title: 'Está falando (borda verde)' },
              { mark: '!', label: 'MUDO', title: 'Está mutado (mic vermelho)' },
            ]}
          />
        </Field>
        <Field label="Fotos dos participantes" hint="Vazio = tela verde (encaixa o vídeo por chroma) ou quadro escuro com a inicial.">
          <div className="grid grid-cols-2 gap-2">
            {parts.map((p, i) => (
              <ImageUpload key={i} value={s.imgs[i] || ''} onChange={(v) => setImg(i, v)} label={p.nome || `#${i + 1}`} />
            ))}
          </div>
        </Field>
        <Toggle on={s.vazioVerde} onChange={(v) => set({ vazioVerde: v })} label="Quadro sem foto = tela verde (chroma)" />
        {s.mode === 'share' ? (
          <>
            <Field label="Quem está apresentando"><TextField value={s.apresentador} onChange={(v) => set({ apresentador: v })} placeholder="Scott" maxLength={30} /></Field>
            <Field label="Imagem da tela compartilhada" hint="Vazio = tela verde (pra encaixar o conteúdo depois).">
              <ImageUpload value={s.telaImg} onChange={(v) => set({ telaImg: v })} label="tela" />
            </Field>
            <Toggle on={s.filmstrip} onChange={(v) => set({ filmstrip: v })} label="Mostrar participantes na lateral" />
          </>
        ) : null}
      </div>
    );
  },
  Preview: ({ s }) => <ZoomStage s={s} />,
};

export default [ZOOM];
