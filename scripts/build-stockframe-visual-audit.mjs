import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Build the checked-in, URL-free visual index from human-reviewed contact
// sheets. The source remains local; this output contains no API key or media.
const source = resolve(process.argv[2] || '.stockframe-catalogo');
const output = resolve(process.argv[3] || 'data/stockframe-visual-audit.ts');
const names = (await readdir(join(source, 'fichas'))).filter((name) => /^\d{4}\.txt$/.test(name)).sort();
const entries = {};
const completeSheets = [];
const partialSheets = [];
for (const name of names) {
  const sheet = name.slice(0, 4);
  const manifest = JSON.parse(await readFile(join(source, 'folhas', `${sheet}.json`), 'utf8'));
  const lines = (await readFile(join(source, 'fichas', name), 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const takes = new Map(manifest.takes.map((take) => [take.n, take]));
  const seen = new Set();
  for (const line of lines) {
    const columns = line.split('|');
    if (columns.length !== 5) throw new Error(`${name}: expected n|title|beats|appeal|flags: ${line}`);
    const [number, title, beatString, appealString, flagString] = columns;
    const index = Number(number);
    const take = takes.get(index);
    const appeal = Number(appealString);
    if (!take || seen.has(index) || !title || !beatString || !Number.isInteger(appeal) || appeal < 0 || appeal > 3) {
      throw new Error(`${name}: invalid or duplicate entry ${number}`);
    }
    const beats = beatString.split(',').map((value) => value.trim()).filter(Boolean);
    const flags = flagString.split(',').map((value) => value.trim()).filter(Boolean);
    if (beats.some((beat) => !/^[a-z][a-z0-9:-]*$/.test(beat))) throw new Error(`${name}: malformed beat ${beatString}`);
    if (flags.some((flag) => !/^(?:T|E|Q|3D|IA|TELA|ANIMAL|CRIANCA)$/.test(flag))) throw new Error(`${name}: malformed flag ${flagString}`);
    if (entries[take.id]) throw new Error(`${name}: duplicate video ID ${take.id}`);
    seen.add(index);
    entries[take.id] = { title, beats, appeal, flags, stockTitle: take.title, niche: take.nicho };
  }
  // An unfinished sheet can contain individually reviewed rows. In
  // particular, 0031 intentionally omits explicit +18 material.
  if (seen.size === takes.size) completeSheets.push(sheet);
  else partialSheets.push({ sheet, reviewed: seen.size, total: takes.size });
}
await mkdir(resolve(output, '..'), { recursive: true });
const header = '/* Generated from human-reviewed StockFrame contact sheets. No media URLs or credentials. */\n';
const sourceCode = `${header}export const visualAuditCounts = ${JSON.stringify({ completeSheets: completeSheets.length, partialSheets: partialSheets.length, videos: Object.keys(entries).length })};\nexport const visualAuditEntries: Record<string, { title: string; beats: string[]; appeal: number; flags: string[]; stockTitle: string; niche: string }> = ${JSON.stringify(entries)};\n`;
await writeFile(output, sourceCode, 'utf8');
console.log(`StockFrame visual audit: ${completeSheets.length} complete sheets, ${partialSheets.length} partial, ${Object.keys(entries).length} video IDs -> ${output}`);
