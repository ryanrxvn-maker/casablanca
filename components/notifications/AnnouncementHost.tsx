'use client';

/**
 * Janela de aviso NA TELA do cliente. Montado nos layouts logados (tools,
 * configurações, admin), igual ao Heartbeat.
 *
 * Ordem: a propaganda (janela grande, uma por vez) primeiro; quando não há
 * propaganda aberta, os avisos pequenos empilham no canto (até 3).
 * Fechar (X, "Agora não", Esc, clique fora) manda pro histórico; o botão
 * principal conta clique e leva pro link (página do site na mesma aba,
 * site de fora em aba nova).
 *
 * As janelas (PromoWindow / AvisoWindow) também servem o "ver de novo" do
 * histórico em /tools/notificacoes.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { internalPath, type AvisoContent, type NotifItem, type PromoContent } from '@/lib/announcements';
import { dismissPopup, getNotificationsState, resetNotifications, startNotifications, useNotifications } from '@/lib/notifications-client';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import { createClient } from '@/lib/supabase/client';
import { AvisoCard, PromoBanner } from './templates';

const LEAVE_MS = 230;

export function useOpenLink() {
  const router = useRouter();
  return useCallback(
    (url: string) => {
      if (!url) return;
      const path = internalPath(url, window.location.origin);
      if (path) router.push(path);
      else window.open(url, '_blank', 'noopener,noreferrer');
    },
    [router],
  );
}

export function AnnouncementHost() {
  const s = useNotifications();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Conta trocada sem recarregar a página: limpa antes de mostrar qualquer coisa.
    const known = getNotificationsState().userId;
    if (known) {
      createClient()
        .auth.getSession()
        .then(({ data }) => {
          if (data.session?.user?.id !== known) resetNotifications();
        })
        .catch(() => {});
    }
    return startNotifications();
  }, []);

  if (!mounted || s.suppressed || s.status !== 'ready') return null;
  // Troca de senha obrigatória não fica atrás de propaganda.
  if (pathname?.startsWith('/trocar-senha')) return null;

  const promo = s.popups.find((p) => p.kind === 'propaganda') ?? null;
  const avisos = promo ? [] : s.popups.filter((p) => p.kind === 'aviso').slice(0, 3);

  return createPortal(
    <div className="ann-root">
      {promo ? (
        <PromoWindow key={`${promo.id}@${promo.activatedAt}`} item={promo} onFinish={(clicked) => void dismissPopup(promo, clicked)} />
      ) : null}
      {avisos.length ? (
        <div className="ann-stack" aria-label="Avisos">
          {avisos.map((a) => (
            <AvisoToast key={`${a.id}@${a.activatedAt}`} item={a} />
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/** Saída animada + efeito UMA vez (Strict Mode e clique duplo não repetem). */
function useLeave(onFinish: (clicked: boolean) => void, link: string) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const openLink = useOpenLink();
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const close = useCallback(
    (clicked: boolean) => {
      if (done.current) return;
      done.current = true;
      setLeaving(true);
      window.setTimeout(() => finish.current(clicked), LEAVE_MS);
      if (clicked) openLink(link);
    },
    [link, openLink],
  );
  return { leaving, close };
}

function AvisoToast({ item }: { item: NotifItem }) {
  const content = item.content as AvisoContent;
  const { leaving, close } = useLeave((clicked) => void dismissPopup(item, clicked), content.ctaUrl);
  return (
    <AvisoCard
      content={content}
      timeLabel="agora"
      className={leaving ? 'ann-leave-right' : 'ann-enter-right'}
      onClose={() => close(false)}
      onCta={content.ctaUrl ? () => close(true) : undefined}
    />
  );
}

/** Fundo escuro + foco preso dentro + Esc fecha + scroll da página travado. */
function Overlay({
  leaving,
  onClose,
  labelledBy,
  maxWidth,
  children,
}: {
  leaving: boolean;
  onClose: () => void;
  labelledBy?: string;
  maxWidth: number;
  children: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const destravar = travarScrollDaPagina();
    const before = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(boxRef.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), a[href]') ?? []).filter(
        (el) => !el.hasAttribute('disabled'),
      );
    // Foco na própria janela (leitor de tela anuncia; Tab já cai no botão)
    // sem acender o anel de foco no botão logo que abre.
    const first = window.setTimeout(() => boxRef.current?.focus({ preventScroll: true }), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const a = list[0];
      const z = list[list.length - 1];
      if (document.activeElement === boxRef.current) {
        e.preventDefault();
        (e.shiftKey ? z : a).focus();
      } else if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener('keydown', onKey, true);
      destravar();
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  // Portal no body: o <main> tem filter no tema escuro, e fixed dentro dele
  // vira relativo ao main (a janela rolaria junto com a página).
  return createPortal(
    <div className="ann-root ann-overlay" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className={'ann-overlay__veil ' + (leaving ? 'ann-veil--out' : 'ann-veil')} onClick={() => closeRef.current()} />
      <div ref={boxRef} tabIndex={-1} className={'ann-overlay__box outline-none ' + (leaving ? 'ann-pop--out' : 'ann-pop')} style={{ maxWidth }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function PromoWindow({ item, onFinish }: { item: NotifItem; onFinish: (clicked: boolean) => void }) {
  const content = item.content as PromoContent;
  const { leaving, close } = useLeave(onFinish, content.ctaUrl);
  const titleId = useId();
  return (
    <Overlay leaving={leaving} onClose={() => close(false)} labelledBy={titleId} maxWidth={940}>
      <PromoBanner
        content={content}
        endsAt={item.live ? item.endsAt : null}
        animate
        titleId={titleId}
        onClose={() => close(false)}
        onLater={() => close(false)}
        onCta={content.ctaUrl ? () => close(true) : undefined}
      />
    </Overlay>
  );
}

export function AvisoWindow({ item, onFinish, timeLabel }: { item: NotifItem; onFinish: (clicked: boolean) => void; timeLabel?: string | null }) {
  const content = item.content as AvisoContent;
  const { leaving, close } = useLeave(onFinish, content.ctaUrl);
  return (
    <Overlay leaving={leaving} onClose={() => close(false)} maxWidth={400}>
      <AvisoCard
        content={content}
        timeLabel={timeLabel}
        className="mx-auto"
        onClose={() => close(false)}
        onCta={content.ctaUrl ? () => close(true) : undefined}
      />
    </Overlay>
  );
}
