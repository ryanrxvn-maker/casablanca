'use client';

import { useEffect } from 'react';

/**
 * MODO DESCANSO das animações DECORATIVAS (05.10).
 *
 * Qualquer animação infinita na tela — por menor que seja (o pulso do
 * WhatsApp, as bolhas do fundo, o anel do selo do plano) — obriga o navegador
 * a redesenhar a janela 60x por segundo. Medido numa página parada: ~50% de um
 * núcleo só no processo de GPU, pra sempre, competindo com o CapCut e com o
 * próprio render das ferramentas.
 *
 * Enquanto a pessoa USA o site nada muda. Quando a janela perde o foco (foi
 * pro CapCut, outra aba), fica oculta, ou passa IDLE_MS sem mouse/teclado/
 * scroll, a classe `ae-calm` entra no <html> e o CSS pausa (animation-play-
 * state) só o que é enfeite: `.ae-ambient` + as classes listadas no
 * globals.css. Spinner, barra de progresso e qualquer indicador de trabalho
 * NÃO são tocados. Ao voltar, tudo continua de onde parou (sem salto).
 */
const IDLE_MS = 30_000;

export function AmbientCalm() {
  useEffect(() => {
    const root = document.documentElement;
    let calm = false;
    let last = performance.now();
    let timer: number | undefined;

    const setCalm = (v: boolean) => {
      if (v === calm) return;
      calm = v;
      root.classList.toggle('ae-calm', v);
    };

    function check() {
      timer = undefined;
      const idleFor = performance.now() - last;
      if (idleFor >= IDLE_MS) setCalm(true);
      else timer = window.setTimeout(check, IDLE_MS - idleFor);
    }

    const wake = () => {
      last = performance.now();
      setCalm(false);
      if (timer === undefined) timer = window.setTimeout(check, IDLE_MS);
    };

    // Handler barato de propósito (pointermove dispara a cada pixel): só
    // anota o horário; o timer pendente recalcula o resto sozinho.
    const onActivity = () => {
      last = performance.now();
      if (calm) setCalm(false);
      if (timer === undefined) timer = window.setTimeout(check, IDLE_MS);
    };
    const onBlur = () => setCalm(true);
    const onVisibility = () => {
      if (document.hidden) setCalm(true);
      else if (document.hasFocus()) wake();
    };

    const opts: AddEventListenerOptions = { passive: true, capture: true };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const ev of events) window.addEventListener(ev, onActivity, opts);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', onVisibility);
    timer = window.setTimeout(check, IDLE_MS);

    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity, opts);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) clearTimeout(timer);
      root.classList.remove('ae-calm');
    };
  }, []);

  return null;
}
