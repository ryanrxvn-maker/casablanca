/**
 * CHAT DE AJUDA — a mensagem que chega no WhatsApp do suporte tem que dizer
 * QUEM é, QUAL o assunto e O QUE houve, num texto que dá gosto de ler, sem
 * perder nada do que a pessoa escreveu (e sem ruído tipo "Página: ...").
 */
import {
  HELP_TOPICS,
  buildSupportMessage,
  cleanText,
  detectTopic,
  followUpFor,
  looksLikeEmail,
  MAX_DESCRICAO,
  SUPPORT_WHATSAPP,
  toolFromPath,
  toolMentioned,
  whatsappUrl,
} from './help-chat';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`, extra ?? '');
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(a === b, msg, `\n    recebido: ${JSON.stringify(a)}\n    esperado: ${JSON.stringify(b)}`);
}

console.log('help-chat: mensagem do WhatsApp');

eq(
  buildSupportMessage({
    name: 'Silas',
    email: 'cliente@exemplo.com',
    topic: 'conta',
    description: 'Não recebi o e-mail de confirmação',
    pathname: '/tools',
  }),
  'Olá, suporte do Auto Edit! Meu nome é Silas.\n\n' +
    'Conta: cliente@exemplo.com\n' +
    'Assunto: Problema na conta\n' +
    'O que aconteceu: Não recebi o e-mail de confirmação.\n\n' +
    'Podem me ajudar?',
  'logado + conta: o caso do print do Silas, sem "Página"',
);

eq(
  buildSupportMessage({
    name: 'Ana Souza',
    email: 'ana@exemplo.com',
    topic: 'ferramenta',
    description: 'travou no processamento',
    pathname: '/tools/tipografia',
  }),
  'Olá, suporte do Auto Edit! Meu nome é Ana Souza.\n\n' +
    'Conta: ana@exemplo.com\n' +
    'Assunto: Erro na ferramenta Legendas Automáticas\n' +
    'O que aconteceu: Travou no processamento.\n\n' +
    'Podem me ajudar?',
  'erro numa ferramenta: a ferramenta da página entra no assunto; relato com maiúscula e ponto',
);

eq(
  buildSupportMessage({ topic: 'conta', description: 'Não consigo entrar', pathname: '/login' }),
  'Olá, suporte do Auto Edit!\n\n' + 'Assunto: Problema na conta\n' + 'O que aconteceu: Não consigo entrar.\n\n' + 'Podem me ajudar?',
  'deslogado sem e-mail: sem nome e sem linha de conta',
);

ok(
  buildSupportMessage({ topic: 'ferramenta', description: 'Não, foi no downloader. O link não baixa', pathname: '/tools/tipografia' }).includes(
    'Assunto: Erro na ferramenta Downloader\n',
  ),
  'ferramenta citada no relato vence a da página',
);
ok(
  buildSupportMessage({ topic: 'ferramenta', description: 'não, foi em outra', pathname: '/tools/tipografia' }).includes(
    'Assunto: Erro em uma ferramenta\n',
  ),
  '"não" ao "Foi na ferramenta X?" tira a ferramenta da página do assunto',
);
ok(
  buildSupportMessage({ topic: 'ferramenta', description: 'Travou', pathname: '/' }).includes('Assunto: Erro em uma ferramenta\n'),
  'fora de ferramenta: assunto genérico',
);

eq(
  buildSupportMessage({ email: 'x@y.com', topic: 'duvida', description: 'como faço legenda em lote?', pathname: '/' }),
  'Olá, suporte do Auto Edit!\n\n' + 'Conta: x@y.com\n' + 'Assunto: Dúvida de como usar\n' + 'Minha dúvida: Como faço legenda em lote?\n\n' + 'Podem me ajudar?',
  'dúvida: rótulo "Minha dúvida", pontuação da pessoa respeitada',
);

eq(
  buildSupportMessage({ name: 'Bia', topic: null, description: 'HeyGen recusou meu avatar', pathname: '/' }),
  'Olá, suporte do Auto Edit! Meu nome é Bia.\n\n' + 'O que aconteceu: HeyGen recusou meu avatar.\n\n' + 'Podem me ajudar?',
  'sem assunto reconhecido: sem linha de assunto (nada de chute)',
);

eq(
  buildSupportMessage({ topic: 'pagamento', description: 'paguei no pix\n\n\n\ne   não liberou', pathname: '/planos' }),
  'Olá, suporte do Auto Edit!\n\n' + 'Assunto: Plano e pagamento\n' + 'O que aconteceu:\nPaguei no pix\n\ne não liberou.\n\n' + 'Podem me ajudar?',
  'relato de várias linhas vai na linha de baixo, sem espaço/linha em excesso',
);

eq(
  buildSupportMessage({ topic: 'duvida', description: '', pathname: '/' }),
  'Olá, suporte do Auto Edit!\n\nAssunto: Dúvida de como usar\n\nPodem me ajudar?',
  'relato vazio não deixa rótulo pendurado',
);

for (const t of HELP_TOPICS) {
  for (const r of t.rapidas) {
    const m = buildSupportMessage({ name: 'Ana', email: 'a@b.co', topic: t.id, description: r, pathname: '/tools/lipsync' });
    ok(!/Página|localhost|darkoautoedit|undefined|null/.test(m) && m.endsWith('Podem me ajudar?'), `resposta rápida "${r}" sai limpa`, m);
  }
}

eq(cleanText('x'.repeat(5000)).length, MAX_DESCRICAO, 'relato gigante é cortado no teto');

console.log('help-chat: link');
const msg = 'Olá! Tudo bem? 50% & #1\nlinha';
const url = whatsappUrl(msg);
ok(url.startsWith(`https://wa.me/${SUPPORT_WHATSAPP}?text=`), 'link wa.me do número do suporte');
eq(decodeURIComponent(url.split('?text=')[1]), msg, 'texto ida e volta sem perder acento, %, &, # nem quebra de linha');
ok(!/[\s#&]/.test(url.split('?text=')[1]), 'nada cru na query (espaço, #, &)');
ok(
  whatsappUrl(buildSupportMessage({ name: 'A', email: 'a@b.co', topic: 'conta', description: 'y'.repeat(9999), pathname: '/tools/lipsync' })).length < 8000,
  'pior caso cabe com folga no limite prático de URL',
);

console.log('help-chat: ferramentas');
eq(toolFromPath('/tools/clickup-pilot'), 'Pilot', 'Pilot pelo nome que o dono usa');
eq(toolFromPath('/tools/caixinha-pergunta'), 'FakePrint', 'apelido cai na ferramenta dona');
eq(toolFromPath('/tools/historico'), null, 'histórico não é ferramenta');
eq(toolFromPath('/tools'), null, 'hub não é ferramenta');
eq(toolFromPath('/configuracoes'), null, 'fora de /tools não é ferramenta');
eq(toolMentioned('o lipsync não gera'), 'Lipsync', 'cita ferramenta sem acento/maiúscula');
eq(toolMentioned('no remover silencios por copy travou'), 'Remover Silêncios por Copy', 'nome mais longo vence');
eq(toolMentioned('remover silêncios travou'), 'Remover Silêncios', 'nome curto quando é ele');
eq(toolMentioned('meu piloto automático'), null, 'pedaço de palavra não conta ("piloto" não é Pilot)');
ok(followUpFor('ferramenta', 'Pilot').startsWith('Foi na ferramenta Pilot?'), 'pergunta de erro cita a ferramenta da página');
ok(!followUpFor('ferramenta', null).includes('null'), 'sem ferramenta: pergunta genérica');

console.log('help-chat: assunto do texto livre');
eq(detectTopic('paguei no pix e não liberou'), 'pagamento', 'pagamento');
eq(detectTopic('quero cancelar minha assinatura'), 'pagamento', 'cancelar');
eq(detectTopic('esqueci minha senha'), 'conta', 'senha');
eq(detectTopic('Não consigo entrar'), 'conta', 'entrar');
eq(detectTopic('a legenda travou em 80%'), 'ferramenta', 'travou');
eq(detectTopic('deu erro no lipsync'), 'ferramenta', 'erro');
eq(detectTopic('não consigo acessar o lipsync'), 'ferramenta', 'acessar ferramenta não é conta');
eq(detectTopic('como faço pra usar o downloader?'), 'duvida', 'como usar');
eq(detectTopic('oi'), null, 'nada reconhecível');

console.log('help-chat: e-mail e sugestões');
ok(looksLikeEmail('ana@exemplo.com'), 'e-mail válido');
ok(looksLikeEmail('  ana.s+1@ex.com.br '), 'e-mail com espaços nas pontas');
ok(!looksLikeEmail('ana@exemplo'), 'sem domínio');
ok(!looksLikeEmail('ana exemplo.com'), 'sem arroba');
eq(HELP_TOPICS.length, 4, '4 assuntos');
ok(HELP_TOPICS.every((t) => t.rapidas.length >= 2), 'todo assunto tem respostas rápidas');
ok(
  HELP_TOPICS.every((t) => !/[—–]/.test(t.label + t.rapidas.join(''))),
  'nenhum travessão em texto visível',
);
ok(
  !/[—–]/.test(buildSupportMessage({ name: 'A', email: 'a@b.co', topic: 'ferramenta', description: 'x', pathname: '/tools/lipsync' })),
  'nenhum travessão na mensagem',
);

console.log(`\n${passed} ok, ${failed} falhas`);
if (failed) process.exit(1);
