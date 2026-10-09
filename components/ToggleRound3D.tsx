'use client';

/**
 * ToggleRound3D — botao REDONDO ON/OFF, so com icone (sem texto).
 *
 * Visual (08.10): o mesmo "botão-instrumento" do Pilot (.pl-ibtn em
 * app/pilot-skin.css). Desligado = grafite com o ícone apagado; ligado = anel
 * e brilho na cor da variante, com um pulso suave (pausa no modo descanso).
 * Mesma API de antes.
 */
export function ToggleRound3D({
  on,
  onChange,
  icon,
  title,
  disabled = false,
  variant = 'lime',
  size = 'md',
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  icon: React.ReactNode;
  title?: string;
  disabled?: boolean;
  variant?: 'lime' | 'cyan' | 'fuchsia';
  size?: 'sm' | 'md' | 'lg';
}) {
  const px = { sm: 36, md: 44, lg: 56 }[size];
  const iconSize = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' }[size];
  return (
    <button
      type="button"
      role="switch"
      aria-pressed={on}
      aria-checked={on}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-tone={on ? variant : 'neutral'}
      data-on={on ? 'true' : undefined}
      className="pl-ibtn group select-none"
      style={{ width: px, height: px }}
    >
      {on && !disabled ? <span className="pl-ibtn__pulse ae-ambient" aria-hidden /> : null}
      <span className={'flex items-center justify-center ' + iconSize}>{icon}</span>
    </button>
  );
}

/**
 * Icone Tesoura — usado no toggle de decupagem por task (ClickUp Pilot).
 */
export function ScissorsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

/**
 * Icone Olho (revisao) — usado no toggle "incluir tasks em REVISÃO"
 * do ClickUp Pilot.
 */
export function ReviewEyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

/**
 * Icone Wireless (curvas radiando) — usado no Smart Mode VA toggle.
 */
export function WirelessIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Onda externa */}
      <path d="M2 8.5C5 5.5 8.5 4 12 4C15.5 4 19 5.5 22 8.5" />
      {/* Onda media */}
      <path d="M5 12C7 10 9.5 9 12 9C14.5 9 17 10 19 12" />
      {/* Onda interna */}
      <path d="M8.5 15.5C9.5 14.5 10.7 14 12 14C13.3 14 14.5 14.5 15.5 15.5" />
      {/* Ponto central */}
      <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
