/**
 * Voice ↔ Avatar memory.
 *
 * Quando user escolhe (ou auto-match) uma combinacao avatar+voz no ClickUp
 * Pilot ou HeyGen Auto, salvamos: voice_name normalizada → avatarId.
 *
 * Convencao do usuario: voice clones no HeyGen sao nomeadas EXATAMENTE como
 * o copy referencia o avatar — `@drrafaelsiqueira1.mp4` no docs vira voz
 * `@drrafaelsiqueira1` no HeyGen. Mas o avatarId pode ser qualquer um (foto
 * de stock, talking_photo, instant_avatar...). Memoria liga os dois.
 *
 * Usado em duas etapas:
 * 1. Quando briefing menciona `@x.mp4`, tentamos achar voz `@x` na biblioteca.
 *    Se encontrar + memoria tem avatar associado → auto-fill avatar + voz.
 * 2. Quando user pareia manualmente avatar + voz, salvamos pra proxima vez.
 *
 * Persistido em localStorage. So roda no browser. Cap de 500 entries pra
 * nao explodir; LRU drop quando exceder.
 */

const KEY = 'darkolab:voice-avatar-memory';
const MAX_ENTRIES = 500;

export type VoiceAvatarMapping = {
  voiceName: string; // canonical (lowercased, sem @ no inicio, sem .mp4)
  avatarId: string;
  avatarName: string;
  voiceId: string;
  /** Ultima vez que user usou — pra LRU eviction */
  lastUsed: number;
};

/** Normaliza voice_name pra lookup: lowercase, remove @ inicial, .mp4/.mov,
 *  e remove sufixos de versao tipo "(1)" ou " (V2)" */
export function normalizeVoiceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\.(mp4|mov|wav|mp3)$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/\s*\(v\d+\)$/i, '')
    .trim();
}

function loadAll(): Record<string, VoiceAvatarMapping> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(map: Record<string, VoiceAvatarMapping>): void {
  if (typeof window === 'undefined') return;
  // LRU eviction se passou o cap
  const entries = Object.entries(map);
  if (entries.length > MAX_ENTRIES) {
    entries.sort(([, a], [, b]) => b.lastUsed - a.lastUsed);
    const trimmed = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } else {
    localStorage.setItem(KEY, JSON.stringify(map));
  }
}

/** Busca: dado um voice_name (ja normalizado ou nao), retorna a memoria */
export function recallByVoiceName(voiceName: string): VoiceAvatarMapping | null {
  const norm = normalizeVoiceName(voiceName);
  if (!norm) return null;
  const all = loadAll();
  return all[norm] || null;
}

/** Salva pareamento voz+avatar. Chamado quando user escolhe manualmente OU
 *  quando match automatico funcionou — ambos sao "voto de confianca". */
export function rememberPairing(opts: {
  voiceName: string;
  voiceId: string;
  avatarId: string;
  avatarName: string;
}): void {
  const norm = normalizeVoiceName(opts.voiceName);
  if (!norm) return;
  const all = loadAll();
  all[norm] = {
    voiceName: norm,
    voiceId: opts.voiceId,
    avatarId: opts.avatarId,
    avatarName: opts.avatarName,
    lastUsed: Date.now(),
  };
  saveAll(all);
}

/** Apaga uma entrada. Usado quando user explicitamente limpa um avatar. */
export function forgetVoiceName(voiceName: string): void {
  const norm = normalizeVoiceName(voiceName);
  const all = loadAll();
  delete all[norm];
  saveAll(all);
}

/** Conta entradas — util pra UI mostrar "N memorias salvas". */
export function memoryCount(): number {
  return Object.keys(loadAll()).length;
}

/* ============================================================
 * Memoria AVATAR → VOZ (direcao inversa, pedido do user).
 *
 * Quando o user escolhe uma voz pra um avatar especifico, lembramos
 * avatarId → {voiceId, voiceName}. Na proxima vez que esse MESMO avatar
 * for selecionado (qualquer task), a voz volta automatica. Pode trocar
 * normalmente — ao trocar, a memoria atualiza.
 * ============================================================ */

const AV_KEY = 'darkolab:avatar-voice-memory';

export type AvatarVoiceMapping = {
  avatarId: string;
  voiceId: string;
  voiceName: string;
  lastUsed: number;
};

function loadAvAll(): Record<string, AvatarVoiceMapping> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(AV_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAvAll(map: Record<string, AvatarVoiceMapping>): void {
  if (typeof window === 'undefined') return;
  const entries = Object.entries(map);
  if (entries.length > MAX_ENTRIES) {
    entries.sort(([, a], [, b]) => b.lastUsed - a.lastUsed);
    localStorage.setItem(AV_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ENTRIES))));
  } else {
    localStorage.setItem(AV_KEY, JSON.stringify(map));
  }
}

/** Lembra a voz escolhida pra esse avatar. */
export function rememberAvatarVoice(avatarId: string, voiceId: string, voiceName: string): void {
  if (!avatarId || !voiceId) return;
  const all = loadAvAll();
  all[avatarId] = { avatarId, voiceId, voiceName: voiceName || '', lastUsed: Date.now() };
  saveAvAll(all);
}

/** Recupera a voz lembrada pra esse avatar (ou null). */
export function recallAvatarVoice(avatarId: string): AvatarVoiceMapping | null {
  if (!avatarId) return null;
  return loadAvAll()[avatarId] || null;
}

/** Esquece a voz desse avatar. */
export function forgetAvatarVoice(avatarId: string): void {
  const all = loadAvAll();
  if (all[avatarId]) {
    delete all[avatarId];
    saveAvAll(all);
  }
}
