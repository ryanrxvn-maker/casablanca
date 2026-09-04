/**
 * TRAVA DO SCROLL DA PÁGINA — com CONTADOR (04.09).
 *
 * Toda janela modal do app travava o scroll do jeito ingênuo: guarda o
 * `overflow` de antes, põe `hidden`, e no fim devolve o guardado. Funciona com
 * UMA janela. Com DUAS abertas ao mesmo tempo quebra feio:
 *
 *   janela A monta  → antes = ''        , body = 'hidden'
 *   janela B monta  → antes = 'hidden'  , body = 'hidden'
 *   janela A fecha  → body = ''         (destrava cedo demais)
 *   janela B fecha  → body = 'hidden'   ← a página NUNCA MAIS ROLA
 *
 * E duas janelas ao mesmo tempo não é hipótese no ClickUp Pilot: a mesma task
 * aparece no card de análise E na fila de produção, então os dois cards
 * renderizam a mesma janela de pós-produção; abrir a de Legenda por um dos
 * lados monta as duas cópias.
 *
 * Aqui a trava é do APP, não de cada janela: só a primeira trava e só a última
 * destrava. O valor original é guardado uma vez só.
 */

let abertas = 0;
let overflowOriginal = '';

/**
 * Trava o scroll do body e devolve a função que destrava.
 * Uso: `useEffect(() => travarScrollDaPagina(), [])`.
 */
export function travarScrollDaPagina(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (abertas === 0) {
    overflowOriginal = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  abertas++;
  let soltou = false;
  return () => {
    // O React pode chamar a limpeza mais de uma vez (StrictMode, remontagem):
    // sem esta guarda o contador iria pra baixo de zero e a trava vazaria.
    if (soltou) return;
    soltou = true;
    abertas = Math.max(0, abertas - 1);
    if (abertas === 0) document.body.style.overflow = overflowOriginal;
  };
}
