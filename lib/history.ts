'use client';

/**
 * Histórico geral — registro local de tudo que o usuário produziu, em todas
 * as ferramentas, com retenção de 7 dias (pedido: mínimo 5).
 *
 * Desenho:
 * - localStorage (chave versionada) — sobrevive a F5 e fechamento; nada sobe
 *   pra servidor (privacidade: nomes de arquivo ficam na máquina do usuário).
 * - logHistory() é fire-and-forget e NUNCA lança: instrumentação não pode
 *   quebrar ferramenta. Poda por idade e por teto a cada escrita.
 * - Um CustomEvent 'autoedit:history' avisa a página do histórico pra
 *   atualizar ao vivo se estiver aberta.
 */

export type HistoryKind = 'done' | 'export' | 'dispatch' | 'download';

/**
 * Referência RECUPERÁVEL de arquivo — o que torna um registro do histórico
 * baixável de novo, e não só visível. Cada evento pode carregar N referências
 * (ex.: um disparo do Pilot tem Montado + Takes + resgate via HeyGen).
 *
 * - 'vault'  → bytes guardados no cofre do histórico (IndexedDB próprio,
 *              lib/history-vault.ts) — artefatos pequenos (prints, srt, áudio…).
 * - 'zip'    → aponta pra um artefato que JÁ vive no zip-store dos disparos
 *              (batch:<id>:montado etc.) — zero custo extra de espaço.
 * - 'heygen' → receita de resgate: os videoIds do disparo. O HeyGen retém os
 *              vídeos (~60 dias), então dá pra re-baixar os takes pelo id
 *              mesmo depois do navegador ter descartado os blobs locais.
 */
export type FileRef =
  | { via: 'vault'; key: string; name: string; size?: number; mime?: string; label?: string }
  | { via: 'zip'; key: string; name: string; label?: string; taskId?: string }
  | {
      via: 'heygen';
      parts: { label: string; videoId: string }[];
      name: string;
      label?: string;
      taskId?: string;
    };

export type HistoryEvent = {
  id: string;
  /** epoch ms */
  t: number;
  /** slug da ferramenta (mesmo id das rotas: 'decupagem', 'heygen-auto'...) */
  tool: string;
  /** frase curta do que aconteceu — ex.: "ad-hook-03.mp4 decupado" */
  title: string;
  kind: HistoryKind;
  /** detalhe opcional — ex.: "31% menor · 0:42" */
  meta?: string;
  /** referências de download — presença = o registro é recuperável */
  ref?: FileRef[];
  /** evento criado automaticamente pela captura de download (candidato a fusão) */
  auto?: boolean;
};

const KEY = 'autoedit:history:v1';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 1200;

/** Nomes exibidos por ferramenta (e ordem dos filtros). */
export const HISTORY_TOOLS: { id: string; label: string }[] = [
  { id: 'clickup-pilot', label: 'ClickUp Pilot' },
  { id: 'heygen-auto', label: 'Hey Auto' },
  { id: 'auto-broll', label: 'Auto B-roll' },
  { id: 'lipsync', label: 'Lipsync' },
  { id: 'decupagem', label: 'Decupagem' },
  { id: 'decupagem-copy', label: 'Decupagem Inteligente' },
  { id: 'copy-srt', label: 'Gerador de SRT' },
  { id: 'tipografia', label: 'Legendas Automáticas' },
  { id: 'auto-cortes', label: 'Auto Cortes' },
  { id: 'camuflagem', label: 'Camuflagem' },
  { id: 'compressor', label: 'Compressor' },
  { id: 'acelerador', label: 'Mixer de Velocidade' },
  { id: 'audio-split', label: 'Dividir áudios' },
  { id: 'downloader', label: 'Downloader' },
  { id: 'fakepass', label: 'FakePrint' },
  { id: 'caixinha-pergunta', label: 'Caixinha de Pergunta' },
  { id: 'ltx-video', label: 'Vídeo do zero' },
  { id: 'normalizador', label: 'Normalizador' },
  { id: 'separador-audio', label: 'Separador de Áudio' },
  { id: 'voice-test', label: 'Isolar voz' },
];

export function historyToolLabel(id: string): string {
  return HISTORY_TOOLS.find((t) => t.id === id)?.label ?? id;
}

function safeRead(): HistoryEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e) =>
        e &&
        typeof e.t === 'number' &&
        typeof e.tool === 'string' &&
        typeof e.title === 'string',
    );
  } catch {
    return [];
  }
}

function safeWrite(events: HistoryEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    // Quota cheia: derruba a metade mais velha e tenta uma única vez.
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(events.slice(0, Math.floor(events.length / 2))),
      );
    } catch {
      /* desiste em silêncio — histórico nunca derruba ferramenta */
    }
  }
}

function prune(events: HistoryEvent[]): HistoryEvent[] {
  const cutoff = Date.now() - RETENTION_MS;
  const alive = events.filter((e) => e.t >= cutoff);
  alive.sort((a, b) => b.t - a.t);
  return alive.slice(0, MAX_EVENTS);
}

/**
 * Registra um evento. Fire-and-forget: nunca lança, nunca bloqueia.
 * Dedup leve: ignora se o evento idêntico foi gravado há <1.5s (protege
 * contra double-fire de efeitos em StrictMode/re-render).
 */
export function logHistory(ev: {
  tool: string;
  title: string;
  kind?: HistoryKind;
  meta?: string;
  ref?: FileRef[];
}) {
  if (typeof window === 'undefined') return;
  try {
    const events = safeRead();
    const now = Date.now();
    const dup = events.find(
      (e) =>
        e.tool === ev.tool &&
        e.title === ev.title &&
        e.kind === (ev.kind ?? 'done') &&
        now - e.t < 1500,
    );
    if (dup) {
      // Evento idêntico recém-gravado: se o novo traz refs e o antigo não,
      // aproveita pra anexar (double-fire de StrictMode não perde download).
      if (ev.ref?.length && !dup.ref?.length) {
        dup.ref = ev.ref;
        safeWrite(prune(events));
        window.dispatchEvent(new CustomEvent('autoedit:history'));
      }
      return;
    }
    const novo: HistoryEvent = {
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      t: now,
      tool: ev.tool,
      title: ev.title.slice(0, 160),
      kind: ev.kind ?? 'done',
      meta: ev.meta ? ev.meta.slice(0, 120) : undefined,
      ref: ev.ref?.length ? ev.ref : undefined,
    };
    // FUSÃO (captura → evento da página): se a captura automática de download
    // criou eventos provisórios pra essa ferramenta há poucos segundos e a
    // página agora registra o evento "de verdade" (título melhor), os
    // provisórios são absorvidos: as refs migram (cofre na frente — retenção
    // maior que o zip-store) e eles somem — nada de registro duplicado.
    {
      const autos = events.filter(
        (e) => e.auto && e.tool === ev.tool && now - e.t < ATTACH_WINDOW_MS && e.ref?.length,
      );
      if (autos.length > 0) {
        const doCofre: FileRef[] = [];
        for (const a of autos) for (const r of a.ref ?? []) doCofre.push(r);
        // Cofre primeiro; refs de mesmo nome viram cadeia de fallback na UI.
        novo.ref = [...doCofre, ...(novo.ref ?? [])];
        for (const a of autos) {
          const i = events.indexOf(a);
          if (i >= 0) events.splice(i, 1);
        }
      }
    }
    events.unshift(novo);
    safeWrite(prune(events));
    window.dispatchEvent(new CustomEvent('autoedit:history'));
  } catch {
    /* nunca propaga */
  }
}

/** Janela de fusão entre a captura automática do download e o logHistory da página. */
const ATTACH_WINDOW_MS = 12_000;

/**
 * Anexa uma referência de download ao evento mais recente da ferramenta que
 * ainda não tem uma (fusão evento da página → captura). Se não existir evento
 * recente, cria um provisório (auto) — que o próximo logHistory da página
 * absorve, se vier. Usado pela captura automática em lib/history-vault.ts.
 * Fire-and-forget: nunca lança.
 */
export function attachRefToRecent(opts: {
  tool: string;
  ref: FileRef;
  fallbackTitle: string;
}): 'attached' | 'created' | 'skipped' {
  if (typeof window === 'undefined') return 'skipped';
  try {
    const events = safeRead();
    const now = Date.now();
    // Double-click no mesmo download? Não duplica registro nem bytes — o
    // caller usa o 'skipped' pra descartar os bytes que acabou de guardar.
    const jaTem = events.find(
      (e) =>
        e.tool === opts.tool &&
        now - e.t < ATTACH_WINDOW_MS &&
        e.ref?.some((r) => r.name === opts.ref.name),
    );
    if (jaTem) return 'skipped';
    // Só anexa a evento de RESULTADO (done/export/download) — um 'dispatch'
    // recente não pode herdar o arquivo de outro fluxo por coincidência de tempo.
    const alvo = events.find(
      (e) =>
        e.tool === opts.tool &&
        now - e.t < ATTACH_WINDOW_MS &&
        !e.ref?.length &&
        e.kind !== 'dispatch',
    );
    let resultado: 'attached' | 'created';
    if (alvo) {
      alvo.ref = [opts.ref];
      resultado = 'attached';
    } else {
      events.unshift({
        id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        t: now,
        tool: opts.tool,
        title: opts.fallbackTitle.slice(0, 160),
        kind: 'download',
        ref: [opts.ref],
        auto: true,
      });
      resultado = 'created';
    }
    safeWrite(prune(events));
    window.dispatchEvent(new CustomEvent('autoedit:history'));
    return resultado;
  } catch {
    return 'skipped';
  }
}

/** Lê o histórico já podado (mais novo primeiro). */
export function readHistory(): HistoryEvent[] {
  if (typeof window === 'undefined') return [];
  return prune(safeRead());
}

/** Apaga tudo. */
export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent('autoedit:history'));
  } catch {
    /* noop */
  }
}
