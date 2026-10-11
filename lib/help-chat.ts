/**
 * CHAT DE AJUDA (07.10, respostas próprias em 10.10) — lógica pura do mini
 * chat do canto da tela.
 *
 * O chat resolve sozinho o que é simples (cancelar a assinatura, excluir a
 * conta, recuperar a senha...) com o passo a passo da tela REAL, e depois de
 * cada resposta pergunta se a pessoa ainda precisa do suporte. Se precisar, ele
 * organiza o pedido (quem é + assunto + o que aconteceu) numa mensagem pronta e
 * entrega o link do WhatsApp com ela já escrita. Tudo aqui é sem DOM pra poder
 * ser testado em node (lib/help-chat.test.ts), inclusive a garantia de que todo
 * botão citado entre aspas existe de verdade na tela.
 *
 * 11.10: as AULAS EM VÍDEO (lib/aulas-video.ts, YouTube não listado) entram no
 * chat: botão "Assistir no YouTube" na dúvida de uma ferramenta, na resposta
 * das Chaves de IA e numa lista de aulas. Mesma trava do "Como usar": aula de
 * ferramenta paga só pra quem tem acesso a ela, e aula sem id (ainda não
 * publicada) não aparece.
 */
import { AULAS_VIDEO, aulaDaRota } from './aulas-video';
import { HISTORY_TOOLS, historyToolLabel } from './history-tools';

/** Número do suporte (o mesmo do antigo botão verde do WhatsApp). */
export const SUPPORT_WHATSAPP = '5534991262437';

/** Teto do que a pessoa escreve. A mensagem inteira vai na URL do wa.me. */
export const MAX_DESCRICAO = 1200;

export type HelpTopicId = 'conta' | 'ferramenta' | 'duvida' | 'pagamento';

export type HelpArticleId =
  | 'senha-esqueci'
  | 'entrar'
  | 'codigo'
  | 'email-trocar'
  | 'senha-trocar'
  | 'excluir-conta'
  | 'cancelar'
  | 'reembolso'
  | 'cartao'
  | 'plano'
  | 'comprovante'
  | 'chave-ia'
  | 'como-usar'
  | 'tema';

export type HelpTopic = {
  id: HelpTopicId;
  /** texto do botão de sugestão */
  label: string;
  /** perguntas que o próprio chat responde (viram a lista do assunto) */
  artigos: HelpArticleId[];
  /** problemas que só gente resolve: tocar leva direto pro pedido de suporte */
  rapidas: string[];
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'conta',
    label: 'Problemas com a conta',
    artigos: ['senha-esqueci', 'entrar', 'codigo', 'email-trocar', 'senha-trocar', 'excluir-conta'],
    rapidas: [],
  },
  {
    id: 'ferramenta',
    label: 'Erro em alguma ferramenta',
    artigos: ['chave-ia'],
    rapidas: ['Travou no processamento', 'Deu erro ao enviar o arquivo', 'O download não funcionou'],
  },
  {
    id: 'duvida',
    label: 'Dúvidas de como usar',
    artigos: ['como-usar', 'chave-ia', 'tema'],
    rapidas: ['Qual ferramenta serve pro meu caso?'],
  },
  {
    id: 'pagamento',
    label: 'Planos e pagamento',
    artigos: ['cancelar', 'reembolso', 'cartao', 'comprovante', 'plano'],
    rapidas: ['Paguei e não liberou'],
  },
];

/** Atalhos da tela inicial do chat: o que mais se pergunta. */
export const HOME_ARTICLES: HelpArticleId[] = ['senha-esqueci', 'cancelar', 'excluir-conta'];

export function topicById(id: HelpTopicId | null | undefined): HelpTopic | null {
  return HELP_TOPICS.find((t) => t.id === id) ?? null;
}

/** Ferramenta da página atual (`/tools/<slug>`), com o nome que a pessoa vê. */
export function toolFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/tools\/([^/?#]+)/.exec(pathname || '');
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  const label = historyToolLabel(slug);
  // slug sem nome cadastrado (ex.: /tools/historico) não vira "ferramenta"
  return label && label !== slug ? label : null;
}

/** Pergunta que o chat faz depois que a pessoa escolhe o assunto. */
export function followUpFor(topic: HelpTopicId, tool: string | null): string {
  switch (topic) {
    case 'conta':
      return 'Sobre a sua conta, essas são as dúvidas mais comuns. Toque numa delas ou me conta com suas palavras.';
    case 'ferramenta':
      return tool
        ? `Foi na ferramenta ${tool}? Me conta o que aconteceu e, se apareceu alguma mensagem de erro, cola ela aqui.`
        : 'Qual ferramenta deu erro e o que apareceu na tela? Se tiver uma mensagem de erro, cola ela aqui.';
    case 'duvida':
      return 'Claro! Veja se a sua dúvida está aqui. Se for outra, escreve embaixo a ferramenta e o que você quer fazer.';
    case 'pagamento':
      return 'Sobre planos e pagamento, essas são as dúvidas mais comuns. Toque numa delas ou me conta com suas palavras.';
  }
}

// ─── respostas que o próprio chat dá ────────────────────────────────────────
// Cada passo descreve a tela REAL. Botão citado entre "aspas" tem que existir
// com esse texto no site: o teste (help-chat.test.ts) confere arquivo por
// arquivo, então renomear um botão sem atualizar aqui quebra o `npm test`.

export type HelpLink = { label: string; href: string };

export type HelpArticle = {
  id: HelpArticleId;
  /** assunto da mensagem do WhatsApp, se a pessoa ainda precisar do suporte */
  topic: HelpTopicId;
  /** a pergunta como a pessoa faria (linha da lista e balão dela) */
  title: string;
  /** linha "Assunto:" da mensagem pro suporte */
  subject: string;
  intro?: string;
  steps: string[];
  note?: string;
  link?: HelpLink;
  /** os passos acontecem dentro da conta: deslogado ganha o passo "Entre na sua conta." */
  needsLogin?: boolean;
  /**
   * Pedido que só a equipe conclui (excluir a conta). Em vez de "Isso
   * resolveu?", o chat oferece mandar o pedido pronto no WhatsApp.
   */
  request?: { text: string; button: string };
  /**
   * Aula em vídeo que acompanha a resposta (rota em lib/aulas-video.ts).
   * 'atual' = a aula da ferramenta aberta na tela, se houver.
   */
  aula?: string | 'atual';
  /** sugestões de "o que aconteceu" quando a pessoa ainda precisa do suporte */
  stuck: string[];
};

const MINHA_ASSINATURA: HelpLink = { label: 'Abrir Minha assinatura', href: '/configuracoes/assinatura' };

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'senha-esqueci',
    topic: 'conta',
    title: 'Esqueci minha senha',
    subject: 'Recuperar a senha',
    intro: 'Você cria uma senha nova em 1 minuto:',
    steps: [
      'Abra a tela "Esqueci a senha" (pelo botão abaixo ou pelo link na tela de login).',
      'Digite o e-mail do cadastro e toque em "Enviar código".',
      'Chega um código de 6 dígitos no seu e-mail. Se não aparecer em 1 minuto, olhe o spam.',
      'Digite o código, crie a senha nova e toque em "Redefinir senha e entrar".',
    ],
    note: 'O código não chegou? Na mesma tela, toque em "Não chegou? Reenviar código".',
    link: { label: 'Criar senha nova', href: '/forgot-password' },
    stuck: ['O código não chega', 'O código não funciona', 'Não lembro o e-mail do cadastro'],
  },
  {
    id: 'entrar',
    topic: 'conta',
    title: 'Não consigo entrar',
    subject: 'Não consigo entrar na conta',
    intro: 'Na tela de login, o aviso que aparece diz o motivo. Os mais comuns:',
    steps: [
      'Apareceu "Email ou senha incorretos"? Confira o e-mail do cadastro ou toque em "Redefinir senha por email" pra criar uma senha nova.',
      'Apareceu "Email não confirmado"? Toque em "Enviar código de novo" e digite o código que chegar no e-mail.',
      'Esqueceu a senha? Use "Esqueci a senha", logo acima do campo da senha.',
    ],
    link: { label: 'Criar senha nova', href: '/forgot-password' },
    stuck: ['Aparece outra mensagem de erro', 'Minha conta está bloqueada', 'Já tentei tudo isso'],
  },
  {
    id: 'codigo',
    topic: 'conta',
    title: 'Não recebi o código no e-mail',
    subject: 'Código não chegou no e-mail',
    steps: [
      'Espere até 1 minuto e olhe também o spam e a aba Promoções.',
      'Confira se o e-mail digitado está certinho, letra por letra.',
      'Peça outro código: no login aparece "Enviar código de novo" e, na tela de senha nova, "Não chegou? Reenviar código".',
    ],
    stuck: ['Já pedi de novo e não chegou', 'O código diz que expirou', 'Digitei o e-mail errado no cadastro'],
  },
  {
    id: 'email-trocar',
    topic: 'conta',
    title: 'Trocar meu e-mail',
    subject: 'Trocar o e-mail da conta',
    steps: [
      'Abra Configurações, na parte "Email".',
      'Digite o e-mail novo e toque em "Trocar".',
      'Confirme pelo link que chega no e-mail novo. A troca só vale depois disso.',
    ],
    link: { label: 'Abrir Configurações', href: '/configuracoes#email' },
    needsLogin: true,
    stuck: ['O link de confirmação não chegou', 'Não tenho mais acesso ao e-mail antigo'],
  },
  {
    id: 'senha-trocar',
    topic: 'conta',
    title: 'Trocar minha senha',
    subject: 'Trocar a senha',
    steps: [
      'Abra Configurações, na parte "Senha".',
      'Digite a senha atual e a nova duas vezes (mínimo de 6 caracteres).',
      'Toque em "Alterar".',
    ],
    note: 'Não lembra a senha atual? Crie uma nova pela tela "Esqueci a senha".',
    link: { label: 'Abrir Configurações', href: '/configuracoes#senha' },
    needsLogin: true,
    stuck: ['Diz que a senha atual está incorreta', 'Deu erro ao alterar'],
  },
  {
    id: 'excluir-conta',
    topic: 'conta',
    title: 'Excluir minha conta',
    subject: 'Excluir minha conta',
    intro: 'Por segurança, quem apaga a conta é a nossa equipe, depois de confirmar que é você mesmo.',
    steps: [
      'Tem assinatura? Cancele antes em Minha assinatura, pra não vir nenhuma cobrança nova.',
      'Mande o pedido de exclusão pro suporte no WhatsApp. Eu deixo a mensagem pronta.',
      'A equipe confirma com você e apaga a conta e os seus dados.',
    ],
    note: 'Depois de excluída, a conta não pode ser recuperada.',
    link: MINHA_ASSINATURA,
    request: { text: 'Quero excluir minha conta do Auto Edit e apagar os meus dados.', button: 'Enviar pedido de exclusão' },
    stuck: [],
  },
  {
    id: 'cancelar',
    topic: 'pagamento',
    title: 'Cancelar a assinatura',
    subject: 'Cancelar a assinatura',
    steps: [
      'Abra Minha assinatura (pelo botão abaixo ou em Configurações, no botão "Gerenciar").',
      'Toque em "Cancelar assinatura".',
      'Confirme em "Sim, cancelar". Pronto: nenhuma cobrança nova é feita.',
    ],
    note:
      'Pagou há menos de 7 dias? O valor volta inteiro no cartão e o Premium termina na hora (a tela mostra o valor antes de você confirmar). Depois de 7 dias não tem reembolso, mas você continua usando até o fim do período pago.',
    link: MINHA_ASSINATURA,
    needsLogin: true,
    stuck: ['Não aparece o botão de cancelar', 'Deu erro ao cancelar', 'Fui cobrado depois de cancelar'],
  },
  {
    id: 'reembolso',
    topic: 'pagamento',
    title: 'Reembolso em até 7 dias',
    subject: 'Reembolso',
    intro: 'Se a cobrança foi há menos de 7 dias, o reembolso é automático:',
    steps: [
      'Abra Minha assinatura e toque em "Cancelar assinatura".',
      'A tela mostra o valor que volta. Confirme em "Sim, cancelar e receber reembolso".',
      'O estorno aparece na fatura do cartão em até 10 dias úteis, conforme o seu banco.',
    ],
    note: 'Passou dos 7 dias? Não tem reembolso, mas o acesso continua até o fim do período pago e nada mais é cobrado.',
    link: MINHA_ASSINATURA,
    needsLogin: true,
    stuck: ['A tela não mostrou o reembolso', 'O estorno ainda não caiu', 'Fui cobrado duas vezes'],
  },
  {
    id: 'cartao',
    topic: 'pagamento',
    title: 'Trocar o cartão',
    subject: 'Trocar o cartão',
    steps: [
      'Abra Minha assinatura.',
      'Toque em "Atualizar cartão", preencha o cartão novo e toque em "Salvar cartão".',
      'As próximas cobranças já vão pro cartão novo.',
    ],
    note: 'Se a renovação falhou, salvar o cartão novo já tenta a cobrança nele e o acesso volta assim que ela passar.',
    link: MINHA_ASSINATURA,
    needsLogin: true,
    stuck: ['O cartão foi recusado', 'Deu erro ao salvar o cartão'],
  },
  {
    id: 'comprovante',
    topic: 'pagamento',
    title: 'Baixar o comprovante',
    subject: 'Comprovante de pagamento',
    steps: [
      'Abra Minha assinatura.',
      'Desça até "Histórico de faturas".',
      'Toque em "comprovante" na cobrança que você quer.',
    ],
    link: MINHA_ASSINATURA,
    needsLogin: true,
    stuck: ['O comprovante não aparece', 'Preciso de nota fiscal'],
  },
  {
    id: 'plano',
    topic: 'pagamento',
    title: 'Assinar ou mudar de plano',
    subject: 'Mudar de plano',
    steps: [
      'Ainda está no plano grátis? Abra a página de planos (botão abaixo), escolha o Premium e pague com cartão.',
      'O acesso libera assim que o pagamento é aprovado.',
      'Já é assinante e quer trocar (mensal ou anual)? Fale com o suporte antes, pra não ficar com duas assinaturas.',
    ],
    link: { label: 'Ver planos', href: '/planos?upgrade=1' },
    stuck: ['Quero trocar do mensal pro anual', 'Quero trocar do anual pro mensal', 'Paguei e não liberou'],
  },
  {
    id: 'chave-ia',
    topic: 'duvida',
    title: 'Onde coloco a chave de IA',
    subject: 'Chave de IA',
    intro: 'Algumas ferramentas usam a sua própria chave de IA, e o crédito sai da sua conta no serviço.',
    steps: [
      'Abra Configurações, em Chaves de IA (botão abaixo).',
      'No card do serviço, siga o passo a passo pra criar a chave e cole no campo.',
      'Toque em "Salvar". O selo do card vira CONFIGURADA.',
    ],
    link: { label: 'Abrir Chaves de IA', href: '/configuracoes/api' },
    needsLogin: true,
    aula: '/configuracoes/api',
    stuck: ['Salvei e a ferramenta ainda pede a chave', 'Não sei qual chave criar'],
  },
  {
    id: 'como-usar',
    topic: 'duvida',
    title: 'Como usar uma ferramenta',
    subject: 'Como usar uma ferramenta',
    steps: [
      'Abra a ferramenta que você quer usar.',
      'No canto de cima, à direita, toque em "Como usar" (o ícone de livro).',
      'Abre o passo a passo da ferramenta e, quando ela tem, a aula em vídeo.',
    ],
    aula: 'atual',
    stuck: ['A ferramenta não tem o botão "Como usar"', 'Segui o passo a passo e não deu certo'],
  },
  {
    id: 'tema',
    topic: 'duvida',
    title: 'Mudar pro tema claro ou escuro',
    subject: 'Tema claro ou escuro',
    steps: [
      'Nas ferramentas, toque no botão de sol e lua, na barra de cima.',
      'Ou abra Configurações, na parte "Aparência", em "Tema do app".',
    ],
    link: { label: 'Abrir Configurações', href: '/configuracoes#aparencia' },
    needsLogin: true,
    stuck: ['O tema não muda'],
  },
];

export function articleById(id: HelpArticleId | null | undefined): HelpArticle | null {
  return HELP_ARTICLES.find((a) => a.id === id) ?? null;
}

export type ArticleView = { intro?: string; steps: string[]; note?: string; link?: HelpLink; aula?: AulaDoChat | null };

/**
 * O que o cartão de resposta mostra pra ESTA pessoa: deslogado ganha o passo
 * "Entre na sua conta." quando a resposta acontece dentro dela; quem já está
 * numa ferramenta com guia fica sabendo que o botão está na própria tela; e a
 * aula em vídeo da resposta só entra se ela puder ver (`aula`, já filtrada).
 */
export function articleView(
  a: HelpArticle,
  ctx: { logged: boolean; hasGuide?: boolean; aula?: AulaDoChat | null },
): ArticleView {
  const steps = a.needsLogin && !ctx.logged ? ['Entre na sua conta.', ...a.steps] : [...a.steps];
  let note = a.note;
  if (a.id === 'como-usar' && ctx.hasGuide) {
    note = ctx.aula
      ? 'A ferramenta que você está usando agora tem guia e aula em vídeo: a aula está aqui embaixo.'
      : 'A ferramenta que você está usando agora tem esse guia: o botão fica aí no canto de cima, à direita.';
  }
  return { intro: a.intro, steps, note, link: a.link, aula: ctx.aula ?? null };
}

// ─── aulas em vídeo (YouTube) ───────────────────────────────────────────────

export type AulaDoChat = {
  /** rota da ferramenta (chave de AULAS_VIDEO) */
  path: string;
  /** nome curto, do jeito que a pessoa vê no site: "Legendas Automáticas" */
  label: string;
  /** título da aula no YouTube: "Como usar as Legendas Automáticas" */
  titulo: string;
  duracao: string;
  capa: string;
  /** link do vídeo no YouTube (não listado: só abre com o link) */
  url: string;
};

/** Nome curto da aula: o mesmo nome da ferramenta no site. */
export function aulaLabel(path: string): string {
  const m = /^\/tools\/([^/?#]+)/.exec(path);
  if (m) {
    const label = historyToolLabel(decodeURIComponent(m[1]));
    if (label && label !== m[1]) return label;
  }
  if (path === '/configuracoes/api') return 'Chaves de IA';
  const titulo = AULAS_VIDEO[path]?.titulo ?? path;
  return titulo.replace(/^como (instalar e )?(usar|configurar) (o|a|as|os) /i, '');
}

export function aulaYoutubeUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

/**
 * Aula da rota pra ESTA pessoa. `pode(path)` é a trava de acesso (a mesma do
 * AulaVideo: aula de ferramenta paga só com o plano que libera a ferramenta);
 * aula sem id ainda não foi publicada e não aparece.
 */
export function aulaDoChat(path: string | null | undefined, pode: (path: string) => boolean): AulaDoChat | null {
  const a = aulaDaRota(path);
  if (!a || !path || !pode(path)) return null;
  return { path, label: aulaLabel(path), titulo: a.titulo, duracao: a.duracao, capa: a.capa, url: aulaYoutubeUrl(a.id) };
}

/** Todas as aulas que ESTA pessoa pode ver; a da ferramenta aberta vem primeiro. */
export function aulasDisponiveis(pode: (path: string) => boolean, atual?: string | null): AulaDoChat[] {
  const todas = Object.keys(AULAS_VIDEO)
    .map((p) => aulaDoChat(p, pode))
    .filter((a): a is AulaDoChat => !!a);
  const i = todas.findIndex((a) => a.path === atual);
  if (i > 0) todas.unshift(...todas.splice(i, 1));
  return todas;
}

/** Rota da ferramenta citada num texto ("como uso o lipsync" → /tools/lipsync). */
export function toolPathMentioned(texto: string): string | null {
  const label = toolMentioned(texto);
  if (label) {
    const t = HISTORY_TOOLS.find((x) => x.label === label);
    if (t) return `/tools/${t.id}`;
  }
  if (/\bchaves?\b|\bapi\b/.test(sem(texto))) return '/configuracoes/api';
  return null;
}

/** A pessoa pediu vídeo/aula/tutorial ("tem aula?", "vídeo de como usa"). Só "vídeo" não basta: "meu vídeo travou" é erro. */
export function pedeAula(texto: string): boolean {
  const t = sem(texto);
  return /\b(aula|aulas|videoaula|videoaulas|tutorial|tutoriais|youtube)\b|\bvideos? (aula|de como|ensinando|explicando|tutorial|mostrando)\b|\bassistir\b/.test(
    t,
  );
}

/**
 * O que um texto livre pede em matéria de aula:
 * - `{ uma: rota }`: aula de UMA ferramenta (citada no texto, ou a da tela
 *   quando a pessoa só pediu "aula") — quem chama confere se ela pode ver;
 * - `'lista'`: pediu aula sem dizer de quê, fora de uma ferramenta com aula;
 * - `null`: não é sobre aula (segue o fluxo normal).
 * "como usar o downloader" também cai aqui quando o Downloader tem aula.
 */
export function aulaPedida(texto: string, atual?: string | null): { uma: string } | 'lista' | null {
  const citada = toolPathMentioned(texto);
  if (pedeAula(texto)) {
    if (citada && AULAS_VIDEO[citada]) return { uma: citada };
    if (!citada && atual && aulaDaRota(atual)) return { uma: atual };
    return 'lista';
  }
  if (citada && citada.startsWith('/tools/') && aulaDaRota(citada) && findArticle(texto)?.id === 'como-usar') {
    return { uma: citada };
  }
  return null;
}

/** Por que a aula de uma rota aparece (ok) ou não pra esta pessoa. */
export function aulaStatus(path: string, pode: (path: string) => boolean): 'ok' | 'sem-video' | 'bloqueada' | 'nao-existe' {
  if (!AULAS_VIDEO[path]) return 'nao-existe';
  if (!aulaDaRota(path)) return 'sem-video';
  return pode(path) ? 'ok' : 'bloqueada';
}

/** Assunto da mensagem pro suporte depois de uma aula. */
export function aulaSubject(a: Pick<AulaDoChat, 'label'>): string {
  return `Dúvida sobre ${a.label}`;
}

/** Sugestões de relato quando a pessoa viu a aula e ainda precisa do suporte. */
export const AULA_STUCK = ['Assisti e ainda tenho dúvida', 'A ferramenta deu erro', 'O vídeo não abre'];

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Assunto de um texto livre (quando a pessoa escreve direto, sem tocar numa
 * sugestão). Ordem importa: pagamento e conta são mais específicos que "erro".
 */
export function detectTopic(texto: string): HelpTopicId | null {
  const t = sem(texto);
  if (/\b(pag(o|ou|uei|ar|amento)|plano|assinatura|cobr|cartao|pix|boleto|reembols|cancel|fatura|premium|upgrade)/.test(t)) return 'pagamento';
  // "acesso" sozinho fica de fora: "não consigo acessar o lipsync" é ferramenta
  if (/\b(senha|login|logar|entrar|conta\b|cadastr|e-?mail|confirma)/.test(t)) return 'conta';
  if (/\b(erro|bug|trav|falh|nao (funciona|carrega|baixa|abre|gera|processa|consigo)|acess|parou|quebr|deu ruim|crash)/.test(t)) return 'ferramenta';
  if (/\b(como|duvida|usar|uso|tutorial|onde|qual|serve)/.test(t)) return 'duvida';
  return null;
}

/** Senha: quem fala de código, esquecimento ou recuperação quer a senha NOVA; trocar só sabendo a atual. */
function senhaArticle(t: string): HelpArticleId | null {
  if (!/\bsenha/.test(t)) return null;
  if (/codigo|esquec|perdi|nao (lembro|sei)|recuper|redefin|reset/.test(t)) return 'senha-esqueci';
  if (/\b(trocar|troco|mudar|mudo|alterar|altero|atualizar|nova senha)\b/.test(t)) return 'senha-trocar';
  return 'senha-esqueci';
}

/**
 * Resposta pronta pra um texto livre. Ordem importa: o mais específico
 * primeiro ("cancelar e pedir reembolso" é reembolso; "esqueci a senha e o
 * código não chega" é senha). Sem resposta = null, e o chat leva pro suporte.
 */
const ARTICLE_RULES: Array<(t: string) => HelpArticleId | null> = [
  (t) =>
    /\b(exclu|delet|apag|remov|encerr)\w*(\s+\S+){0,3}?\s+(conta|cadastro|perfil|dados)\b/.test(t) ||
    /\b(conta|cadastro)\b(\s+\S+){0,3}?\s+(exclu|delet|apag)\w*/.test(t)
      ? 'excluir-conta'
      : null,
  (t) => (/reembols|estorn|dinheiro de volta|devolv\w*(\s+\S+){0,2}?\s+dinheiro|devolucao|\bgarantia\b/.test(t) ? 'reembolso' : null),
  (t) => (/\bcancel/.test(t) ? 'cancelar' : null),
  senhaArticle,
  (t) =>
    /nao (recebi|chegou|chega|veio|recebo)\b.{0,30}(codigo|e-?mail)|\bcodigo\b.{0,25}(nao (chega|chegou|veio)|confirmacao|verificacao)|confirmar (o |meu )?e-?mail|e-?mail (de confirmacao|nao confirmado)/.test(
      t,
    )
      ? 'codigo'
      : null,
  (t) =>
    /nao (consigo|consegui|to conseguindo|estou conseguindo) (entrar|logar|acessar (a |minha )?conta|fazer (o )?login)|\blogin\b.{0,20}\b(nao|erro)\b|\bnao (entra|loga)\b|erro (no|ao fazer|de) login|e-?mail ou senha incorret/.test(
      t,
    )
      ? 'entrar'
      : null,
  (t) => (/\b(trocar|troco|mudar|mudo|alterar|altero|atualizar|atualizo)\s+(o\s+|meu\s+|de\s+)?e-?mail\b/.test(t) ? 'email-trocar' : null),
  (t) =>
    /\b(trocar|troco|mudar|mudo|alterar|altero|atualizar|atualizo|cadastrar|cadastro|outro|novo)\s+(o\s+|meu\s+|de\s+)?cartao|cartao\s+(novo|vencido|venceu|expirou)/.test(
      t,
    )
      ? 'cartao'
      : null,
  (t) => (/comprovante|recibo|(baixar|ver|segunda via)\s+(a\s+|da\s+)?fatura/.test(t) ? 'comprovante' : null),
  (t) =>
    /\b(trocar|troco|mudar|mudo|alterar|altero|subir|migrar|migro)\s+(o\s+|meu\s+|de\s+|pro\s+|para o\s+)?plano|plano anual|\bupgrade\b|assinar o premium|virar premium|ver (os )?planos/.test(t)
      ? 'plano'
      : null,
  (t) => (/chave (de |da )?(ia|api)|\bapi key\b|\b(groq|assemblyai|elevenlabs|openai)\b|pede (uma )?chave|chave nao configurada/.test(t) ? 'chave-ia' : null),
  (t) => (/\btema\b|modo (claro|escuro|noturno)|dark mode|fundo (branco|preto|claro|escuro)/.test(t) ? 'tema' : null),
  (t) =>
    /como (eu )?(uso|usar|utilizo|utilizar|funciona|comeco|comecar)\b|como (eu )?faco (pra|para) usar|por onde (eu )?comec|tutorial|passo a passo|\bguia\b|nao sei (usar|mexer)/.test(t)
      ? 'como-usar'
      : null,
];

export function findArticle(texto: string): HelpArticle | null {
  const t = ` ${sem(texto).replace(/\s+/g, ' ')} `;
  for (const rule of ARTICLE_RULES) {
    const id = rule(t);
    if (id) return articleById(id);
  }
  return null;
}

// ─── respostas curtas (sim, não, valeu, oi) ─────────────────────────────────
// Sem isso, um "obrigado" depois da resposta virava mensagem pro suporte.

const palavras = (s: string) => sem(s).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);

function soCom(texto: string, vocab: Set<string>, max: number): boolean {
  const w = palavras(texto);
  return w.length > 0 && w.length <= max && w.every((x) => vocab.has(x));
}

const THANKS = new Set(
  'ok okay obrigado obrigada obg brigado brigada valeu vlw resolveu resolvido resolvida deu certo consegui funcionou perfeito show top beleza blz entendi tranquilo massa otimo muito mto era isso ja agora sim ajudou certinho tudo'.split(
    ' ',
  ),
);
const GREETINGS = new Set('oi oie oii ola opa eai e ai bom boa dia tarde noite tudo bem hey hello salve pessoal suporte alguem'.split(' '));

/** "valeu", "deu certo, obrigado!", "resolveu" */
export function isThanks(texto: string): boolean {
  const w = palavras(texto);
  // "sim" sozinho é resposta pra "Quer que eu...?", não agradecimento
  if (w.length === 1 && w[0] === 'sim') return false;
  return soCom(texto, THANKS, 6) && !w.every((x) => x === 'tudo' || x === 'muito' || x === 'mto');
}

/** "oi", "olá, tudo bem?", "boa tarde" */
export function isGreeting(texto: string): boolean {
  return soCom(texto, GREETINGS, 5);
}

/** "não", "ainda não", "não resolveu" */
export function isNo(texto: string): boolean {
  return /^(n|nao|nope|ainda nao|nao resolveu|nao deu( certo)?|nao funcionou|nao consegui)$/.test(palavras(texto).join(' '));
}

/** "mudei de ideia", "deixa pra lá" */
export function isGiveUp(texto: string): boolean {
  return /^(mudei de ideia|desisti|deixa (pra|para) la|esquece|nao quero mais|nao precisa)\b/.test(palavras(texto).join(' '));
}

/** "sim", "pode", "quero" */
export function isYes(texto: string): boolean {
  return /^(s|sim|pode|pode sim|quero|quero sim|claro|isso|bora|manda|pode mandar|sim pode|sim quero|ok)$/.test(palavras(texto).join(' '));
}

/** Quantas palavras: pedido de 1 a 3 palavras sem assunto ("ajuda", "preciso de ajuda") pede um pouco mais. */
export function wordCount(texto: string): number {
  return palavras(texto).length;
}

// ─── abrir o chat de outra tela ─────────────────────────────────────────────

/** Evento que abre o chat (opcionalmente já numa resposta). Ouvido pelo HelpChat. */
export const HELP_CHAT_EVENT = 'autoedit:help-chat';

/** Abre o chat de ajuda. Ex.: o botão "Solicitar exclusão da conta" das Configurações. */
export function openHelpChat(article?: HelpArticleId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HELP_CHAT_EVENT, { detail: { article: article ?? null } }));
}

/** E-mail plausível (o suporte só precisa achar a conta, não validar RFC). */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

/** Limpa o que a pessoa escreveu: espaços, linhas vazias em excesso, teto. */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_DESCRICAO);
}

/** Relato depois de um rótulo: "travou no processamento" → "Travou no processamento." */
function comoRelato(desc: string): string {
  let d = desc.trim();
  if (/^\p{Ll}/u.test(d)) d = d[0].toUpperCase() + d.slice(1);
  if (!/[.!?…)"]$/.test(d)) d += '.';
  return d;
}

/** Ferramenta citada no relato, pelo nome que a pessoa vê (o nome mais longo vence). */
export function toolMentioned(texto: string): string | null {
  const t = ` ${sem(texto).replace(/[^a-z0-9]+/g, ' ')} `;
  const labels = HISTORY_TOOLS.map((x) => x.label).sort((a, b) => b.length - a.length);
  for (const label of labels) {
    if (t.includes(` ${sem(label).replace(/[^a-z0-9]+/g, ' ').trim()} `)) return label;
  }
  return null;
}

const ASSUNTO: Record<HelpTopicId, string> = {
  conta: 'Problema na conta',
  ferramenta: 'Erro em uma ferramenta',
  duvida: 'Dúvida de como usar',
  pagamento: 'Plano e pagamento',
};

export type SupportMessageInput = {
  name?: string | null;
  email?: string | null;
  topic?: HelpTopicId | null;
  /** resposta do chat que a pessoa leu antes de pedir o suporte: vira o Assunto */
  article?: HelpArticleId | null;
  /** assunto pronto, quando não veio de uma resposta (ex.: "Dúvida sobre Legendas Automáticas", depois da aula) */
  subject?: string | null;
  description: string;
  /** página onde a pessoa estava: só serve pra saber a FERRAMENTA, não vai na mensagem */
  pathname?: string | null;
};

/**
 * A mensagem que a pessoa manda pro suporte no WhatsApp. Curta, educada e com
 * tudo que o atendimento precisa pra agir sem perguntar de volta:
 *
 *   Olá, suporte do Auto Edit! Meu nome é Ana.
 *
 *   Conta: ana@x.com
 *   Assunto: Erro na ferramenta Legendas Automáticas
 *   O que aconteceu: Travou no processamento.
 *
 *   Podem me ajudar?
 *
 * Texto puro de propósito: o *negrito* do WhatsApp aparece com os asteriscos
 * na caixa de texto antes de a pessoa enviar.
 */
export function buildSupportMessage(i: SupportMessageInput): string {
  const name = (i.name || '').trim();
  const email = (i.email || '').trim();
  const desc = cleanText(i.description);
  const topic = topicById(i.topic);
  const article = articleById(i.article);
  const subject = (i.subject || '').trim();

  let assunto = article ? article.subject : subject || (topic ? ASSUNTO[topic.id] : null);
  if (!article && !subject && topic?.id === 'ferramenta') {
    // a ferramenta citada no relato manda; senão, a da página, a menos que a
    // pessoa tenha respondido "não" ao "Foi na ferramenta X?"
    const negou = /^n(a|ã)o\b/i.test(desc);
    const tool = toolMentioned(desc) ?? (negou ? null : toolFromPath(i.pathname));
    if (tool) assunto = `Erro na ferramenta ${tool}`;
  }

  const dados: string[] = [];
  if (email) dados.push(`Conta: ${email}`);
  if (assunto) dados.push(`Assunto: ${assunto}`);
  if (desc) {
    const rotulo = article?.request ? 'Pedido' : topic?.id === 'duvida' ? 'Minha dúvida' : 'O que aconteceu';
    const relato = comoRelato(desc);
    dados.push(relato.includes('\n') ? `${rotulo}:\n${relato}` : `${rotulo}: ${relato}`);
  }

  const abertura = name ? `Olá, suporte do Auto Edit! Meu nome é ${name}.` : 'Olá, suporte do Auto Edit!';
  return [abertura, dados.join('\n'), 'Podem me ajudar?'].filter(Boolean).join('\n\n');
}

/** Link do WhatsApp do suporte com a mensagem já escrita. */
export function whatsappUrl(message: string, phone: string = SUPPORT_WHATSAPP): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
