'use client';

/**
 * Cartão de "concluído" (09.10): aparece no canto quando um processo termina
 * em qualquer ferramenta. Mesmo desenho do aviso do admin (.ann-aviso), com o
 * ícone COLORIDO da ferramenta num quadradinho neutro + selo de status, e uma
 * barrinha de tempo: some sozinho em DONE_MS, pausando com o mouse/foco em
 * cima e enquanto a aba está oculta. X fecha na hora.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toolIconExact } from '@/components/history/tool-icons';
import { DONE_MS, quandoTerminou, type DoneToast as Toast } from '@/lib/done-toasts';
import { dismissDone } from '@/lib/done-toasts-client';
import { AnnIcon } from './templates';

const LEAVE_MS = 230;
const TONE_RGB: Record<Toast['tone'], string> = {
  sucesso: 'var(--lime)',
  falha: '232 92 104',
};

export function DoneToast({ t }: { t: Toast }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [hover, setHover] = useState(false);
  const [hidden, setHidden] = useState(false);
  const paused = hover || hidden;
  const left = useRef(DONE_MS);
  const done = useRef(false);

  const close = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    window.setTimeout(() => dismissDone(t.id), LEAVE_MS);
  }, [t.id]);

  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Relógio que pausa: guarda quanto falta a cada pausa.
  useEffect(() => {
    if (paused || leaving) return;
    const startedAt = Date.now();
    const id = window.setTimeout(close, left.current);
    return () => {
      window.clearTimeout(id);
      left.current = Math.max(0, left.current - (Date.now() - startedAt));
    };
  }, [paused, leaving, close]);

  const when = quandoTerminou(t.at);

  return (
    <div
      className={'ann-aviso ann-done ' + (leaving ? 'ann-leave-right' : 'ann-enter-right')}
      style={{ ['--ann' as string]: TONE_RGB[t.tone], ['--done-ms' as string]: `${DONE_MS}ms` }}
      data-paused={paused ? 'on' : 'off'}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <div className="ann-aviso__core">
        <div className="ann-aviso__head">
          <span className="ann-tile ann-tile--tool">
            {toolIconExact(t.tool, 19)}
            <span className="ann-done__badge" aria-hidden>
              {t.tone === 'falha' ? <AnnIcon.close size={10} /> : <AnnIcon.check size={10} />}
            </span>
          </span>
          <p className="ann-aviso__meta">
            {t.toolLabel}
            <span>
              {' · '}
              {t.status} {when}
            </span>
          </p>
          <button type="button" className="ann-x" onClick={close} aria-label="Fechar notificação" title="Fechar">
            <AnnIcon.close size={15} />
          </button>
        </div>
        <p className="ann-aviso__title">{t.title}</p>
        {t.meta ? <p className="ann-aviso__body">{t.meta}</p> : null}
        <button
          type="button"
          className="ann-cta"
          onClick={() => {
            close();
            router.push('/tools/historico');
          }}
        >
          <span>Ver no histórico</span>
          <span className="ann-cta__dot">
            <AnnIcon.arrow size={13} />
          </span>
        </button>
        <span className="ann-done__bar" aria-hidden />
      </div>
    </div>
  );
}
