/**
 * UM relógio só pra todo canvas da ferramenta de legendas.
 *
 * O editor tinha SEIS loops de `requestAnimationFrame` independentes rodando
 * ao mesmo tempo — prévia do vídeo, galeria de modelos, os quatro cartões de
 * efeito, a timeline, a demo de animação e a prévia do roteiro. Cada um
 * desenhava texto com sombra/contorno a 60fps, tudo na MESMA thread que o
 * `<video>` usa pra compor: o player engasgava e parecia travado.
 *
 * Aqui existe um único rAF que:
 *
 *   • pula quem está FORA DA TELA (IntersectionObserver compartilhado);
 *   • respeita um teto de FPS por trabalho (a galeria não precisa de 60);
 *   • respeita um ORÇAMENTO de tempo por frame — estourou, o resto fica pro
 *     frame seguinte, em rodízio, pra ninguém morrer de fome.
 *
 * A política de escolha (`pickJobs`) é pura e testada em
 * `lib/typography/canvas-loop.test.ts`; só a cola com o DOM mora aqui.
 */

export type JobLike = {
  id: number;
  /** teto de quadros por segundo deste trabalho */
  fps: number;
  /** quando este trabalho desenhou pela última vez (ms) */
  last: number;
  /** está na tela? */
  visible: boolean;
  /** custo médio medido do último desenho (ms) */
  cost: number;
  /** prioridade: quanto MAIOR, mais cedo entra (a prévia do vídeo vem antes) */
  prio: number;
};

export type PickResult = {
  /** ids que devem desenhar neste frame */
  run: number[];
  /** ids que estavam prontos mas ficaram pro próximo frame (orçamento) */
  deferred: number[];
};

/**
 * Escolhe quem desenha neste frame.
 *
 * Elegível = visível E já passou o intervalo do seu FPS. Entre os elegíveis,
 * ordena por prioridade e depois por "há mais tempo esperando" (o rodízio que
 * evita fome). Vai somando o custo medido até estourar o orçamento — o
 * PRIMEIRO trabalho sempre passa, mesmo caro, senão um trabalho mais caro que
 * o orçamento nunca desenharia.
 */
export function pickJobs(jobs: JobLike[], now: number, budgetMs: number): PickResult {
  const prontos = jobs
    .filter((j) => {
      if (j.fps <= 0) return false;
      // ⚠ O PRIMEIRO desenho é incondicional: o IntersectionObserver reporta
      // TUDO como fora da tela enquanto a aba/painel está oculto, e sem esta
      // regra o canvas nascia em branco e ficava em branco (miniatura, print,
      // aba aberta em segundo plano). Depois do primeiro quadro a visibilidade
      // volta a mandar.
      if (j.last === 0) return true;
      return j.visible && now - j.last >= 1000 / j.fps - 0.5;
    })
    .sort((a, b) => {
      if (b.prio !== a.prio) return b.prio - a.prio;
      const atrasoA = now - a.last;
      const atrasoB = now - b.last;
      return atrasoB - atrasoA;
    });

  const run: number[] = [];
  const deferred: number[] = [];
  let gasto = 0;
  for (const j of prontos) {
    if (run.length > 0 && gasto + j.cost > budgetMs) {
      deferred.push(j.id);
      continue;
    }
    run.push(j.id);
    gasto += j.cost;
  }
  return { run, deferred };
}

/* ─────────────────────────────── cola com o DOM ───────────────────────── */

type Job = JobLike & {
  el: Element | null;
  draw: (nowMs: number) => void;
};

const jobs = new Map<number, Job>();
let seq = 0;
let raf = 0;
let io: IntersectionObserver | null = null;
const byEl = new WeakMap<Element, Job>();

/** Orçamento de desenho por frame (ms). Sobra pro vídeo compor sem engasgo. */
const BUDGET_MS = 9;

function ensureIO(): IntersectionObserver | null {
  if (io || typeof IntersectionObserver === 'undefined') return io;
  io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const j = byEl.get(en.target);
        if (j) j.visible = en.isIntersecting;
      }
    },
    { rootMargin: '120px' },
  );
  return io;
}

function loop() {
  raf = 0;
  if (jobs.size === 0) return;
  // ⚠ NÃO checar `document.hidden` aqui: o navegador já congela o rAF em aba
  // escondida sozinho. Um guarda próprio só criava um caso ruim — quando o
  // navegador PEDE um quadro mesmo com a aba oculta (captura de miniatura,
  // print, aba em segundo plano que volta), o relógio pulava tudo e os canvas
  // ficavam em branco de vez.
  const now = performance.now();
  const lista = Array.from(jobs.values());
  const { run } = pickJobs(lista, now, BUDGET_MS);
  for (const id of run) {
    const j = jobs.get(id);
    if (!j) continue;
    const t0 = performance.now();
    try {
      j.draw(t0);
    } catch {
      // um frame ruim não pode derrubar o relógio dos outros
    }
    const gasto = performance.now() - t0;
    // média móvel: o custo real varia com o modelo desenhado
    j.cost = j.cost === 0 ? gasto : j.cost * 0.7 + gasto * 0.3;
    j.last = t0;
  }
  raf = requestAnimationFrame(loop);
}

function kick() {
  if (raf === 0 && jobs.size > 0) raf = requestAnimationFrame(loop);
}

export type CanvasJobOpts = {
  /** teto de FPS (default 30) */
  fps?: number;
  /** prioridade; a prévia do vídeo usa 10, o resto 0 */
  prio?: number;
  /**
   * Elemento observado pra saber se está na tela. Sem ele o trabalho é
   * considerado sempre visível (use só pra coisa que ocupa a tela toda).
   */
  el?: Element | null;
};

/**
 * Registra um desenho no relógio compartilhado. Devolve a função que
 * cancela — chame no cleanup do efeito.
 */
export function registerCanvasJob(
  draw: (nowMs: number) => void,
  opts: CanvasJobOpts = {},
): () => void {
  seq += 1;
  const id = seq;
  const el = opts.el ?? null;
  const job: Job = {
    id,
    fps: opts.fps ?? 30,
    last: 0,
    // sem elemento observado = sempre visível; com elemento, começa visível
    // e o observer corrige no primeiro callback (nunca nasce invisível, pra
    // não ficar em branco enquanto o IO não roda)
    visible: true,
    cost: 0,
    prio: opts.prio ?? 0,
    el,
    draw,
  };
  jobs.set(id, job);
  if (el) {
    byEl.set(el, job);
    ensureIO()?.observe(el);
  }
  // PRIMEIRO quadro AGORA, sincrono: o rAF nao roda em aba escondida, e sem
  // isto o canvas nascia em branco e so pintava quando a aba ganhasse foco
  // (miniatura, print, aba aberta em segundo plano). De quebra, mata o
  // piscar branco no mount.
  try {
    const t0 = performance.now();
    job.draw(t0);
    job.cost = performance.now() - t0;
    job.last = t0;
  } catch {
    /* primeiro quadro falhou: o loop tenta de novo */
  }
  kick();
  return () => {
    jobs.delete(id);
    if (el) {
      byEl.delete(el);
      io?.unobserve(el);
    }
    if (jobs.size === 0 && raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** Quantos trabalhos estão registrados (diagnóstico/testes). */
export function canvasJobCount(): number {
  return jobs.size;
}
