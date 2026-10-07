'use client';

/**
 * Estilo dos emojis do FakePass: iPhone (Apple) ou Android (Google).
 *
 * Uma escolha só, valendo pra TODOS os modelos — o print e o seletor de emoji
 * leem daqui. Trocar o sistema do celular na barra de status também troca o
 * estilo (Android → emoji do Android); o botão do seletor sobrescreve quando o
 * usuário quiser outro. Lembrado no navegador (só conveniência: sem storage, o
 * padrão é iPhone).
 */

import { useSyncExternalStore } from 'react';

export type EmojiSet = 'apple' | 'google';

const KEY = 'fakepass:emojiSet';
let current: EmojiSet = 'apple';
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'apple' || v === 'google') current = v;
  } catch {
    // storage bloqueado (aba anônima etc.): fica o padrão
  }
}

export function getEmojiSet(): EmojiSet {
  load();
  return current;
}

export function setEmojiSet(v: EmojiSet) {
  load();
  if (v === current) return;
  current = v;
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    // sem storage: vale só nesta aba
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Estilo atual (re-renderiza quando muda). No servidor é sempre iPhone. */
export function useEmojiSet(): EmojiSet {
  return useSyncExternalStore(subscribe, getEmojiSet, () => 'apple');
}

export const EMOJI_SET_LABEL: Record<EmojiSet, string> = { apple: 'iPhone', google: 'Android' };
