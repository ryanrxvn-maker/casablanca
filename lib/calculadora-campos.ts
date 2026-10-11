/**
 * Campos digitados na Calculadora (11.10) — fora da página pra serem
 * testáveis (página do Next só pode exportar o componente).
 */

/**
 * Preço digitado → número. Vazio/inválido = 0. Aceita o jeito brasileiro
 * (11.10): "1.200" e "1.200,50" são mil e duzentos — antes "1.200" virava
 * R$ 1,20. Ponto seguido de exatamente 3 dígitos = milhar; "99.90" e "99,90"
 * continuam sendo noventa e nove e noventa.
 */
export function parseMoney(s: string): number {
  let t = (s || '').trim().replace(/[R$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return parseFloat(t) || 0;
}

/**
 * Máscara de TEMPO estilo ODÔMETRO: o usuário SÓ digita números e eles entram
 * pela DIREITA, subindo de segundos → minutos → horas. Nunca precisa digitar `:`.
 *
 *   1 → 00:01   ·   11 → 00:11   ·   111 → 01:11   ·   619 → 06:19
 *   1745 → 17:45   ·   14000 → 1:40:00
 *
 * A máscara NÃO normaliza (61 s fica 00:61 enquanto digita); quem faz a conta
 * é o parseDur da página, que lê 00:61 como 61 s. Reprocessar o próprio texto
 * devolve o mesmo texto (round-trip).
 */
export function maskTime(raw: string): string {
  // Só os dígitos, sem zeros à esquerda inúteis; teto de 6 (até 99:99:99).
  const digits = (raw || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 6);
  if (!digits) return '';
  // Os dígitos ficam ONDE foram digitados — sem "corrigir" no meio (11.10).
  // Antes, digitando 6-1-9 o "61" virava 01:01 na hora e o 9 seguinte dava
  // 10:19 (orçamento 63% mais caro no PDF). 00:61 durante a digitação é
  // inofensivo: parseDur lê 61 s certinho e o resumo/PDF mostram 01:01.
  const pad = (n: string) => n.padStart(2, '0');
  const sec = digits.slice(-2);
  const min = digits.length > 2 ? digits.slice(-4, -2) : '';
  const hr = digits.length > 4 ? digits.slice(0, -4) : '';
  return hr ? `${parseInt(hr, 10)}:${pad(min)}:${pad(sec)}` : `${pad(min)}:${pad(sec)}`;
}
