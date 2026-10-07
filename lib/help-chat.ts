/**
 * CHAT DE AJUDA (07.10) — lógica pura do mini chat do canto da tela.
 *
 * O chat NÃO responde nada sozinho: ele só organiza o pedido da pessoa
 * (assunto + o que aconteceu + quem é + onde estava) numa mensagem pronta e
 * entrega um link do WhatsApp do suporte com ela já escrita. Quem atende é
 * gente, no WhatsApp. Tudo aqui é sem DOM pra poder ser testado em node
 * (lib/help-chat.test.ts).
 */
import { historyToolLabel } from './history-tools';

/** Número do suporte (o mesmo do antigo botão verde do WhatsApp). */
export const SUPPORT_WHATSAPP = '5534991262437';

/** Teto do que a pessoa escreve. A mensagem inteira vai na URL do wa.me. */
export const MAX_DESCRICAO = 1200;

export type HelpTopicId = 'conta' | 'ferramenta' | 'duvida' | 'pagamento';

export type HelpTopic = {
  id: HelpTopicId;
  /** texto do botão de sugestão */
  label: string;
  /** como o assunto entra na frase da mensagem (completa "Estou ..."/"Tenho ...") */
  frase: string;
  /** respostas rápidas depois de escolher o assunto */
  rapidas: string[];
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'conta',
    label: 'Problemas com a conta',
    frase: 'Estou com um problema na minha conta',
    rapidas: ['Não consigo entrar', 'Não recebi o e-mail de confirmação', 'Quero trocar meu e-mail'],
  },
  {
    id: 'ferramenta',
    label: 'Erro em alguma ferramenta',
    frase: 'Estou com um erro em uma ferramenta',
    rapidas: ['Travou no processamento', 'Deu erro ao enviar o arquivo', 'O download não funcionou'],
  },
  {
    id: 'duvida',
    label: 'Dúvidas de como usar',
    frase: 'Tenho uma dúvida de como usar o site',
    rapidas: ['Por onde eu começo?', 'Qual ferramenta serve pro meu caso?'],
  },
  {
    id: 'pagamento',
    label: 'Planos e pagamento',
    frase: 'Preciso de ajuda com plano ou pagamento',
    rapidas: ['Paguei e não liberou', 'Quero mudar de plano', 'Quero cancelar'],
  },
];

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

const PAGINAS: Record<string, string> = {
  '/': 'Página inicial',
  '/tools': 'Início das ferramentas',
  '/login': 'Login',
  '/register': 'Cadastro',
  '/planos': 'Planos',
  '/configuracoes': 'Configurações',
  '/tools/historico': 'Histórico',
};

/** Nome legível da página onde a pessoa estava quando pediu ajuda. */
export function pageLabelFor(pathname: string | null | undefined): string {
  const p = (pathname || '/').replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  return toolFromPath(p) ?? PAGINAS[p] ?? (p.startsWith('/configuracoes') ? 'Configurações' : p);
}

/** Pergunta que o chat faz depois que a pessoa escolhe o assunto. */
export function followUpFor(topic: HelpTopicId, tool: string | null): string {
  switch (topic) {
    case 'conta':
      return 'Entendi. O que está acontecendo com a sua conta?';
    case 'ferramenta':
      return tool
        ? `Foi na ferramenta ${tool}? Me conta o que aconteceu e, se apareceu alguma mensagem de erro, cola ela aqui.`
        : 'Qual ferramenta deu erro e o que apareceu na tela? Se tiver uma mensagem de erro, cola ela aqui.';
    case 'duvida':
      return 'Claro! Qual é a sua dúvida? Fala a ferramenta e o que você quer fazer.';
    case 'pagamento':
      return 'Certo. Me conta o que houve com o seu plano ou pagamento.';
  }
}

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Assunto de um texto livre (quando a pessoa escreve direto, sem tocar numa
 * sugestão). Ordem importa: pagamento e conta são mais específicos que "erro".
 */
export function detectTopic(texto: string): HelpTopicId | null {
  const t = sem(texto);
  if (/\b(pag(o|ou|uei|ar|amento)|plano|assinatura|cobr|cartao|pix|boleto|reembols|cancel|fatura|premium|upgrade)/.test(t)) return 'pagamento';
  if (/\b(senha|login|logar|entrar|acess(o|ar)|conta|cadastr|e-?mail|confirma)/.test(t)) return 'conta';
  if (/\b(erro|bug|trav|falh|nao (funciona|carrega|baixa|abre|gera|processa)|parou|quebr|deu ruim|crash)/.test(t)) return 'ferramenta';
  if (/\b(como|duvida|usar|uso|tutorial|onde|qual|serve)/.test(t)) return 'duvida';
  return null;
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

/** "Não consigo entrar" → "não consigo entrar." para caber depois dos dois-pontos. */
function comoContinuacao(desc: string): string {
  let d = desc.trim();
  // só abaixa a 1ª letra de palavra comum ("Travou" → "travou", "O download" →
  // "o download"); sigla e nome próprio com 2 maiúsculas ficam ("PIX", "HeyGen")
  if (/^\p{Lu}(\p{Ll}|\s|$)/u.test(d) && !/^\S*\p{Lu}\S*\p{Lu}/u.test(d.split(/\s/)[0] ?? '')) {
    d = d[0].toLowerCase() + d.slice(1);
  }
  if (!/[.!?…)]$/.test(d)) d += '.';
  return d;
}

export type SupportMessageInput = {
  name?: string | null;
  email?: string | null;
  topic?: HelpTopicId | null;
  description: string;
  pathname?: string | null;
  host?: string | null;
};

/**
 * A mensagem que a pessoa manda pro suporte no WhatsApp:
 *
 *   Olá! Meu nome é Ana e uso o Auto Edit (conta: ana@x.com).
 *
 *   Estou com um erro na ferramenta Legendas Automáticas: travou no processamento.
 *
 *   Página: Legendas Automáticas (darkoautoedit.com/tools/tipografia)
 */
export function buildSupportMessage(i: SupportMessageInput): string {
  const name = (i.name || '').trim();
  const email = (i.email || '').trim();
  const conta = email ? ` (conta: ${email})` : '';
  const abertura = name
    ? `Olá! Meu nome é ${name} e uso o Auto Edit${conta}.`
    : email
      ? `Olá! Uso o Auto Edit${conta}.`
      : 'Olá! Vim pelo site do Auto Edit.';

  const tool = toolFromPath(i.pathname);
  const topic = topicById(i.topic);
  let frase: string;
  if (topic?.id === 'ferramenta' && tool) frase = `Estou com um erro na ferramenta ${tool}`;
  else if (topic) frase = topic.frase;
  else frase = 'Preciso de ajuda';

  const desc = cleanText(i.description);
  const corpo = desc ? `${frase}: ${comoContinuacao(desc)}` : `${frase}.`;

  const path = (i.pathname || '/').replace(/[?#].*$/, '');
  const host = (i.host || 'darkoautoedit.com').replace(/^www\./, '');
  const pagina = `Página: ${pageLabelFor(path)} (${host}${path === '/' ? '' : path})`;

  return [abertura, corpo, pagina].join('\n\n');
}

/** Link do WhatsApp do suporte com a mensagem já escrita. */
export function whatsappUrl(message: string, phone: string = SUPPORT_WHATSAPP): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
