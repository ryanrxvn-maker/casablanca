/**
 * CHAT DE AJUDA (07.10) — lógica pura do mini chat do canto da tela.
 *
 * O chat NÃO responde nada sozinho: ele só organiza o pedido da pessoa
 * (quem é + assunto + o que aconteceu) numa mensagem pronta e
 * entrega um link do WhatsApp do suporte com ela já escrita. Quem atende é
 * gente, no WhatsApp. Tudo aqui é sem DOM pra poder ser testado em node
 * (lib/help-chat.test.ts).
 */
import { HISTORY_TOOLS, historyToolLabel } from './history-tools';

/** Número do suporte (o mesmo do antigo botão verde do WhatsApp). */
export const SUPPORT_WHATSAPP = '5534991262437';

/** Teto do que a pessoa escreve. A mensagem inteira vai na URL do wa.me. */
export const MAX_DESCRICAO = 1200;

export type HelpTopicId = 'conta' | 'ferramenta' | 'duvida' | 'pagamento';

export type HelpTopic = {
  id: HelpTopicId;
  /** texto do botão de sugestão */
  label: string;
  /** respostas rápidas depois de escolher o assunto */
  rapidas: string[];
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'conta',
    label: 'Problemas com a conta',
    rapidas: ['Não consigo entrar', 'Não recebi o e-mail de confirmação', 'Quero trocar meu e-mail'],
  },
  {
    id: 'ferramenta',
    label: 'Erro em alguma ferramenta',
    rapidas: ['Travou no processamento', 'Deu erro ao enviar o arquivo', 'O download não funcionou'],
  },
  {
    id: 'duvida',
    label: 'Dúvidas de como usar',
    rapidas: ['Por onde eu começo?', 'Qual ferramenta serve pro meu caso?'],
  },
  {
    id: 'pagamento',
    label: 'Planos e pagamento',
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
  // "acesso" sozinho fica de fora: "não consigo acessar o lipsync" é ferramenta
  if (/\b(senha|login|logar|entrar|conta\b|cadastr|e-?mail|confirma)/.test(t)) return 'conta';
  if (/\b(erro|bug|trav|falh|nao (funciona|carrega|baixa|abre|gera|processa|consigo)|acess|parou|quebr|deu ruim|crash)/.test(t)) return 'ferramenta';
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

  let assunto = topic ? ASSUNTO[topic.id] : null;
  if (topic?.id === 'ferramenta') {
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
    const rotulo = topic?.id === 'duvida' ? 'Minha dúvida' : 'O que aconteceu';
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
