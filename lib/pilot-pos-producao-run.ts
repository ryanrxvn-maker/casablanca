/**
 * ORQUESTRADOR da pós-produção do Pilot — SÓ BROWSER (ASR + render WebCodecs).
 * As decisões puras (plano de zoom, roteiro hook×body) moram em
 * [[lib/pilot-pos-producao.ts]], que compila sozinho no harness de teste;
 * este arquivo arrasta export.ts/ffmpeg e por isso vive separado.
 */

import { duracaoDeVideo } from './video-duracao';
import {
  planejarZoom,
  encaixarFronteiraNoCorte,
  separarHookBody,
  montarRoteiro,
  palavrasDoHookNoAsr,
  avisoDeFalhaDaPosProducao,
  semOQueFoiPedido,
  motivoCurto,
  type LegendaCfg,
  type ZoomCfg,
} from './pilot-pos-producao';
import type { CaptionTemplate } from './typography/caption-script';
import {
  janelasDosInserts,
  planoSmartStockFrameCompleto,
  coberturaIntegralDeJanelas,
  palcoDoLayout,
  coberturaNoInstante,
  focoEhManual,
  rostoDasAmostras,
  planoDeVelocidade,
  tempoNaMidia,
  recorteDaMidia,
  cortesDoVideo,
  INSERT_VOLUME_PADRAO,
  janelaDaHeadline,
  textoDaHeadline,
  normalizarHeadlineCfg,
  type Insert,
  type HeadlineCfg,
  type RostoAvatar,
} from './pilot-inserts';
import type { ProjetoInsert, RoteiroEdicao } from './pilot-projeto';
import {
  transicoesDasJanelas,
  type LayoutInsert,
  type TransicaoNoVideo,
} from './pilot-inserts';
import { aplicarSmartPosition, regioesDaLegenda, semSobreposicao } from './pilot-legenda-smart';
import {
  planejarSfx,
  velocidadeEfetiva,
  escalarTempos,
  fimDoGanchoNoVideo,
  type SfxCfg,
  type SfxColocado,
  type TrilhaCfg,
  type VelocidadeCfg,
} from './pilot-sonoplastia';

/* ═══════════════════════════ orquestrador (browser) ══════════════════════ */

export type PosProducaoCfg = {
  legenda: LegendaCfg;
  zoom: ZoomCfg;
  /** copy por parte, na ordem do plano (label diz o que é hook) */
  partes: Array<{ label: string; text: string }>;
  /** idioma do ASR ('pt', 'en', 'cs'...) */
  idioma: string;
  /** templates disponíveis (builtin + salvos) — resolvidos pelo caller */
  templates: CaptionTemplate[];
  /** o caller já segura o lock do ffmpeg (o pipeline SEMPRE segura) — sem
   *  isto o mux de áudio do render pede o lock de novo e trava pra sempre */
  ffmpegJaExclusivo?: boolean;
  /** INSERTS: b-roll na montagem, ancorado numa palavra da copy */
  inserts?: Insert[];
  /** HEADLINE: texto parado por cima, saindo num corte */
  headline?: HeadlineCfg;
  /** lê os bytes de uma mídia de insert (IndexedDB) */
  lerMidia?: (key: string) => Promise<Blob | null>;
  /** PROJETO EDITÁVEL (05.10): recebe o avatar limpo + o roteiro do que o
   *  render queimou (b-rolls, legenda, zoom, headline) depois de um render
   *  bom. Falhar aqui nunca afeta a montagem. */
  guardarProjeto?: (roteiro: RoteiroEdicao, avatarLimpo: Blob) => Promise<void>;
  /** MIXER DE VELOCIDADE (08.10): o montado acelera/desacelera ANTES de tudo
   *  (ASR, legenda, inserts e SFX já nascem no tempo novo) */
  velocidade?: VelocidadeCfg;
  /** SMART SFX (08.10): som nas transições + boom na virada do gancho */
  sfx?: SfxCfg;
  /** TRILHA SONORA (08.10) */
  trilha?: TrilhaCfg;
  /** lê a trilha da biblioteca do navegador (bytes + LUFS medido no upload) */
  lerTrilha?: (id: string) => Promise<{ blob: Blob; nome: string; lufs: number | null } | null>;
  onEtapa?: (msg: string) => void;
};

export type PosProducaoInfo = {
  filename: string;
  partesSec: number[] | null;
  /** label de cada parte na ordem (HOOK 1, BODY 1…) — acha a virada do gancho */
  partLabels?: string[];
  /** durações dos pedaços de cada parte depois da decupagem (jump cuts) */
  cortesInternosSec?: number[][] | null;
};

/** Palavra do ASR no shape do engine. */
type PalavraAsr = { text: string; start: number; end: number };

/** Espelho local do que o render espera (evita import cíclico com export.ts). */
type FonteLocal = {
  id: string;
  w: number;
  h: number;
  quadro: (tRel: number) => CanvasImageSource | null;
};
type PlanoInsertLocal = {
  janelas: Array<{ id: string; start: number; end: number }>;
  porId: (id: string, W: number, H: number) => { palco: unknown; focoAvatarY: number; blur?: number; rosto?: RostoAvatar | null } | null;
  cobertura: (t: number) => { cor: 'preto' | 'branco' | 'vermelho'; alpha: number } | null;
  /** recorta o avatar sem fundo (React) */
  recortador?: import('./avatar-recorte').RecortadorAvatar | null;
  fontes: Map<string, FonteLocal>;
  /** espera o quadro do instante `t` (seek do <video> do insert) */
  preparar?: (t: number) => Promise<void>;
  /** dirige os vídeos dos inserts em tempo real (caminho de reprodução) */
  aoVivo?: (t: number) => void;
  /** todos os inserts de vídeo têm leitor exato → libera o caminho RÁPIDO */
  exatos?: boolean;
  /** som dos inserts que o editor ligou */
  sons?: Array<{ blob: Blob; entraEm: number; saiEm: number; deSec: number; volume: number; velocidade: number }>;
  /** pausa todos os vídeos de insert (o principal pausou — backpressure) */
  pausar?: () => void;
};



/**
 * Aplica legenda e/ou zoom num montado. Devolve `null` quando NÃO há nada a
 * fazer ou quando algo falhou (o caller mantém o original) — o motivo vai em
 * `avisos`. Nunca lança.
 */
export async function montarPosProducao(
  blobDoMontado: Blob,
  infoDoMontado: PosProducaoInfo,
  cfg: PosProducaoCfg,
): Promise<{
  blob: Blob | null;
  avisos: string[];
  insertsOrfaos?: string[];
  /** o render de legenda/zoom/inserts/headline entrou? (o blob pode existir
   *  só pela velocidade/sonoplastia) — é isto que o selo do card lê */
  aplicouVisual?: boolean;
  /** o que a sonoplastia de fato pôs no vídeo */
  sonoplastia?: { sfx: number; trilha: boolean };
  velocidade?: number;
}> {
  let blob = blobDoMontado;
  let info = infoDoMontado;
  const avisos: string[] = [];
  /** ids de insert cuja MÍDIA sumiu do cache — o Pilot limpa a config. */
  const orfaos: string[] = [];
  // Por que o vigia abortou — o aviso tem que dizer a verdade: "ficou parado" e
  // "demorou demais" pedem coisas diferentes do editor. Fica no escopo da
  // função porque quem lê é o `catch`, lá embaixo.
  let motivoAborto: 'parado' | 'teto' | null = null;
  const querLegenda = cfg.legenda.on;
  const querZoom = cfg.zoom.on;
  const temInserts = (cfg.inserts?.length || 0) > 0 && !!cfg.lerMidia;
  const querHeadline = !!cfg.headline?.on;
  let velocidade = velocidadeEfetiva(cfg.velocidade);
  const querSfx = !!cfg.sfx?.on;
  const querTrilha = !!(cfg.trilha?.on && cfg.trilha.trilhaId && cfg.lerTrilha);
  const querVisual = querLegenda || querZoom || temInserts || querHeadline;
  if (!querVisual && velocidade === 1 && !querSfx && !querTrilha) return { blob: null, avisos, insertsOrfaos: orfaos };
  /** o mux da velocidade/sonoplastia pede o lock do ffmpeg só se o caller não o segura */
  const comFfmpeg = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (cfg.ffmpegJaExclusivo) return fn();
    const { runFfmpegExclusive } = await import('./ffmpeg-serial');
    return runFfmpegExclusive(fn);
  };
  // O que o editor LIGOU — toda mensagem de falha fala só disso (bug AD44VN:
  // só zoom ligado e o card acusava "legenda/zoom").
  const pedido = { legenda: querLegenda, zoom: querZoom, headline: querHeadline, inserts: temInserts };
  const sem = semOQueFoiPedido(pedido);

  try {
    const [{ renderTypographyVideo }, engine, grupo, roteiro, copyFix] = await Promise.all([
      import('./typography/export'),
      import('./typography/engine'),
      import('./typography/group'),
      import('./typography/caption-script'),
      import('./typography/copy-fix'),
    ]);
    const { DEFAULT_STYLE } = engine;
    const { getPreset } = await import('./typography/presets');
    const { emptyIdentity } = await import('./typography/blocks-edit');

    // duração do vídeo final (pro plano de zoom)
    // A duração vem do CABEÇALHO do MP4 (aritmética pura). O <video> só entra
    // de reserva, e a soma das partes — que o pipeline já mediu — é a última
    // linha. Antes disto, uma aba em segundo plano zerava a duração e a
    // pós-produção abortava sem dizer nada a ninguém.
    // ── MIXER DE VELOCIDADE: antes de TUDO. A fala acelerada é a que vai pro
    // ASR, então legenda, âncora dos inserts, zoom e SFX já nascem no tempo
    // novo — nada precisa ser reescalado depois. Mesmo motor do /tools/acelerador
    // (setpts + atempo: muda a velocidade sem mudar o tom da voz).
    if (velocidade !== 1) {
      try {
        cfg.onEtapa?.(`mixer de velocidade: ${velocidade.toFixed(2)}x`);
        const ffw = await import('./ffmpeg-worker');
        let acelerado: Blob | null = null;
        /* CAMINHO RÁPIDO: o áudio pelo atempo (só áudio, segundos) e o vídeo
         * pelo encoder de HARDWARE do render (o quadro de saída em t é o da
         * fonte em t × velocidade). O x264 do ffmpeg-wasm é single-thread:
         * em 1080x1920 levava ~3x a duração do AD e inchava o arquivo. */
        try {
          const audioNovo = await comFfmpeg(() => ffw.audioNaVelocidade(blob, velocidade));
          const [{ renderTypographyVideo }, engine, presets] = await Promise.all([
            import('./typography/export'), import('./typography/engine'), import('./typography/presets'),
          ]);
          const estilo = { ...engine.DEFAULT_STYLE, presetId: 'keynote' };
          const rv = await renderTypographyVideo({
            file: blob, blocks: [], preset: presets.getPreset('keynote'), style: estilo, zoom: [],
            velocidade, audioSubstituto: audioNovo, ffmpegJaExclusivo: cfg.ffmpegJaExclusivo,
            onProgress: (pr) => {
              if (pr.phase === 'frames') cfg.onEtapa?.(`mixer de velocidade: ${velocidade.toFixed(2)}x · ${Math.round((pr.ratio || 0) * 100)}%`);
            },
          });
          if (!rv.audioOk) throw new Error('o vídeo acelerado saiu sem áudio');
          acelerado = rv.blob;
          console.log(`[pos-producao] velocidade pelo encoder de ${rv.hw ? 'hardware' : 'software'} (${rv.mode})`);
        } catch (e) {
          // RESERVA: o mesmo motor do /tools/acelerador, inteiro no ffmpeg
          console.warn('[pos-producao] velocidade pelo render falhou — usando o ffmpeg:', e);
          acelerado = await comFfmpeg(() => ffw.mudarVelocidadeDaMontagem(blob, velocidade, {
            onProgress: (pr) => cfg.onEtapa?.(`mixer de velocidade: ${velocidade.toFixed(2)}x · ${Math.round((pr.ratio || 0) * 100)}%`),
          }));
        }
        if (!acelerado || acelerado.size < 50_000) throw new Error('saída vazia');
        blob = acelerado;
        info = {
          ...info,
          partesSec: escalarTempos(info.partesSec, velocidade),
          cortesInternosSec: escalarTempos(info.cortesInternosSec, velocidade),
        };
        console.log(`[pos-producao] ${info.filename}: velocidade ${velocidade}x aplicada (${(acelerado.size / 1e6).toFixed(1)}MB)`);
      } catch (e) {
        console.warn('[pos-producao] mixer de velocidade falhou:', e);
        avisos.push(`o mixer de velocidade não entrou nesta montagem — o AD saiu na velocidade original (${motivoCurto(e)}). Clica RETOMAR.`);
        velocidade = 1;
        blob = blobDoMontado;
        info = infoDoMontado;
      }
    }

    const somaPartes = (info.partesSec || []).reduce((a, b) => a + (b > 0 ? b : 0), 0);
    const durSec = await duracaoDeVideo(blob, somaPartes > 0.5 ? somaPartes : null);
    if (!durSec) {
      avisos.push(`não consegui medir a duração do vídeo montado — ele saiu ${sem}. Clica RETOMAR com a aba do Pilot visível.`);
      return { blob: null, avisos, insertsOrfaos: orfaos };
    }

    const plano = querZoom ? planejarZoom(cfg.zoom, durSec, info.partesSec, info.cortesInternosSec) : [];

    // ── ASR: serve à legenda E à âncora dos inserts ──
    // O insert é ancorado numa PALAVRA da copy; sem o ASR não há como saber em
    // que segundo ela é falada (a lib cai no rateio proporcional, que erra por
    // segundos). Então transcrevemos também quando só há insert.
    let palavrasParaAncora: PalavraAsr[] = [];
    let blocks: import('./typography/engine').Block[] = [];
    let style: import('./typography/engine').StyleState = { ...DEFAULT_STYLE, presetId: 'keynote' };
    if (!querLegenda && (temInserts || querHeadline)) {
      try {
        cfg.onEtapa?.('lendo a fala pra ancorar insert/headline');
        palavrasParaAncora = await transcreverComRetentativa(blob, cfg.idioma, durSec);
      } catch (e) {
        console.warn('[pos-producao] ASR das âncoras falhou:', e);
        avisos.push('não consegui ouvir a fala pra posicionar insert/headline — eles entraram pela estimativa da copy (podem ficar alguns segundos fora do lugar)');
      }
    }
    if (querLegenda) {
      try {
        cfg.onEtapa?.('legendando: transcrevendo');
        const palavras = await transcreverComRetentativa(blob, cfg.idioma, durSec);
        palavrasParaAncora = palavras;
        let bls = grupo.groupWords(palavras, 'rapido');

        // correção pela copy do doc (grafia + palavras comidas pelo ASR)
        const copyToda = cfg.partes.map((p) => p.text).filter(Boolean).join('\n');
        try {
          bls = copyFix.correctBlocksByCopy(bls, copyToda).blocks;
        } catch (e) {
          console.warn('[pos-producao] correção pela copy falhou:', e);
          avisos.push('a legenda saiu do que foi FALADO, sem a correção pela copy do doc — confere a grafia dos nomes próprios.');
        }

        const tpl =
          cfg.templates.find((t) => t.id === cfg.legenda.templateId) ||
          cfg.templates[0] ||
          roteiro.BUILTIN_TEMPLATES[0];
        const { hook, body } = separarHookBody(cfg.partes);
        // FRONTEIRA DO HOOK POR ALINHAMENTO: mede quantas palavras do ÁUDIO o
        // hook realmente ocupa. Sem isto a fronteira era a contagem da copy do
        // doc — e uma palavra de diferença do ASR fazia a legenda trocar de
        // estilo antes da hora (o "daqui." do AD02 saiu com o estilo do body).
        const palavrasDosBlocos = bls.flatMap((b) => b.words.map((w) => w.text));
        let fronteira = palavrasDoHookNoAsr(palavrasDosBlocos, hook);
        if (hook.trim()) {
          console.log(
            `[pos-producao] hook: ${fronteira != null ? `${fronteira} palavras no áudio` : 'alinhamento não confiável — usando a contagem da copy'}` +
              ` (copy tem ${hook.trim().split(/\s+/).length})`,
          );
        }
        // A TROCA DE ESTILO CAI NUM CORTE (03.09) — a mesma regra da
        // headline: o corte hook→body mascara a virada da legenda. Ajusta a
        // fronteira pra palavra cujo fim encosta no corte vizinho (±3
        // palavras, corte a até 0,9s); sem corte perto, fica como está.
        if (fronteira != null && info.partesSec?.length) {
          const cortesLegenda = cortesDoVideo(info.partesSec, info.cortesInternosSec);
          const finsSec = bls.flatMap((b) => b.words.map((w) => w.end / 1000));
          const ajustada = encaixarFronteiraNoCorte(finsSec, fronteira, cortesLegenda);
          if (ajustada !== fronteira) {
            console.log(`[pos-producao] hook: fronteira ${fronteira} → ${ajustada} pra virada cair no corte`);
            fronteira = ajustada;
          }
        }
        const segs = montarRoteiro(tpl, hook, body, fronteira);
        const aplicado = roteiro.applyCaptionScript(bls, segs, emptyIdentity());
        // DESENCAVALA (08.10): bloco que o ASR deixou terminando depois do
        // começo do seguinte ficava no ar POR CIMA do novo (5x num AD de 54 s)
        const desencavalado = semSobreposicao(aplicado.blocks);
        if (desencavalado.ajustes) console.log(`[pos-producao] legenda: ${desencavalado.ajustes} bloco(s) desencavalado(s)`);
        blocks = desencavalado.blocks;
        style = {
          ...DEFAULT_STYLE,
          presetId: (segs[segs.length - 1]?.style?.presetId as string) || 'keynote',
          perBlock: aplicado.blockStyles,
          highlights: aplicado.highlights,
          wordStyles: aplicado.wordStyles,
        };
      } catch (e) {
        console.warn('[pos-producao] legenda falhou:', e);
        avisos.push('a legenda não entrou nesta montagem — o vídeo saiu sem ela. Clica RETOMAR pra tentar de novo.');
        // Sem transcrição, insert e headline perdem a âncora e são posicionados
        // pela ESTIMATIVA da copy — podem sair alguns segundos fora do lugar.
        // Isso precisa ser dito, senão o editor acha que ele marcou errado.
        if ((cfg.inserts && cfg.inserts.length > 0) || cfg.headline) {
          avisos.push(
            'sem a transcrição, os inserts e a headline entraram pela estimativa da copy — podem ficar alguns segundos fora do lugar.',
          );
        }
        blocks = [];
        if (!querZoom) return { blob: null, avisos, insertsOrfaos: orfaos };
      }
    }

    // ── INSERTS: abre as mídias e monta o plano de composição ──
    // Vídeo vira um <video> que o render busca por seek (o insert é curto —
    // 2-5s — então o custo é baixo e não precisa decodificar tudo na memória).
    // Imagem vira um <img> desenhado direto.
    let planoInserts: PlanoInsertLocal | undefined;
    /** o que o render compõe, no formato do projeto editável */
    let insertsDoProjeto: ProjetoInsert[] = [];
    const fechaveis: Array<() => void> = [];
    /** formato de cada insert que ENTROU (Smart Position lê a dobra dele) */
    const layoutPorId = new Map<string, LayoutInsert>();
    /** as trocas que o render desenha — o Smart SFX bate nelas */
    let transicoesDoVideo: TransicaoNoVideo[] = [];
    if (temInserts) {
      try {
        cfg.onEtapa?.('preparando inserts');
        const fontes = new Map<string, FonteLocal>();
        const durNatural = new Map<string, number>();
        const videosPorId = new Map<string, { v: HTMLVideoElement; natural: number }>();
        // preenchido DEPOIS de conhecer as janelas (a velocidade depende delas)
        const velocidadePorId = new Map<string, ReturnType<typeof planoDeVelocidade>>();
        /** quadro já decodificado pro instante atual (o `quadro()` é síncrono) */
        const quadroProntoPorId = new Map<string, CanvasImageSource>();
        /** bytes de cada insert — a mixagem do som precisa deles */
        const blobPorId = new Map<string, Blob>();
        /** onde o recorte de cada insert começa dentro do arquivo (segundos) */
        const recortePorId = new Map<string, number>();
        /** LEITOR DE QUADROS por insert (decodificação exata) — quando existe,
         *  ele manda: o <video> vira reserva pra arquivo que não decodifica. */
        const leitorPorId = new Map<string, import('./insert-decoder').LeitorDeQuadros>();
        for (const ins of cfg.inserts!) {
          /* ⚠ `lerMidia` devolve null TANTO pra "não existe" QUANTO pra "a
           * leitura falhou" (o catch dele engole o erro). E o IndexedDB
           * rejeita quando o banco está travado por um upgrade de OUTRA aba do
           * Pilot — sessão paralela é rotina aqui. Uma tentativa a mais separa
           * o transitório do definitivo; abaixo, "sumiram TODOS" é tratado
           * como problema de banco, não como mídia apagada. */
          let blob = await cfg.lerMidia!(ins.midiaKey);
          if (!blob) blob = await cfg.lerMidia!(ins.midiaKey);
          if (!blob) {
            // Mídia varrida pela faxina do cache (o AD ficou parado tempo
            // demais). Mensagem HUMANA + o que fazer — "não voltou do
            // armazenamento" não diz nada a ninguém.
            orfaos.push(ins.id);
            avisos.push(`o arquivo do insert "${ins.midiaNome}" não está mais salvo no navegador — sobe ele de novo na janela de inserts. O AD saiu sem esse insert.`);
            continue;
          }
          const url = URL.createObjectURL(blob);
          fechaveis.push(() => URL.revokeObjectURL(url));
          blobPorId.set(ins.id, blob);
          if (ins.midiaTipo === 'imagem') {
            const img = await new Promise<HTMLImageElement | null>((res) => {
              const im = new Image();
              im.onload = () => res(im);
              im.onerror = () => res(null);
              im.src = url;
            });
            if (!img) { avisos.push(`a imagem do insert "${ins.midiaNome}" não abriu — troca o arquivo na janela de inserts`); continue; }
            fontes.set(ins.id, { id: ins.id, w: img.naturalWidth, h: img.naturalHeight, quadro: () => img });
          } else {
            const v = document.createElement('video');
            v.muted = true;
            v.preload = 'auto';
            v.playsInline = true;
            const abriu = await new Promise<boolean>((res) => {
              const t = setTimeout(() => res(false), 15000);
              v.onloadeddata = () => { clearTimeout(t); res(true); };
              v.onerror = () => { clearTimeout(t); res(false); };
              v.src = url;
            });
            if (!abriu) { avisos.push(`o vídeo do insert "${ins.midiaNome}" não abriu — converte pra MP4 (H.264) e sobe de novo`); continue; }
            /* SOLTAR O <video> NO FIM (04.09). Revogar a object URL não basta:
             * o elemento continua segurando a mídia DECODIFICADA. Numa fila de
             * várias tasks, cada montagem deixava um player vivo por insert. */
            fechaveis.push(() => {
              try {
                v.pause();
                v.removeAttribute('src');
                v.load();
              } catch {
                /* já solto */
              }
            });
            // A duração vem do CABEÇALHO do arquivo, não do `v.duration`
            // (02.09). O `onloadeddata` dispara com o 1º quadro pronto, e aí a
            // duração ainda pode vir errada ou infinita — e uma duração menor
            // que a real fazia o encaixe achar que faltava mídia e entregar
            // uma câmera lenta extrema num insert que na verdade SOBRAVA.
            const doCabecalho = await duracaoDeVideo(blob, 0).catch(() => 0);
            const arquivoSec = doCabecalho > 0 ? doCabecalho : (isFinite(v.duration) ? v.duration : 0) || 0;
            // RECORTE: só o pedaço escolhido do arquivo é o insert. Tudo
            // daqui pra frente enxerga a duração do RECORTE — o encaixe, a
            // velocidade e o seek. O resto do arquivo não existe.
            const rec = recorteDaMidia(ins, arquivoSec);
            const natural = rec.dur;
            recortePorId.set(ins.id, rec.de);
            durNatural.set(ins.id, natural);
            videosPorId.set(ins.id, { v, natural });
            // LEITOR DE QUADROS (03.09): decodifica em ordem e entrega o quadro
            // EXATO de cada instante — sem relógio (que fazia o insert correr
            // à frente do render e trancar) e sem seek (que estourava o
            // orçamento em GOP longo e repetia quadro). Falhou? o <video>
            // continua valendo, nada regride.
            try {
              const { abrirLeitorDeQuadros } = await import('./insert-decoder');
              const leitor = await abrirLeitorDeQuadros(blob);
              /* ⚠ ROTAÇÃO DO CONTAINER (04.09). B-roll de celular vem
               * codificado 1920x1080 com matriz de rotação de 90° no
               * container. O `VideoFrame` IGNORA essa matriz, então o leitor
               * enxerga 1920x1080 deitado; já o `<video>` reporta
               * `videoWidth/Height` JÁ rotacionados (1080x1920) — e é esse par
               * que registramos como tamanho da fonte. O recorte sairia
               * calculado contra a medida errada e o insert entrava deitado e
               * cortado, calado. Quando as duas medidas divergem, o leitor é
               * descartado e o `<video>` assume: ele desenha rotacionado
               * certo. */
              if (leitor && (leitor.largura !== v.videoWidth || leitor.altura !== v.videoHeight)) {
                console.warn(
                  `[pos-producao] insert "${ins.midiaNome}": container rotacionado ` +
                    `(leitor ${leitor.largura}x${leitor.altura} != player ${v.videoWidth}x${v.videoHeight}) — usando o player`,
                );
                leitor.fechar();
              } else if (leitor) {
                leitorPorId.set(ins.id, leitor);
                fechaveis.push(() => leitor.fechar());
                console.log(`[pos-producao] insert "${ins.midiaNome}": decodificação exata ligada`);
              } else {
                console.warn(`[pos-producao] insert "${ins.midiaNome}": sem decodificação exata — usando o player`);
              }
            } catch (e) {
              console.warn(`[pos-producao] insert "${ins.midiaNome}": leitor falhou, usando o player:`, e);
            }
            // O `quadro` só sabe o tempo DA JANELA; a conversão pro tempo da
            // MÍDIA depende do plano de velocidade, que só existe depois de a
            // janela ser calculada. Por isso ele consulta o mapa na hora.
            fontes.set(ins.id, {
              id: ins.id,
              w: v.videoWidth,
              h: v.videoHeight,
              quadro: (tRel: number) => {
                // o leitor exato já deixou o quadro pronto no `preparar`
                const doLeitor = quadroProntoPorId.get(ins.id);
                if (doLeitor) return doLeitor;
                const pv = velocidadePorId.get(ins.id);
                const inicio = recortePorId.get(ins.id) || 0;
                const alvo = pv
                  ? tempoNaMidia(tRel, pv, natural, inicio)
                  : inicio + Math.min(tRel, Math.max(0, natural - 0.04));
                // TOCANDO (caminho de reprodução), o vídeo anda sozinho: seek
                // aqui brigaria com o play a cada frame. A correção de deriva
                // grande é do aoVivo; parado, o seek fino continua valendo.
                const tolerancia = v.paused ? 0.03 : 0.3;
                /* ⚠ SÓ CORRIGE QUANDO ESTÁ ATRASADO (04.09). O `aoVivo` PAUSA
                 * de propósito o insert que correu à frente e espera o render
                 * alcançar. Um seek "pra trás" aqui desfazia justamente essa
                 * espera: o insert voltava um quadro e andava de novo, que é o
                 * tranco que a pausa existe pra evitar. Adiantado, deixa o
                 * alvo chegar até ele. */
                if (alvo - v.currentTime > tolerancia) v.currentTime = alvo;
                return v;
              },
            });
          }
        }

        /* ⚠ SUMIRAM TODOS = BANCO, NÃO MÍDIA (04.09). Quando o IndexedDB está
         * travado (upgrade de outra aba do Pilot), TODA leitura falha e todo
         * insert vira "órfão". Quem chama usa `insertsOrfaos` pra LIMPAR a
         * configuração do editor — então um problema passageiro apagava o
         * trabalho de marcação pra sempre. Mídia realmente apagada pela faxina
         * do cache some UMA de cada vez; todas de uma vez é o banco. */
        if (cfg.inserts!.length > 1 && orfaos.length === cfg.inserts!.length) {
          orfaos.length = 0;
          // tira SÓ os avisos de órfão — os outros (legenda, ASR) continuam
          for (let k = avisos.length - 1; k >= 0; k--) {
            if (avisos[k].includes('não está mais salvo no navegador')) avisos.splice(k, 1);
          }
          avisos.push(
            'não consegui ler os arquivos dos inserts agora (o armazenamento do navegador ficou ocupado, normalmente por outra aba do Pilot aberta). Os inserts foram MANTIDOS na configuração — fecha as outras abas do Pilot e clica RETOMAR. O AD saiu sem eles.',
          );
        }

        const usaveis = cfg.inserts!.filter((i) => fontes.has(i.id));
        if (usaveis.length > 0) {
          const janelas = janelasDosInserts(
            usaveis,
            cfg.partes,
            palavrasParaAncora,
            durSec,
            (id) => durNatural.get(id) ?? null,
            cortesDoVideo(info.partesSec, info.cortesInternosSec),
          );
          if (cfg.inserts!.some((ins) => ins.source === 'stockframe' && ins.stockFrame?.smart === true && ins.stockFrame.coverage === 100)
              && (usaveis.length !== cfg.inserts!.length
                || !planoSmartStockFrameCompleto(usaveis, cfg.partes)
                || janelas.length !== usaveis.length
                || !coberturaIntegralDeJanelas(janelas, durSec))) {
            avisos.push('a cobertura 100% do StockFrame não entrou integralmente nesta montagem — algum take ou trecho ficou indisponível. O Pilot não deve entregar este vídeo como 100%; recupere os inserts e clique RETOMAR.');
          }
          // ⭐ AGORA dá pra decidir a velocidade: cada mídia tem que caber na
          // janela dela. Longa CORTA (roda normal e morre no fim da parte),
          // curta DESACELERA. É o que faz o insert preencher o trecho da fala
          // sem buraco e sem sobra.
          /* Um insert pode ser DESCARTADO no cálculo da janela (não sobrou
           * 0,25s no trecho, duas marcações na mesma parte se empurrando, ou a
           * parte da copy não existe mais). Isso acontecia em SILÊNCIO: o AD
           * saía sem o insert e o editor só descobria assistindo. */
          for (const i of usaveis) {
            if (!janelas.some((j) => j.id === i.id)) {
              avisos.push(
                `o insert "${i.midiaNome}" não coube no trecho de copy marcado — ele não entrou nesta montagem. Marca outro trecho na janela de inserts.`,
              );
            }
          }
          for (const j of janelas) {
            const nat = durNatural.get(j.id) || 0;
            const pv = planoDeVelocidade(nat, j.end - j.start);
            velocidadePorId.set(j.id, pv);
            if (pv.motivo !== 'exato' && pv.motivo !== 'sem-duracao') {
              const nome = usaveis.find((x) => x.id === j.id)?.midiaNome || j.id;
              console.log(
                `[pos-producao] insert "${nome}": ${nat.toFixed(1)}s em janela de ` +
                  `${(j.end - j.start).toFixed(1)}s → ${pv.motivo}` +
                  (pv.velocidade !== 1 ? ` (${pv.velocidade.toFixed(2)}x)` : ''),
              );
              if (pv.motivo === 'desacelerou-e-congelou') {
                avisos.push(
                  `insert "${nome}" é curto demais pro trecho (${nat.toFixed(1)}s em ${(j.end - j.start).toFixed(1)}s): ` +
                    'desacelerou até o limite e o resto ficou no último frame',
                );
              }
            }
          }
          const porId = new Map(usaveis.map((i) => [i.id, i]));
          for (const i of usaveis) layoutPorId.set(i.id, i.layout);
          // a MESMA lista de trocas que o `cobertura` abaixo pinta
          transicoesDoVideo = transicoesDasJanelas(janelas, (id) => porId.get(id)?.transicao || 'nenhuma');
          // ENQUADRAMENTO PELO ROSTO: nas janelas que mostram o avatar
          // (dividida, mescla, react) o rosto é medido no próprio montado e o
          // render põe ele no lugar certo — a não ser que o editor tenha
          // arrastado o foco na mão (aí vale o dele).
          const precisaRosto = janelas.filter((j) => {
            const ins = porId.get(j.id);
            return !!ins && ins.layout.tipo !== 'cheia' && !focoEhManual(ins);
          });
          if (precisaRosto.length) cfg.onEtapa?.('enquadrando o rosto do avatar');
          const rostoPorId = await rostosDasJanelas(blob, precisaRosto);
          if (precisaRosto.length) {
            console.log(`[pos-producao] rosto do avatar: ${rostoPorId.size}/${precisaRosto.length} janela(s) enquadradas pelo rosto`);
          }
          // REACT: o avatar sai SEM FUNDO — o segmentador só carrega se tiver
          // React no AD. Sem ele o avatar entra num card no canto (nunca some).
          let recortador: import('./avatar-recorte').RecortadorAvatar | null = null;
          if (janelas.some((j) => porId.get(j.id)?.layout.tipo === 'react')) {
            cfg.onEtapa?.('preparando o recorte do avatar (react)');
            try {
              const { criarRecortadorAvatar } = await import('./avatar-recorte');
              recortador = await criarRecortadorAvatar();
            } catch (e) {
              console.warn('[pos-producao] recorte do avatar indisponível:', e);
              recortador = null;
            }
            if (recortador) {
              const r = recortador;
              fechaveis.push(() => r.fechar());
            } else {
              avisos.push('o recorte do fundo do avatar (formato React) não carregou nesta máquina — o avatar entrou num quadro arredondado no canto. Clica RETOMAR pra tentar de novo.');
            }
          }
          // PROJETO EDITÁVEL: exatamente o que o render vai compor — janela,
          // recorte, velocidade e congelamento de cada b-roll.
          insertsDoProjeto = janelas.flatMap((j) => {
            const ins = porId.get(j.id);
            const fonte = fontes.get(j.id);
            if (!ins || !fonte) return [];
            const pv = velocidadePorId.get(j.id);
            return [{
              id: ins.id, nome: ins.midiaNome, tipo: ins.midiaTipo, midiaKey: ins.midiaKey,
              start: j.start, end: j.end,
              deSec: recortePorId.get(j.id) || 0,
              naturalSec: durNatural.get(j.id) || 0,
              velocidade: pv?.velocidade ?? 1,
              congelaApos: pv?.congelaApos ?? 0,
              layout: ins.layout, transicao: ins.transicao || 'nenhuma',
              audio: !!ins.audio && ins.midiaTipo === 'video',
              volume: typeof ins.volume === 'number' ? ins.volume : INSERT_VOLUME_PADRAO,
              focoAvatarY: ins.focoAvatarY, rosto: rostoPorId.get(j.id) ?? null, w: fonte.w, h: fonte.h,
            }];
          });
          /* CAMINHO RÁPIDO TAMBÉM COM INSERT DE VÍDEO (04.09).
           *
           * Por algumas horas isto ficou restrito a imagem, porque o render
           * travava perto do fim (91%) e eu li aquilo como "dois decoders de
           * hardware disputando o pool de quadros do chip". Era diagnóstico
           * errado: o travamento era o `flush` do decoder principal esperando
           * sem ninguém drenar os quadros que chegavam — corrigido no
           * export.ts. Medido depois, com insert de VÍDEO no caminho rápido:
           * 420 quadros em 8,7s, a mesma velocidade do render sem insert.
           *
           * Ganho real: o caminho rápido não depende de <video> tocando nem de
           * requestVideoFrameCallback, os dois estrangulados em ABA OCULTA —
           * que é como o Pilot roda de verdade. Era essa cascata (reprodução
           * travada -> seek re-decodificando desde o keyframe a cada quadro)
           * que produzia AD de horas.
           *
           * Insert que NÃO conseguiu leitor (arquivo grande demais, codec que
           * o decoder não abre) continua caindo na reprodução, intacta. */
          const exatos = usaveis.every(
            (i) => !videosPorId.has(i.id) || leitorPorId.has(i.id),
          );
          console.log(
            `[pos-producao] inserts: ${usaveis.length} · ${exatos ? 'todos com quadro exato — caminho rápido' : 'algum sem leitor — caminho de reprodução'}`,
          );
          planoInserts = {
            janelas,
            exatos,
            // W/H vêm do RENDER (o vídeo real), não de uma régua fixa — senão
            // o card do avatar cai fora da tela em qualquer resolução != 1080p.
            porId: (id: string, W: number, H: number) => {
              const ins = porId.get(id);
              if (!ins) return null;
              return {
                palco: palcoDoLayout(ins.layout, W, H),
                focoAvatarY: ins.focoAvatarY,
                blur: velocidadePorId.get(id)?.blur ?? 0,
                rosto: rostoPorId.get(id) ?? null,
              };
            },
            recortador,
            cobertura: (t: number) =>
              coberturaNoInstante(t, janelas, (id) => porId.get(id)?.transicao || 'nenhuma'),
            fontes,
            // SOM: só dos inserts que o editor LIGOU. Vídeo mudo entra mudo,
            // como sempre — nenhum AD já montado muda de som sozinho.
            sons: janelas
              .map((j) => {
                const ins = porId.get(j.id);
                const b = blobPorId.get(j.id);
                if (!ins?.audio || !b || ins.midiaTipo !== 'video') return null;
                const pv = velocidadePorId.get(j.id);
                /* O som acaba onde a IMAGEM acaba. Quando a mídia é mais
                 * curta que a janela, o plano CONGELA o último quadro a partir
                 * de `congelaApos` — mas o som seguia tocando até o fim da
                 * janela, ou seja, continuava depois de a imagem já ter
                 * parado. */
                const fimReal =
                  pv && pv.congelaApos > 0
                    ? Math.min(j.end, j.start + pv.congelaApos)
                    : j.end;
                return {
                  blob: b,
                  entraEm: j.start,
                  saiEm: fimReal,
                  deSec: recortePorId.get(j.id) || 0,
                  volume: typeof ins.volume === 'number' ? ins.volume : INSERT_VOLUME_PADRAO,
                  velocidade: pv?.velocidade ?? 1,
                };
              })
              .filter((x): x is NonNullable<typeof x> => !!x),
            // ESPERA o quadro do insert chegar (02.09). O quadro() síncrono
            // disparava o seek e desenhava o frame VELHO — o render compunha
            // mais rápido do que o <video> completava seeks e o insert saía
            // "frame a frame, parece 5fps", no take longo e no curto. Aqui o
            // render espera o 'seeked' de verdade antes de desenhar.
            // DRIVER do caminho de reprodução (03.09): cada insert TOCA com
            // playbackRate = velocidade do plano enquanto a janela dele está
            // viva; congela no ponto certo; pausa fora. A deriva grande
            // (>0,25s) é corrigida com um seek — o resto é o play cuidando.
            pausar: () => {
              for (const ent of videosPorId.values()) {
                if (!ent.v.paused) ent.v.pause();
              }
            },
            aoVivo: (t: number) => {
              for (const jan of janelas) {
                /* Com LEITOR EXATO não há vídeo pra dirigir: o quadro vem do
                 * decoder no `preparar`, e os TRÊS caminhos do render chamam
                 * `preparar` (decode, seek e — desde 04.09 — reprodução).
                 * ⚠ Este `continue` só é correto ENQUANTO isso for verdade: por
                 * algumas horas de 04.09 a reprodução não chamava `preparar`, e
                 * então o insert de vídeo ficava sem motorista nenhum e entrava
                 * CONGELADO no AD, calado. Se um caminho novo aparecer sem
                 * `preparar`, este pulo volta a ser um bug. */
                if (leitorPorId.has(jan.id)) continue;
                const ent = videosPorId.get(jan.id);
                if (!ent) continue; // imagem: nada a dirigir
                const vv = ent.v;
                const dentro = t >= jan.start - 0.3 && t < jan.end;
                if (!dentro) {
                  if (!vv.paused) vv.pause();
                  continue;
                }
                const pv = velocidadePorId.get(jan.id);
                const natural = durNatural.get(jan.id) || ent.natural;
                const inicio = recortePorId.get(jan.id) || 0;
                const tRel = Math.max(0, t - jan.start);
                const alvo = pv
                  ? tempoNaMidia(tRel, pv, natural, inicio)
                  : inicio + Math.min(tRel, Math.max(0, natural - 0.04));
                const congelou = !!pv && pv.congelaApos > 0 && tRel >= pv.congelaApos - 0.02;
                if (congelou) {
                  if (!vv.paused) vv.pause();
                  if (Math.abs(vv.currentTime - alvo) > 0.08) vv.currentTime = alvo;
                  continue;
                }
                const rate = pv?.velocidade ?? 1;
                if (Math.abs(vv.playbackRate - rate) > 0.01) vv.playbackRate = rate;
                // CORREÇÃO DE DERIVA SEM SNAP-BACK (03.09/2): seek pra TRÁS no
                // meio do play é o "piscando/travando" que saiu num AD real —
                // o quadro volta, anda, volta. Regra nova:
                //   ADIANTOU (> 1,5 frame) → PAUSA e deixa o alvo alcançar
                //     (segurar um quadro por alguns ticks é invisível);
                //   ATRASOU (> 0,12s)      → seek pra FRENTE (decode
                //     incremental, barato) e segue tocando.
                const deriva = vv.currentTime - alvo;
                if (deriva > 0.05) {
                  if (!vv.paused) vv.pause();
                  continue;
                }
                if (deriva < -0.12) vv.currentTime = alvo;
                if (vv.paused) void vv.play().catch(() => { /* quadro() cobre com seek */ });
              }
            },
            preparar: async (t: number) => {
              const jan = janelas.find((j) => t >= j.start && t < j.end);
              if (!jan) return;
              const ent = videosPorId.get(jan.id);
              if (!ent) return; // imagem: sempre pronta

              // ── CAMINHO EXATO: o leitor entrega o quadro do instante ──
              const leitor = leitorPorId.get(jan.id);
              if (leitor) {
                const pvL = velocidadePorId.get(jan.id);
                const naturalL = durNatural.get(jan.id) || ent.natural;
                const inicioL = recortePorId.get(jan.id) || 0;
                const alvoL = pvL
                  ? tempoNaMidia(t - jan.start, pvL, naturalL, inicioL)
                  : inicioL + Math.min(t - jan.start, Math.max(0, naturalL - 0.04));
                // MISTURA só quando há câmera lenta de verdade: é ela que tira
                // o "frame a frame". Em velocidade normal misturar borraria o
                // movimento sem motivo.
                const suavizar = !!pvL && pvL.velocidade < 0.99;
                try {
                  const quadro = await leitor.irPara(alvoL, suavizar);
                  if (quadro) {
                    quadroProntoPorId.set(jan.id, quadro);
                    return;
                  }
                } catch (e) {
                  console.warn('[pos-producao] leitor exato falhou no meio — caindo pro player:', e);
                }
                quadroProntoPorId.delete(jan.id);
              }
              const pv = velocidadePorId.get(jan.id);
              const natural = durNatural.get(jan.id) || ent.natural;
              const inicio = recortePorId.get(jan.id) || 0;
              const tRel = t - jan.start;
              const alvo = pv
                ? tempoNaMidia(tRel, pv, natural, inicio)
                : inicio + Math.min(tRel, Math.max(0, natural - 0.04));
              const v = ent.v;
              if (Math.abs(v.currentTime - alvo) <= 1 / 60) return; // já está no quadro
              await new Promise<void>((res) => {
                let feito = false;
                const fim = () => {
                  if (feito) return;
                  feito = true;
                  v.removeEventListener('seeked', fim);
                  clearTimeout(tm);
                  res();
                };
                // Teto do seek (03.09/2): 350ms era POUCO pra H.264 de GOP
                // longo (o seek re-decodifica do keyframe) — o timeout vencia,
                // o quadro VELHO era desenhado e o insert "pulava de frame em
                // frame". 1,5s cobre o pior GOP real; um seek que passar disso
                // repete UM frame e o render segue (nunca pendura).
                const tm = setTimeout(fim, 1500);
                v.addEventListener('seeked', fim);
                v.currentTime = alvo;
              });
            },
          };
          console.log(
            `[pos-producao] ${info.filename}: ${janelas.length} insert(s) — ` +
              janelas.map((j) => `${j.start.toFixed(1)}→${j.end.toFixed(1)}s`).join(', '),
          );
        }
      } catch (e) {
        console.warn('[pos-producao] inserts falharam:', e);
        avisos.push('os inserts não entraram nesta montagem — o vídeo saiu com o resto (legenda, zoom) normal. Clica RETOMAR pra tentar de novo.');
        planoInserts = undefined;
      }
    }

    // ── HEADLINE: texto parado por cima, ENTRANDO E SAINDO NUM CORTE ──
    // A saída no corte é o ponto: texto que some no meio da fala denuncia o
    // automático, porque nada mais na tela muda junto. No corte, a troca de
    // imagem mascara o sumiço.
    let headlines: import('./typography/headline').Headline[] | undefined;
    if (querHeadline && cfg.headline) {
      try {
        const cortes = cortesDoVideo(info.partesSec, info.cortesInternosSec);
        const jan = janelaDaHeadline(cfg.headline, cfg.partes, palavrasParaAncora, durSec, cortes);
        const texto = textoDaHeadline(cfg.headline, cfg.partes);
        if (jan && texto) {
          const hl = await import('./typography/headline');
          const est = normalizarHeadlineCfg(cfg.headline);
          headlines = [
            {
              id: 'pilot-hl',
              text: texto,
              start: jan.start * 1000,
              end: jan.end * 1000,
              // A aparência inteira vai pro render (02.09). `null`/ausente
              // continua significando "o que o modelo manda" — por isso o ??
              // e não um valor concreto: um default duro apagaria a
              // identidade do preset.
              style: {
                ...hl.HEADLINE_STYLE_DEFAULT,
                presetId: est.presetId,
                posX: est.posX ?? 0.5,
                posY: est.posY,
                fontScale: est.fontScale ?? 1,
                width: est.width ?? 0.9,
                align: est.align ?? null,
                uppercase: est.uppercase ?? null,
                panel: est.panel ?? null,
                panelOpacity: est.panelOpacity ?? null,
                color: est.color ?? null,
                panelColor: est.panelColor ?? null,
                font: (est.font ?? null) as never,
                bold: est.bold ?? null,
                italic: est.italic ?? null,
                underline: est.underline ?? null,
                stroke: est.stroke ?? null,
                strokeColor: est.strokeColor ?? null,
                shadowForca: est.shadowForca ?? null,
                glow: est.glow ?? null,
                glowColor: est.glowColor ?? null,
              },
            },
          ];
          console.log(
            `[pos-producao] headline: ${jan.start.toFixed(1)}→${jan.end.toFixed(1)}s ` +
              `(saída ${cortes.some((c) => Math.abs(c - jan.end) < 0.01) ? 'NO CORTE' : 'sem corte por perto'})`,
          );
        } else if (!texto) {
          avisos.push('headline: sem texto (nem escrito, nem hook na copy) — não entrou');
        } else {
          // Tinha texto, mas a janela saiu degenerada (o trecho de fala não
          // deu tempo útil). Sumia CALADA: o editor escrevia a headline e ela
          // simplesmente não aparecia no AD.
          avisos.push(
            'a headline tinha texto mas não achou um trecho válido pra aparecer nesta montagem — ela não entrou. Confere o gancho na janela de headline.',
          );
        }
      } catch (e) {
        console.warn('[pos-producao] headline falhou:', e);
        avisos.push('a headline não entrou nesta montagem — clica RETOMAR pra tentar de novo.');
      }
    }

    /* ── SMART POSITION (08.10): a legenda vai pra DOBRA da tela dividida e
     * pro meio exato no React, trocando de lugar NO corte (o bloco que
     * atravessa a borda é cortado nela). Só mexe no `perBlock` — o mesmo
     * override do editor de legendas —, então render e projeto saem iguais. */
    /* CORTE NA BORDA SEMPRE (08.10): com o Smart Position DESLIGADO a legenda
     * da tela dividida atravessava o corte e seguia por cima do take seguinte
     * (AD01 09:39: "cérebro.", "avançada,", "Alzheimer."). O bloco agora é
     * cortado na borda de toda tela dividida/React com o botão ligado OU
     * desligado — o botão decide só a POSIÇÃO (dobra/meio). */
    if (blocks.length && planoInserts?.janelas.length) {
      const posicionar = !!cfg.legenda.smartPosition;
      try {
        const dims = await dimensoesDoVideo(blob);
        const regioes = regioesDaLegenda(planoInserts.janelas, (id) => layoutPorId.get(id), dims.w, dims.h);
        if (regioes.length) {
          const sp = aplicarSmartPosition(blocks, style, regioes, { posicionar });
          blocks = sp.blocks as typeof blocks;
          style = sp.style as typeof style;
          console.log(`[pos-producao] ${posicionar ? 'smart position' : 'corte nas bordas'}: ${sp.posicionados} bloco(s) na dobra/meio · ${sp.cortes} cortado(s) na borda · ${regioes.length} região(ões) ${dims.w}x${dims.h}`);
        }
      } catch (e) {
        console.warn('[pos-producao] corte da legenda nas bordas falhou:', e);
        avisos.push(posicionar
          ? 'o Smart Position não entrou nesta montagem — a legenda ficou na posição do modelo. Clica RETOMAR pra tentar de novo.'
          : 'a legenda não foi cortada nas bordas da tela dividida nesta montagem — clica RETOMAR pra tentar de novo.');
      }
    }

    const temVisual = !(blocks.length === 0 && plano.length === 0 && !planoInserts && !headlines);
    if (!temVisual && velocidade === 1 && !querSfx && !querTrilha) {
      for (const f of fechaveis) f();
      return { blob: null, avisos, insertsOrfaos: orfaos };
    }
    /** o vídeo que entra no render (avatar limpo, já na velocidade nova) */
    const base = blob;
    let renderizado: Blob | null = null;
    let renderInfo = '';
    if (temVisual) {
      // ── RENDER com PROGRESSO REAL e TETO DE TEMPO ──
      // O render de um AD de 90s são ~2.700 frames com legenda desenhada em cada
      // um: leva minutos. Sem o ratio na tela isso PARECIA travado (era só uma
      // string parada). E sem teto, um decoder que engasga ficava pra sempre —
      // agora aborta e entrega o montado original, que é a regra da casa.
      const verbo = blocks.length ? 'legendando' : 'aplicando zoom';
      cfg.onEtapa?.(`${verbo}: preparando`);
      const t0 = Date.now();
      const ctrl = new AbortController();
      // WATCHDOG DE PROGRESSO (03.09) — o teto fixo de tempo matou um AD REAL.
      //
      // A régua antiga (~6s de render por segundo de vídeo, teto 25min) foi
      // medida no caminho RÁPIDO. Com INSERTS o render vai pelo caminho de
      // seek — e em aba de segundo plano o Chrome estrangula os seeks a ponto
      // de 12s de vídeo levarem 11min (medido). O AD do Silas estava ANDANDO e
      // o relógio o matou: "pós-produção: o render estourou o tempo".
      //
      // A regra certa: um render LENTO nunca é abortado; um render PARADO é.
      // Aborta só quando o progresso não anda por 4min (fase de frames viva
      // manda sinal a cada ~3 ticks), com um teto absoluto de 35min — ABAIXO
      // dos 40min de ESPERA_MAX_MS da fila do ffmpeg, senão quem espera o lock
      // morreria antes de este render soltar.
      const PARADO_MS = 4 * 60_000;
      const TETO_ABSOLUTO_MS = 35 * 60_000;
      let ultimoSinal = Date.now();
      let ultimoFrame = -1;
      const inicioRender = Date.now();
      const vigia = setInterval(() => {
        const agora = Date.now();
        if (agora - inicioRender > TETO_ABSOLUTO_MS) {
          console.warn('[pos-producao] teto absoluto de 35min — abortando');
          motivoAborto = 'teto';
          ctrl.abort();
          return;
        }
        if (agora - ultimoSinal > PARADO_MS) {
          console.warn(`[pos-producao] render sem progresso há ${Math.round((agora - ultimoSinal) / 1000)}s — abortando (parado, não lento)`);
          motivoAborto = 'parado';
          ctrl.abort();
        }
      }, 15_000);
      let r: Awaited<ReturnType<typeof renderTypographyVideo>>;
      try {
        r = await renderTypographyVideo({
          file: blob,
          blocks,
          preset: getPreset(style.presetId),
          style,
          zoom: plano,
          ffmpegJaExclusivo: cfg.ffmpegJaExclusivo,
          // MAX QUALITY é escolha do editor; o padrão é o render rápido.
          qualidadeMax: !!cfg.legenda.qualidadeMax,
          inserts: planoInserts as never,
          headlines,
          signal: ctrl.signal,
          onProgress: (pr) => {
            // qualquer avanço de fase/frame alimenta o watchdog
            if (pr.phase !== 'frames' || (pr.frame ?? 0) !== ultimoFrame) {
              ultimoFrame = pr.frame ?? ultimoFrame;
              ultimoSinal = Date.now();
            }
            // 'frames' é a fase longa — é dela que sai a porcentagem honesta.
            const pct = Math.round((pr.ratio || 0) * 100);
            cfg.onEtapa?.(
              pr.phase === 'frames'
                ? `${verbo}: ${pct}% (${pr.frame ?? 0}/${pr.totalFrames ?? 0} frames)`
                : `${verbo}: ${pr.phase}`,
            );
          },
        });
      } finally {
        clearInterval(vigia);
        for (const f of fechaveis) f();
      }
      const seg = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `[pos-producao] ${info.filename}: render ${r.mode || '?'}/${r.hw ? 'hardware' : 'software'} em ${seg}s · ` +
          `${r.width}x${r.height}@${r.fps} · ${(r.blob.size / 1e6).toFixed(1)}MB · audioOk=${r.audioOk}`,
      );
      if (!r.blob || r.blob.size < 50_000) {
        avisos.push(`o render saiu vazio — o AD foi entregue ${sem}. Clica RETOMAR; se repetir, fecha as outras abas pesadas.`);
      } else {
        renderizado = r.blob;
        renderInfo = `${r.width}x${r.height}`;
        if (!r.audioOk) avisos.push('o vídeo saiu SEM ÁUDIO — confere antes de entregar e, se estiver mudo, clica RETOMAR.');
        if (r.somInsertOk === false) {
          avisos.push(
            'não consegui misturar o som dos inserts nesta montagem — o AD saiu só com o áudio do avatar. Clica RETOMAR pra tentar de novo.',
          );
        }
      }
    } else {
      for (const f of fechaveis) f();
    }

    // ── SONOPLASTIA (08.10): SFX nas transições + trilha, DEPOIS do render —
    // a imagem já está pronta e os instantes das trocas são os do quadro.
    // Nunca derruba a entrega: falhou, o vídeo segue sem ela (com aviso).
    let final: Blob | null = renderizado;
    let sfxEntraram: SfxColocado[] = [];
    let trilhaDoProjeto: RoteiroEdicao['trilha'] = null;
    if (querSfx || querTrilha) {
      const alvo = renderizado ?? base;
      const fimDoGancho = fimDoGanchoNoVideo(info.partesSec, info.partLabels);
      const sfxPlano = querSfx && cfg.sfx
        ? planejarSfx(cfg.sfx, { transicoes: renderizado ? transicoesDoVideo : [], durSec, fimDoGancho })
        : [];
      if (querSfx && !sfxPlano.length) {
        avisos.push('Smart SFX ligado, mas este AD não tem transição (nem virada de gancho) pra bater — nenhum SFX foi colocado. As transições vêm dos inserts.');
      }
      let trilha: Parameters<typeof import('./pilot-sonoplastia-run').mixarSonoplastia>[1]['trilha'] = null;
      if (querTrilha && cfg.trilha?.trilhaId) {
        const lida = await cfg.lerTrilha!(cfg.trilha.trilhaId).catch(() => null);
        if (!lida) {
          avisos.push(`a trilha "${cfg.trilha.nome || 'escolhida'}" não está mais salva neste navegador — o AD saiu sem trilha. Suba ela de novo na janela de SFX e trilha.`);
        } else {
          trilha = { blob: lida.blob, nome: lida.nome, volume: cfg.trilha.volume, lufs: lida.lufs };
        }
      }
      if (sfxPlano.length || trilha) {
        const { mixarSonoplastia } = await import('./pilot-sonoplastia-run');
        const mix = await mixarSonoplastia(alvo, { sfx: sfxPlano, trilha }, { comFfmpeg, onEtapa: cfg.onEtapa });
        avisos.push(...mix.avisos);
        if (mix.blob) {
          final = mix.blob;
          sfxEntraram = mix.sfx;
          if (mix.trilha && trilha && cfg.trilha?.trilhaId) {
            trilhaDoProjeto = {
              trilhaId: cfg.trilha.trilhaId, nome: trilha.nome, ganho: mix.trilha.ganho,
              durTrilha: mix.trilha.durTrilha, pedacos: mix.trilha.pedacos,
            };
          }
        }
      }
    }
    // só velocidade (ou o render falhou com a velocidade aplicada): entrega o acelerado
    if (!final && velocidade !== 1) final = base;

    // PROJETO EDITÁVEL: guarda o avatar LIMPO (o que entrou no render, já na
    // velocidade nova) e o roteiro do que foi queimado + os SFX e a trilha.
    // Nunca derruba a entrega — o projeto é um extra.
    if (final && cfg.guardarProjeto) {
      try {
        await cfg.guardarProjeto({
          versao: 1, filename: info.filename, criadoEm: Date.now(), durSec,
          inserts: renderizado && planoInserts ? insertsDoProjeto : [],
          legenda: renderizado && blocks.length ? { blocks, style } : null,
          zoom: renderizado ? plano : [],
          headlines: renderizado && headlines?.length ? headlines : null,
          sfx: sfxEntraram,
          trilha: trilhaDoProjeto,
          velocidade,
          transicoes: renderizado ? transicoesDoVideo : [],
          fimDoGancho: fimDoGanchoNoVideo(info.partesSec, info.partLabels),
        }, base);
      } catch (e) {
        console.warn('[pos-producao] projeto editável não foi guardado (a entrega segue normal):', e);
      }
    }
    if (renderInfo) console.log(`[pos-producao] ${info.filename}: entregue ${renderInfo}${sfxEntraram.length ? ` + ${sfxEntraram.length} SFX` : ''}${trilhaDoProjeto ? ' + trilha' : ''}${velocidade !== 1 ? ` @${velocidade}x` : ''}`);
    return {
      blob: final,
      avisos,
      insertsOrfaos: orfaos,
      aplicouVisual: !!renderizado,
      sonoplastia: querSfx || querTrilha ? { sfx: sfxEntraram.length, trilha: !!trilhaDoProjeto } : undefined,
      velocidade,
    };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.warn('[pos-producao] falhou:', e);
    /* ⚠ MENSAGEM AMIGÁVEL PASSA DIRETO (04.09). `FriendlyError` já vem escrita
     * pro usuário ("Usa o Chrome ou Edge atualizados no computador", por
     * exemplo). Ela não casa com nenhum dos dois regex abaixo, então era
     * DESCARTADA e virava "clica RETOMAR pra tentar de novo" — um conselho que
     * ia falhar identicamente em todos os ADs do lote, pra sempre, sem nunca
     * dizer o motivo real. */
    if ((e as Error)?.name === 'FriendlyError' && msg) {
      avisos.push(msg);
      return { blob: null, avisos, insertsOrfaos: orfaos };
    }
    // Versão nova do site publicada com a aba aberta: o import dinâmico do
    // render busca um chunk que não existe mais. RETOMAR sem F5 falharia igual.
    const versaoNova = /ChunkLoadError|Loading chunk\s+[\w-]+\s+failed|Loading CSS chunk|dynamically imported module|importing a module script failed/i.test(
      `${(e as Error)?.name || ''} ${msg}`,
    );
    avisos.push(
      avisoDeFalhaDaPosProducao(
        motivoAborto === 'teto'
          ? 'teto'
          : /abort|cancel/i.test(msg)
            ? 'parado'
            : /terminat/i.test(msg)
              ? 'terminado'
              : versaoNova
                ? 'versao-nova'
                : 'generica',
        pedido,
        motivoCurto(e),
      ),
    );
    return { blob: null, avisos, insertsOrfaos: orfaos };
  }
}

/**
 * ROSTO do avatar em cada janela: 3 amostras dentro dela, mediana do centro e
 * da altura (um piscar ou virar de rosto não desloca o enquadramento). Nunca
 * lança — janela sem rosto, detector fora do ar ou demora demais ficam sem
 * entrada, e o render usa o foco manual de sempre.
 */
async function rostosDasJanelas(
  blob: Blob,
  janelas: Array<{ id: string; start: number; end: number }>,
): Promise<Map<string, RostoAvatar>> {
  const out = new Map<string, RostoAvatar>();
  if (!janelas.length) return out;
  try {
    const { detectFacePresence } = await import('./face-detector');
    const res = await Promise.race([
      detectFacePresence({
        videoBlob: blob,
        segments: janelas.map((j) => ({ start: j.start, end: j.end })),
        samplesPerSegment: 3,
      }),
      new Promise<null>((r) => setTimeout(() => r(null), 30_000)),
    ]);
    if (!res) {
      console.warn('[pos-producao] detector de rosto demorou demais — enquadramento pelo foco manual');
      return out;
    }
    res.forEach((seg, i) => {
      const rosto = rostoDasAmostras(seg.samples.map((s) => s.bbox));
      if (rosto && janelas[i]) out.set(janelas[i].id, rosto);
    });
  } catch (e) {
    console.warn('[pos-producao] detector de rosto indisponível — enquadramento pelo foco manual:', e);
  }
  return out;
}

/** Duração (s) de um blob de vídeo via metadata — 0 quando não dá pra ler. */


/** ASR do montado: extrai o áudio e chama a MESMA rota das Legendas Automáticas. */
/**
 * ASR com UMA retentativa quando o ffmpeg é terminado POR FORA (03.09).
 *
 * O singleton do ffmpeg é global à aba: um cancel de outra ferramenta mata a
 * instância no meio da extração de áudio da transcrição. A instância nova
 * sobe sozinha — desistir aqui custava a âncora dos inserts (a posição caía
 * pro rateio da copy, que erra por segundos). Mesma regra do mux.
 */
async function transcreverComRetentativa(
  blob: Blob,
  idioma: string,
  durSec?: number,
): Promise<PalavraAsr[]> {
  try {
    return await transcreverMontado(blob, idioma, durSec);
  } catch (e) {
    const msg = (e as Error)?.message || '';
    if (!/terminat/i.test(msg)) throw e;
    console.warn('[pos-producao] ffmpeg terminado POR FORA na transcrição — refazendo');
    return await transcreverMontado(blob, idioma, durSec);
  }
}

async function transcreverMontado(
  blob: Blob,
  idioma: string,
  durSec?: number,
): Promise<PalavraAsr[]> {
  const { extractAudioForTranscription } = await import('./ffmpeg-worker');
  /* ⚠ A DURAÇÃO JÁ FOI MEDIDA — usa ela (04.09). Sem esse parâmetro o extrator
   * fica num bitrate fixo, e um AD longo estoura o teto de 4,4MB do ASR. O
   * erro que sai é "áudio grande demais", e o conselho do card é RETOMAR —
   * que ia falhar exatamente igual, pra sempre, porque nada muda entre as
   * tentativas. Com a duração, o extrator escolhe um bitrate que cabe. */
  const audio = await extractAudioForTranscription(blob, {}, durSec);
  if (audio.size > 4_400_000) {
    throw new Error(`áudio grande demais pro ASR (${(audio.size / 1e6).toFixed(1)}MB)`);
  }
  const fd = new FormData();
  fd.append('audio', audio, 'audio.opus');
  fd.append('language', /^[a-z]{2}(-[a-z]{2})?$/.test(idioma) ? idioma : 'pt');
  const res = await fetch('/api/tipografia/transcribe', { method: 'POST', body: fd });
  const json = (await res.json().catch(() => null)) as { words?: PalavraAsr[]; error?: string } | null;
  if (!res.ok || !json?.words?.length) {
    throw new Error(json?.error || `ASR respondeu ${res.status}`);
  }
  return json.words;
}

/** Largura × altura do vídeo (metadata do <video>); 1080×1920 quando não dá. */
async function dimensoesDoVideo(blob: Blob): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    const ok = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 10_000);
      v.onloadedmetadata = () => { clearTimeout(t); res(true); };
      v.onerror = () => { clearTimeout(t); res(false); };
      v.src = url;
    });
    const w = ok ? v.videoWidth : 0;
    const h = ok ? v.videoHeight : 0;
    v.removeAttribute('src');
    v.load();
    return w > 0 && h > 0 ? { w, h } : { w: 1080, h: 1920 };
  } catch {
    return { w: 1080, h: 1920 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
