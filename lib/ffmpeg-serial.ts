/**
 * Fila GLOBAL de "1 operação ffmpeg-wasm por vez" pra TODO o app.
 *
 * O ffmpeg-wasm (lib/ffmpeg-worker.ts) é um SINGLETON compartilhado no navegador.
 * Quando 2 tarefas tocam ffmpeg ao mesmo tempo (a fila roda até 2 disparos em
 * paralelo), elas usam a MESMA instância e se atropelam: uma chama
 * `cancelFFmpeg()` (no timeout/retry dela) e mata o worker enquanto a OUTRA ainda
 * processa → a outra morre com "called FFmpeg.terminate()". Foi exatamente isso
 * que perdia o concat de UM avatar no VA (o AD saía com 1/2 avatares) e o que já
 * dava "1 PRONTO, resto INCOMPLETO" na decupagem das tasks normais.
 *
 * Este módulo é PROPOSITALMENTE sem dependências (não importa o ffmpeg-worker nem
 * o @ffmpeg/ffmpeg) pra poder ser importado tanto pela página quanto pela
 * lib/va-pipeline.ts SEM puxar o wasm pro bundle. Todos os caminhos que tocam
 * ffmpeg (montagem das tasks normais, concat do VA-texto, pipeline do VA-lipsync)
 * passam por `runFfmpegExclusive` → garante 1 operação por vez, sem colisão.
 *
 * A fila SEGUE mesmo quando uma operação falha (o encadeamento engole o erro pra
 * não travar as próximas). Cada operação tem seus próprios timeouts por cima, e o
 * watchdog do worker (25min) é o backstop final — então o slot SEMPRE libera, sem
 * risco de travar a fila pra sempre.
 *
 * IMPORTANTE: não aninhar — uma função passada pra `runFfmpegExclusive` não pode,
 * lá dentro, chamar `runFfmpegExclusive` de novo (esperaria a fila que ela mesma
 * segura = deadlock). Por isso embrulhamos no NÍVEL ALTO (a operação inteira),
 * nunca nas primitivas de baixo nível do worker.
 */
let _chain: Promise<unknown> = Promise.resolve();

/**
 * TETO DE ESPERA NA FILA (31.08). Aninhar `runFfmpegExclusive` dentro de si
 * mesmo é deadlock — e um deadlock aqui não dava erro nenhum: a operação
 * simplesmente ficava esperando PARA SEMPRE (foi o que travou a pós-produção
 * do Pilot na fase de áudio). Nada legítimo espera 40min na fila: o watchdog
 * do worker é 25min e cada operação tem seu próprio timeout por cima. Então,
 * passou disso, é bug de aninhamento — e agora ele GRITA em vez de pendurar.
 */
const ESPERA_MAX_MS = 40 * 60_000;

/** A espera na fila estourou o teto? (pura, pro teste alcançar a regra) */
export function esperaEstourou(esperouMs: number, tetoMs: number = ESPERA_MAX_MS): boolean {
  return esperouMs > tetoMs;
}

/**
 * DONO da vez (10.10). Cada ferramenta passa um `dono` ('normalizador',
 * 'mixer'...) ao entrar na fila. Serve pro botão Cancelar de UMA ferramenta não
 * derrubar a outra: o cancelamento mata o motor inteiro (cancelFFmpeg), então a
 * ferramenta só pode matá-lo quando é ELA que está usando o motor agora.
 * Auditoria 10.10: o Cancelar do Mixer cancelou o lote do Normalizador.
 */
let _donoAtual: string | null = null;
let _ocupados = 0;

/** Aviso pro cliente quando a ferramenta espera outra terminar (texto simples). */
export const MSG_NA_FILA = 'Na fila: outra ferramenta está processando agora. Começa assim que ela terminar.';

/** Quem está usando o motor agora (null = ninguém ou operação sem dono). */
export function donoDoMotor(): string | null {
  return _donoAtual;
}

/** true se tem alguma operação rodando OU esperando na fila. */
export function motorOcupado(): boolean {
  return _ocupados > 0;
}

/**
 * Quem está ESPERANDO a vez (10.10). O Cancelar de uma ferramenta que ainda
 * está na fila não tinha efeito nenhum até a outra terminar — a tela seguia
 * "Na fila…" depois do clique. Agora quem desiste sai da fila na hora.
 */
type Espera = { dono: string | null; desistiu: boolean; desistir: () => void };
const _esperando = new Set<Espera>();

/** Erro de quem desistiu da fila (mesmo texto do cancelamento do motor). */
const DESISTIU_DA_FILA = 'CANCELLED_BY_USER';

/**
 * Tira da fila as operações desse dono que AINDA NÃO começaram: elas falham na
 * hora com cancelamento e, quando chegaria a vez delas, a fila só pula. Não
 * mexe em nada que já esteja rodando nem em outro dono. Devolve quantas saíram.
 */
export function desistirDaFila(dono: string): number {
  let n = 0;
  for (const e of Array.from(_esperando)) {
    if (e.dono !== dono) continue;
    _esperando.delete(e);
    e.desistir();
    n++;
  }
  return n;
}

export function runFfmpegExclusive<T>(
  fn: () => Promise<T>,
  dono?: string,
  /** Chamado UMA vez quando a operação vai esperar outra terminar (pra UI avisar). */
  aoEsperar?: () => void,
): Promise<T> {
  const entrou = Date.now();
  if (_ocupados > 0) {
    try { aoEsperar?.(); } catch { /* aviso de UI nunca derruba a fila */ }
  }
  _ocupados++;
  let rejeitarEspera: (e: Error) => void = () => {};
  const desistencia = new Promise<never>((_, rej) => { rejeitarEspera = rej; });
  const espera: Espera = {
    dono: dono ?? null,
    desistiu: false,
    desistir: () => { espera.desistiu = true; rejeitarEspera(new Error(DESISTIU_DA_FILA)); },
  };
  _esperando.add(espera);
  const run = _chain.then(() => {
    _esperando.delete(espera);
    // Desistiu enquanto esperava: a vez é pulada (fn nem começa).
    if (espera.desistiu) throw new Error(DESISTIU_DA_FILA);
    const esperou = Date.now() - entrou;
    if (esperaEstourou(esperou)) {
      throw new Error(
        `fila do ffmpeg: esperei ${Math.round(esperou / 60000)}min pelo slot — ` +
          'provável aninhamento de runFfmpegExclusive (deadlock).',
      );
    }
    _donoAtual = dono ?? null;
    return fn();
  });
  const solta = () => {
    _ocupados = Math.max(0, _ocupados - 1);
    if (_donoAtual === (dono ?? null)) _donoAtual = null;
  };
  _chain = run.then(
    () => { solta(); return undefined; },
    () => { solta(); return undefined; },
  );
  // Quem desistiu na fila recebe o cancelamento NA HORA (não espera a vez).
  return Promise.race([run, desistencia]);
}

/**
 * Pega a VEZ na fila e devolve a função que a solta (10.10). Pra ferramentas
 * cujo item é um bloco grande de código: `const sair = await entrarNaFila(...)`
 * e `try { ... } finally { sair(); }`. Mesma fila e mesmas regras de
 * `runFfmpegExclusive` — inclusive não aninhar.
 */
export function entrarNaFila(dono?: string, aoEsperar?: () => void): Promise<() => void> {
  return new Promise<() => void>((entrou, falhou) => {
    let sair: () => void = () => {};
    const liberado = new Promise<void>((r) => { sair = () => r(); });
    runFfmpegExclusive(() => {
      entrou(sair);
      return liberado;
    }, dono, aoEsperar).catch(falhou);
  });
}
