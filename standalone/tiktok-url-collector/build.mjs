/* Build do bookmarklet:
 *  - le bookmarklet.js
 *  - tira comentarios /* ... *\/ e // ...
 *  - colapsa espacos repetidos (sem quebrar strings)
 *  - codifica como javascript: URI
 *  - injeta o resultado em install.html (entre marcadores)
 *
 * Uso: node build.mjs
 */
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripComments(src) {
  // tira /* ... */ (nao-greedy, multiline)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // tira // ... ate fim da linha (cuidando pra nao matar URLs em strings — simples mesmo)
  out = out.replace(/(^|[^:"'\\])\/\/[^\n]*$/gm, '$1');
  return out;
}

function collapse(src) {
  // preserva conteudo dentro de strings simples/duplas/template
  const parts = [];
  let i = 0;
  let buf = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      // dump buffer
      parts.push({ kind: 'code', s: buf });
      buf = '';
      const quote = c;
      let s = c;
      i++;
      while (i < src.length) {
        const ch = src[i];
        s += ch;
        if (ch === '\\' && i + 1 < src.length) {
          s += src[i + 1];
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        i++;
      }
      parts.push({ kind: 'str', s });
    } else {
      buf += c;
      i++;
    }
  }
  if (buf) parts.push({ kind: 'code', s: buf });
  return parts
    .map((p) => (p.kind === 'str' ? p.s : p.s.replace(/\s+/g, ' ')))
    .join('')
    .trim();
}

async function main() {
  const src = await readFile(path.join(__dirname, 'bookmarklet.js'), 'utf8');
  const noComments = stripComments(src);
  const min = collapse(noComments);
  const uri = 'javascript:' + encodeURIComponent(min);

  await writeFile(path.join(__dirname, 'bookmarklet.min.js'), min, 'utf8');
  await writeFile(path.join(__dirname, 'bookmarklet.uri.txt'), uri, 'utf8');

  // injeta no install.html (entre <!--BM_START--> e <!--BM_END-->)
  const htmlPath = path.join(__dirname, 'install.html');
  try {
    const html = await readFile(htmlPath, 'utf8');
    const patched = html.replace(
      /(<!--BM_START-->)[\s\S]*?(<!--BM_END-->)/,
      `$1${uri}$2`,
    );
    await writeFile(htmlPath, patched, 'utf8');
    console.log('install.html atualizado.');
  } catch {
    console.log('install.html ainda nao existe — pulando injecao.');
  }
  console.log('min:', min.length, 'chars  | uri:', uri.length, 'chars');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
