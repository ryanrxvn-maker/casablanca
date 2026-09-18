/**
 * STATUS AO VIVO DE UM DISPARO — a parte pura.
 *
 * O histórico não mostra só o que já terminou: enquanto a task está na fila do
 * Pilot, a linha dela acompanha o trabalho igual ao card (fase, contagem de
 * takes e barra andando). Quem guarda esse estado é o registro de `background`
 * (durable-records), o MESMO que o card lê — então aqui mora só a conta, com a
 * fórmula copiada de BatchJobCard3D pra as duas telas nunca discordarem.
 *
 * Testado no node em lib/history-fila.test.ts.
 */

export type FaseDisparo =
  | 'draft'
  | 'queued'
  | 'dispatching'
  | 'rendering'
  | 'downloading'
  | 'post'
  | 'done'
  | 'failed';

export type ParteDoDisparo = {
  label?: string;
  videoId?: string | null;
  videoStatus?: string | null;
};

/** O pedaço do registro de background que o histórico precisa ler. */
export type RegistroDeFila = {
  phase?: string;
  parts?: ParteDoDisparo[];
  progressoMotor?: number;
  taskName?: string;
  startedAt?: number;
  finishedAt?: number;
  message?: string;
};

export type TomDeFase = 'idle' | 'progress' | 'success' | 'error';

export type StatusDisparo = {
  fase: FaseDisparo;
  /** Rótulo curto do selo (o mesmo vocabulário do card do Pilot). */
  rotulo: string;
  tom: TomDeFase;
  /** 0 a 100 — quanto da barra desenhar. */
  pct: number;
  /** Está trabalhando agora (barra andando, selo pulsando). */
  ativo: boolean;
  total: number;
  enviados: number;
  prontos: number;
};

const ROTULO: Record<FaseDisparo, { rotulo: string; tom: TomDeFase }> = {
  draft: { rotulo: 'Rascunho', tom: 'idle' },
  queued: { rotulo: 'Na fila', tom: 'idle' },
  dispatching: { rotulo: 'Enviando', tom: 'progress' },
  rendering: { rotulo: 'Gerando', tom: 'progress' },
  downloading: { rotulo: 'Baixando', tom: 'progress' },
  post: { rotulo: 'Montando', tom: 'progress' },
  done: { rotulo: 'Pronto', tom: 'success' },
  failed: { rotulo: 'Falhou', tom: 'error' },
};

/** Fases em que o disparo está de fato trabalhando. */
const ATIVAS: FaseDisparo[] = ['queued', 'dispatching', 'rendering', 'downloading', 'post'];

function normalizarFase(v: string | undefined | null): FaseDisparo {
  const f = String(v ?? '').trim();
  return (Object.keys(ROTULO) as FaseDisparo[]).includes(f as FaseDisparo)
    ? (f as FaseDisparo)
    : 'queued';
}

/**
 * Traduz o registro de background no status que a linha mostra.
 *
 * A barra segue a MESMA divisão do card: 30% pra enviar as partes, 60% pra
 * renderizar e 10% pro download/montagem. O progresso do motor entra como piso
 * porque no modo economia a contagem de partes fica zerada até o fim — sem
 * isso, a barra ficava parada no mínimo o disparo inteiro.
 */
export function statusDoDisparo(rec: RegistroDeFila | null | undefined): StatusDisparo | null {
  if (!rec) return null;
  const fase = normalizarFase(rec.phase);
  const partes = Array.isArray(rec.parts) ? rec.parts : [];
  const total = partes.length;
  const enviados = partes.filter((p) => !!p?.videoId).length;
  // Fase terminal confirma o render: batch antigo não gravava videoStatus e
  // mostrava "0 prontos" durante a montagem, com os MP4 já baixados.
  const renderConfirmadoPelaFase = fase === 'downloading' || fase === 'post' || fase === 'done';
  const prontos = partes.filter(
    (p) =>
      p?.videoStatus === 'completed' ||
      (renderConfirmadoPelaFase && !!p?.videoId && !p?.videoStatus),
  ).length;

  const ativo = ATIVAS.includes(fase);
  const pctEnvio = total > 0 ? enviados / total : 0;
  const pctRender = enviados > 0 ? prontos / enviados : 0;
  const cauda = fase === 'done' ? 1 : fase === 'downloading' || fase === 'post' ? 0.5 : 0;
  const porContagem =
    fase === 'done' ? 100 : Math.round(pctEnvio * 30 + pctRender * 60 + cauda * 10);
  const motorVale = fase === 'dispatching' || fase === 'rendering' || fase === 'downloading' || fase === 'post';
  const bruto =
    fase === 'done'
      ? 100
      : Math.max(porContagem, motorVale ? Math.max(0, Math.min(99, rec.progressoMotor ?? 0)) : 0);
  const pct = fase === 'failed' ? Math.max(0, Math.min(100, bruto)) : Math.min(100, Math.max(ativo ? 3 : 0, bruto));

  return {
    fase,
    rotulo: ROTULO[fase].rotulo,
    tom: ROTULO[fase].tom,
    pct,
    ativo,
    total,
    enviados,
    prontos,
  };
}

/**
 * Selo de quem NÃO está mais na fila (ou nunca teve fila): o estado vem do
 * próprio registro. Existe pra a lista nunca ficar com umas linhas com selo e
 * outras sem — inconsistência que o dono leu na hora como defeito.
 */
export function seloDoRegistro(kind: string): { rotulo: string; tom: TomDeFase } {
  switch (kind) {
    case 'done':
      return { rotulo: 'Pronto', tom: 'success' };
    case 'export':
      return { rotulo: 'Exportado', tom: 'success' };
    case 'dispatch':
      return { rotulo: 'Disparado', tom: 'idle' };
    case 'download':
      return { rotulo: 'Baixado', tom: 'idle' };
    default:
      return { rotulo: 'Pronto', tom: 'success' };
  }
}

/** Resumo curto dos takes pra linha do histórico (vazio quando não há partes). */
export function resumoDeTakes(s: StatusDisparo | null): string {
  if (!s || s.total === 0) return '';
  if (s.fase === 'done') return `${s.total} take${s.total === 1 ? '' : 's'}`;
  return `${s.prontos}/${s.total} take${s.total === 1 ? '' : 's'}`;
}

/** Há algum disparo trabalhando? (decide se a lista fica lendo o estado) */
export function algumAtivo(mapa: Record<string, StatusDisparo | null>): boolean {
  for (const s of Object.values(mapa)) if (s?.ativo) return true;
  return false;
}

/** Tempo corrido em formato curto (3s, 2m17s, 1h04m). */
export function tempoCurto(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seg = Math.floor(ms / 1000);
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  const restoSeg = seg % 60;
  if (min < 60) return `${min}m${String(restoSeg).padStart(2, '0')}s`;
  const hora = Math.floor(min / 60);
  return `${hora}h${String(min % 60).padStart(2, '0')}m`;
}
