/**
 * Erro técnico → mensagem amigável PT-BR pro cliente.
 *
 * Padrão do app ([[project_friendly_errors]]): o cliente NUNCA vê stack,
 * jargão ou inglês. Quando a causa NÃO é nossa (limite do serviço externo,
 * rede, política de conteúdo), a mensagem diz isso com todas as letras.
 *
 * Uso: `error: toFriendlyMessage(e, 'Não consegui processar. Tente de novo.')`
 * O erro CRU deve continuar indo pro console no call-site (diagnóstico).
 */
/**
 * Erro cuja mensagem JÁ é amigável (escrita à mão no call-site) — passa
 * direto pelo toFriendlyMessage sem cair no fallback genérico.
 */
export class FriendlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FriendlyError';
  }
}

export function toFriendlyMessage(
  err: unknown,
  fallback = 'Algo deu errado aqui. Tente de novo em instantes.',
): string {
  if (err instanceof FriendlyError) return err.message;
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '');
  const m = raw.toLowerCase();
  if (!m.trim()) return fallback;

  // Cancelamento pelo próprio user — não é erro.
  if (m.includes('aborterror') || m.includes('cancelado')) return 'Cancelado por você.';

  // Limites do serviço externo (não é culpa do app).
  if (/(maximum daily|daily limit|limite di[aá]rio)/.test(m)) {
    return 'O serviço de geração atingiu o limite diário da sua conta — libera de novo amanhã. Não é um erro do app.';
  }
  if (/(exceeded concurrent|too many request|429|rate.?limit)/.test(m)) {
    return 'O serviço de geração está lotado neste momento. Aguarde alguns minutos e tente de novo — não é um erro do app.';
  }
  // Política de conteúdo do gerador.
  if (/(nsfw|img_denied|content.?policy|pol[ií]tica de conte|recusad|denied|blocked)/.test(m)) {
    return 'O gerador recusou esse conteúdo por política própria. Ajuste o texto/prompt desse item e tente de novo.';
  }
  // Rede.
  if (/(failed to fetch|networkerror|network error|err_internet|err_network|load failed|econnreset|socket hang)/.test(m)) {
    return 'A internet falhou no meio do caminho. Confira a conexão e tente de novo — o que já ficou pronto está salvo.';
  }
  // Memória do navegador.
  if (/(allocation failed|out of memory|oom|sem mem[oó]ria)/.test(m)) {
    return 'O navegador ficou sem memória pra esse trabalho. Feche outras abas (ou use um arquivo menor) e tente de novo.';
  }
  // Travou / watchdog / timeout.
  if (/(watchdog|travad|travou|timeout|timed out|sem progresso)/.test(m)) {
    return 'Ficou sem resposta por muito tempo e foi interrompido por segurança. Tente de novo — o que já ficou pronto está salvo.';
  }
  // Armazenamento local bloqueado por outra aba.
  if (/(indexeddb|bloqueado por outra aba)/.test(m)) {
    return 'Outra aba do AutoEdit estava usando o armazenamento. Feche abas duplicadas do app e tente de novo.';
  }
  // Extensão / ponte do navegador.
  if (/(extens[aã]o|extension|bridge|not connected|n[aã]o conectad|cookies)/.test(m)) {
    return 'A extensão do navegador não respondeu. Confira se ela está instalada e conectada, recarregue a página e tente de novo.';
  }
  return fallback;
}
