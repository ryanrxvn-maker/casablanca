/**
 * Acentos e maiúsculas nas mensagens que o Motor do Downloader manda (10.10).
 *
 * O Motor instalado no computador do cliente escreve as mensagens sem acento
 * ("Falha no download. esse video nao esta mais disponivel"). Motor já
 * instalado não se atualiza sozinho, então o ajuste é feito AQUI, na hora de
 * mostrar — vale pra todos os Motores, velhos e novos. Só troca palavras e
 * frases conhecidas dessas mensagens (nada de "esta" solto, que pode ser
 * "esta página").
 */
const PALAVRAS: Array<[RegExp, string]> = [
  [/\bnao\b/g, 'não'],
  [/\bNao\b/g, 'Não'],
  [/\bvideos\b/g, 'vídeos'],
  [/\bvideo\b/g, 'vídeo'],
  [/\baudio\b/g, 'áudio'],
  [/\bservico\b/g, 'serviço'],
  [/\bdisponivel\b/g, 'disponível'],
  [/\bpagina\b/g, 'página'],
  [/\bconexao\b/g, 'conexão'],
  [/\brestricao\b/g, 'restrição'],
  [/\binvalida\b/g, 'inválida'],
  [/\bvalida\b/g, 'válida'],
  [/\bpublico\b/g, 'público'],
  [/\bDominio\b/g, 'Domínio'],
  [/\bdominio\b/g, 'domínio'],
  [/\bConteudo\b/g, 'Conteúdo'],
  [/\bconteudo\b/g, 'conteúdo'],
  [/\bantivirus\b/g, 'antivírus'],
  [/\bproximo\b/g, 'próximo'],
  [/\bsubstituida\b/g, 'substituída'],
  [/\bmidia\b/g, 'mídia'],
];

const FRASES: Array<[RegExp, string]> = [
  [/\bnão esta\b/g, 'não está'],
  [/\besta público\b/g, 'está público'],
  [/\b([Ee]sse vídeo) e privado\b/g, '$1 é privado'],
  [/\bso da pra\b/g, 'só dá pra'],
];

/** Deixa a mensagem do Motor em português correto (acento + maiúscula). */
export function ajustarTextoDoMotor(msg: string): string {
  if (!msg) return msg;
  let s = msg;
  for (const [re, troca] of PALAVRAS) s = s.replace(re, troca);
  for (const [re, troca] of FRASES) s = s.replace(re, troca);
  // Maiúscula no começo e depois de ponto final.
  s = s.replace(/^(\s*)([a-zà-ú])/, (_m, sp: string, c: string) => sp + c.toUpperCase());
  s = s.replace(/([.!?]\s+)([a-zà-ú])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  return s;
}
