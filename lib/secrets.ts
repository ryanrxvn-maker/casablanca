import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Criptografia simétrica AES-256-GCM com chave derivada de
 * SECRETS_ENCRYPTION_KEY (env). Usado para guardar/recuperar as keys
 * de IA dos usuarios em user_api_keys.
 *
 * Layout do ciphertext (todos juntos, encoded em base64):
 *   [ 12 bytes IV ][ 16 bytes auth tag ][ ciphertext ]
 *
 * GCM garante:
 *   - Confidencialidade
 *   - Autenticacao: alterar 1 byte do ciphertext invalida a decifragem
 *
 * IMPORTANTE: SECRETS_ENCRYPTION_KEY DEVE ser uma string aleatoria longa
 * (>= 32 bytes equivalente). Trocar a key invalida TODAS as keys ja
 * guardadas no banco — no rotation flow ainda. Pra rotacionar:
 *  1. Adiciona nova env SECRETS_ENCRYPTION_KEY_NEW
 *  2. Lê todas as keys com a antiga, re-encripta com a nova
 *  3. Substitui a env antiga pela nova
 */

const ALGO = 'aes-256-gcm' as const;
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const secret = process.env.SECRETS_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY nao configurada (precisa de >= 16 chars).',
    );
  }
  // Deriva 32 bytes via SHA-256, garante chave do tamanho correto.
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error('Plaintext vazio.');
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(b64: string): string {
  if (!b64) throw new Error('Ciphertext vazio.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('Ciphertext invalido (tamanho).');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function lastFour(plaintext: string): string {
  return plaintext.slice(-4);
}
