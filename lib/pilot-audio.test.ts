/**
 * Testes das partes PURAS do motor de áudio do Pilot:
 *  - normalização do ASR (shapes variados do fast_asr)
 *  - diff copy × áudio (LCS palavra a palavra)
 *  - pontos de corte guiados pela copy (com e sem ASR)
 *  - snap de pausa
 *
 * Roda igual aos outros: tsc → node (ver package.json "test").
 */
import {
  normalizarPalavrasAsr,
  normTokens,
  compararCopyComAudio,
  pontosDeCorteDoAudio,
  _snapNaPausa,
  type PalavraAsr,
} from './pilot-audio';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    falhas++;
    console.error('  ✗ FALHOU: ' + msg);
  }
}

console.log('— normalizarPalavrasAsr —');
{
  const raw = [
    { word: 'como', start: 0.1, end: 0.4 },
    { text: 'fazer', start_time: 0.5, end_time: 0.9 },
    { w: 'azeite', begin_time: 1.0, end_time: 1.5 },
    { word: 'semtempo' }, // sem tempo → descartada
    null,
  ];
  const ws = normalizarPalavrasAsr(raw as unknown[]);
  ok(ws.length === 3, `3 palavras válidas de 5 entradas (veio ${ws.length})`);
  ok(ws[0].texto === 'como' && ws[2].texto === 'azeite', 'ordem por início preservada');
}

console.log('— normTokens —');
{
  ok(normTokens('Próstata, em 1 minuto!').join('|') === 'prostata|em|1|minuto', 'acentos/pontuação fora, número fica');
  ok(normTokens('guarda-chuva').length === 2, 'hífen separa tokens');
}

console.log('— compararCopyComAudio —');
{
  const d = compararCopyComAudio('Como fazer o azeite diminuir a próstata', 'como fazer o azeite diminuir a prostata');
  ok(d.igual, 'texto igual (só caixa/acentos) → igual');
  ok(d.similaridade === 1, 'similaridade 1');
}
{
  const d = compararCopyComAudio(
    'Como fazer o azeite que custa menos de 10 reais diminuir a próstata',
    'Como fazer o azeite que custa menos de 20 reais reduzir a próstata',
  );
  ok(!d.igual, 'diferença detectada');
  const trocados = d.trechos.filter((t) => t.tipo === 'trocado');
  ok(trocados.length === 2, `2 trechos trocados (10→20, diminuir→reduzir) — veio ${trocados.length}`);
  ok(trocados.some((t) => t.copy === '10' && t.audio === '20'), 'acusa 10 → 20');
  ok(trocados.some((t) => t.copy === 'diminuir' && t.audio === 'reduzir'), 'acusa diminuir → reduzir');
}
{
  const d = compararCopyComAudio('sem pílula e sem cortes em casa', 'sem pílula em casa');
  ok(d.trechos.length === 1 && d.trechos[0].tipo === 'faltou-no-audio' && d.trechos[0].copy === 'e sem cortes', 'trecho da copy ausente no áudio é acusado inteiro');
}
{
  const d = compararCopyComAudio('em casa', 'olha só em casa');
  ok(d.trechos.length === 1 && d.trechos[0].tipo === 'sobrou-no-audio' && d.trechos[0].audio === 'olha so', 'fala extra no áudio é acusada');
}
{
  const d = compararCopyComAudio('', '');
  ok(d.igual && d.trechos.length === 0, 'vazio × vazio não explode');
}

console.log('— pontosDeCorteDoAudio (sem ASR: proporção de texto) —');
{
  const cortes = pontosDeCorteDoAudio(['aaaa bbbb', 'cccc dddd'], 10, null);
  ok(cortes.length === 1, '1 corte pra 2 partes');
  ok(Math.abs(cortes[0] - 5) < 0.6, `corte ~metade pra textos iguais (veio ${cortes[0].toFixed(2)})`);
  ok(pontosDeCorteDoAudio(['só uma parte'], 10, null).length === 0, '1 parte → sem corte');
}

console.log('— pontosDeCorteDoAudio (com ASR: cai na pausa entre takes) —');
{
  // 8 palavras: take 1 = 4 primeiras (0–2.0s), pausa GRANDE 2.0→3.5, take 2 = 4 últimas.
  const ws: PalavraAsr[] = [
    { texto: 'como', inicio: 0.0, fim: 0.4 },
    { texto: 'fazer', inicio: 0.45, fim: 0.9 },
    { texto: 'o', inicio: 0.95, fim: 1.1 },
    { texto: 'azeite', inicio: 1.2, fim: 2.0 },
    { texto: 'quase', inicio: 3.5, fim: 3.9 },
    { texto: 'todo', inicio: 3.95, fim: 4.3 },
    { texto: 'mundo', inicio: 4.35, fim: 4.8 },
    { texto: 'usa', inicio: 4.85, fim: 5.3 },
  ];
  const cortes = pontosDeCorteDoAudio(['como fazer o azeite', 'quase todo mundo usa'], 5.6, ws);
  ok(cortes.length === 1, '1 corte pra 2 takes');
  ok(cortes[0] > 2.0 && cortes[0] < 3.5, `corte DENTRO da pausa 2.0–3.5 (veio ${cortes[0].toFixed(2)})`);
}
{
  // 3 takes com pausas em lugares certos — cortes monotônicos e dentro dos gaps.
  const ws: PalavraAsr[] = [];
  let t = 0;
  const falas = [5, 4, 6]; // palavras por take
  const gaps = [1.2, 0.9];
  falas.forEach((n, ti) => {
    for (let i = 0; i < n; i++) {
      ws.push({ texto: `p${ti}_${i}`, inicio: t, fim: t + 0.3 });
      t += 0.35;
    }
    if (ti < gaps.length) t += gaps[ti];
  });
  const textos = falas.map((n, ti) => Array.from({ length: n }, (_, i) => `p${ti}_${i}`).join(' '));
  const cortes = pontosDeCorteDoAudio(textos, t + 0.5, ws);
  ok(cortes.length === 2, '2 cortes pra 3 takes');
  ok(cortes[0] < cortes[1], 'cortes monotônicos');
  const fimTake1 = ws[4].fim;
  const iniTake2 = ws[5].inicio;
  ok(cortes[0] > fimTake1 - 0.01 && cortes[0] < iniTake2 + 0.01, `1º corte no gap do take 1→2 (veio ${cortes[0].toFixed(2)}, gap ${fimTake1.toFixed(2)}–${iniTake2.toFixed(2)})`);
}

console.log('— _snapNaPausa —');
{
  const pausas = [{ start: 4.0, end: 5.0 }, { start: 9.0, end: 9.4 }];
  ok(Math.abs(_snapNaPausa(4.7, pausas) - 4.5) < 1e-9, 'dentro da pausa → centraliza');
  ok(Math.abs(_snapNaPausa(5.6, pausas) - 4.5) < 1e-9, 'perto da borda → vai pro meio da pausa');
  ok(_snapNaPausa(7.2, pausas) === 7.2, 'longe de qualquer pausa → mantém o alvo');
}

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) FALHARAM`);
  process.exit(1);
}
console.log('\npilot-audio: todos os testes passaram ✓');
