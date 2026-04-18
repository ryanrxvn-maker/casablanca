/**
 * CASABLANCA — ZIP builder nativo (sem bibliotecas externas).
 *
 * Gera um ZIP no formato STORE (sem compressão), válido para qualquer
 * extrator padrão. Estrutura:
 *   - Local File Headers (um por arquivo)
 *   - Central Directory (um registro por arquivo)
 *   - End of Central Directory Record
 *
 * Especificação: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 */

// ---------- CRC-32 (polinômio IEEE 0xEDB88320) ----------------------------

let CRC_TABLE: Uint32Array | null = null;

function ensureCrcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = ensureCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------- Helpers -------------------------------------------------------

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

// Retorna (MS-DOS time, MS-DOS date)
function dosDateTime(date: Date = new Date()): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const d =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: d };
}

// ---------- API pública ---------------------------------------------------

export type ZipEntry = {
  name: string;            // nome do arquivo dentro do zip (pode ter /)
  data: Uint8Array | Blob | ArrayBuffer;
};

/**
 * Constrói um Blob ZIP a partir de uma lista de arquivos. Método STORE.
 */
export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  // Normaliza entradas para Uint8Array
  const normalized: Array<{
    name: Uint8Array;
    data: Uint8Array;
    crc: number;
    time: number;
    date: number;
  }> = [];

  for (const entry of entries) {
    const bytes =
      entry.data instanceof Uint8Array
        ? entry.data
        : entry.data instanceof ArrayBuffer
        ? new Uint8Array(entry.data)
        : new Uint8Array(await entry.data.arrayBuffer());

    const name = encodeName(entry.name);
    const { time, date } = dosDateTime();
    normalized.push({ name, data: bytes, crc: crc32(bytes), time, date });
  }

  // Calcula offsets e tamanho final
  const LOCAL_HEADER_SIZE = 30;
  const CENTRAL_HEADER_SIZE = 46;
  const EOCD_SIZE = 22;

  let localTotal = 0;
  for (const e of normalized) {
    localTotal += LOCAL_HEADER_SIZE + e.name.length + e.data.length;
  }
  let centralTotal = 0;
  for (const e of normalized) {
    centralTotal += CENTRAL_HEADER_SIZE + e.name.length;
  }
  const totalSize = localTotal + centralTotal + EOCD_SIZE;

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let offset = 0;

  // ---- Local file headers ------------------------------------------------
  for (const e of normalized) {
    offsets.push(offset);
    writeUint32(view, offset + 0, 0x04034b50);    // signature
    writeUint16(view, offset + 4, 20);            // version needed
    writeUint16(view, offset + 6, 0);             // general purpose flag
    writeUint16(view, offset + 8, 0);             // compression = 0 (store)
    writeUint16(view, offset + 10, e.time);
    writeUint16(view, offset + 12, e.date);
    writeUint32(view, offset + 14, e.crc);
    writeUint32(view, offset + 18, e.data.length); // compressed size
    writeUint32(view, offset + 22, e.data.length); // uncompressed size
    writeUint16(view, offset + 26, e.name.length);
    writeUint16(view, offset + 28, 0);             // extra field length
    offset += LOCAL_HEADER_SIZE;

    out.set(e.name, offset);
    offset += e.name.length;

    out.set(e.data, offset);
    offset += e.data.length;
  }

  const centralDirOffset = offset;

  // ---- Central directory ------------------------------------------------
  for (let i = 0; i < normalized.length; i++) {
    const e = normalized[i];
    writeUint32(view, offset + 0, 0x02014b50);    // signature
    writeUint16(view, offset + 4, 20);            // version made by
    writeUint16(view, offset + 6, 20);            // version needed
    writeUint16(view, offset + 8, 0);             // flags
    writeUint16(view, offset + 10, 0);            // compression
    writeUint16(view, offset + 12, e.time);
    writeUint16(view, offset + 14, e.date);
    writeUint32(view, offset + 16, e.crc);
    writeUint32(view, offset + 20, e.data.length);
    writeUint32(view, offset + 24, e.data.length);
    writeUint16(view, offset + 28, e.name.length);
    writeUint16(view, offset + 30, 0);            // extra field length
    writeUint16(view, offset + 32, 0);            // comment length
    writeUint16(view, offset + 34, 0);            // disk number
    writeUint16(view, offset + 36, 0);            // internal attrs
    writeUint32(view, offset + 38, 0);            // external attrs
    writeUint32(view, offset + 42, offsets[i]);   // local header offset
    offset += CENTRAL_HEADER_SIZE;

    out.set(e.name, offset);
    offset += e.name.length;
  }

  // ---- End of Central Directory ----------------------------------------
  writeUint32(view, offset + 0, 0x06054b50);                      // signature
  writeUint16(view, offset + 4, 0);                               // disk number
  writeUint16(view, offset + 6, 0);                               // disk w/ CD
  writeUint16(view, offset + 8, normalized.length);               // entries on this disk
  writeUint16(view, offset + 10, normalized.length);              // total entries
  writeUint32(view, offset + 12, offset - centralDirOffset);      // CD size
  writeUint32(view, offset + 16, centralDirOffset);               // CD offset
  writeUint16(view, offset + 20, 0);                              // comment length

  return new Blob([out], { type: 'application/zip' });
}
