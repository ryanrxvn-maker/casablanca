import { createHash, timingSafeEqual } from 'crypto';
import { headers } from 'next/headers';

/**
 * Auth de MÁQUINA pro CLI/MCP do AutoEdit (controle server-to-server).
 *
 * POR QUÊ EXISTE: toda rota /api/* se autentica por COOKIE de sessão do
 * browser (requireTier/requireAdmin → supabase.auth.getUser()). Um cliente
 * externo — o `autoedit` CLI, um cron, um CI — não tem esse cookie. Esta chave
 * é o ÚNICO caminho de autenticação fora do browser.
 *
 * SEGURANÇA:
 *   - DESLIGADO POR PADRÃO. Sem `AUTOEDIT_CLI_KEY` no ambiente (ou com chave
 *     fraca < 24 chars), `cliMachineIdentity()` SEMPRE retorna null e nada muda
 *     no comportamento do app. Só liga quando o dono seta o segredo na Vercel.
 *   - Comparação timing-safe sobre o SHA-256 das chaves (não vaza tamanho nem
 *     dá early-return por caractere).
 *   - Concede tier `admin` (controle total). A chave vive só no env da Vercel +
 *     no ~/.autoedit/config.json do dono. Trate como senha-mestra: quem tiver
 *     ela controla o app inteiro pela API.
 *
 * USO (no início de um gate, antes do fluxo de cookie):
 *   const machine = cliMachineIdentity();
 *   if (machine) return { ok: true, userId: machine.userId, ... };
 */

export interface CliMachineIdentity {
  userId: string;
  email: string | null;
}

/** Header que o CLI manda com a chave. */
export const CLI_AUTH_HEADER = 'x-autoedit-key';

/** Tamanho mínimo de chave aceito (proteção contra chave fraca/placeholder). */
const MIN_KEY_LEN = 24;

function sha256(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Compara duas strings em tempo constante (via digest de tamanho fixo). */
function safeEqual(a: string, b: string): boolean {
  try {
    return timingSafeEqual(sha256(a), sha256(b));
  } catch {
    return false;
  }
}

/**
 * Lê o header `x-autoedit-key` do request atual e, se bater com
 * `AUTOEDIT_CLI_KEY`, devolve a identidade de máquina (mapeada pro user admin
 * configurável). Caso contrário, null — e o fluxo normal de sessão segue.
 *
 * Seguro pra chamar em qualquer route handler /api: se rodar fora de escopo de
 * request (build/SSG), o try/catch devolve null.
 */
export function cliMachineIdentity(): CliMachineIdentity | null {
  const expected = process.env.AUTOEDIT_CLI_KEY?.trim();
  if (!expected || expected.length < MIN_KEY_LEN) return null;

  let provided = '';
  try {
    provided = headers().get(CLI_AUTH_HEADER)?.trim() || '';
  } catch {
    return null;
  }
  if (provided.length < MIN_KEY_LEN) return null;
  if (!safeEqual(provided, expected)) return null;

  return {
    userId: process.env.AUTOEDIT_CLI_USER_ID?.trim() || 'autoedit-cli',
    email: process.env.AUTOEDIT_CLI_EMAIL?.trim() || 'cli@darkoautoedit.com',
  };
}
