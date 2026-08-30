'use client';

import React from 'react';
import type { LinkIndicacao } from '@/lib/pilot-indicacoes';

/**
 * IndicacaoPanel — o painel das INDICAÇÕES do copy (comentários do Docs).
 *
 * Dois sabores, mesma peça:
 *  · `tipo="avatar"` (âmbar) — "Indicação de avatar · comentário do Docs".
 *  · `tipo="copy"`  (azul)   — "Comentário no texto · copy do Docs", com o
 *    chip do TAKE e o trecho comentado.
 *
 * Desenho: superfície ESCURA nos dois temas (mesma gramática dos cards de
 * preview dos takes do HeyGen) — o painel é uma "ilha" de leitura sobre o
 * card claro, com hairline colorido, filete de acento na lateral e um único
 * acento por sabor. Cada link citado no comentário vira um CARD com thumb
 * real (Drive/YouTube/imagem) ou glifo da plataforma (TikTok/Instagram) e
 * abre em nova aba.
 */

export type IndicacaoItem = {
  nota: string;
  links?: LinkIndicacao[];
  /** Só no tipo "copy": onde o comentário estava ancorado. */
  take?: string | null;
  trecho?: string;
};

function IconMegafone({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m3 11 14-6v14L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      <path d="M21 8.5c.7.8.7 5.2 0 6" />
    </svg>
  );
}
function IconBalao({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h.01M12 9h.01M16 9h.01" />
    </svg>
  );
}

/** Glifo da plataforma — usado quando não há thumb pública (e como marca
 *  no canto da thumb quando há). Traço fino, mesma família dos outros. */
function GlifoPlataforma({ tipo, size = 18 }: { tipo: LinkIndicacao['tipo']; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (tipo === 'youtube') {
    return (
      <svg {...p}>
        <rect x="2" y="5" width="20" height="14" rx="4" />
        <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (tipo === 'tiktok') {
    return (
      <svg {...p}>
        <path d="M15 3v9.5a3.5 3.5 0 1 1-3-3.46" />
        <path d="M15 6.2A5 5 0 0 0 19.5 9" />
      </svg>
    );
  }
  if (tipo === 'instagram') {
    return (
      <svg {...p}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="3.6" />
        <path d="M17.2 6.9h.01" />
      </svg>
    );
  }
  if (tipo === 'drive') {
    return (
      <svg {...p}>
        <path d="M9 3h6l6 10.5h-6z" />
        <path d="m9 3-6 10.5L6 21l6-10.5z" />
        <path d="M6 21h12l3-7.5" />
      </svg>
    );
  }
  if (tipo === 'imagem') {
    return (
      <svg {...p}>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="m4 17 5-5 3.5 3.5L16 12l4 5" />
      </svg>
    );
  }
  if (tipo === 'docs') {
    return (
      <svg {...p}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" />
      </svg>
    );
  }
  return (
    <svg {...p}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L12 6.4" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </svg>
  );
}

function CardDeLink({ link }: { link: LinkIndicacao }) {
  const [falhou, setFalhou] = React.useState(false);
  const temThumb = !!link.thumb && !falhou;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`ind-link ind-link-${link.tipo}`}
      title={link.url}
    >
      <span className="ind-link-thumb">
        {temThumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={link.thumb as string}
            alt={link.rotulo}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFalhou(true)}
          />
        ) : (
          <span className="ind-link-glifo"><GlifoPlataforma tipo={link.tipo} size={20} /></span>
        )}
        {temThumb ? (
          <span className="ind-link-selo" aria-hidden><GlifoPlataforma tipo={link.tipo} size={11} /></span>
        ) : null}
      </span>
      <span className="ind-link-txt">
        <span className="ind-link-rotulo">{link.rotulo}</span>
        <span className="ind-link-url">{link.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}</span>
      </span>
      <span className="ind-link-seta" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </span>

      <style jsx>{`
        /* ⚠ estes estilos moram AQUI (e não no painel): styled-jsx é escopado
           por componente e não alcança um filho declarado fora dele. */
        .ind-link {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          max-width: 100%;
          border-radius: 10px;
          padding: 5px 10px 5px 5px;
          text-decoration: none;
          background: rgba(255, 255, 255, 0.05);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
          transition: transform 0.18s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.18s, background-color 0.18s;
        }
        .ind-link:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 0 0 1px rgba(var(--acento, 251, 191, 36), 0.5), 0 8px 18px -12px rgba(0, 0, 0, 0.9);
        }
        .ind-link-thumb {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          flex-shrink: 0;
          border-radius: 7px;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.45);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.09);
        }
        .ind-link-thumb :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .ind-link-glifo {
          color: rgba(255, 255, 255, 0.62);
        }
        .ind-link-selo {
          position: absolute;
          right: 2px;
          bottom: 2px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 15px;
          height: 15px;
          border-radius: 5px;
          color: #fff;
          background: rgba(0, 0, 0, 0.72);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
        }
        .ind-link-txt {
          display: grid;
          min-width: 0;
          gap: 1px;
          line-height: 1.25;
        }
        .ind-link-rotulo {
          font-family: var(--font-tech), system-ui;
          font-size: 11.5px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.92);
        }
        .ind-link-url {
          font-family: var(--font-mono), monospace;
          font-size: 9.5px;
          color: rgba(255, 255, 255, 0.42);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 190px;
        }
        .ind-link-seta {
          color: rgba(255, 255, 255, 0.35);
          transition: color 0.18s, transform 0.18s;
        }
        .ind-link:hover .ind-link-seta {
          color: rgba(var(--acento, 251, 191, 36), 1);
          transform: translate(1px, -1px);
        }
        .ind-link-youtube .ind-link-glifo { color: #ff6b6b; }
        .ind-link-tiktok .ind-link-glifo { color: #7ef0e0; }
        .ind-link-instagram .ind-link-glifo { color: #f7a3d0; }
        .ind-link-drive .ind-link-glifo { color: #8ee6a0; }
      `}</style>
    </a>
  );
}

export function IndicacaoPanel({
  tipo,
  itens,
}: {
  tipo: 'avatar' | 'copy';
  itens: IndicacaoItem[];
}) {
  if (!itens?.length) return null;
  const ehCopy = tipo === 'copy';
  return (
    <div className={`ind-panel ${ehCopy ? 'is-copy' : 'is-avatar'} mt-2`}>
      <div className="ind-head">
        <span className="ind-head-tile">{ehCopy ? <IconBalao size={12} /> : <IconMegafone size={12} />}</span>
        <span className="ind-head-txt">
          {ehCopy ? 'Comentário no texto' : 'Indicação de avatar'}
          <span className="ind-head-sub">comentário do Docs</span>
        </span>
        {itens.length > 1 ? <span className="ind-head-n">{itens.length}</span> : null}
      </div>

      <ul className="ind-list">
        {itens.map((it, k) => (
          <li key={k} className="ind-item">
            {ehCopy && (it.take || it.trecho) ? (
              <div className="ind-ancora">
                {it.take ? <span className="ind-take">{it.take}</span> : null}
                {it.trecho ? (
                  <span className="ind-trecho">
                    “{it.trecho.length > 120 ? it.trecho.slice(0, 120) + '…' : it.trecho}”
                  </span>
                ) : null}
              </div>
            ) : null}
            <p className="ind-nota">{it.nota}</p>
            {(it.links || []).length > 0 ? (
              <div className="ind-links">
                {(it.links || []).map((l, j) => (
                  <CardDeLink key={j} link={l} />
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <style jsx>{`
        /* ── Ilha ESCURA (nos dois temas), igual aos cards de preview dos
           takes: superfície funda, hairline do acento e um filete lateral. */
        .ind-panel {
          --acento: 251, 191, 36;   /* âmbar: indicação de avatar */
          position: relative;
          overflow: hidden;
          border-radius: 14px;
          padding: 12px;
          background:
            radial-gradient(120% 100% at 0% 0%, rgba(var(--acento), 0.14), transparent 55%),
            linear-gradient(180deg, #14141b 0%, #0e0e14 100%);
          box-shadow:
            inset 0 0 0 1px rgba(var(--acento), 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.06),
            0 18px 38px -22px rgba(0, 0, 0, 0.9);
          animation: indEntra 0.28s cubic-bezier(0.32, 0.72, 0, 1) both;
        }
        .ind-panel.is-copy {
          --acento: 96, 165, 250;   /* azul: comentário no texto */
        }
        .ind-panel::before {
          content: '';
          position: absolute;
          left: 0;
          top: 10px;
          bottom: 10px;
          width: 2px;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(var(--acento), 0.95), rgba(var(--acento), 0.25));
        }

        .ind-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 9px;
        }
        .ind-head-tile {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 7px;
          color: #0d0b04;
          background: linear-gradient(150deg, rgba(var(--acento), 1), rgba(var(--acento), 0.72));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 4px 10px -6px rgba(var(--acento), 0.9);
        }
        .ind-head-txt {
          display: flex;
          align-items: baseline;
          gap: 7px;
          font-family: var(--font-tech), system-ui;
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: rgba(var(--acento), 1);
        }
        .ind-head-sub {
          font-family: var(--font-display), system-ui;
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0;
          color: rgba(255, 255, 255, 0.42);
        }
        .ind-head-sub::before {
          content: '· ';
        }
        .ind-head-n {
          margin-left: auto;
          font-family: var(--font-mono), monospace;
          font-size: 10px;
          font-weight: 700;
          color: rgba(var(--acento), 0.95);
          background: rgba(var(--acento), 0.14);
          box-shadow: inset 0 0 0 1px rgba(var(--acento), 0.35);
          border-radius: 999px;
          padding: 1px 7px;
        }

        .ind-list {
          display: grid;
          gap: 8px;
        }
        .ind-item {
          border-radius: 11px;
          padding: 9px 11px;
          background: rgba(255, 255, 255, 0.035);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
        }
        .ind-ancora {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 7px;
          margin-bottom: 5px;
        }
        .ind-take {
          flex-shrink: 0;
          font-family: var(--font-mono), monospace;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(var(--acento), 1);
          background: rgba(var(--acento), 0.16);
          box-shadow: inset 0 0 0 1px rgba(var(--acento), 0.4);
          border-radius: 999px;
          padding: 2px 8px;
        }
        .ind-trecho {
          min-width: 0;
          font-size: 11px;
          font-style: italic;
          line-height: 1.45;
          color: rgba(255, 255, 255, 0.5);
        }
        .ind-nota {
          margin: 0;
          font-size: 12.5px;
          line-height: 1.55;
          color: rgba(255, 255, 255, 0.94);
        }

        /* Wrapper dos cards de link (o card em si tem estilo próprio). */
        .ind-links {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 9px;
        }

        @keyframes indEntra {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ind-panel { animation: none; }
        }
      `}</style>
    </div>
  );
}
