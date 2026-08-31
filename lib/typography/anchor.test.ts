/**
 * Testes da ÂNCORA da legenda no quadro — a margem de manobra do arrasto.
 *
 * Queixa do Silas (31.08): "ele trava ali como se tivesse uma borda que não
 * deixa arrastar mais pro lado; preciso de mais espaço invisível... só não
 * pode sair o texto inteiro da tela".
 *
 * Antes o bloco era obrigado a caber INTEIRO no quadro (topY preso em
 * [4%, 96%-altura]), o que virava uma parede bem antes da borda. Agora a
 * única regra é: sempre sobra uma FATIA dentro do quadro.
 */
import { captionAnchor, captionPosBounds, FRACAO_VISIVEL } from './engine';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

const W = 1080;
const H = 1920;
const BW = 800; // largura do bloco
const BH = 240; // altura do bloco

console.log('\n── dá pra passar da borda (o pedido) ──');
{
  const b = captionPosBounds(BW, BH, W, H);
  ok(b.minY < 0, `dá pra subir ACIMA do topo (minY=${b.minY.toFixed(3)})`);
  ok(b.maxY > 1, `e descer ABAIXO do rodapé (maxY=${b.maxY.toFixed(3)})`);
  ok(b.minX < 0, `dá pra sair pela esquerda (minX=${b.minX.toFixed(3)})`);
  ok(b.maxX > 1, `e pela direita (maxX=${b.maxX.toFixed(3)})`);

  // a régua antiga: posY ficava preso em ~[0.10, 0.90] com este bloco
  const antigoMin = (H * 0.04 + BH / 2) / H;
  const antigoMax = (H * 0.96 - BH / 2) / H;
  ok(b.minY < antigoMin - 0.05, `bem mais espaço em cima que a régua antiga (${antigoMin.toFixed(2)} → ${b.minY.toFixed(2)})`);
  ok(b.maxY > antigoMax + 0.05, `e embaixo (${antigoMax.toFixed(2)} → ${b.maxY.toFixed(2)})`);
}

console.log('\n── mas NUNCA some inteiro ──');
{
  const b = captionPosBounds(BW, BH, W, H);
  const noLimite = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
    { x: b.maxX, y: b.minY },
  ];
  for (const p of noLimite) {
    const { cx, topY } = captionAnchor(p.x, p.y, BW, BH, W, H);
    const esq = cx - BW / 2;
    const dir = cx + BW / 2;
    const visX = Math.min(dir, W) - Math.max(esq, 0);
    const visY = Math.min(topY + BH, H) - Math.max(topY, 0);
    ok(visX > 0 && visY > 0, `no limite (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) ainda sobra ${Math.round(visX)}x${Math.round(visY)}px na tela`);
  }
}
{
  // valor ABSURDO vindo de fora (template, sessão corrompida) é contido
  for (const [x, y] of [[-9, -9], [9, 9], [0.5, 50], [-50, 0.5]] as const) {
    const { cx, topY } = captionAnchor(x, y, BW, BH, W, H);
    const visX = Math.min(cx + BW / 2, W) - Math.max(cx - BW / 2, 0);
    const visY = Math.min(topY + BH, H) - Math.max(topY, 0);
    ok(visX > 0 && visY > 0, `posição absurda (${x}, ${y}) ainda desenha algo na tela`);
  }
}

console.log('\n── a fatia visível é a prometida ──');
{
  const b = captionPosBounds(BW, BH, W, H);
  const restoX = Math.max(8, Math.min(BW, W) * FRACAO_VISIVEL);
  const restoY = Math.max(8, Math.min(BH, H) * FRACAO_VISIVEL);
  const noCanto = captionAnchor(b.maxX, b.maxY, BW, BH, W, H);
  const sobraDireita = W - (noCanto.cx - BW / 2);
  const sobraBaixo = H - noCanto.topY;
  ok(Math.abs(sobraDireita - restoX) < 0.51, `no extremo direito sobram ${sobraDireita.toFixed(1)}px (pedido ${restoX.toFixed(1)})`);
  ok(Math.abs(sobraBaixo - restoY) < 0.51, `no extremo de baixo sobram ${sobraBaixo.toFixed(1)}px (pedido ${restoY.toFixed(1)})`);
}

console.log('\n── centro continua sendo o centro ──');
{
  const { cx, topY } = captionAnchor(0.5, 0.5, BW, BH, W, H);
  ok(Math.abs(cx - W / 2) < 1e-9, 'posX 0.5 põe o bloco no meio horizontal');
  ok(Math.abs(topY + BH / 2 - H / 2) < 1e-9, 'posY 0.5 põe o CENTRO do bloco no meio vertical');
  const padrao = captionAnchor(0.5, 0.76, BW, BH, W, H);
  ok(Math.abs(padrao.topY + BH / 2 - H * 0.76) < 1e-9, 'a altura padrão (76%) não é mais mexida por clamp nenhum');
}

console.log('\n── bloco gigante (maior que o quadro) ──');
{
  const b = captionPosBounds(W * 1.4, H * 1.4, W, H);
  ok(b.minX < b.maxX && b.minY < b.maxY, 'a faixa continua válida (min < max) mesmo com bloco maior que a tela');
  const meio = captionAnchor(0.5, 0.5, W * 1.4, H * 1.4, W, H);
  ok(Number.isFinite(meio.cx) && Number.isFinite(meio.topY), 'e a âncora sai num número real');
}

console.log('\n── blocos de tamanhos diferentes ganham faixas diferentes ──');
{
  const pequeno = captionPosBounds(200, 80, W, H);
  const grande = captionPosBounds(900, 400, W, H);
  ok(grande.maxY > pequeno.maxY, 'bloco maior pode descer mais (a fatia visível é dele mesmo)');
  ok(grande.minY < pequeno.minY, 'e subir mais');
}

console.log(falhas === 0 ? '\n✅ anchor: tudo passou' : `\n❌ anchor: ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
