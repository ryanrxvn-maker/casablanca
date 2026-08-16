/**
 * A credencial do OAuth do modo imagem.
 *
 * O bug que isto blinda (16/08/2026): o campo guardava só o refresh token, e o
 * HeyGen INVALIDA o refresh anterior a cada renovação. Cada instância fria
 * renovava, queimava o token e — por causa de um upsert cujo erro ninguém
 * checava — não gravava o novo. Resultado: "tenho que fazer login toda vez".
 * Guardando o access (que vale ~10 dias) junto, a renovação vira evento raro.
 */
import { lerCredencial, empacotarCredencial } from './heygen-image-video';

let fails = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL ${label}\n  esperado: ${e}\n  veio:     ${a}`); fails++; }
  else console.log(`ok   ${label}`);
}
const ok = (c: boolean, label: string) => eq(!!c, true, label);

// COMPATIBILIDADE: é isto que o usuário cola na mão em /configuracoes/api, e é
// o formato de tudo que já está gravado hoje.
{
  const c = lerCredencial('meu-refresh-puro');
  eq(c.refresh, 'meu-refresh-puro', 'string pura continua sendo o refresh');
  eq(c.access, undefined, 'sem access quando é string pura');
  ok(!c.exp, 'sem validade quando é string pura');
}

// espaço em volta (colar de terminal traz \n) não pode virar outro token
eq(lerCredencial('  refresh-com-espaco \n').refresh, 'refresh-com-espaco', 'apara espaço do colar');

// IDA E VOLTA
{
  const exp = 1786900000000;
  const pacote = empacotarCredencial({ refresh: 'r1', access: 'a1', exp });
  const c = lerCredencial(pacote);
  eq(c.refresh, 'r1', 'refresh sobrevive ao empacotamento');
  eq(c.access, 'a1', 'access sobrevive');
  eq(c.exp, exp, 'validade sobrevive');
}

// JSON QUEBRADO não pode derrubar o disparo — trata como refresh e segue
{
  const c = lerCredencial('{isso nao e json');
  eq(c.refresh, '{isso nao e json', 'JSON inválido vira refresh puro (não explode)');
}

// aceita também o nome do campo como o HeyGen devolve
eq(lerCredencial(JSON.stringify({ refresh_token: 'r9' })).refresh, 'r9', 'aceita refresh_token');

// exp inválido não vira "válido pra sempre"
{
  const c = lerCredencial(JSON.stringify({ refresh: 'r', access: 'a', exp: 'ontem' }));
  ok(!c.exp, 'exp não-numérico é descartado (senão serviria token vencido)');
}

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
