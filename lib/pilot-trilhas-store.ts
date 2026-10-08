/**
 * BIBLIOTECA DE TRILHAS do Pilot (08.10) — SÓ BROWSER.
 *
 * O cliente sobe a trilha UMA vez e usa em quantas tasks quiser: os bytes
 * ficam no IndexedDB (`pilotTrilha:<id>`, ciclo de vida PRÓPRIO — a faxina do
 * cache não toca, ver zip-store-prune/grupoAutogerido) e a lista com nome,
 * duração e loudness fica no localStorage. Guardamos no máximo 12: a 13ª
 * apaga a mais antiga (quem cria o namespace responde pelo tamanho dele).
 *
 * O loudness (LUFS) é medido no upload, uma vez: a montagem nivela a trilha
 * NA VOZ com ele, então o "12%" de volume soa igual numa trilha masterizada
 * alta e numa baixinha.
 */

import { lufsIntegrado } from './pilot-sonoplastia';

export type TrilhaSalva = {
  id: string;
  nome: string;
  durSec: number;
  /** loudness integrado (LUFS); null = não deu pra medir (montagem usa palpite) */
  lufs: number | null;
  bytes: number;
  criadaEm: number;
};

const META_KEY = 'darkolab:pilot:trilhas';
export const TRILHAS_MAX = 12;
export const TRILHA_MAX_BYTES = 80 * 1024 * 1024;
const chave = (id: string) => `pilotTrilha:${id}`;

export function listarTrilhas(): TrilhaSalva[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(META_KEY) || '[]');
    if (!Array.isArray(bruto)) return [];
    return bruto.filter((t): t is TrilhaSalva => t && typeof t.id === 'string' && typeof t.nome === 'string')
      .sort((a, b) => b.criadaEm - a.criadaEm);
  } catch {
    return [];
  }
}

function gravarLista(lista: TrilhaSalva[]) {
  try { localStorage.setItem(META_KEY, JSON.stringify(lista)); } catch { /* modo privado: some no F5 */ }
}

/** Decodifica um áudio (ou vídeo com áudio) — null quando o navegador não abre. */
export async function decodificarAudio(blob: Blob): Promise<AudioBuffer | null> {
  const Ctx: typeof AudioContext | undefined =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ||
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => {});
  }
}

export function canaisDe(buf: AudioBuffer): Float32Array[] {
  return Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
}

/**
 * Sobe uma trilha pra biblioteca. Lança erro EM PORTUGUÊS quando o arquivo não
 * serve (formato, tamanho, mudo) — a janela mostra a frase como veio.
 */
export async function salvarTrilha(arquivo: File): Promise<TrilhaSalva> {
  if (arquivo.size > TRILHA_MAX_BYTES) {
    throw new Error(`Essa trilha tem ${(arquivo.size / 1048576).toFixed(0)}MB — o máximo é ${TRILHA_MAX_BYTES / 1048576}MB. Use um MP3.`);
  }
  const buf = await decodificarAudio(arquivo);
  if (!buf || !(buf.duration > 0.5)) {
    throw new Error('Não consegui abrir esse arquivo como áudio. Use MP3, WAV ou M4A.');
  }
  const lufs = lufsIntegrado(canaisDe(buf), buf.sampleRate);
  if (lufs == null) throw new Error('Essa trilha está muda (só silêncio). Escolha outro arquivo.');
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const { saveBlob, deleteZip } = await import('./zip-store');
  await saveBlob(chave(id), arquivo, arquivo.type || 'audio/mpeg');
  const nova: TrilhaSalva = {
    id,
    nome: arquivo.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Trilha',
    durSec: Math.round(buf.duration * 1000) / 1000,
    lufs: Math.round(lufs * 100) / 100,
    bytes: arquivo.size,
    criadaEm: Date.now(),
  };
  const lista = [nova, ...listarTrilhas().filter((t) => t.id !== id)];
  const fora = lista.slice(TRILHAS_MAX);
  gravarLista(lista.slice(0, TRILHAS_MAX));
  if (fora.length) {
    for (const t of fora) {
      try { await deleteZip(chave(t.id)); } catch { /* sobra no banco até a próxima */ }
    }
  }
  return nova;
}

export async function lerTrilha(id: string): Promise<Blob | null> {
  try {
    const { loadBlob } = await import('./zip-store');
    return await loadBlob(chave(id), 'audio/mpeg');
  } catch {
    return null;
  }
}

export async function removerTrilha(id: string): Promise<void> {
  gravarLista(listarTrilhas().filter((t) => t.id !== id));
  try {
    const { deleteZip } = await import('./zip-store');
    await deleteZip(chave(id));
  } catch { /* fica órfã no banco; não aparece mais na lista */ }
}

export function trilhaPorId(id: string | null | undefined): TrilhaSalva | null {
  if (!id) return null;
  return listarTrilhas().find((t) => t.id === id) || null;
}
