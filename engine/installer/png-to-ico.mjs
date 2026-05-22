// PNG -> ICO: monta um .ico com PNGs embutidos (suportado a partir do
// Vista, csc /win32icon aceita). Sem dependencias externas.
//
// Uso: pngToIco([{w:16,h:16,buf},{w:32,h:32,buf}, ...]) -> Buffer
import { readFileSync } from 'fs';

export function pngToIco(entries) {
  // ICONDIR: 6 bytes + N * ICONDIRENTRY(16 bytes)
  const headerSize = 6 + entries.length * 16;
  const dataParts = [];
  const dataOffsets = [];
  let cursor = headerSize;
  for (const e of entries) {
    dataOffsets.push(cursor);
    cursor += e.buf.length;
    dataParts.push(e.buf);
  }
  const out = Buffer.alloc(headerSize);
  // ICONDIR
  out.writeUInt16LE(0, 0); // reserved
  out.writeUInt16LE(1, 2); // type: 1 = ICO
  out.writeUInt16LE(entries.length, 4);
  // ICONDIRENTRYs
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = 6 + i * 16;
    // 0 representa 256 (no formato ICO classico)
    out.writeUInt8(e.w >= 256 ? 0 : e.w, off + 0);
    out.writeUInt8(e.h >= 256 ? 0 : e.h, off + 1);
    out.writeUInt8(0, off + 2); // colorCount
    out.writeUInt8(0, off + 3); // reserved
    out.writeUInt16LE(1, off + 4); // planes
    out.writeUInt16LE(32, off + 6); // bitCount
    out.writeUInt32LE(e.buf.length, off + 8); // bytesInRes
    out.writeUInt32LE(dataOffsets[i], off + 12); // imageOffset
  }
  return Buffer.concat([out, ...dataParts]);
}

export function pngFiles(map) {
  // map: { 16: 'path16.png', 32: 'path32.png', ... }
  const entries = [];
  for (const k of Object.keys(map).sort((a, b) => +a - +b)) {
    const size = +k;
    entries.push({ w: size, h: size, buf: readFileSync(map[k]) });
  }
  return entries;
}
