/**
 * Testes da BARRA DE PROGRESSO do modo economia.
 *
 * O defeito que originou isto: a barra ficava CRAVADA em 3% durante todo o
 * disparo (minutos) e só pulava pra 100% no fim. Estes testes fixam as três
 * propriedades que impedem isso de voltar — e o último deles compara as
 * fórmulas com a CÓPIA que roda dentro da extensão, porque as duas se
 * desencontrarem em silêncio é exatamente como o defeito voltaria.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  faixaDaCena,
  pctDaEspera,
  linhaDoTempoEconomia,
  PCT_PREPARO,
  PCT_UTIL,
  ESPERA_TAU_MS,
  ESPERA_PISO,
  ESPERA_ALCANCE,
} from './pilot-progresso';

let oks = 0;
let fails = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { oks++; console.log(`  ✓ ${msg}`); }
  else { fails++; console.log(`  ✗ ${msg}`); }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (veio ${JSON.stringify(a)})`);
}

console.log('pilot-progresso:');

/* ─── 1. as faixas cobrem tudo, na ordem, sem buraco nem sobreposição ─── */
{
  for (const total of [1, 2, 3, 7, 12]) {
    let anteriorFim = PCT_PREPARO;
    let contiguas = true;
    for (let i = 0; i < total; i++) {
      const f = faixaDaCena(i, total);
      if (Math.abs(f.inicio - anteriorFim) > 1e-9) contiguas = false;
      anteriorFim = f.inicio + f.largura;
    }
    ok(contiguas, `${total} cena(s): as faixas se encaixam sem buraco`);
    ok(Math.abs(anteriorFim - (PCT_PREPARO + PCT_UTIL)) < 1e-9, `${total} cena(s): a última faixa termina em ${PCT_PREPARO + PCT_UTIL}%`);
  }
}

/* ─── 2. a espera SEMPRE anda, e nunca invade a cena seguinte ─── */
{
  const { inicio, largura } = faixaDaCena(0, 3);
  let anterior = -1;
  let sempreSobe = true;
  for (let s = 0; s <= 600; s += 4) {
    const p = pctDaEspera(inicio, largura, s * 1000);
    if (p <= anterior) sempreSobe = false;
    anterior = p;
  }
  ok(sempreSobe, 'a espera sobe a CADA volta de 4s, mesmo depois de 10 minutos');

  const teto = inicio + largura * (ESPERA_PISO + ESPERA_ALCANCE);
  ok(pctDaEspera(inicio, largura, 60 * 60 * 1000) < teto + 1e-9, 'nem em 1 hora a espera alcança o fim da própria faixa');
  ok(teto < inicio + largura, 'o teto da espera fica DENTRO da faixa — nunca invade a cena seguinte');

  // O que o usuário sente: em 30s de render a barra tem que ter andado de verdade.
  const em4 = pctDaEspera(inicio, largura, 4000);
  const em30 = pctDaEspera(inicio, largura, 30000);
  ok(em30 - em4 > largura * 0.25, `em 30s a barra anda mais de 1/4 da faixa da cena (andou ${(em30 - em4).toFixed(1)}%)`);
}

/* ─── 3. a linha do tempo inteira é MONOTÔNICA e não fica parada ─── */
{
  const linha = linhaDoTempoEconomia([30, 45, 28]);
  let monotonica = true;
  let maiorParada = 0;
  for (let i = 1; i < linha.length; i++) {
    if (linha[i].pct < linha[i - 1].pct) monotonica = false;
    if (linha[i].pct === linha[i - 1].pct) {
      maiorParada = Math.max(maiorParada, linha[i].t - linha[i - 1].t);
    }
  }
  ok(monotonica, 'a barra NUNCA anda pra trás no disparo inteiro');
  ok(maiorParada <= 5, `a barra nunca fica no mesmo valor por mais de 5s (pior caso: ${maiorParada}s)`);
  ok(linha[linha.length - 1].pct === 97, 'termina em 97% — os últimos 3% são do download/montagem');
  ok(linha[0].pct <= 5, 'começa baixo, sem fingir progresso que não houve');

  // 1 cena só era o pior caso do defeito antigo: base=0 o disparo inteiro.
  const uma = linhaDoTempoEconomia([35]);
  const durante = uma.filter((e) => /renderizando ha/.test(e.msg));
  ok(durante.length >= 8, `com 1 cena só, a barra recebe ${durante.length} atualizações durante a espera`);
  ok(durante[durante.length - 1].pct - durante[0].pct > 15, 'e sobe mais de 15 pontos ao longo dela');
}

/* ─── 4. ANTI-DERIVA: a extensão usa as MESMAS fórmulas ─── */
{
  const fonte = readFileSync(join(process.cwd(), 'extension', 'heygen-content.js'), 'utf8');

  const faixa = /const util = (\d+);\s*\n\s*const inicio = (\d+) \+ \(i \/ total\) \* util;/.exec(fonte);
  ok(!!faixa, 'achei ecoFaixaDaCena na extensão');
  if (faixa) {
    eq(Number(faixa[1]), PCT_UTIL, 'a extensão usa o MESMO PCT_UTIL');
    eq(Number(faixa[2]), PCT_PREPARO, 'a extensão usa o MESMO PCT_PREPARO');
  }

  const espera = /Math\.exp\(-Math\.max\(0, decorridoMs\) \/ (\d+)\);\s*\n\s*return inicio \+ largura \* \(([\d.]+) \+ ([\d.]+) \* k\);/.exec(fonte);
  ok(!!espera, 'achei ecoPctDaEspera na extensão');
  if (espera) {
    eq(Number(espera[1]), ESPERA_TAU_MS, 'a extensão usa o MESMO tau da curva de espera');
    eq(Number(espera[2]), ESPERA_PISO, 'a extensão usa o MESMO piso da espera');
    eq(Number(espera[3]), ESPERA_ALCANCE, 'a extensão usa o MESMO alcance da espera');
  }

  // A trava que garante que a barra nunca volta atrás mora na extensão.
  ok(/if \(n > ecoPctAtual\) ecoPctAtual = n;/.test(fonte), 'a extensão só emite progresso que SOBE');
  // E a espera avisa a cada volta, não a cada 5 (foi o que congelava ~20s).
  ok(!/voltas % 5 === 0/.test(fonte), 'a espera não pula mais 4 de cada 5 avisos');
}

console.log(`\npilot-progresso: ${oks} ok, ${fails} fail`);
if (fails) process.exit(1);
