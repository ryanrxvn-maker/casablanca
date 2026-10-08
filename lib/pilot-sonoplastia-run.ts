/**
 * MIXAGEM DA SONOPLASTIA do Pilot (08.10) — SÓ BROWSER.
 *
 * Recebe o vídeo montado (já com legenda/zoom/inserts, se tiver) e o PLANO
 * (os SFX do planejarSfx + a trilha) e devolve o MESMO vídeo com o áudio novo:
 *  - a trilha do montado entra intocada;
 *  - cada SFX é somado no instante exato do plano (OfflineAudioContext =
 *    precisão de AMOSTRA, 1/48000 s), com o ganho calibrado e fade de saída;
 *  - a trilha sonora é nivelada NA VOZ (LUFS dos dois), cortada no tamanho
 *    do vídeo (ou repetida com crossfade) e termina em fade;
 *  - um limitador abaixa só os picos que estourariam;
 *  - o vídeo NÃO é re-encodado: o mux troca só o áudio (-c:v copy).
 *
 * Nunca derruba a entrega: qualquer falha devolve `blob: null` com o motivo, e
 * quem chama mantém o vídeo sem a sonoplastia.
 */

import { encodeWAV } from './audio-engine';
import {
  SFX_CATALOGO, ganhoDaTrilha, limitarPicos, lufsIntegrado, planoDaTrilha,
  type SfxColocado, type SfxId,
} from './pilot-sonoplastia';
import { canaisDe, decodificarAudio } from './pilot-trilhas-store';

/** Os SFX decodificados ficam em memória: o mesmo plim serve o lote inteiro. */
const cacheSfx = new Map<SfxId, Promise<AudioBuffer | null>>();

/** Baixa e decodifica um SFX do catálogo (com uma retentativa de rede). */
export function carregarSfx(id: SfxId): Promise<AudioBuffer | null> {
  let p = cacheSfx.get(id);
  if (!p) {
    p = (async () => {
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
          const r = await fetch(SFX_CATALOGO[id].url, { cache: 'force-cache' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = await decodificarAudio(await r.blob());
          if (buf) return buf;
        } catch (e) {
          console.warn(`[sonoplastia] SFX ${id} não carregou (tentativa ${tentativa + 1}):`, e);
        }
      }
      return null;
    })();
    cacheSfx.set(id, p);
    // falhou = tira do cache, o próximo AD tenta de novo
    void p.then((b) => { if (!b) cacheSfx.delete(id); });
  }
  return p;
}

/** O SFX como WAV (o arquivo que vai pro projeto do CapCut/Premiere) — os
 *  mesmos samples que a mixagem usou, sem atraso de codec em editor nenhum. */
export async function wavDoSfx(id: SfxId): Promise<Blob | null> {
  const buf = await carregarSfx(id);
  return buf ? encodeWAV(buf) : null;
}

export type TrilhaParaMixar = {
  blob: Blob;
  nome: string;
  /** volume relativo à voz (TrilhaCfg.volume) */
  volume: number;
  /** LUFS medido no upload (null = mede agora) */
  lufs: number | null;
};

export type ResultadoTrilha = {
  ganho: number;
  lufsVoz: number | null;
  lufsTrilha: number | null;
  durTrilha: number;
  pedacos: ReturnType<typeof planoDaTrilha>;
};

export type ResultadoSonoplastia = {
  blob: Blob | null;
  avisos: string[];
  /** os SFX que de fato entraram (os que carregaram) */
  sfx: SfxColocado[];
  trilha: ResultadoTrilha | null;
  /** maior redução do limitador (dB, 0 = nada) */
  limitadorDb: number;
};

/**
 * Mistura SFX + trilha no áudio do vídeo. `comFfmpeg` embrulha o mux (o caller
 * decide se precisa pedir o lock global do ffmpeg ou se já o segura).
 */
export async function mixarSonoplastia(
  video: Blob,
  plano: { sfx: SfxColocado[]; trilha: TrilhaParaMixar | null },
  opts: { comFfmpeg: <T>(fn: () => Promise<T>) => Promise<T>; onEtapa?: (msg: string) => void },
): Promise<ResultadoSonoplastia> {
  const avisos: string[] = [];
  const vazio: ResultadoSonoplastia = { blob: null, avisos, sfx: [], trilha: null, limitadorDb: 0 };
  if (!plano.sfx.length && !plano.trilha) return vazio;
  const Offline: typeof OfflineAudioContext | undefined = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) {
    avisos.push('este navegador não mistura áudio — os SFX e a trilha não entraram. Use o Chrome ou o Edge atualizados.');
    return vazio;
  }
  try {
    opts.onEtapa?.('sonoplastia: lendo o áudio do vídeo');
    let principal = await decodificarAudio(video);
    if (!principal) {
      // contêiner que o decoder do navegador não abre: extrai em WAV e tenta de novo
      try {
        const { extractAudio } = await import('./ffmpeg-worker');
        const wav = await opts.comFfmpeg(() => extractAudio(video));
        principal = await decodificarAudio(wav);
      } catch (e) {
        console.warn('[sonoplastia] extração do áudio falhou:', e);
      }
    }
    if (!principal || !(principal.duration > 0.2)) {
      avisos.push('não consegui ler o áudio do vídeo montado — os SFX e a trilha não entraram nesta montagem. Clica RETOMAR.');
      return vazio;
    }
    const taxa = principal.sampleRate;
    const durSec = principal.duration;
    const offline = new Offline(2, principal.length, taxa);

    const base = offline.createBufferSource();
    base.buffer = principal;
    base.connect(offline.destination);
    base.start(0);

    // ── SFX ──
    const entraram: SfxColocado[] = [];
    if (plano.sfx.length) {
      opts.onEtapa?.('sonoplastia: encaixando os SFX nas transições');
      const ids = [...new Set(plano.sfx.map((s) => s.sfx))];
      const bufs = new Map<SfxId, AudioBuffer | null>(await Promise.all(ids.map(async (id) => [id, await carregarSfx(id)] as const)));
      const faltaram = ids.filter((id) => !bufs.get(id));
      if (faltaram.length) {
        avisos.push(`não consegui baixar ${faltaram.map((id) => SFX_CATALOGO[id].nome).join(', ')} — esses SFX não entraram nesta montagem (confira a internet e clique RETOMAR).`);
      }
      for (const s of plano.sfx) {
        const buf = bufs.get(s.sfx);
        if (!buf) continue;
        const inicio = Math.max(0, s.inicio);
        if (inicio >= durSec - 0.01) continue;
        const de = Math.max(0, Math.min(s.deSec, buf.duration - 0.01));
        const dur = Math.max(0, Math.min(s.dur, buf.duration - de, durSec - inicio));
        if (!(dur > 0.01)) continue;
        const src = offline.createBufferSource();
        src.buffer = buf;
        const g = offline.createGain();
        const fim = inicio + dur;
        const fade = Math.max(0.003, Math.min(s.fadeOutSec, dur / 2));
        // começo cortado no meio do arquivo: 3ms de rampa tira o estalo
        g.gain.setValueAtTime(de > 0 ? 0 : s.ganho, inicio);
        if (de > 0) g.gain.linearRampToValueAtTime(s.ganho, inicio + 0.003);
        g.gain.setValueAtTime(s.ganho, Math.max(inicio + 0.003, fim - fade));
        g.gain.linearRampToValueAtTime(0, fim);
        src.connect(g);
        g.connect(offline.destination);
        src.start(inicio, de, dur);
        entraram.push(s);
      }
    }

    // ── TRILHA ──
    let trilhaInfo: ResultadoTrilha | null = null;
    if (plano.trilha) {
      opts.onEtapa?.('sonoplastia: nivelando a trilha na voz');
      const tbuf = await decodificarAudio(plano.trilha.blob);
      if (!tbuf || !(tbuf.duration > 0.2)) {
        avisos.push(`a trilha "${plano.trilha.nome}" não abriu neste navegador — o AD saiu sem trilha. Suba ela de novo (MP3/WAV) na janela de SFX e trilha.`);
      } else {
        const lufsVoz = lufsIntegrado(canaisDe(principal), taxa);
        const lufsTrilha = plano.trilha.lufs ?? lufsIntegrado(canaisDe(tbuf), tbuf.sampleRate);
        const ganho = ganhoDaTrilha(plano.trilha.volume, lufsVoz, lufsTrilha);
        const pedacos = planoDaTrilha(durSec, tbuf.duration);
        // fades de POTÊNCIA CONSTANTE (seno/cosseno): na emenda de uma trilha
        // repetida o volume não afunda no meio do crossfade como no linear
        const curva = (subindo: boolean) => {
          const n = 64;
          const c = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const x = i / (n - 1);
            c[i] = ganho * (subindo ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2));
          }
          return c;
        };
        for (const p of pedacos) {
          if (!(p.dur > 0.05)) continue; // pedaço-relâmpago não tem onde fazer fade
          const src = offline.createBufferSource();
          src.buffer = tbuf;
          const g = offline.createGain();
          const fim = p.inicio + p.dur;
          const fi = Math.max(0.005, Math.min(p.fadeIn, p.dur / 2 - 0.01));
          const fo = Math.max(0.005, Math.min(p.fadeOut, p.dur / 2 - 0.01));
          g.gain.setValueAtTime(0, p.inicio);
          g.gain.setValueCurveAtTime(curva(true), p.inicio, fi);
          g.gain.setValueAtTime(ganho, p.inicio + fi + 1e-4);
          g.gain.setValueAtTime(ganho, fim - fo - 1e-4);
          g.gain.setValueCurveAtTime(curva(false), fim - fo, fo);
          src.connect(g);
          g.connect(offline.destination);
          src.start(p.inicio, p.deSec, p.dur);
        }
        trilhaInfo = { ganho, lufsVoz, lufsTrilha, durTrilha: tbuf.duration, pedacos };
        console.log(
          `[sonoplastia] trilha "${plano.trilha.nome}": voz ${lufsVoz?.toFixed(1) ?? '?'} LUFS · trilha ${lufsTrilha?.toFixed(1) ?? '?'} LUFS · ` +
            `volume ${(plano.trilha.volume * 100).toFixed(0)}% → ganho ${ganho.toFixed(3)} · ${pedacos.length} pedaço(s) até ${durSec.toFixed(2)}s`,
        );
      }
    }

    if (!entraram.length && !trilhaInfo) return { ...vazio, avisos };

    opts.onEtapa?.('sonoplastia: mixando');
    const rendido = await offline.startRendering();
    const canais = canaisDe(rendido);
    const limitadorDb = limitarPicos(canais, taxa, 0.97);
    if (limitadorDb < -0.05) console.log(`[sonoplastia] limitador segurou picos (até ${limitadorDb.toFixed(1)} dB, só nos estouros)`);
    const wav = encodeWAV(rendido);

    opts.onEtapa?.('sonoplastia: gravando o áudio no vídeo');
    const { muxAudioIntoVideo } = await import('./ffmpeg-worker');
    let saida = await opts.comFfmpeg(() => muxAudioIntoVideo(video, wav));
    // confere: mesma duração (o mux tem -shortest — nunca pode encurtar o AD)
    try {
      const { duracaoDeVideo } = await import('./video-duracao');
      const [antes, depois] = await Promise.all([duracaoDeVideo(video, 0), duracaoDeVideo(saida, 0)]);
      if (antes > 0 && depois > 0 && Math.abs(antes - depois) > 0.12) {
        console.warn(`[sonoplastia] duração mudou no mux (${antes.toFixed(2)} → ${depois.toFixed(2)}s) — descartado`);
        avisos.push('a mixagem dos SFX/trilha saiu com duração diferente do vídeo e foi descartada — o AD saiu sem eles. Clica RETOMAR.');
        saida = null as unknown as Blob;
      }
    } catch {
      /* sem medida: confia no assertValidMp4 do mux */
    }
    if (!saida || saida.size < 50_000) return { ...vazio, avisos };
    console.log(
      `[sonoplastia] ${entraram.length} SFX (${entraram.map((s) => `${SFX_CATALOGO[s.sfx].nome}@${s.t.toFixed(2)}s`).join(', ') || '—'})` +
        `${trilhaInfo ? ' + trilha' : ''} no áudio do vídeo`,
    );
    return { blob: saida, avisos, sfx: entraram, trilha: trilhaInfo, limitadorDb };
  } catch (e) {
    console.warn('[sonoplastia] mixagem falhou:', e);
    avisos.push('os SFX e a trilha não entraram nesta montagem (a mixagem falhou) — o vídeo saiu sem eles. Clica RETOMAR pra tentar de novo.');
    return { ...vazio, avisos };
  }
}
