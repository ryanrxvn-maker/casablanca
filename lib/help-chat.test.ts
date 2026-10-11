/**
 * CHAT DE AJUDA — a mensagem que chega no WhatsApp do suporte tem que dizer
 * QUEM é, QUAL o assunto e O QUE houve, num texto que dá gosto de ler, sem
 * perder nada do que a pessoa escreveu (e sem ruído tipo "Página: ...").
 *
 * E as respostas que o próprio chat dá (10.10) não podem mentir: todo botão
 * citado "entre aspas" tem que existir com esse texto na tela, e todo link
 * tem que abrir uma página que existe.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AULAS_VIDEO } from './aulas-video';
import {
  AULA_STUCK,
  HELP_ARTICLES,
  HELP_TOPICS,
  HOME_ARTICLES,
  articleById,
  articleView,
  aulaDoChat,
  aulaLabel,
  aulaPedida,
  aulaStatus,
  aulaSubject,
  aulasDisponiveis,
  pedeAula,
  toolPathMentioned,
  buildSupportMessage,
  cleanText,
  detectTopic,
  findArticle,
  followUpFor,
  isGiveUp,
  isGreeting,
  isNo,
  isThanks,
  isYes,
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
ok(HELP_TOPICS.every((t) => t.artigos.length + t.rapidas.length >= 2), 'todo assunto tem pelo menos 2 sugestões');
ok(
  HELP_TOPICS.every((t) => !/[—–]/.test(t.label + t.rapidas.join(''))),
  'nenhum travessão em texto visível',
);
ok(
  !/[—–]/.test(buildSupportMessage({ name: 'A', email: 'a@b.co', topic: 'ferramenta', description: 'x', pathname: '/tools/lipsync' })),
  'nenhum travessão na mensagem',
);

console.log('help-chat: respostas do próprio chat');

const ids = HELP_ARTICLES.map((a) => a.id);
eq(new Set(ids).size, ids.length, 'nenhuma resposta repetida');
for (const t of HELP_TOPICS) {
  ok(t.artigos.every((id) => !!articleById(id)), `assunto "${t.label}": toda resposta da lista existe`);
  eq(new Set(t.artigos).size, t.artigos.length, `assunto "${t.label}": sem resposta repetida na lista`);
}
ok(HOME_ARTICLES.every((id) => !!articleById(id)), 'atalhos da tela inicial existem');
for (const id of ['senha-esqueci', 'cancelar', 'excluir-conta'] as const) {
  ok(HOME_ARTICLES.includes(id), `"${articleById(id)!.title}" está nos atalhos da tela inicial`);
}
for (const a of HELP_ARTICLES) {
  const listada = HOME_ARTICLES.includes(a.id) || HELP_TOPICS.some((t) => t.artigos.includes(a.id));
  ok(listada, `"${a.title}" aparece em alguma lista (senão só se acha digitando)`);
}

// Botões citados entre aspas: têm que existir com esse texto nas telas reais.
const UI_FILES = [
  'app/login/page.tsx',
  'app/forgot-password/page.tsx',
  'app/reset-password/page.tsx',
  'app/configuracoes/page.tsx',
  'app/configuracoes/assinatura/page.tsx',
  'app/configuracoes/api/page.tsx',
  'components/CardUpdate.tsx',
  'components/ToolGuideFab.tsx',
];
const ui = UI_FILES.map((f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')).join('\n');
for (const a of HELP_ARTICLES) {
  const texto = [a.intro ?? '', ...a.steps, a.note ?? ''].join('\n');
  const citados = [...texto.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const label of citados) {
    ok(ui.includes(label), `"${a.title}": o botão/rótulo "${label}" existe na tela`);
  }
  const tudo = [a.title, a.subject, texto, a.link?.label ?? '', ...a.stuck, a.request?.text ?? '', a.request?.button ?? ''].join(' ');
  ok(!/[—–]/.test(tudo), `"${a.title}": sem travessão`);
  ok(a.steps.length >= 1 && a.steps.length <= 4, `"${a.title}": de 1 a 4 passos (coisa simples)`);
  ok(a.steps.every((st) => st.length <= 180 && /[.?!)]$/.test(st)), `"${a.title}": passos curtos e pontuados`);
  ok(a.request ? a.stuck.length === 0 : a.stuck.length >= 1, `"${a.title}": sugestões de relato pro suporte`);

  // link: a página existe; a âncora (#senha) existe na página
  if (a.link) {
    const [semQuery] = a.link.href.split('?');
    const [rota, ancora] = semQuery.split('#');
    const arquivo = path.join(process.cwd(), 'app', rota, 'page.tsx');
    ok(fs.existsSync(arquivo), `"${a.title}": o link ${a.link.href} abre uma página que existe`);
    if (ancora && fs.existsSync(arquivo)) {
      ok(fs.readFileSync(arquivo, 'utf8').includes(`id="${ancora}"`), `"${a.title}": a seção #${ancora} existe na página`);
    }
  }
}

// Texto livre → resposta certa (do jeito que a pessoa escreve de verdade)
const casos: Array<[string, string | null]> = [
  ['esqueci minha senha', 'senha-esqueci'],
  ['Esqueci a senha!!', 'senha-esqueci'],
  ['não lembro minha senha', 'senha-esqueci'],
  ['como recupero minha senha?', 'senha-esqueci'],
  ['quero redefinir a senha', 'senha-esqueci'],
  ['esqueci a senha e o código não chega', 'senha-esqueci'],
  ['quero trocar minha senha', 'senha-trocar'],
  ['como mudo a senha', 'senha-trocar'],
  ['quero cancelar minha assinatura', 'cancelar'],
  ['Como cancelo?', 'cancelar'],
  ['cancelamento do plano', 'cancelar'],
  ['quero cancelar minha conta', 'cancelar'],
  ['quero excluir minha conta', 'excluir-conta'],
  ['como deleto a conta', 'excluir-conta'],
  ['apagar meu cadastro', 'excluir-conta'],
  ['quero que apaguem meus dados', 'excluir-conta'],
  ['encerrar minha conta', 'excluir-conta'],
  ['quero meu dinheiro de volta', 'reembolso'],
  ['como peço reembolso?', 'reembolso'],
  ['cancelar e pedir reembolso', 'reembolso'],
  ['o estorno não caiu', 'reembolso'],
  ['não recebi o código de confirmação', 'codigo'],
  ['Não recebi o e-mail de confirmação', 'codigo'],
  ['o código não chegou', 'codigo'],
  ['Não consigo entrar', 'entrar'],
  ['não consigo fazer login', 'entrar'],
  ['quero trocar meu e-mail', 'email-trocar'],
  ['como atualizo o cartão', 'cartao'],
  ['quero trocar o cartão', 'cartao'],
  ['como mudo de plano', 'plano'],
  ['como altero meu e-mail', 'email-trocar'],
  ['meu cartão venceu', 'cartao'],
  ['preciso do comprovante', 'comprovante'],
  ['quero mudar de plano', 'plano'],
  ['quero o plano anual', 'plano'],
  ['onde coloco a chave de ia', 'chave-ia'],
  ['a ferramenta pede uma chave', 'chave-ia'],
  ['como uso o downloader', 'como-usar'],
  ['por onde eu começo?', 'como-usar'],
  ['como deixo o modo escuro', 'tema'],
  // problemas: quem resolve é gente
  ['Paguei e não liberou', null],
  ['Travou no processamento', null],
  ['não consigo acessar o lipsync', null],
  ['como faço legenda em lote?', null],
  ['oi', null],
];
for (const [texto, esperado] of casos) {
  eq(findArticle(texto)?.id ?? null, esperado, `texto livre "${texto}"`);
}
for (const t of HELP_TOPICS) {
  for (const r of t.rapidas) eq(findArticle(r), null, `"${r}" (vai pro suporte) não é desviado pra uma resposta pronta`);
}
for (const a of HELP_ARTICLES) {
  for (const st of a.stuck) {
    // relato pro suporte não pode ser confundido com agradecimento/desistência
    ok(!isThanks(st) && !isGiveUp(st) && !isYes(st) && !isNo(st), `"${st}" é relato, não resposta curta`);
  }
}

console.log('help-chat: respostas curtas');
for (const x of ['valeu', 'Obrigado!', 'resolveu', 'deu certo, obrigada', 'perfeito', 'show, valeu', 'muito obrigado']) ok(isThanks(x), `"${x}" é agradecimento`);
for (const x of ['sim', 'não', 'tudo', 'não resolveu', 'travou tudo', 'ok mas não deu certo']) ok(!isThanks(x), `"${x}" não é agradecimento`);
for (const x of ['oi', 'Olá, tudo bem?', 'boa tarde', 'e aí']) ok(isGreeting(x), `"${x}" é cumprimento`);
for (const x of ['oi, esqueci minha senha', 'preciso de ajuda']) ok(!isGreeting(x), `"${x}" não é só cumprimento`);
for (const x of ['não', 'Não resolveu', 'ainda não', 'nao deu certo']) ok(isNo(x), `"${x}" é não`);
for (const x of ['não consigo cancelar', 'nada']) ok(!isNo(x), `"${x}" não é um "não" curto`);
for (const x of ['sim', 'Sim, pode', 'quero', 'pode mandar']) ok(isYes(x), `"${x}" é sim`);
for (const x of ['mudei de ideia', 'Deixa pra lá', 'desisti']) ok(isGiveUp(x), `"${x}" é desistência`);

console.log('help-chat: cartão de resposta');
const cancelar = articleById('cancelar')!;
eq(articleView(cancelar, { logged: true }).steps[0], cancelar.steps[0], 'logado: passos como estão');
eq(articleView(cancelar, { logged: false }).steps[0], 'Entre na sua conta.', 'deslogado: primeiro passo é entrar na conta');
eq(
  articleView(articleById('senha-esqueci')!, { logged: false }).steps.length,
  articleById('senha-esqueci')!.steps.length,
  'senha esquecida não pede login',
);
ok(
  /agora tem esse guia/.test(articleView(articleById('como-usar')!, { logged: true, hasGuide: true }).note ?? ''),
  'como usar: avisa quando a ferramenta aberta tem o guia',
);
ok(/7 dias/.test(cancelar.note ?? '') && /reembolso/.test(cancelar.note ?? ''), 'cancelar explica a regra dos 7 dias');

console.log('help-chat: mensagem depois de uma resposta');
eq(
  buildSupportMessage({
    name: 'Silas',
    email: 'cliente@exemplo.com',
    topic: 'pagamento',
    article: 'cancelar',
    description: 'não aparece o botão de cancelar',
    pathname: '/configuracoes/assinatura',
  }),
  'Olá, suporte do Auto Edit! Meu nome é Silas.\n\n' +
    'Conta: cliente@exemplo.com\n' +
    'Assunto: Cancelar a assinatura\n' +
    'O que aconteceu: Não aparece o botão de cancelar.\n\n' +
    'Podem me ajudar?',
  'leu "Cancelar a assinatura" e ainda precisou: o assunto vem da resposta',
);
eq(
  buildSupportMessage({
    name: 'Ana',
    email: 'ana@exemplo.com',
    topic: 'conta',
    article: 'excluir-conta',
    description: articleById('excluir-conta')!.request!.text,
  }),
  'Olá, suporte do Auto Edit! Meu nome é Ana.\n\n' +
    'Conta: ana@exemplo.com\n' +
    'Assunto: Excluir minha conta\n' +
    'Pedido: Quero excluir minha conta do Auto Edit e apagar os meus dados.\n\n' +
    'Podem me ajudar?',
  'pedido de exclusão: rótulo "Pedido" e texto completo',
);
eq(
  buildSupportMessage({ email: 'x@y.com', topic: 'conta', article: 'senha-esqueci', description: '' }),
  'Olá, suporte do Auto Edit!\n\nConta: x@y.com\nAssunto: Recuperar a senha\n\nPodem me ajudar?',
  '"Prefiro explicar no WhatsApp": só o assunto, sem rótulo pendurado',
);
ok(
  buildSupportMessage({ topic: 'ferramenta', article: 'chave-ia', description: 'salvei e ainda pede', pathname: '/tools/lipsync' }).includes(
    'Assunto: Chave de IA\n',
  ),
  'resposta lida vence a ferramenta da página no assunto',
);
for (const a of HELP_ARTICLES) {
  for (const st of a.stuck) {
    const m = buildSupportMessage({ name: 'Ana', email: 'a@b.co', topic: a.topic, article: a.id, description: st, pathname: '/tools/lipsync' });
    ok(!/undefined|null|Página/.test(m) && m.includes(`Assunto: ${a.subject}\n`), `"${a.title}" + "${st}" sai limpa`, m);
  }
}

console.log('help-chat: aulas em vídeo');
const rotas = Object.keys(AULAS_VIDEO);
const publicadas = rotas.filter((p) => !!AULAS_VIDEO[p].id);
const pendentes = rotas.filter((p) => !AULAS_VIDEO[p].id);
const todas = () => true;
const nenhuma = () => false;
const so = (...ps: string[]) => (p: string) => ps.includes(p);
ok(publicadas.length >= 1, 'tem aula publicada');
for (const p of rotas) {
  const aula = AULAS_VIDEO[p];
  const label = aulaLabel(p);
  ok(!!label && !/^como /i.test(label) && !/[—–]/.test(label), `aula ${p}: nome curto "${label}"`);
  ok(fs.existsSync(path.join(process.cwd(), 'public', aula.capa)), `aula ${p}: capa ${aula.capa} existe`);
  ok(fs.existsSync(path.join(process.cwd(), 'app', p, 'page.tsx')), `aula ${p}: a página ${p} existe (link "Abrir")`);
  ok(/^\d+:\d\d$/.test(aula.duracao), `aula ${p}: duração no formato do YouTube`);
}
eq(aulaLabel('/tools/tipografia'), 'Legendas Automáticas', 'nome da aula = nome da ferramenta no site');
eq(aulaLabel('/configuracoes/api'), 'Chaves de IA', 'aula das chaves');
for (const p of publicadas) {
  const a = aulaDoChat(p, todas)!;
  ok(!!a && a.url === `https://www.youtube.com/watch?v=${AULAS_VIDEO[p].id}`, `aula ${p}: link do YouTube com o id`);
  eq(aulaDoChat(p, nenhuma), null, `aula ${p}: sem acesso, não aparece`);
}
for (const p of pendentes) eq(aulaDoChat(p, todas), null, `aula ${p}: sem id (não publicada) não aparece`);
eq(aulasDisponiveis(todas).length, publicadas.length, 'lista = todas as publicadas');
eq(aulasDisponiveis(nenhuma).length, 0, 'sem acesso a nada: lista vazia');
const outra = publicadas[publicadas.length - 1];
eq(aulasDisponiveis(todas, outra)[0].path, outra, 'a aula da ferramenta aberta vem primeiro');
eq(new Set(aulasDisponiveis(todas, outra).map((a) => a.path)).size, publicadas.length, 'sem aula repetida ao reordenar');
const free = so('/tools/decupagem', '/tools/compressor', '/tools/fakepass', '/tools/downloader');
ok(aulasDisponiveis(free).every((a) => free(a.path)), 'plano grátis: só aula de ferramenta grátis');
eq(aulaStatus('/tools/tipografia', todas), AULAS_VIDEO['/tools/tipografia'].id ? 'ok' : 'sem-video', 'status ok');
eq(aulaStatus('/tools/tipografia', nenhuma), AULAS_VIDEO['/tools/tipografia'].id ? 'bloqueada' : 'sem-video', 'status bloqueada');
eq(aulaStatus('/tools/historico', todas), 'nao-existe', 'status sem aula cadastrada');
for (const p of pendentes) eq(aulaStatus(p, todas), 'sem-video', `status ${p} sem vídeo ainda`);

// texto livre que pede aula
for (const x of ['tem aula?', 'tem vídeo aula?', 'quero ver o tutorial', 'tem vídeo de como usa?', 'onde assisto a aula', 'link do youtube']) ok(pedeAula(x), `"${x}" pede aula`);
for (const x of ['meu vídeo travou', 'o vídeo não baixa', 'como cancelo', 'esqueci minha senha']) ok(!pedeAula(x), `"${x}" não é pedido de aula`);
eq(toolPathMentioned('aula do downloader'), '/tools/downloader', 'ferramenta citada vira rota');
eq(toolPathMentioned('vídeo das chaves de api'), '/configuracoes/api', 'chave/api = aula das Chaves de IA');
eq(toolPathMentioned('meu vídeo travou'), null, 'sem ferramenta citada');
const comAula = publicadas.find((p) => p.startsWith('/tools/'))!;
const nomeComAula = aulaLabel(comAula);
eq(JSON.stringify(aulaPedida(`tem aula do ${nomeComAula}?`)), JSON.stringify({ uma: comAula }), `"tem aula do ${nomeComAula}?" = a aula dela`);
eq(JSON.stringify(aulaPedida('tem aula?', comAula)), JSON.stringify({ uma: comAula }), '"tem aula?" dentro da ferramenta = a aula dela');
eq(aulaPedida('tem aula?', '/tools/historico'), 'lista', '"tem aula?" fora de ferramenta com aula = lista');
eq(aulaPedida('quero ver as aulas'), 'lista', '"quero ver as aulas" = lista');
eq(JSON.stringify(aulaPedida(`como uso o ${nomeComAula}?`)), JSON.stringify({ uma: comAula }), '"como uso o X" = aula do X, se ela existe');
eq(aulaPedida('como uso o pilot?'), null, '"como uso" de ferramenta sem aula segue pro texto');
eq(aulaPedida('quero cancelar minha assinatura'), null, 'pagamento não vira aula');
eq(aulaPedida('meu vídeo travou no processamento'), null, 'erro com "vídeo" não vira aula');
eq(JSON.stringify(aulaPedida('tem aula de chave de api?')), JSON.stringify({ uma: '/configuracoes/api' }), 'aula das chaves');

// resposta com aula: Chaves de IA leva a aula quando ela existe e a pessoa pode ver
const chave = articleById('chave-ia')!;
eq(chave.aula, '/configuracoes/api', 'Chaves de IA aponta pra aula das chaves');
eq(articleById('como-usar')!.aula, 'atual', 'Como usar aponta pra aula da ferramenta aberta');
const aulaChaves = aulaDoChat('/configuracoes/api', todas);
eq(articleView(chave, { logged: true, aula: aulaChaves }).aula?.path ?? null, aulaChaves?.path ?? null, 'cartão das chaves mostra a aula (quando publicada)');
ok(
  /aula está aqui embaixo/.test(articleView(articleById('como-usar')!, { logged: true, hasGuide: true, aula: aulaDoChat(comAula, todas) }).note ?? ''),
  'como usar dentro da ferramenta com aula: avisa que a aula está no cartão',
);

// mensagem pro suporte depois da aula
const aulaX = aulaDoChat(comAula, todas)!;
eq(aulaSubject(aulaX), `Dúvida sobre ${nomeComAula}`, 'assunto depois da aula');
eq(
  buildSupportMessage({ email: 'a@b.co', topic: 'duvida', subject: aulaSubject(aulaX), description: 'Assisti e ainda tenho dúvida', pathname: '/' }),
  `Olá, suporte do Auto Edit!\n\nConta: a@b.co\nAssunto: Dúvida sobre ${nomeComAula}\nMinha dúvida: Assisti e ainda tenho dúvida.\n\nPodem me ajudar?`,
  'mensagem depois da aula: assunto da aula + a dúvida',
);
ok(
  buildSupportMessage({ topic: 'ferramenta', subject: 'Dúvida sobre X', description: 'travou', pathname: comAula }).includes('Assunto: Dúvida sobre X\n'),
  'assunto pronto vence o "Erro na ferramenta" da página',
);
for (const st of AULA_STUCK) {
  ok(!isThanks(st) && !isGiveUp(st) && !isYes(st) && !isNo(st) && !pedeAula(st), `"${st}" é relato, não resposta curta nem pedido de aula`);
}

console.log('help-chat: guardas de layout');
const css = fs.readFileSync(path.join(process.cwd(), 'components/HelpChat.module.css'), 'utf8');
const tsx = fs.readFileSync(path.join(process.cwd(), 'components/HelpChat.tsx'), 'utf8');
// a conversa é flex em coluna: bloco com overflow:hidden sem flex:none encolhe até altura 0
for (const m of css.matchAll(/\n\.([a-zA-Z]+) \{([^}]*)\}/g)) {
  if (/overflow:\s*hidden/.test(m[2]) && ['faq'].includes(m[1])) {
    ok(/flex:\s*none/.test(m[2]), `.${m[1]} com overflow:hidden tem flex: none (senão some com a conversa cheia)`);
  }
}
const dicas = /const PLACEHOLDER[^{]*\{([^}]*)\}/.exec(tsx)?.[1] ?? '';
const textos = [...dicas.matchAll(/'([^']*)'/g)].map((m) => m[1]);
ok(textos.length === 5, 'as 5 dicas do campo foram lidas', textos);
for (const d of textos) ok(d.length <= 24, `dica "${d}" cabe numa linha no celular (≤ 24 letras)`);

console.log(`\n${passed} ok, ${failed} falhas`);
if (failed) process.exit(1);
