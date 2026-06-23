/**
 * Gerador de PIX "Copia e Cola" (BR Code / padrão EMV do Banco Central).
 *
 * Transforma QUALQUER chave PIX num payload que os apps de banco entendem —
 * tudo no client, sem tocar em banco/servidor. O payload vira o texto do
 * "Copia e Cola" e também o conteúdo do QR Code.
 *
 * Referência: Manual de Padrões para Iniciação do PIX (EMV MPM / BR Code).
 */

export type PixInput = {
  key: string; // chave PIX (email, telefone, CPF/CNPJ, aleatória)
  name?: string; // nome do recebedor (vai no QR; fallback genérico)
  city?: string; // cidade do recebedor (fallback BRASIL)
  amount?: number; // valor a cobrar (opcional — pré-preenche no app)
};

/** TLV: id(2) + tamanho(2, zero-padded) + valor. */
function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

/** Remove acentos, mantém A-Z 0-9 e espaço, caixa alta, corta no limite. */
function sanitize(s: string, max: number): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — exigido pelo PIX. */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Monta o BR Code (texto do Copia e Cola). Retorna '' se a chave estiver vazia.
 * O valor, se informado e > 0, é embutido (campo 54) pra já vir preenchido.
 */
export function buildPixPayload({ key, name, city, amount }: PixInput): string {
  const chave = (key || '').trim();
  if (!chave) return '';

  const nome = sanitize(name || '', 25) || 'RECEBEDOR';
  const cidade = sanitize(city || '', 15) || 'BRASIL';

  // Merchant Account Information (campo 26): GUI fixo + chave.
  const mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);

  // Additional Data Field (campo 62): txid '***' = estático sem referência.
  const addData = tlv('05', '***');

  const amt =
    typeof amount === 'number' && amount > 0
      ? tlv('54', amount.toFixed(2)) // sempre ponto decimal, 2 casas
      : '';

  const payload =
    tlv('00', '01') + // Payload Format Indicator
    tlv('26', mai) + // Merchant Account Information - PIX
    tlv('52', '0000') + // Merchant Category Code
    tlv('53', '986') + // Moeda = BRL
    amt + // Valor (opcional)
    tlv('58', 'BR') + // País
    tlv('59', nome) + // Nome do recebedor
    tlv('60', cidade) + // Cidade do recebedor
    tlv('62', addData) + // Additional Data
    '6304'; // CRC16 (id 63 + len 04) — calculado sobre tudo + esse prefixo

  return payload + crc16(payload);
}
