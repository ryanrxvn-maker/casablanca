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
  // Avatar em OUTRO workspace do HeyGen (space mismatch).
  if (/(not accessible in space|avatar look not found|outro workspace)/.test(m)) {
    return 'O avatar está em outro workspace do HeyGen. Ative lá o workspace dono do avatar e clique Retomar.';
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
  // Downloader: componente do Motor ausente (yt-dlp/ffmpeg). Backstop pra
  // motores antigos que ainda emitem a mensagem técnica de PATH/Python.
  if (/(yt-?dlp|garanta python|python_path|ytdlp_path)/.test(m)) {
    return 'O Motor de download não está pronto neste computador. Abra o Auto Edit Downloader pelo menu Iniciar (ou reinstale no passo 1 da página) e tente de novo.';
  }
  // Downloader: códigos de interrupção do Chrome (download via Motor).
  if (/(server_failed|server_bad_content|server_unauthorized|network_failed|file_failed|user_canceled|crash)/.test(m)) {
    return 'O download falhou no meio do caminho. Confira se o vídeo está público e se o Motor está aberto (bolinha verde no passo 1), e tente de novo.';
  }
  return fallback;
}
