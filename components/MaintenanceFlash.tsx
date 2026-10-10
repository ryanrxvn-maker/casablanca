'use client';

/**
 * Aviso no topo do hub quando o middleware barra uma ferramenta em
 * manutenção (/tools?maintenance=1&from=/tools/x). Antes o cliente caía no
 * hub sem explicação nenhuma.
 *
 * Mostra o recado e a previsão que o admin escreveu no painel "Ferramentas".
 * Se a ferramenta já voltou (o retrato diz que está no ar), troca pra "já
 * voltou" com o botão de abrir. Ferramenta de uso interno nunca tem o nome
 * impresso (mesma regra do LockedFlash: quem força a URL não descobre nada).
 *
 * `MaintenanceFlashView` é o desenho puro: o painel do admin usa o MESMO
 * componente na prévia, então o que ele vê lá é o que o cliente vê aqui.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { maintenanceOf, whenLabel } from '@/lib/maintenance';
import { useMaintenance } from '@/lib/maintenance-client';
import { catalogTool } from '@/lib/tool-catalog';

export function WrenchGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 5.5a3.6 3.6 0 0 0-4.7 4.7L3.3 16.7a1.8 1.8 0 0 0 0 2.5l1.5 1.5a1.8 1.8 0 0 0 2.5 0l6.5-6.5a3.6 3.6 0 0 0 4.7-4.7l-2.2 2.2-2.3-.6-.6-2.3 2.1-2z" />
    </svg>
  );
}

function Close() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export const DEFAULT_MAINT_MESSAGE = 'Estamos fazendo um ajuste rápido. Ela volta em breve e nada do que você fez se perde.';

export function MaintenanceFlashView({
  name,
  message,
  until,
  back = false,
  openHref,
  onClose,
  now,
  className = 'mb-6',
}: {
  name: string;
  message?: string | null;
  until?: string | null;
  back?: boolean;
  openHref?: string;
  onClose?: () => void;
  now?: number;
  className?: string;
}) {
  const tone = back ? 'var(--lime)' : 'var(--amber)';
  return (
    <div
      role="status"
      className={'relative rounded-[20px] p-[5px] ' + className}
      style={{
        background: `rgb(${tone} / 0.07)`,
        boxShadow: `inset 0 0 0 1px rgb(${tone} / 0.22), 0 24px 48px -36px rgb(0 0 0 / 0.6)`,
      }}
    >
      <div
        className="flex items-start gap-4 rounded-[15px] bg-bg-soft px-4 py-4 md:px-5"
        style={{ boxShadow: 'inset 0 1px 0 rgb(var(--text) / 0.045), inset 0 0 0 1px rgb(var(--text) / 0.05)' }}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{ color: `rgb(${tone})`, background: `rgb(${tone} / 0.12)`, boxShadow: `inset 0 0 0 1px rgb(${tone} / 0.28)` }}
        >
          <WrenchGlyph />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-tech text-[15px] font-semibold tracking-[-0.01em] text-text">
            {back ? `${name} já voltou ao ar` : `${name} está em manutenção`}
          </p>
          <p className="field-label mt-1 text-[13.5px] leading-relaxed text-text-muted" style={{ overflowWrap: 'anywhere' }}>
            {back ? 'Pode abrir de novo: está tudo funcionando.' : message || DEFAULT_MAINT_MESSAGE}
          </p>
          {!back && until ? (
            <p
              className="field-label mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
              style={{ color: `rgb(${tone})`, background: `rgb(${tone} / 0.1)`, boxShadow: `inset 0 0 0 1px rgb(${tone} / 0.24)` }}
            >
              Previsão de volta: {whenLabel(until, now)}
            </p>
          ) : null}
          {back && openHref ? (
            <Link
              href={openHref}
              className="field-label mt-3 inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold"
              style={{ color: `rgb(${tone})`, background: `rgb(${tone} / 0.12)`, boxShadow: `inset 0 0 0 1px rgb(${tone} / 0.3)` }}
            >
              Abrir {name}
            </Link>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar aviso"
            title="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors duration-200 hover:bg-[rgb(var(--text)/0.08)] hover:text-text"
          >
            <Close />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MaintenanceFlash({ from }: { from: string }) {
  const snap = useMaintenance();
  const router = useRouter();
  const tool = catalogTool(from);
  const name = tool && tool.plan !== 'admin' ? tool.label : 'Esta ferramenta';
  const info = maintenanceOf(from, snap);
  const back = !!snap && !info && !!tool && tool.plan !== 'admin';

  return (
    <MaintenanceFlashView
      className="fade-in-up mb-6"
      name={name}
      message={info?.message}
      until={info?.until}
      back={back}
      openHref={from}
      onClose={() => router.replace('/tools', { scroll: false })}
    />
  );
}
