/**
 * Controle de play/pausa do <video> da prévia das Legendas Automáticas —
 * UM caminho pra todos os botões (espaço, botão do card, botão da timeline,
 * clique no vídeo) e um vigia que diz POR QUE o player travou.
 *
 * Por que existe: cada botão fazia `void v.play()` e engolia a rejeição.
 * Quando o play falhava — AbortError por um pause() no meio, NotSupportedError
 * com a mídia inválida, MEDIA_ERR depois de um seek — nada acontecia na tela e
 * o player "travava" sem explicação. Aqui:
 *
 *   • a falha é registrada com o diagnóstico do elemento (readyState,
 *     networkState, error), nunca calada;
 *   • sem mídia pronta (erro ou readyState 0) o vídeo é RECARREGADO no mesmo
 *     instante e o play tentado de novo — o travamento vira um soluço;
 *   • pausar espera um play() pendente assentar (pause() no meio de um play()
 *     rejeita o play com AbortError e deixa o estado inconsistente);
 *   • o vigia avisa quando o vídeo diz que toca mas o tempo não anda, e dá um
 *     empurrão (seek de 1ms) que destrava o decoder na maioria dos casos.
 *
 * Só depende do que um <video> expõe, então roda em teste com um dublê.
 */

export type VideoLike = {
  paused: boolean;
  ended: boolean;
  readyState: number;
  networkState: number;
  currentTime: number;
  error: { code: number; message?: string } | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  addEventListener(tipo: string, fn: () => void): void;
  removeEventListener(tipo: string, fn: () => void): void;
};

type Avisar = (msg: string) => void;

const pendentes = new WeakMap<object, Promise<void>>();

export function diagnosticoDoVideo(v: VideoLike): string {
  const erro = v.error ? `${v.error.code}${v.error.message ? ' ' + v.error.message : ''}` : 'nenhum';
  return `readyState=${v.readyState} networkState=${v.networkState} t=${v.currentTime.toFixed(2)} paused=${v.paused} ended=${v.ended} error=${erro}`;
}

function esperarMetadata(v: VideoLike, timeoutMs: number, agendar: (fn: () => void, ms: number) => unknown, cancelar: (h: unknown) => void): Promise<boolean> {
  if (v.readyState >= 1) return Promise.resolve(true);
  return new Promise((res) => {
    let feito = false;
    const fim = (ok: boolean) => {
      if (feito) return;
      feito = true;
      v.removeEventListener('loadedmetadata', okH);
      v.removeEventListener('error', errH);
      cancelar(timer);
      res(ok);
    };
    const okH = () => fim(true);
    const errH = () => fim(false);
    const timer = agendar(() => fim(false), timeoutMs);
    v.addEventListener('loadedmetadata', okH);
    v.addEventListener('error', errH);
  });
}

export type OpcoesPlayer = {
  avisar?: Avisar;
  /** teto de espera pela mídia recarregar (ms) */
  timeoutMs?: number;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (h: unknown) => void;
};

function opts(o?: OpcoesPlayer) {
  return {
    avisar: o?.avisar ?? ((m: string) => console.warn(m)),
    timeoutMs: o?.timeoutMs ?? 8000,
    agendar: o?.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)),
    cancelar: o?.cancelar ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)),
  };
}

/** Recarrega a mídia mantendo o instante. Pra elemento em erro ou que nunca
 *  carregou (readyState 0). Devolve se a mídia voltou. */
export async function recarregarVideo(v: VideoLike, o?: OpcoesPlayer): Promise<boolean> {
  const { timeoutMs, agendar, cancelar } = opts(o);
  const t = v.currentTime;
  try {
    v.load();
  } catch {
    return false;
  }
  const ok = await esperarMetadata(v, timeoutMs, agendar, cancelar);
  if (ok && t > 0) {
    try {
      v.currentTime = t;
    } catch {
      /* mídia sem seek: segue do zero */
    }
  }
  return ok;
}

/** Toca. Devolve se o vídeo passou a tocar. Nunca engole a falha. */
export async function tocar(v: VideoLike, o?: OpcoesPlayer): Promise<boolean> {
  const { avisar } = opts(o);
  if (v.error || v.readyState === 0) {
    avisar(`[legendas] play sem mídia pronta (${diagnosticoDoVideo(v)}) — recarregando o vídeo`);
    if (!(await recarregarVideo(v, o))) {
      avisar(`[legendas] o vídeo não voltou depois de recarregar (${diagnosticoDoVideo(v)})`);
      return false;
    }
  }
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    let p: Promise<void>;
    try {
      p = Promise.resolve(v.play());
    } catch (e) {
      p = Promise.reject(e);
    }
    pendentes.set(v, p);
    try {
      await p;
      return true;
    } catch (e) {
      const err = e as { name?: string; message?: string } | null;
      avisar(`[legendas] play() falhou (${err?.name || '?'}${err?.message ? ': ' + err.message : ''}) ${diagnosticoDoVideo(v)}`);
      // AbortError = alguém pausou no meio: foi intenção, não insiste.
      if (err?.name === 'AbortError') return false;
      if (tentativa === 0 && !(await recarregarVideo(v, o))) return false;
    } finally {
      if (pendentes.get(v) === p) pendentes.delete(v);
    }
  }
  return false;
}

/** Pausa — depois que um play() pendente assentar, pra não abortá-lo. */
export async function pausar(v: VideoLike): Promise<void> {
  const p = pendentes.get(v);
  if (p) {
    try {
      await p;
    } catch {
      /* já registrado no tocar */
    }
  }
  v.pause();
}

/** O que todo botão de play/pausa chama. */
export function alternarPlay(v: VideoLike, o?: OpcoesPlayer): Promise<boolean> {
  if (v.paused) return tocar(v, o);
  return pausar(v).then(() => true);
}

/* ───────────────────────── vigia do player ─────────────────────────
 * Chame `tick(agoraMs)` de vez em quando (1x por segundo basta). Se o vídeo
 * diz que está tocando mas o tempo não anda por `paradoMs`, avisa UMA vez por
 * episódio com o diagnóstico e dá um empurrão (seek de 1ms). */
export type Vigia = {
  tick(agoraMs: number): void;
  /** quantos episódios de travamento já foram vistos */
  episodios(): number;
};

export function criarVigiaDoPlayer(
  v: VideoLike,
  o?: { avisar?: Avisar; paradoMs?: number; empurrar?: boolean },
): Vigia {
  const avisar = o?.avisar ?? ((m: string) => console.warn(m));
  const paradoMs = o?.paradoMs ?? 2000;
  const empurrar = o?.empurrar ?? true;
  let ultimoT = NaN;
  let desde = 0;
  let avisado = false;
  let n = 0;
  return {
    tick(agora) {
      if (v.paused || v.ended || v.readyState < 2) {
        ultimoT = NaN;
        avisado = false;
        return;
      }
      const t = v.currentTime;
      if (t !== ultimoT) {
        ultimoT = t;
        desde = agora;
        avisado = false;
        return;
      }
      if (avisado || agora - desde < paradoMs) return;
      avisado = true;
      n += 1;
      avisar(
        `[legendas] vídeo diz que toca mas está parado em ${t.toFixed(2)}s há ${Math.round((agora - desde) / 100) / 10}s (${diagnosticoDoVideo(v)})${empurrar ? ' — empurrando o decoder' : ''}`,
      );
      if (empurrar) {
        try {
          v.currentTime = t + 0.001;
        } catch {
          /* sem seek: fica só o aviso */
        }
      }
    },
    episodios: () => n,
  };
}

/* ─────────────────────── medidor de quadros ────────────────────────
 * Conta quadros lentos do desenho da prévia. A cada `janelaMs`, se houve
 * quadro acima de `lentoMs`, avisa com contagem e pior caso — é o rastro que
 * separa "player travado" de "desenho pesado demais" (efeito/sombra grande). */
export type Medidor = {
  registrar(duracaoMs: number, agoraMs: number): void;
};

export function criarMedidorDeQuadros(o?: { avisar?: Avisar; lentoMs?: number; janelaMs?: number; rotulo?: string }): Medidor {
  const avisar = o?.avisar ?? ((m: string) => console.warn(m));
  const lentoMs = o?.lentoMs ?? 50;
  const janelaMs = o?.janelaMs ?? 5000;
  const rotulo = o?.rotulo ?? 'prévia';
  let inicio = 0;
  let total = 0;
  let lentos = 0;
  let pior = 0;
  let soma = 0;
  return {
    registrar(d, agora) {
      if (!inicio) inicio = agora;
      total += 1;
      soma += d;
      if (d > lentoMs) lentos += 1;
      if (d > pior) pior = d;
      if (agora - inicio < janelaMs) return;
      if (lentos > 0) {
        avisar(
          `[legendas] ${rotulo}: ${lentos} de ${total} quadros acima de ${lentoMs}ms nos últimos ${Math.round(janelaMs / 1000)}s (pior ${pior.toFixed(0)}ms, média ${(soma / total).toFixed(1)}ms) — desenho pesado (efeitos/sombra/animação), não o vídeo`,
        );
      }
      inicio = agora;
      total = 0;
      lentos = 0;
      pior = 0;
      soma = 0;
    },
  };
}
