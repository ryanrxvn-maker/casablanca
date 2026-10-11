/**
 * Teto do "Baixar ZIP" das ferramentas (10.10).
 *
 * O ZIP é montado inteiro na memória do navegador (lib/zip-builder.ts: lê
 * todos os arquivos e copia num bloco único). Na auditoria, 202 MB saíram em
 * 0,8 s sem travar — o problema é lote de vários GB: a aba congela e falha sem
 * aviso. Acima deste teto a ferramenta avisa e o cliente baixa um por um.
 */

/** Total máximo de um ZIP montado no navegador. */
export const ZIP_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

/** true se o lote cabe num ZIP montado aqui no navegador. */
export function zipCabeNoNavegador(tamanhos: number[], teto = ZIP_MAX_BYTES): boolean {
  const total = tamanhos.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return total <= teto;
}

/** Textos pro cliente — simples, sem termo técnico. */
export const MSG_ZIP_GRANDE =
  'Os arquivos somam mais de 1 GB e ficam pesados demais pra juntar num ZIP aqui. Baixe um por um no botão Baixar de cada arquivo.';
export const MSG_ZIP_FALHOU =
  'Não deu pra juntar os arquivos num ZIP agora. Baixe um por um no botão Baixar de cada arquivo.';
