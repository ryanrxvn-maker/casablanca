/**
 * Testes dos EFEITOS ligáveis da legenda (traço, sombra, brilho, fumaça).
 *
 * A queixa que originou o módulo (Silas, 31.08): "se a legenda não vem com
 * traço, eu mexo ali pro lado e não muda nada". Os controles eram só
 * multiplicadores sobre o que o modelo tinha — num modelo sem o efeito,
 * multiplicar zero por qualquer coisa continua zero.
 */
import type { TypoPreset } from './engine';
import {
  applyFx,
  fxDefault,
  fxIsAuto,
  fxIsOn,
  fxMultipliers,
  fxPresence,
  normalizeFx,
  seedFxFromPreset,
  type FxState,
  type ShadowFx,
  type StrokeFx,
} from './fx';
import { getPreset, TYPO_PRESETS } from './presets';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

/** Modelo PELADO: sem traço, sem sombra, sem brilho, sem fumaça. */
const PELADO: TypoPreset = {
  id: 'pelado',
  name: 'Pelado',
  cat: 'Teste',
  font: 'inter800',
  size: 0.06,
  uppercase: true,
  lineHeight: 1.16,
  fill: 'primary',
  unit: 'word',
  in: { kind: 'fade', dur: 200 },
  out: { kind: 'none', dur: 0 },
  highlightStyle: 'color',
  defaultPrimary: '#ffffff',
  defaultAccent: '#ffd60a',
};

console.log('\n── o modelo pelado ──');
{
  const p = fxPresence(PELADO);
  ok(!p.stroke && !p.shadow && !p.glow && !p.smoke, 'o modelo de teste não tem efeito nenhum');
  ok(applyFx(PELADO, null) === PELADO, 'sem fx, applyFx devolve o MESMO objeto (cache de layout intacto)');
  ok(applyFx(PELADO, fxDefault()) === PELADO, 'fx todo em auto também devolve o mesmo objeto');
  ok(fxIsAuto(fxDefault()) && fxIsAuto(null), 'fxIsAuto reconhece o estado neutro');
}

console.log('\n── LIGAR o efeito num modelo que não tem (a queixa) ──');
{
  const fx = fxDefault();
  fx.stroke = { mode: 'on', width: 0.08, color: '#123456' };
  const out = applyFx(PELADO, fx);
  ok(!!out.stroke, 'ligar o traço CRIA o traço num modelo que não tinha');
  ok(out.stroke?.width === 0.08 && out.stroke?.color === '#123456', 'com a espessura e a cor pedidas');
  ok(!PELADO.stroke, 'e o preset original NÃO foi mutado');
}
{
  const fx = fxDefault();
  fx.glow = { mode: 'on', kind: 'suave', color: '#22d3ee', blur: 0.3 };
  const out = applyFx(PELADO, fx);
  ok(out.glow?.color === '#22d3ee' && out.glow?.blur === 0.3, 'ligar o brilho cria o glow com cor e alcance');
  ok(!out.aura, 'brilho suave não desenha anéis');
}
{
  const fx = fxDefault();
  fx.smoke = { mode: 'on', kind: 'subindo', alpha: 0.5 };
  const out = applyFx(PELADO, fx);
  ok(out.smoke?.alpha === 0.5 && out.smoke?.kind === 'subindo', 'ligar a fumaça cria a fumaça no tipo escolhido');
}

console.log('\n── tipos de SOMBRA ──');
{
  const base = fxDefault();
  const mk = (o: Partial<ShadowFx>): FxState => ({
    ...base,
    shadow: { ...base.shadow, mode: 'on', ...o } as ShadowFx,
  });

  const suave = applyFx(PELADO, mk({ kind: 'suave', dist: 0.1, angle: 90, blur: 0.2, opacity: 0.5, color: '#000000' }));
  ok(!!suave.shadow && !suave.hardShadow, 'sombra suave usa shadow (com blur), não a dura');
  ok(Math.abs((suave.shadow?.y ?? 0) - 0.1) < 1e-9, 'ângulo 90 joga a sombra pra BAIXO');
  ok(Math.abs(suave.shadow?.x ?? 1) < 1e-9, 'e nada pro lado');
  ok(suave.shadow?.color === 'rgba(0,0,0,0.500)', 'a opacidade entra na cor como rgba');
  ok(suave.shadow?.blur === 0.2, 'o desfoque é o pedido');

  const zero = applyFx(PELADO, mk({ kind: 'suave', dist: 0.1, angle: 0 }));
  ok(Math.abs((zero.shadow?.x ?? 0) - 0.1) < 1e-9 && Math.abs(zero.shadow?.y ?? 1) < 1e-9, 'ângulo 0 joga pra direita');

  const dura = applyFx(PELADO, mk({ kind: 'dura', dist: 0.06, angle: 45 }));
  ok(!!dura.hardShadow && !dura.shadow, 'sombra dura usa hardShadow, sem blur');
  ok(
    Math.abs((dura.hardShadow?.x ?? 0) - 0.06 * Math.cos(Math.PI / 4)) < 1e-9,
    'a distância vira x/y pelo ângulo também na dura',
  );

  const contorno = applyFx(PELADO, mk({ kind: 'contorno', dist: 0.5, blur: 0.18 }));
  ok(contorno.shadow?.x === 0 && contorno.shadow?.y === 0, 'contorno ignora a distância (halo em volta)');
  ok((contorno.shadow?.blur ?? 0) > 0, 'e sempre tem desfoque');
}

console.log('\n── tipos de BRILHO ──');
{
  const base = fxDefault();
  const mk = (kind: 'suave' | 'neon' | 'halo' | 'pulsante'): FxState => ({
    ...base,
    glow: { mode: 'on', kind, color: '#ff00aa', blur: 0.2 },
  });
  const neon = applyFx(PELADO, mk('neon'));
  ok(!!neon.glow && !!neon.aura && !neon.aura?.pulse, 'neon = glow + anéis parados');
  const puls = applyFx(PELADO, mk('pulsante'));
  ok(puls.aura?.pulse === true, 'pulsante = anéis que pulsam');
  const halo = applyFx(PELADO, mk('halo'));
  ok((halo.glow?.blur ?? 0) > 0.2 && !halo.aura, 'halo espalha mais e não usa anéis');
  const suave = applyFx(PELADO, mk('suave'));
  ok(suave.glow?.blur === 0.2 && !suave.aura, 'suave é só o glow no alcance pedido');
}

console.log('\n── DESLIGAR o que o modelo tem ──');
{
  const comTudo: TypoPreset = {
    ...PELADO,
    stroke: { color: '#fff', width: 0.04 },
    shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.1, x: 0, y: 0.04 },
    glow: { color: 'accent', blur: 0.2 },
    aura: { color: 'accent', count: 3, width: 0.05, alpha: 0.3 },
    smoke: { alpha: 0.4 },
  };
  const p = fxPresence(comTudo);
  ok(p.stroke && p.shadow && p.glow && p.smoke, 'presença detecta os quatro efeitos do modelo');

  const fx = fxDefault();
  fx.stroke.mode = 'off';
  fx.shadow.mode = 'off';
  fx.glow.mode = 'off';
  fx.smoke.mode = 'off';
  const out = applyFx(comTudo, fx);
  ok(!out.stroke, 'traço desligado some');
  ok(!out.shadow && !out.hardShadow, 'sombra desligada some (suave e dura)');
  ok(!out.glow && !out.aura, 'brilho desligado leva os anéis junto');
  ok(!out.smoke, 'fumaça desligada some');
  ok(!!comTudo.stroke && !!comTudo.glow, 'o preset original continua intacto');
}

console.log('\n── semente ao ligar (não dá pulo visual) ──');
{
  const comSombra: TypoPreset = {
    ...PELADO,
    shadow: { color: 'rgba(0,0,0,0.55)', blur: 0.16, x: 0, y: 0.05 },
  };
  const seed = seedFxFromPreset(comSombra, 'shadow') as ShadowFx;
  ok(seed.mode === 'on', 'a semente já vem ligada');
  ok(seed.kind === 'suave' && Math.abs(seed.dist - 0.05) < 1e-9, 'distância vem do modelo');
  ok(Math.abs(seed.angle - 90) < 0.6, 'ângulo 90 (sombra pra baixo) sai do x/y do modelo');
  ok(Math.abs(seed.opacity - 0.55) < 1e-9, 'a opacidade sai do alpha do rgba do modelo');
  ok(seed.color === '#000000', 'e a cor vira hex editável');

  // ligar com a semente e aplicar reproduz o MESMO desenho do modelo
  const fx = { ...fxDefault(), shadow: seed };
  const out = applyFx(comSombra, fx);
  ok(
    Math.abs((out.shadow?.y ?? 0) - 0.05) < 1e-3 && Math.abs((out.shadow?.blur ?? 0) - 0.16) < 1e-9,
    'ligar com a semente devolve a MESMA sombra que o modelo já desenhava',
  );

  const st = seedFxFromPreset({ ...PELADO, stroke: { color: '#e8192c', width: 0.07 } }, 'stroke') as StrokeFx;
  ok(st.width === 0.07 && st.color === '#e8192c', 'semente do traço copia espessura e cor do modelo');

  const semNada = seedFxFromPreset(PELADO, 'stroke') as StrokeFx;
  ok(semNada.mode === 'on' && semNada.width > 0, 'modelo sem traço ganha um padrão que APARECE');
}

console.log('\n── multiplicadores ──');
{
  const base = { stroke: 2, shadow: 2, glow: 2, smoke: 2 };
  ok(
    JSON.stringify(fxMultipliers(null, base)) === JSON.stringify(base),
    'em auto, o multiplicador antigo continua valendo',
  );
  const fx = fxDefault();
  fx.stroke.mode = 'on';
  const m = fxMultipliers(fx, base);
  ok(m.stroke === 1, 'com o efeito ligado explicitamente o multiplicador vira 1 (o número do painel não mente)');
  ok(m.shadow === 2, 'e os outros efeitos seguem no multiplicador antigo');
}

console.log('\n── robustez ──');
{
  ok(fxIsOn('on', false) && !fxIsOn('off', true) && fxIsOn('auto', true) && !fxIsOn('auto', false), 'fxIsOn cobre os 4 casos');
  const parcial = normalizeFx({ glow: { mode: 'on' } });
  ok(parcial.glow.blur > 0 && parcial.stroke.mode === 'auto', 'sessão parcial é completada com os defaults');
  const d1 = fxDefault();
  d1.stroke.width = 99;
  ok(fxDefault().stroke.width !== 99, 'fxDefault devolve cópia (não vaza o objeto compartilhado)');

  // varredura nos 491 modelos: aplicar fx nunca quebra nem muta
  let mutou = 0;
  let quebrou = 0;
  const fxOn: FxState = {
    stroke: { mode: 'on', width: 0.05, color: '#000000' },
    shadow: { mode: 'on', kind: 'dura', color: '#101010', opacity: 0.7, blur: 0.1, dist: 0.05, angle: 30 },
    glow: { mode: 'on', kind: 'pulsante', color: null, blur: 0.25 },
    smoke: { mode: 'on', kind: 'poeira', alpha: 0.3 },
  };
  for (const pr of TYPO_PRESETS) {
    const antes = JSON.stringify(pr);
    try {
      const out = applyFx(pr, fxOn);
      if (!out.stroke || !out.hardShadow || !out.glow || !out.smoke) quebrou++;
    } catch {
      quebrou++;
    }
    if (JSON.stringify(pr) !== antes) mutou++;
  }
  ok(quebrou === 0, `ligar tudo funciona nos ${TYPO_PRESETS.length} modelos`);
  ok(mutou === 0, 'e nenhum modelo do catálogo foi mutado');

  // semente de todos os modelos não estoura
  let seedFail = 0;
  for (const pr of TYPO_PRESETS) {
    for (const k of ['stroke', 'shadow', 'glow', 'smoke'] as const) {
      const sd = seedFxFromPreset(pr, k) as { mode: string };
      if (sd.mode !== 'on') seedFail++;
    }
  }
  ok(seedFail === 0, 'a semente sai ligada pra qualquer modelo e qualquer efeito');

  // um modelo real conhecido
  const vs = getPreset('vermelho-sangue');
  ok(fxPresence(vs).glow, 'Vermelho Sangue tem brilho de fábrica');
  ok(!fxPresence(vs).stroke, 'e NÃO tem traço (era o caso do slider morto)');
}

console.log(falhas === 0 ? '\n✅ fx: tudo passou' : `\n❌ fx: ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
