/**
 * MISTURA o som dos INSERTS na trilha do AD (03.09).
 *
 * B-roll costuma entrar mudo — a fala do avatar é que manda. Mas há insert que
 * só funciona com o som dele (a colher mexendo, o barulho do produto), e o
 * editor precisa decidir isso por insert: liga/desliga e volume.
 *
 * Como funciona: a trilha do montado e o áudio de cada insert são decodificados
 * e somados num `OfflineAudioContext` — cada insert entra no INSTANTE da janela
 * dele, com o `volume` escolhido e na MESMA velocidade do vídeo (senão o som
 * descola da imagem). Sai um WAV que o mux normal grava no MP4.
 *
 * Nada aqui pode derrubar a entrega: qualquer falha devolve a trilha ORIGINAL
 * intacta — o AD sai com o áudio do avatar, que é o que não pode faltar.
 */

import { encodeWAV } from './audio-engine';

export type SomDeInsert = {
  /** o arquivo do insert (mp4/webm/mov) */
  blob: Blob;
  /** onde ele começa no VÍDEO FINAL (s) */
  entraEm: number;
  /** onde ele termina no vídeo final (s) */
  saiEm: number;
  /** de onde no ARQUIVO o som começa (o recorte) (s) */
  deSec: number;
  /** 0..1 */
  volume: number;
  /** velocidade do vídeo — o som acompanha pra não descolar da imagem */
  velocidade: number;
};

/** Fade nas pontas: corte seco no meio de um som estala. */
const FADE_SEC = 0.06;

/**
 * Devolve um WAV com a trilha principal + o som dos inserts.
 * Em qualquer problema devolve `null` — o chamador mantém a trilha original.
 */
export async function misturarSomDosInserts(
  trilhaPrincipal: Blob,
  sons: SomDeInsert[],
): Promise<Blob | null> {
  if (sons.length === 0) return null;
  const Ctx: typeof AudioContext | undefined =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ||
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const Offline: typeof OfflineAudioContext | undefined = (
    globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }
  ).OfflineAudioContext;
  if (!Ctx || !Offline) return null;

  const ctx = new Ctx();
  try {
    const decodificar = async (b: Blob): Promise<AudioBuffer | null> => {
      try {
        return await ctx.decodeAudioData(await b.arrayBuffer());
      } catch {
        return null; // arquivo sem trilha de áudio, ou codec que o browser não abre
      }
    };

    const principal = await decodificar(trilhaPrincipal);
    if (!principal) return null;

    // decodifica os inserts em paralelo; os que não tiverem som são ignorados
    const decodificados = await Promise.all(
      sons.map(async (s) => ({ som: s, buf: await decodificar(s.blob) })),
    );
    const validos = decodificados.filter((x) => x.buf && x.buf.duration > 0.02);
    if (validos.length === 0) return null;

    const taxa = principal.sampleRate;
    const canais = Math.max(1, Math.min(2, principal.numberOfChannels));
    const offline = new Offline(canais, principal.length, taxa);

    // 1) a trilha do AD, intocada
    const base = offline.createBufferSource();
    base.buffer = principal;
    base.connect(offline.destination);
    base.start(0);

    // 2) cada insert no ponto dele
    for (const { som, buf } of validos) {
      if (!buf) continue;
      const inicio = Math.max(0, som.entraEm);
      const dur = Math.max(0, som.saiEm - som.entraEm);
      if (!(dur > 0.05) || inicio >= principal.duration) continue;

      const src = offline.createBufferSource();
      src.buffer = buf;
      // o som acompanha a velocidade da imagem — sem isto o áudio descola
      // quando o insert é desacelerado pra caber na fala
      src.playbackRate.value = Math.max(0.25, Math.min(4, som.velocidade || 1));

      const g = offline.createGain();
      const vol = Math.max(0, Math.min(1, som.volume));
      const fade = Math.min(FADE_SEC, dur / 3);
      g.gain.setValueAtTime(0, inicio);
      g.gain.linearRampToValueAtTime(vol, inicio + fade);
      g.gain.setValueAtTime(vol, Math.max(inicio + fade, inicio + dur - fade));
      g.gain.linearRampToValueAtTime(0, inicio + dur);

      src.connect(g);
      g.connect(offline.destination);
      // `offset` é o recorte; `duration` já vem na velocidade da fonte
      const offset = Math.max(0, Math.min(som.deSec, Math.max(0, buf.duration - 0.05)));
      const sobra = buf.duration - offset;
      const pedaco = Math.min(dur * src.playbackRate.value, sobra);
      if (pedaco <= 0.02) continue;
      src.start(inicio, offset, pedaco);
    }

    const rendido = await offline.startRendering();
    return encodeWAV(rendido);
  } catch (e) {
    console.warn('[audio-mix] mistura do som dos inserts falhou — trilha original mantida:', e);
    return null;
  } finally {
    try {
      await ctx.close();
    } catch {
      /* já fechado */
    }
  }
}
