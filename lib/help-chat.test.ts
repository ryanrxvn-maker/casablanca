/**
 * CHAT DE AJUDA — a mensagem que chega no WhatsApp do suporte tem que dizer
 * QUEM é, O QUE houve e ONDE estava, sem perder nada do que a pessoa escreveu.
 */
import {
  HELP_TOPICS,
  buildSupportMessage,
  cleanText,
  detectTopic,
  followUpFor,
  looksLikeEmail,
  MAX_DESCRICAO,
  pageLabelFor,
  SUPPORT_WHATSAPP,
  toolFromPath,
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
    name: 'Ana Souza',
    email: 'ana@exemplo.com',
    topic: 'ferramenta',
    description: 'Travou no processamento',
    pathname: '/tools/tipografia',
    host: 'www.darkoautoedit.com',
  }),
  'Olá! Meu nome é Ana Souza e uso o Auto Edit (conta: ana@exemplo.com).\n\n' +
    'Estou com um erro na ferramenta Legendas Automáticas: travou no processamento.\n\n' +
    'Página: Legendas Automáticas (darkoautoedit.com/tools/tipografia)',
  'logado + erro numa ferramenta: nome, conta, ferramenta da página e relato',
);

eq(
  buildSupportMessage({ topic: 'conta', description: 'Não consigo entrar', pathname: '/login' }),
  'Olá! Vim pelo site do Auto Edit.\n\n' +
    'Estou com um problema na minha conta: não consigo entrar.\n\n' +
    'Página: Login (darkoautoedit.com/login)',
  'deslogado sem e-mail: abre sem nome e ainda diz a página',
);

eq(
  buildSupportMessage({ email: 'x@y.com', topic: 'pagamento', description: 'PIX não caiu!', pathname: '/planos?upgrade=1' }),
  'Olá! Uso o Auto Edit (conta: x@y.com).\n\n' +
    'Preciso de ajuda com plano ou pagamento: PIX não caiu!\n\n' +
    'Página: Planos (darkoautoedit.com/planos)',
  'só e-mail; sigla no começo fica maiúscula; pontuação final respeitada; query some da página',
);

ok(
  buildSupportMessage({ topic: 'ferramenta', description: 'O download não funcionou', pathname: '/' }).includes(
    'Estou com um erro em uma ferramenta: o download não funcionou.',
  ),
  'fora de ferramenta: frase genérica; artigo de 1 letra vira minúsculo',
);

ok(
  buildSupportMessage({ topic: null, description: 'HeyGen recusou meu avatar', pathname: '/' }).includes(
    'Preciso de ajuda: HeyGen recusou meu avatar.',
  ),
  'sem assunto: "Preciso de ajuda"; nome próprio com 2 maiúsculas preservado',
);

ok(
  buildSupportMessage({ topic: 'duvida', description: 'linha 1\n\n\n\nlinha 2   com   espaços', pathname: '/' }).includes(
    'linha 1\n\nlinha 2 com espaços.',
  ),
  'relato com várias linhas é preservado, sem espaço/linha em excesso',
);

ok(
  buildSupportMessage({ topic: 'duvida', description: '', pathname: '/' }).includes('Tenho uma dúvida de como usar o site.\n\n'),
  'relato vazio não deixa ":" pendurado',
);

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

console.log('help-chat: páginas e ferramentas');
eq(toolFromPath('/tools/clickup-pilot'), 'Pilot', 'Pilot pelo nome que o dono usa');
eq(toolFromPath('/tools/caixinha-pergunta'), 'FakePrint', 'apelido cai na ferramenta dona');
eq(toolFromPath('/tools/historico'), null, 'histórico não é ferramenta');
eq(toolFromPath('/tools'), null, 'hub não é ferramenta');
eq(toolFromPath('/configuracoes'), null, 'fora de /tools não é ferramenta');
eq(pageLabelFor('/'), 'Página inicial', 'landing');
eq(pageLabelFor('/tools/'), 'Início das ferramentas', 'barra final ignorada');
eq(pageLabelFor('/configuracoes/api'), 'Configurações', 'subpágina de configurações');
eq(pageLabelFor('/algo-novo'), '/algo-novo', 'página sem nome: mostra o caminho');
ok(followUpFor('ferramenta', 'Pilot').startsWith('Foi na ferramenta Pilot?'), 'pergunta de erro cita a ferramenta da página');
ok(!followUpFor('ferramenta', null).includes('null'), 'sem ferramenta: pergunta genérica');

console.log('help-chat: assunto do texto livre');
eq(detectTopic('paguei no pix e não liberou'), 'pagamento', 'pagamento');
eq(detectTopic('quero cancelar minha assinatura'), 'pagamento', 'cancelar');
eq(detectTopic('esqueci minha senha'), 'conta', 'senha');
eq(detectTopic('Não consigo entrar'), 'conta', 'entrar');
eq(detectTopic('a legenda travou em 80%'), 'ferramenta', 'travou');
eq(detectTopic('deu erro no lipsync'), 'ferramenta', 'erro');
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
  HELP_TOPICS.every((t) => !/[—–]/.test(t.label + t.frase + t.rapidas.join(''))),
  'nenhum travessão em texto visível',
);

console.log(`\n${passed} ok, ${failed} falhas`);
if (failed) process.exit(1);
