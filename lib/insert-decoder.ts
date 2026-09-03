/**
 * LEITOR DE QUADROS de um insert — decodificação EXATA, sem relógio e sem seek.
 *
 * Por que existe (03.09). As duas formas anteriores de tirar o quadro de um
 * insert erram por motivos opostos:
 *
 *  · `<video>` + seek: em H.264 de GOP longo cada busca re-decodifica desde o
 *    keyframe. Passa do orçamento, o quadro VELHO é desenhado e o insert
 *    "pula de frame em frame".
 *  · `<video>` tocando em tempo real: o render compõe mais devagar que o
 *    relógio, o insert corre à frente, o corretor pausa, retoma, corre de novo
 *    — um liga-desliga 30x por segundo que aparece como tranco.
 *
 * Aqui o insert é DEMUXADO e DECODIFICADO em ordem, igual ao vídeo principal:
 * pra cada instante pedido devolve-se o quadro cujo PTS é o certo. Sem relógio,
 * sem seek, sem tranco — a fluidez é a do arquivo importado.
 *
 * E porque temos DOIS quadros vizinhos em mãos, a câmera lenta ganha
 * MISTURA (frame blending): em vez de repetir o mesmo quadro várias vezes
 * (a sensação de "frame a frame"), os vizinhos são cruzados na proporção
 * exata do instante. É o que faz uma desaceleração leve parecer suave.
 */

import { createFile, MP4BoxBuffer, type Movie, type Sample } from 'mp4box';
import { trackDescription } from './typography/export';

/** Acima disto o arquivo não é lido inteiro na memória — cai pro `<video>`. */
const TETO_BYTES = 320 * 1024 * 1024;

export type LeitorDeQuadros = {
  largura: number;
  altura: number;
  /**
   * O quadro do instante `t` (segundos DENTRO do arquivo), já misturado com o
   * vizinho quando `suavizar` é true. Devolve `null` quando não há quadro.
   */
  irPara(t: number, suavizar: boolean): Promise<CanvasImageSource | null>;
  fechar(): void;
};

type Amostra = { data: Uint8Array; ctsUs: number; durUs: number; chave: boolean };

/**
 * Abre o leitor. Devolve `null` quando o arquivo não serve (sem moov, codec
 * não suportado, grande demais) — o chamador cai no `<video>`.
 */
export async function abrirLeitorDeQuadros(blob: Blob): Promise<LeitorDeQuadros | null> {
  if (typeof VideoDecoder === 'undefined' || blob.size > TETO_BYTES) return null;

  let mp4: ReturnType<typeof createFile>;
  try {
    mp4 = createFile(true);
  } catch {
    return null;
  }

  let movie: Movie | null = null;
  let erro = false;
  const brutas: Sample[] = [];
  mp4.onReady = (m: Movie) => {
    movie = m;
  };
  mp4.onError = () => {
    erro = true;
  };
  mp4.onSamples = (_id: number, _u: unknown, s: Sample[]) => {
    for (const x of s) brutas.push(x);
  };

  try {
    const raw = await blob.arrayBuffer();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(raw, 0), true);
  } catch {
    return null;
  }
  const mv = movie as Movie | null;
  if (erro || !mv) return null;

  const trilha = mv.videoTracks?.[0];
  if (!trilha) return null;

  try {
    mp4.setExtractionOptions(trilha.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
    mp4.start();
    mp4.flush();
  } catch {
    return null;
  }
  if (brutas.length === 0) return null;

  // description do avcC/hvcC pelo MESMO helper do render principal — foi
  // testado em arquivo real e cobre avcC/hvcC/vpcC/av1C.
  const { desc } = trackDescription(mp4.getTrackById(trilha.id));
  if (!desc) return null;

  const escala = trilha.timescale || 1000;
  const amostras: Amostra[] = brutas
    .filter((s) => !!s.data)
    .map((s) => ({
      data: s.data as Uint8Array,
      ctsUs: Math.round((s.cts / s.timescale) * 1_000_000),
      durUs: Math.max(0, Math.round((s.duration / s.timescale) * 1_000_000)),
      chave: !!s.is_sync,
    }))
    .sort((a, b) => a.ctsUs - b.ctsUs);
  void escala;
  if (amostras.length === 0) return null;

  const largura = trilha.video?.width || trilha.track_width || 0;
  const altura = trilha.video?.height || trilha.track_height || 0;
  if (!(largura > 0) || !(altura > 0)) return null;

  // mesma dica do render principal: sem ela o Chrome decodifica por SOFTWARE
  const base: VideoDecoderConfig = {
    codec: trilha.codec,
    description: desc,
  };
  const cabe = async (c: VideoDecoderConfig) => {
    try {
      return (await VideoDecoder.isConfigSupported(c)).supported === true;
    } catch {
      return false;
    }
  };
  const rapida: VideoDecoderConfig = {
    ...base,
    hardwareAcceleration: 'prefer-hardware',
    optimizeForLatency: false,
  };
  const config: VideoDecoderConfig = (await cabe(rapida))
    ? rapida
    : (await cabe(base))
      ? base
      : (null as unknown as VideoDecoderConfig);
  if (!config) return null;

  /* ── estado da decodificação ── */
  let decoder: VideoDecoder | null = null;
  let prontos: VideoFrame[] = [];
  let proxAmostra = 0;
  let morto = false;
  let falhou = false;

  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const g = tela.getContext('2d', { alpha: false });
  if (!g) return null;

  const soltarTudo = () => {
    for (const f of prontos) {
      try {
        f.close();
      } catch {
        /* já fechado */
      }
    }
    prontos = [];
  };

  const novoDecoder = () => {
    try {
      decoder?.close();
    } catch {
      /* já fechado */
    }
    soltarTudo();
    decoder = new VideoDecoder({
      output: (f) => {
        if (morto) {
          f.close();
          return;
        }
        prontos.push(f);
        avisarNovoQuadro?.();
      },
      error: () => {
        falhou = true;
      },
    });
    decoder.configure(config);
  };

  /** Volta pro keyframe <= `alvoUs` e recomeça dali. */
  const recomecarEm = (alvoUs: number) => {
    let k = 0;
    for (let i = 0; i < amostras.length; i++) {
      if (amostras[i].ctsUs > alvoUs) break;
      if (amostras[i].chave) k = i;
    }
    novoDecoder();
    proxAmostra = k;
  };

  const alimentar = (quantas: number) => {
    if (!decoder || decoder.state !== 'configured') return;
    for (let n = 0; n < quantas && proxAmostra < amostras.length; n++, proxAmostra++) {
      const a = amostras[proxAmostra];
      decoder.decode(
        new EncodedVideoChunk({
          type: a.chave ? 'key' : 'delta',
          timestamp: a.ctsUs,
          duration: a.durUs,
          data: a.data,
        }),
      );
    }
  };

  /* ⚠ ESPERAR O QUADRO, NÃO A FILA (03.09). A 1ª versão drenava a fila
   * INTEIRA a cada quadro pedido (`while decodeQueueSize > 0` com sleep de
   * 1ms): isso serializa o decoder — ele nunca trabalha adiantado e o render
   * com insert ficou ~25x tempo real. Agora o `output` avisa quem espera, e
   * a decodificação segue PIPELINE: enquanto o render compõe um quadro, o
   * decoder já está produzindo os próximos. */
  let avisarNovoQuadro: (() => void) | null = null;
  /* ⚠ CORRIDA DO AVISO (03.09). A 1ª versão registrava o aviso DEPOIS de
   * mandar decodificar; quando o quadro chegava nesse meio-tempo o aviso não
   * existia ainda, ninguém era acordado e a espera pagava o timer inteiro.
   * Medido: ~366ms por quadro de insert, quase o teto do timer. Agora quem
   * espera passa a CONDIÇÃO: se ela já vale, volta na hora; e o timer é curto,
   * então mesmo um aviso perdido custa pouco. */
  const esperarQuadro = (jaTem: () => boolean) => {
    if (jaTem()) return Promise.resolve();
    return new Promise<void>((res) => {
      let fim = false;
      const terminar = () => {
        if (fim) return;
        fim = true;
        clearTimeout(tm);
        avisarNovoQuadro = null;
        res();
      };
      // acorda a CADA quadro novo, não só quando o alvo chegou: é o laço de
      // fora que decide continuar — e é lá que o decoder é realimentado. Só
      // esperar o alvo fazia cada volta intermediária dormir o timer inteiro.
      const tm = setTimeout(terminar, 50);
      avisarNovoQuadro = terminar;
      if (jaTem()) terminar();
    });
  };

  novoDecoder();

  return {
    largura,
    altura,

    async irPara(t: number, suavizar: boolean): Promise<CanvasImageSource | null> {
      if (morto || falhou) return null;
      const alvoUs = Math.max(0, Math.round(t * 1_000_000));

      // pediu ANTES do que já temos? volta pro keyframe (raro: só no laço)
      const primeiro = prontos[0];
      if (primeiro && alvoUs < primeiro.timestamp - 1000) recomecarEm(alvoUs);
      if (prontos.length === 0 && proxAmostra === 0) recomecarEm(alvoUs);

      // decodifica pra frente até ter um quadro DEPOIS do alvo (ou acabar)
      let voltas = 0;
      while (!falhou && voltas < 400) {
        const ultimo = prontos[prontos.length - 1];
        if (ultimo && ultimo.timestamp > alvoUs) break;
        if (proxAmostra >= amostras.length) {
          if (decoder && decoder.state === 'configured') {
            try {
              await decoder.flush();
            } catch {
              /* fim do fluxo */
            }
          }
          break;
        }
        /* ⚠⚠ PODAR ENQUANTO BUSCA (03.09). O VideoDecoder PARA de produzir
         * quando o app segura quadros de saída demais — e este laço acumulava
         * `prontos` sem soltar nada até o fim da chamada. Com fila funda dava
         * impasse: o decoder parava, ninguém era avisado, e a busca queimava
         * as 400 voltas. O render travava perto do fim (visto em 96%).
         * Aqui só interessam o quadro <= alvo e os DEPOIS dele; tudo que
         * ficou pra trás é solto na hora, e o decoder nunca fica sem buffer. */
        let corte = -1;
        for (let i = 0; i < prontos.length; i++) {
          if (prontos[i].timestamp <= alvoUs) corte = i;
          else break;
        }
        if (corte > 0) {
          for (let i = 0; i < corte; i++) {
            try {
              prontos[i].close();
            } catch {
              /* já fechado */
            }
          }
          prontos = prontos.slice(corte);
        }
        // mantém o decoder abastecido sem afogá-lo em quadros de saída
        if (decoder && decoder.decodeQueueSize < 8) alimentar(6);
        await esperarQuadro(() => {
          const u = prontos[prontos.length - 1];
          return !!u && u.timestamp > alvoUs;
        });
        voltas++;
      }
      if (voltas >= 400) {
        console.warn(
          `[insert-decoder] busca esgotou as voltas · alvo=${(alvoUs / 1e6).toFixed(2)}s ` +
            `prontos=${prontos.length} proxAmostra=${proxAmostra}/${amostras.length} ` +
            `fila=${decoder ? decoder.decodeQueueSize : -1} estado=${decoder ? decoder.state : 'nulo'}`,
        );
      }
      if (falhou) return null;

      // escolhe o quadro do instante: o ÚLTIMO com pts <= alvo
      let iA = -1;
      for (let i = 0; i < prontos.length; i++) {
        if (prontos[i].timestamp <= alvoUs) iA = i;
        else break;
      }
      if (iA < 0) iA = 0;
      const a = prontos[iA];
      if (!a) return null;
      const b = prontos[iA + 1];

      g.drawImage(a, 0, 0, largura, altura);
      // MISTURA: só quando há vizinho e o instante cai ENTRE os dois. É o que
      // tira a sensação de "frame a frame" da câmera lenta — o quadro
      // intermediário existe de verdade, cruzado na proporção do instante.
      if (suavizar && b && b.timestamp > a.timestamp) {
        const alpha = (alvoUs - a.timestamp) / (b.timestamp - a.timestamp);
        if (alpha > 0.02 && alpha < 0.98) {
          g.save();
          g.globalAlpha = alpha;
          g.drawImage(b, 0, 0, largura, altura);
          g.restore();
        }
      }

      // solta o que ficou pra trás (mantém 2 de folga pro blend do próximo)
      if (iA > 1) {
        for (let i = 0; i < iA - 1; i++) {
          try {
            prontos[i].close();
          } catch {
            /* já fechado */
          }
        }
        prontos = prontos.slice(iA - 1);
      }
      return tela;
    },

    fechar() {
      morto = true;
      soltarTudo();
      try {
        decoder?.close();
      } catch {
        /* já fechado */
      }
      decoder = null;
    },
  };
}
