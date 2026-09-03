/**
 * DETECÇÃO DE IDIOMA — o Pilot não pode transcrever tudo como português.
 *
 * Copies REAIS dos nichos: pt (B2C), en (CUTFEELING), es, pl e hu (DR
 * MILLION), cs (emagrecimento tcheco). Errar o idioma aqui = legenda e
 * âncoras de insert erradas no AD inteiro.
 */
import { detectarIdioma, idiomaDaCopy } from './idioma';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

ok(detectarIdioma('Você comprou o vick para ter resultado? Não cometa o mesmo erro que eu, isso aqui é muito mais forte do que parece.') === 'pt', 'copy pt-BR');
ok(detectarIdioma('If you bought this thinking it would fix your prostate, you are making the same mistake that thousands of men make every single day.') === 'en', 'copy em inglês');
ok(detectarIdioma('Si usted compró esto pensando que iba a resolver su próstata, está cometiendo el mismo error que miles de hombres cometen cada día, pero ahora hay algo muy diferente.') === 'es', 'copy em espanhol');
ok(detectarIdioma('Jeśli kupiłeś ten produkt myśląc, że rozwiąże twój problem, popełniasz ten sam błąd, który popełnia bardzo wielu mężczyzn każdego dnia.') === 'pl', 'copy em polonês');
ok(detectarIdioma('Ha azt hitted, hogy ez megoldja a problémádat, akkor nagyon nagy hibát követsz el, mert már ezrek próbálták ki és nem működött nekik sem.') === 'hu', 'copy em húngaro');
ok(detectarIdioma('Pokud jste si koupili tento produkt, protože jste si mysleli, že vyřeší váš problém, děláte stejnou chybu jako tisíce mužů každý den.') === 'cs', 'copy em tcheco');
ok(detectarIdioma('Wenn Sie das gekauft haben, weil Sie dachten, dass es Ihr Problem löst, machen Sie den gleichen Fehler wie tausende Männer jeden Tag.') === 'de', 'copy em alemão');

// ── sem evidência = null (o chamador decide o fallback) ──
ok(detectarIdioma('') === null, 'vazio não tem veredito');
ok(detectarIdioma('AD07 G1 GL 123 456') === null, 'código de task não tem veredito');
ok(detectarIdioma('ok') === null, 'curto demais não tem veredito');

// ── a régua do Pilot ──
ok(
  idiomaDaCopy([{ text: 'Você comprou para ter resultado?' }, { text: 'Não cometa o mesmo erro que eu, aqui é muito mais forte.' }]) === 'pt',
  'idiomaDaCopy junta as partes',
);
ok(idiomaDaCopy([{ text: 'whatever text here' }], 'pl') === 'pl', 'a escolha explícita do user SEMPRE vence a detecção');
ok(idiomaDaCopy([{ text: '123' }]) === 'pt', 'sem evidência, o fallback é pt — nunca um palpite');

// determinismo: mesma copy, mesmo veredito, sempre
const copy = 'Jeśli kupiłeś ten produkt myśląc, że rozwiąże twój problem, popełniasz błąd.';
ok(detectarIdioma(copy) === detectarIdioma(copy), 'determinístico');

console.log(`\n${failed === 0 ? '✓' : '✗'} idioma: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
