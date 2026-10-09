'use client';

/**
 * Os DOIS templates fixos de aviso (09.10). Um componente só por template,
 * usado em TODO lugar onde ele aparece: na janela da tela do cliente, no
 * histórico ("ver de novo") e na prévia ao vivo da central de avisos do
 * admin. O que o admin vê na prévia é exatamente o que o cliente recebe.
 *
 *  • AvisoCard    → pequeno, no canto (tom: informação/novidade/sucesso/
 *                   atenção/urgente), título, texto e botão opcional.
 *  • PromoBanner  → grande, janela central: mídia (imagem enviada ou arte do
 *                   tema), selo, título, texto, até 3 destaques, preço
 *                   "de/por", contagem do prazo e botão principal.
 *
 * Desenho no ./notifications.css (prefixo ann-).
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import './notifications.css';
import {
  THEME_META,
  TONE_META,
  timeLeft,
  type AvisoContent,
  type AvisoTone,
  type PromoContent,
} from '@/lib/announcements';

/**
 * Cena do herói do Pilot (arte "Pilot animado"): o MESMO componente da página
 * da ferramenta. Carregado só quando uma propaganda com essa arte aparece, pra
 * o motor WebGL não pesar nas outras telas; até chegar, fica o aro vazio do
 * mesmo tamanho (nada pula).
 */
const PilotHero = dynamic(() => import('@/components/pilot/PilotHero').then((m) => m.PilotHero), {
  ssr: false,
  loading: () => <div className="ann-pilot__ph" />,
});

/* ───────────────────────── Ícones (traço fino) ───────────────────────── */

type IconProps = { size?: number };
const svgProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const AnnIcon = {
  info: ({ size = 17 }: IconProps) => (
    <svg {...svgProps(size)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.2M12 7.9v.2" /></svg>
  ),
  novidade: ({ size = 17 }: IconProps) => (
    <svg {...svgProps(size)}><path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5Z" /><path d="M18.5 15.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5Z" /></svg>
  ),
  sucesso: ({ size = 17 }: IconProps) => (
    <svg {...svgProps(size)}><circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.3 2.6 2.6 5-5.4" /></svg>
  ),
  atencao: ({ size = 17 }: IconProps) => (
    <svg {...svgProps(size)}><path d="M10.4 4.6 3.2 17.4A1.8 1.8 0 0 0 4.8 20h14.4a1.8 1.8 0 0 0 1.6-2.6L13.6 4.6a1.8 1.8 0 0 0-3.2 0Z" /><path d="M12 9.5v4.2M12 16.6v.2" /></svg>
  ),
  urgente: ({ size = 17 }: IconProps) => (
    <svg {...svgProps(size)}><path d="M13 3 5.5 13.2h5.6L10 21l7.5-10.3h-5.6L13 3Z" /></svg>
  ),
  megaphone: ({ size = 17 }: IconProps) => (
    <svg {...svgProps(size)}><path d="M4 10.2v3.6a1 1 0 0 0 1 1h2.2l6.8 4.2V5L7.2 9.2H5a1 1 0 0 0-1 1Z" /><path d="M17.5 9a4.2 4.2 0 0 1 0 6M7.6 14.8l1.2 4.7" /></svg>
  ),
  bell: ({ size = 17 }: IconProps) => (
    <svg {...svgProps(size)}><path d="M6.2 16.5V11a5.8 5.8 0 0 1 11.6 0v5.5l1.6 1.6H4.6l1.6-1.6Z" /><path d="M10 20.2a2.2 2.2 0 0 0 4 0" /></svg>
  ),
  close: ({ size = 16 }: IconProps) => (
    <svg {...svgProps(size)}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>
  ),
  arrow: ({ size = 15 }: IconProps) => (
    <svg {...svgProps(size)}><path d="M7 17 17 7M9 7h8v8" /></svg>
  ),
  check: ({ size = 12 }: IconProps) => (
    <svg {...svgProps(size)} strokeWidth={2.2}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
  ),
  clock: ({ size = 13 }: IconProps) => (
    <svg {...svgProps(size)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
  ),
};

export function ToneIcon({ tone, size }: { tone: AvisoTone; size?: number }) {
  const C = AnnIcon[tone];
  return <C size={size} />;
}

const toneVar = (tone: AvisoTone) => ({ ['--ann' as string]: TONE_META[tone].rgb });
export const themeVar = (theme: PromoContent['theme']) => ({ ['--ann' as string]: THEME_META[theme].rgb });

/* ───────────────────────── AVISO ───────────────────────── */

export function AvisoCard({
  content,
  timeLabel = 'agora',
  onClose,
  onCta,
  className = '',
  placeholder,
}: {
  content: AvisoContent;
  timeLabel?: string | null;
  onClose?: () => void;
  onCta?: () => void;
  className?: string;
  /** prévia do admin: mostra o lugar do texto quando o campo está vazio */
  placeholder?: boolean;
}) {
  const title = content.title || (placeholder ? 'Título do aviso' : '');
  const body = content.body || (placeholder ? 'O recado aparece aqui, curto e direto.' : '');
  return (
    <div className={'ann-aviso ' + className} style={toneVar(content.tone)} role="status" aria-live="polite">
      <div className="ann-aviso__core">
        <div className="ann-aviso__head">
          <span className="ann-tile">
            <ToneIcon tone={content.tone} />
          </span>
          <p className="ann-aviso__meta">
            {TONE_META[content.tone].label}
            {timeLabel ? <span> · {timeLabel}</span> : null}
          </p>
          {onClose ? (
            <button type="button" className="ann-x" onClick={onClose} aria-label="Fechar aviso" title="Fechar">
              <AnnIcon.close size={15} />
            </button>
          ) : null}
        </div>
        <p className="ann-aviso__title" style={!content.title && placeholder ? { opacity: 0.45 } : undefined}>{title}</p>
        {body ? (
          <p className="ann-aviso__body" style={!content.body && placeholder ? { opacity: 0.55 } : undefined}>{body}</p>
        ) : null}
        {content.ctaLabel ? (
          <button type="button" className="ann-cta" onClick={onCta} tabIndex={onCta ? 0 : -1}>
            <span>{content.ctaLabel}</span>
            <span className="ann-cta__dot">
              <AnnIcon.arrow size={13} />
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────────────────── PROPAGANDA ───────────────────────── */

/** Contagem do prazo: folha própria, atualiza a cada 30 s só enquanto montada. */
function Countdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const left = timeLeft(endsAt, now);
  if (!left) return null;
  return (
    <span className="ann-clock" title="Tempo até a oferta sair do ar">
      <AnnIcon.clock size={13} />
      Termina em {left}
    </span>
  );
}

function PromoArt({ animate }: { animate: boolean }) {
  return (
    <div className="ann-art" aria-hidden>
      <div className="ann-art__glow" />
      <div className="ann-art__slats" />
      <svg className="ann-art__floor" viewBox="0 0 400 200" preserveAspectRatio="none">
        <g stroke="rgb(255 255 255 / 0.09)" strokeWidth="1" fill="none">
          {Array.from({ length: 17 }, (_, i) => {
            const x = (i / 16) * 400;
            return <line key={`v${i}`} x1="200" y1="0" x2={x * 2.2 - 240} y2="200" />;
          })}
          {[18, 40, 68, 104, 150].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} />
          ))}
        </g>
      </svg>
      <div className="ann-stars" />
      <div className="ann-art__horizon" />
      <div className="ann-art__stage">
        <div className="ann-ring__halo" />
        <div className="ann-ring ann-ring--soft" />
        <div className="ann-ring" />
        <div className="ann-ring__disc">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/auto-edit-logo@256.png" alt="" decoding="async" loading={animate ? 'eager' : 'lazy'} />
        </div>
      </div>
      <div className="ann-grain" />
      <span className="ann-art__mark">
        <i />
        Auto Edit
      </span>
    </div>
  );
}

export function PromoBanner({
  content,
  endsAt,
  onClose,
  onCta,
  onLater,
  animate = false,
  placeholder,
  titleId,
}: {
  content: PromoContent;
  endsAt?: string | null;
  onClose?: () => void;
  onCta?: () => void;
  onLater?: () => void;
  /** coreografia de entrada (janela de verdade); a prévia fica parada */
  animate?: boolean;
  placeholder?: boolean;
  titleId?: string;
}) {
  const [imgBroken, setImgBroken] = useState(false);
  useEffect(() => setImgBroken(false), [content.imageUrl]);
  // "Pilot animado": a cena do herói ocupa a largura toda em cima e o texto
  // vem embaixo; o fechar fica sobre a cena e, sem botão principal, ele é a
  // única ação (nada de "Agora não" sobrando).
  const pilot = content.art === 'pilot';
  const showImage = !pilot && !!content.imageUrl && !imgBroken;
  const later = pilot && !content.ctaLabel ? undefined : onLater;
  const bullets = content.bullets.map((b) => b.trim()).filter(Boolean);
  const title = content.title || (placeholder ? 'Título da propaganda' : '');
  const body = content.body || (placeholder && !content.title ? 'Uma frase que faz a pessoa querer clicar.' : '');
  const closeBtn = onClose ? (
    <button type="button" className="ann-promo__x" onClick={onClose} aria-label="Fechar" title="Fechar">
      <AnnIcon.close size={16} />
    </button>
  ) : null;
  return (
    <div className={'ann-promo dark-island' + (pilot ? ' ann-promo--pilot' : '')} style={themeVar(content.theme)} data-anim={animate ? 'on' : 'off'}>
      <div className="ann-promo__core">
        {pilot ? (
          <div className="ann-pilot">
            <PilotHero />
            {closeBtn}
          </div>
        ) : (
          <div className="ann-media">
            {showImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={content.imageUrl} alt="" decoding="async" onError={() => setImgBroken(true)} />
                <div className="ann-media__scrim" />
              </>
            ) : (
              <PromoArt animate={animate} />
            )}
          </div>
        )}

        <div className="ann-body">
          {pilot ? null : closeBtn}

          {content.badge || endsAt ? (
            <div className="ann-top ann-r ann-r1">
              {content.badge ? (
                <span className="ann-badge">
                  <i />
                  {content.badge}
                </span>
              ) : null}
              {endsAt ? <Countdown endsAt={endsAt} /> : null}
            </div>
          ) : null}

          <h2 id={titleId} className="ann-title ann-r ann-r2" style={!content.title && placeholder ? { opacity: 0.4 } : undefined}>
            {title}
          </h2>
          {body ? (
            <p className="ann-text ann-r ann-r3" style={!content.body && placeholder ? { opacity: 0.55 } : undefined}>
              {body}
            </p>
          ) : null}

          {bullets.length ? (
            <ul className="ann-list ann-r ann-r4">
              {bullets.map((b, i) => (
                <li key={i}>
                  <span className="ann-check">
                    <AnnIcon.check size={11} />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          ) : null}

          {content.priceNew ? (
            <div className="ann-price ann-r ann-r5">
              {content.priceOld ? <span className="ann-price__old">de {content.priceOld}</span> : null}
              <span className="ann-price__new">{content.priceNew}</span>
              {content.priceNote ? <span className="ann-price__note">{content.priceNote}</span> : null}
            </div>
          ) : null}

          {content.ctaLabel || later ? (
            <div className="ann-actions ann-r ann-r6">
              {content.ctaLabel ? (
                <button type="button" className="ann-cta" onClick={onCta} tabIndex={onCta ? 0 : -1}>
                  <span>{content.ctaLabel}</span>
                  <span className="ann-cta__dot">
                    <AnnIcon.arrow size={15} />
                  </span>
                </button>
              ) : null}
              {later ? (
                <button type="button" className="ann-later" onClick={later}>
                  Agora não
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
