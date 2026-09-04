/**
 * ÁUDIO DO RENDER SEM FFMPEG (04.09).
 *
 * Devolver o áudio pro vídeo renderizado custava DUAS passadas de ffmpeg-wasm:
 *
 *   1. `extractAudio(file)`  → decodifica a trilha inteira pra WAV (PCM cru:
 *      ~10MB por minuto de estéreo a 48k)
 *   2. `muxAudioIntoVideo()` → lê o MP4 só-vídeo de volta, encoda AAC e
 *      escreve um MP4 novo
 *
 * Isso pesa três vezes: o tempo das duas passadas, a memória do MEMFS (que é o
 * que obriga o teto de 300MB do render), e o LOCK GLOBAL do ffmpeg — enquanto
 * um AD faz o áudio, nenhum outro anda.
 *
 * O navegador já sabe fazer os dois lados sozinho: `decodeAudioData` lê a
 * trilha direto do MP4 (não precisa extrair pra WAV) e o `AudioEncoder` do
 * WebCodecs devolve AAC que o mp4-muxer grava na MESMA passada do vídeo. Zero
 * ffmpeg, zero arquivo intermediário, zero fila.
 *
 * Qualquer tropeço aqui devolve `null` — e o chamador cai no caminho de ffmpeg
 * de sempre, que continua intacto. Áudio é o que não pode faltar num AD.
 */

/** Quadros por pedaço mandado ao encoder. 1024 é o tamanho natural do AAC. */
const QUADROS_POR_PEDACO = 1024;
/** Estéreo a 128kbps é transparente pra voz; o AD não precisa de mais. */
const BITRATE_AAC = 128_000;
/** Acima disto a trilha não cabe confortavelmente na memória como PCM. */
const TETO_SEGUNDOS = 60 * 30;

export type TrilhaAac = {
  /** o que o mp4-muxer precisa pra declarar a faixa */
  sampleRate: number;
  numberOfChannels: number;
  /** os pedaços já codificados, na ordem */
  pedacos: Array<{ chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }>;
};

function temWebCodecsDeAudio(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioData !== 'undefined' &&
    typeof AudioEncoder.isConfigSupported === 'function'
  );
}

/**
 * Decodifica o áudio de `blob` (MP4, WAV, o que o navegador abrir) e devolve
 * AAC pronto pro muxer. `null` = não deu; use o caminho de ffmpeg.
 *
 * Usa `OfflineAudioContext` de propósito: ele decodifica sem abrir o
 * dispositivo de áudio da máquina (um `AudioContext` normal sobe uma thread de
 * tempo real em alta prioridade, e isso compete com o encoder de vídeo).
 */
export async function aacDeAudio(
  blob: Blob,
  sinal?: AbortSignal,
): Promise<TrilhaAac | null> {
  if (!temWebCodecsDeAudio()) return null;
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (!Offline) return null;

  try {
    let buf: AudioBuffer;
    try {
      // 1 canal, 1 quadro, 48k: só pra ter um contexto pra decodificar — o
      // decodeAudioData ignora esses parâmetros e devolve o formato da fonte.
      const ctx = new Offline(1, 1, 48_000);
      buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      return null; // sem trilha de áudio, ou codec que o navegador não abre
    }
    if (!(buf.duration > 0) || buf.duration > TETO_SEGUNDOS) return null;

    const sampleRate = buf.sampleRate;
    const canais = Math.max(1, Math.min(2, buf.numberOfChannels));

    const config: AudioEncoderConfig = {
      codec: 'mp4a.40.2', // AAC-LC
      sampleRate,
      numberOfChannels: canais,
      bitrate: BITRATE_AAC,
    };
    try {
      const sup = await AudioEncoder.isConfigSupported(config);
      if (!sup.supported) return null;
    } catch {
      return null;
    }

    const pedacos: TrilhaAac['pedacos'] = [];
    let erro: Error | null = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => pedacos.push({ chunk, meta }),
      error: (e) => {
        erro = e instanceof Error ? e : new Error(String(e));
      },
    });
    encoder.configure(config);

    // Canais em PLANAR: o AudioBuffer já guarda assim, então não há
    // entrelaçamento a fazer — é cópia direta.
    const canaisPcm: Float32Array[] = [];
    for (let c = 0; c < canais; c++) canaisPcm.push(buf.getChannelData(c));

    const total = buf.length;
    try {
      for (let inicio = 0; inicio < total; inicio += QUADROS_POR_PEDACO) {
        if (sinal?.aborted) return null;
        if (erro) return null;
        const n = Math.min(QUADROS_POR_PEDACO, total - inicio);
        const plano = new Float32Array(n * canais);
        for (let c = 0; c < canais; c++) {
          plano.set(canaisPcm[c].subarray(inicio, inicio + n), c * n);
        }
        const dado = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: n,
          numberOfChannels: canais,
          timestamp: Math.round((inicio / sampleRate) * 1_000_000),
          data: plano,
        });
        encoder.encode(dado);
        dado.close();
        // A fila do encoder de áudio é barata, mas não é infinita: um AD de
        // 90s são ~4.200 pedaços. Deixa ela escoar por EVENTO — nunca girando.
        if (encoder.encodeQueueSize > 64) {
          await new Promise<void>((res) => {
            let fim = false;
            const ok = () => {
              if (fim) return;
              fim = true;
              clearTimeout(tm);
              encoder.removeEventListener('dequeue', ok);
              res();
            };
            const tm = setTimeout(ok, 20);
            encoder.addEventListener('dequeue', ok);
          });
        }
      }
      await encoder.flush();
    } finally {
      try {
        if (encoder.state !== 'closed') encoder.close();
      } catch {
        /* já fechado */
      }
    }
    if (erro || pedacos.length === 0) return null;

    return { sampleRate, numberOfChannels: canais, pedacos };
  } catch (e) {
    console.warn('[tipografia] áudio por WebCodecs não deu — caindo no ffmpeg:', e);
    return null;
  }
}
