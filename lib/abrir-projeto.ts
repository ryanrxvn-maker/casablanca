/**
 * ABRIR DIRETO NO EDITOR (08.10) — a ponte do site com o Auto Edit Abrir, o
 * app do PC que abre o projeto editável do Pilot direto no CapCut/Premiere.
 *
 * Silas: *"possibilitar abrir o CapCut com 1 clique, já no projeto, sem precisar
 * fazer nada, só baixar"*.
 *
 * Extensão sozinha não consegue: o Chrome não deixa extensão gravar fora da
 * pasta de downloads nem abrir programa. Então:
 *   1. o clique em CapCut/Premiere chama o link `autoedit-abrir://abrir?…`
 *      (o app registra esse link no Windows ao instalar) — o app abre na hora;
 *   2. o site monta e BAIXA o .zip normal (o mesmo do PDF), com um
 *      `autoedit-job.json` dentro levando o MESMO id do link;
 *   3. o app acha esse .zip na pasta de downloads, copia o projeto pra pasta de
 *      rascunhos do CapCut (ou C:\AUTOEDIT no Premiere), abre o editor e entra
 *      no projeto. O .zip vai pra Lixeira.
 * Sem o app, nada muda: o .zip baixa igual, com o PDF de como abrir.
 *
 * O site não tem como perguntar ao Windows se o app está instalado: quem diz é
 * esta marca no navegador, posta pela página que o instalador abre no fim
 * (`/abrir-projeto?instalado=1`) ou pelo "já instalei" da janela.
 */

export type AlvoDoEditor = 'capcut' | 'premiere';

/** Versão do app que o site entrega (public/downloads/auto-edit-abrir.zip). */
export const ABRIR_VERSAO = '1.0.0';
export const ABRIR_DOWNLOAD = '/downloads/auto-edit-abrir.zip';
export const ABRIR_DOWNLOAD_NOME = 'Auto Edit Abrir - instalador.zip';
export const ABRIR_PROTOCOLO = 'autoedit-abrir';
const CHAVE = 'darkolab:abrir-projeto';

export type MarcaDoApp = { instalado: boolean; versao: string; em: number };

/** Nome de pasta aceito pelo Windows e pelo CapCut (o mesmo do exportador). */
export function nomeDePasta(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'PROJETO PILOT';
}

/** O nome do .zip do pacote — o app espera exatamente este nome (ou com " (1)"). */
export function nomeDoZip(nomeBase: string, alvo: AlvoDoEditor): string {
  return `${nomeDePasta(nomeBase)} - ${alvo === 'premiere' ? 'PREMIERE' : 'CAPCUT'}.zip`;
}

/** O link que acorda o app: só diz QUAL .zip esperar (o app confere o id dentro dele). */
export function linkDoPedido(p: { alvo: AlvoDoEditor; job: string; zip: string; t: number }): string {
  const q = new URLSearchParams({ v: '1', alvo: p.alvo, job: p.job, zip: p.zip, t: String(Math.round(p.t)) });
  // URLSearchParams troca espaço por "+": o app aceita os dois, mas %20 é o universal
  return `${ABRIR_PROTOCOLO}://abrir?${q.toString().replace(/\+/g, '%20')}`;
}

/** Id do pedido: o app só aceita [A-Za-z0-9-]{8,64}. */
export function novoJob(): string {
  const c = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
  return c.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
}

export function lerMarca(): MarcaDoApp | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (v && v.instalado === true && typeof v.versao === 'string') return v as MarcaDoApp;
  } catch { /* modo privado */ }
  return null;
}

export function marcarInstalado(versao: string = ABRIR_VERSAO): void {
  try { localStorage.setItem(CHAVE, JSON.stringify({ instalado: true, versao: (versao || ABRIR_VERSAO).slice(0, 20), em: Date.now() } satisfies MarcaDoApp)); } catch { /* modo privado */ }
}

export function desmarcarInstalado(): void {
  try { localStorage.removeItem(CHAVE); } catch { /* modo privado */ }
}

/**
 * Chama o link do app. Tem de rodar DENTRO do clique (o Chrome só abre app
 * externo com gesto do usuário). Um <a> temporário: a página não navega.
 */
export function chamarApp(link: string): void {
  const a = document.createElement('a');
  a.href = link;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Baixa o instalador (zip com o .exe e o PDF de como instalar). */
export function baixarInstalador(): void {
  const a = document.createElement('a');
  a.href = ABRIR_DOWNLOAD;
  a.download = ABRIR_DOWNLOAD_NOME;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
