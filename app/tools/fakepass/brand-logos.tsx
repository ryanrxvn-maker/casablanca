'use client';

/**
 * FakePass — MINI-LOGOS das marcas pros cards do seletor.
 * Recriações vetoriais compactas (cor da marca + forma/sigla) — mesmo espírito
 * de mockup/paródia do resto da ferramenta. Servem de identificador visual do
 * card; o nome completo aparece do lado.
 */

import type { FakeModel } from './shared';

/* ─────────────── helpers ─────────────── */

function Chip({
  bg,
  fg = '#fff',
  t,
  italic,
  serif,
  size,
  radius = 5,
  border,
}: {
  bg: string;
  fg?: string;
  t: string;
  italic?: boolean;
  serif?: boolean;
  size: number;
  radius?: number;
  border?: string;
}) {
  return (
    <div
      style={{
        height: size,
        minWidth: size,
        padding: '0 5px',
        borderRadius: radius,
        background: bg,
        color: fg,
        border: border ? `1px solid ${border}` : undefined,
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: Math.round(size * 0.46),
        fontStyle: italic ? 'italic' : 'normal',
        fontFamily: serif ? "Georgia, 'Times New Roman', serif" : undefined,
        letterSpacing: -0.3,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {t}
    </div>
  );
}

function Peacock({ size }: { size: number }) {
  const petals = [
    { rot: -75, fill: '#f0641e' },
    { rot: -50, fill: '#f5a623' },
    { rot: -25, fill: '#f6e500' },
    { rot: 0, fill: '#6dbe45' },
    { rot: 25, fill: '#00a0d8' },
    { rot: 50, fill: '#7b4b9c' },
    { rot: 75, fill: '#e5007e' },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }} aria-hidden>
      <g transform="translate(50,58)">
        {petals.map((p, i) => (
          <ellipse key={i} cx={0} cy={-30} rx={9} ry={26} fill={p.fill} transform={`rotate(${p.rot})`} />
        ))}
        <circle cx={0} cy={0} r={10} fill="#fff" />
      </g>
    </svg>
  );
}

function IgMark({ size }: { size: number }) {
  const bw = Math.max(1.4, size * 0.075);
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.28, background: 'linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
      <div style={{ width: size * 0.5, height: size * 0.5, border: `${bw}px solid #fff`, borderRadius: size * 0.16, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: size * 0.22, height: size * 0.22, border: `${bw}px solid #fff`, borderRadius: '50%', boxSizing: 'border-box' }} />
      </div>
      <div style={{ position: 'absolute', top: size * 0.2, right: size * 0.2, width: size * 0.07, height: size * 0.07, borderRadius: '50%', background: '#fff' }} />
    </div>
  );
}

function WaMark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#25d366', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" fill="#fff" aria-hidden>
        <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.7 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .2-3.1-.7-2.7-1.1-4.4-3.9-4.5-4-.1-.2-1.1-1.4-1.1-2.7 0-1.3.7-1.9.9-2.1.2-.2.5-.3.7-.3h.5c.2 0 .4.1.6.5l.7 1.8c.1.2.1.3 0 .5l-.4.5c-.1.2-.3.3-.1.6.1.3.7 1.1 1.4 1.7.9.8 1.6 1 1.9 1.1.2.1.4.1.5-.1l.6-.7c.2-.2.3-.2.6-.1l1.7.8c.3.2.4.2.5.4.1.1.1.6-.1 1z" />
      </svg>
    </div>
  );
}

function XMark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.24, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="#fff" aria-hidden>
        <path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.4L18.9 2zm-1.2 18h1.7L7.4 3.9H5.6L17.7 20z" />
      </svg>
    </div>
  );
}

function NotifMark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.26, background: '#3a3a40', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    </div>
  );
}

function BbcMark({ size }: { size: number }) {
  const b = Math.round(size * 0.62);
  return (
    <div style={{ display: 'flex', gap: Math.max(1, size * 0.06), alignItems: 'center', flexShrink: 0 }}>
      {['B', 'B', 'C'].map((c, i) => (
        <span key={i} style={{ width: b, height: b, background: '#fff', color: '#000', fontSize: b * 0.66, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
          {c}
        </span>
      ))}
    </div>
  );
}

function GloboMark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size * 0.78} height={size * 0.78} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="8.4" stroke="#fff" strokeWidth="1.6" />
        <ellipse cx="12" cy="12" rx="3.6" ry="8.4" stroke="#fff" strokeWidth="1.3" />
        <path d="M4 10.2h16M4 13.8h16" stroke="#fff" strokeWidth="1.1" />
        <circle cx="15.5" cy="8.6" r="1.5" fill="#e30613" />
      </svg>
    </div>
  );
}

function ReutersMark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.22, background: '#fa6b05', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, gap: size * 0.06 }}>
      {[0.2, 0.32, 0.2].map((r, i) => (
        <span key={i} style={{ width: size * r, height: size * r, borderRadius: '50%', background: '#fff' }} />
      ))}
    </div>
  );
}

/* ─────────────── mark por marca ─────────────── */

export function BrandMark({ brand, size = 26 }: { brand: string; size?: number }) {
  switch (brand) {
    case 'instagram':
      return <IgMark size={size} />;
    case 'whatsapp':
      return <WaMark size={size} />;
    case 'x':
      return <XMark size={size} />;
    case 'notif':
      return <NotifMark size={size} />;
    case 'cnn':
    case 'cnnbr':
      return <Chip bg="#cc0000" t="CNN" italic size={size} radius={4} />;
    case 'bbc':
      return <BbcMark size={size} />;
    case 'fox':
      return <Chip bg="#0a2342" t="FOX" size={size} radius={4} />;
    case 'msnbc':
    case 'cnbc':
    case 'times':
      return <Peacock size={size} />;
    case 'global':
      return <Chip bg="#0a3a70" t="GN" size={size} />;
    case 'nnn':
      return <Chip bg="#12294d" t="NNN" size={size} />;
    case 'globonews':
      return <GloboMark size={size} />;
    case 'band':
      return <Chip bg="#0b2e6e" t="band" size={size} />;
    case 'record':
      return <Chip bg="#1b3a8c" t="REC" size={size} />;
    case 'reuters':
      return <ReutersMark size={size} />;
    case 'ap':
      return <Chip bg="#ff322e" t="AP" size={size} radius={3} />;
    case 'guardian':
      return <Chip bg="#052962" t="G" serif size={size} />;
    case 'aljazeera':
      return <Chip bg="#c9920a" t="aj" size={size} radius={size * 0.5} />;
    case 'g1':
      return <Chip bg="#c4170c" t="g1" size={size} radius={size * 0.28} />;
    case 'folha':
      return <Chip bg="#ffffff" fg="#111" t="F" serif size={size} border="#ccc" />;
    case 'uol':
      return <Chip bg="#ffcc00" fg="#111" t="UOL" size={size} radius={size * 0.28} />;
    case 'estadao':
      return <Chip bg="#0a2b5e" t="E" serif size={size} />;
    case 'oglobo':
      return <Chip bg="#111" t="OG" serif size={size} />;
    default:
      return <div style={{ width: size, height: size, borderRadius: size * 0.24, background: 'rgba(167,139,250,0.4)', flexShrink: 0 }} />;
  }
}

/* ─────────────── model → marca ─────────────── */

const GROUP_TO_BRAND: Record<string, string> = {
  CNN: 'cnn',
  BBC: 'bbc',
  'Fox News': 'fox',
  MSNBC: 'msnbc',
  CNBC: 'cnbc',
  'Global News': 'global',
  NNN: 'nnn',
  'CNN Brasil': 'cnnbr',
  GloboNews: 'globonews',
  'Band News': 'band',
  'Record News': 'record',
  'Times Brasil': 'times',
  Reuters: 'reuters',
  'AP News': 'ap',
  'The Guardian': 'guardian',
  'Al Jazeera': 'aljazeera',
  G1: 'g1',
  Folha: 'folha',
  UOL: 'uol',
  Estadão: 'estadao',
  'O Globo': 'oglobo',
};

export function brandForModel(m: FakeModel): string {
  if (m.group && GROUP_TO_BRAND[m.group]) return GROUP_TO_BRAND[m.group];
  if (m.id === 'whatsapp') return 'whatsapp';
  if (m.id === 'tweet') return 'x';
  if (m.id === 'notif') return 'notif';
  if (m.id.startsWith('ig-') || m.id === 'comments') return 'instagram';
  return '';
}
