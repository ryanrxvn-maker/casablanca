/**
 * DURAÇÃO DE UM VÍDEO — sem depender do <video>.
 *
 * Por que este arquivo existe (02.09): a pós-produção media a duração do
 * montado com um <video preload="metadata">. Numa aba EM SEGUNDO PLANO o
 * Chrome estrangula o pipeline de mídia e o `loadedmetadata` simplesmente não
 * chega; o timeout devolvia 0 e a pós-produção ABORTAVA — o AD saía "PRONTO"
 * sem legenda e sem zoom, calado. (É o mesmo gargalo já conhecido do teste de
 * áudio: aba oculta não carrega mídia.)
 *
 * O cabeçalho do MP4 já traz a duração e lê-lo é só aritmética — nenhum
 * decoder, nenhuma política de aba. Por isso a ordem aqui é: CABEÇALHO
 * primeiro, <video> como reserva.
 */
import { createFile, MP4BoxBuffer } from 'mp4box';

/** Quanto do começo basta pro `moov` de um arquivo com faststart. */
const CABECA_BYTES = 2 * 1024 * 1024;
/** Gravação de celular põe o `moov` no FIM — a cauda cobre esse caso. */
const CAUDA_BYTES = 8 * 1024 * 1024;
const VIDEO_TIMEOUT_MS = 12_000;

export type MetaVideo = { durSec: number; width: number; height: number   /** o container tem matriz de rotação 90°/270° (gravação de celular) */
  rotacionado?: boolean;
};

/** Lê duração E dimensões no `moov` do MP4. `null` quando não é MP4/MOV. */
export async function metaPeloCabecalho(blob: Blob): Promise<MetaVideo | null> {
  try {
    const mp4 = createFile(false);
    let achou: MetaVideo | null = null;
    mp4.onReady = (info: any) => {
      const dur = info?.duration && info?.timescale ? info.duration / info.timescale : 0;
      const vt = (info?.videoTracks || [])[0];
      // `video.width/height` é o tamanho CODIFICADO; `track_width/height` é o
      // de exibição (traz a matriz de rotação aplicada). O codificado é o que
      // o canvas do render precisa.
      const w = Math.round(vt?.video?.width || vt?.track_width || 0);
      const h = Math.round(vt?.video?.height || vt?.track_height || 0);
      /* ROTAÇÃO DO CONTAINER (04.09). `track_width/height` já vem com a matriz
       * aplicada; `video.width/height` é o codificado. Quando os dois trocam
       * de lado, o arquivo tem rotação de 90°/270° — típico de gravação de
       * celular. Quem lê a metadata pelo cabeçalho (aba em segundo plano, que
       * é como o Pilot roda) PRECISA saber disso: sem essa informação a guarda
       * de rotação do render comparava codificado com codificado, passava
       * sempre, e o AD saía DEITADO sem nenhum aviso. */
      const tw = Math.round(vt?.track_width || 0);
      const th = Math.round(vt?.track_height || 0);
      const rotacionado = tw > 0 && th > 0 && w > 0 && h > 0 && Math.abs(tw - h) <= 2 && Math.abs(th - w) <= 2 && tw !== th;
      if (dur > 0 && isFinite(dur) && w > 0 && h > 0) {
        achou = { durSec: dur, width: w, height: h, rotacionado };
      }
    };
    mp4.onError = () => {};

    const tenta = async (inicio: number, fim: number) => {
      if (achou !== null) return;
      const raw = await blob.slice(inicio, fim).arrayBuffer();
      if (raw.byteLength === 0) return;
      try {
        mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(raw, inicio), false);
      } catch {
        /* pedaço sem box completo: a próxima tentativa cobre */
      }
    };

    await tenta(0, Math.min(CABECA_BYTES, blob.size));
    if (achou === null && blob.size > CABECA_BYTES) {
      // moov no fim: alimenta a cauda com o offset REAL (o mp4box costura).
      await tenta(Math.max(CABECA_BYTES, blob.size - CAUDA_BYTES), blob.size);
    }
    try {
      mp4.flush();
    } catch {
      /* ignora */
    }
    return achou;
  } catch {
    return null;
  }
}

/** Só a duração — o atalho mais usado. */
export async function duracaoPeloCabecalho(blob: Blob): Promise<number | null> {
  const m = await metaPeloCabecalho(blob);
  return m ? m.durSec : null;
}

/** Reserva: o <video>. Funciona na aba VISÍVEL; pode calar na oculta. */
export async function duracaoPeloVideo(blob: Blob, timeoutMs = VIDEO_TIMEOUT_MS): Promise<number | null> {
  if (typeof document === 'undefined') return null;
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number | null>((resolve) => {
      const v = document.createElement('video');
      const timer = setTimeout(() => resolve(null), timeoutMs);
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(isFinite(v.duration) && v.duration > 0 ? v.duration : null);
      };
      v.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      v.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A duração, custe o que custar.
 *
 * `dica` é uma duração que o chamador já conhece por outro caminho (a soma das
 * partes, por exemplo). Ela entra como ÚLTIMO recurso: é melhor um plano de
 * zoom feito sobre uma duração aproximada do que nenhum zoom.
 */
export async function duracaoDeVideo(blob: Blob, dica?: number | null): Promise<number> {
  const cab = await duracaoPeloCabecalho(blob);
  if (cab && cab > 0) return cab;
  const vid = await duracaoPeloVideo(blob);
  if (vid && vid > 0) return vid;
  if (dica && dica > 0 && isFinite(dica)) {
    console.warn('[video-duracao] cabeçalho e <video> falharam — usando a duração conhecida pelo pipeline');
    return dica;
  }
  return 0;
}
