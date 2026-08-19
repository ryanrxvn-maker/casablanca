/**
 * Guarda contra o erro que se repetiu TRÊS vezes: abrir a ferramenta pra free
 * numa camada e esquecer de outra.
 *
 * A liberação mora em lugares independentes — duas listas do middleware, o
 * gate de cada rota e o filtro da UI. Abrir só uma parte não dá erro nenhum em
 * build nem em tsc: o usuário é que descobre, batendo numa porta fechada.
 *
 * Este teste LÊ OS ARQUIVOS e cobra que toda porta do caminho esteja aberta
 * enquanto a janela existir. É grosseiro de propósito — grep pega o que o
 * type-checker não pega.
 *
 * Roda com: npx tsx lib/famous-hey-trial.test.ts
 */
import { readFileSync } from 'fs';
import { famousHeyGratis, FAMOUS_HEY_PATH, famousHeyDiasRestantes } from './famous-hey-trial';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};
const ler = (p: string) => readFileSync(p, 'utf8');

console.log('famous-hey: janela grátis');

// ── as rotas que a tela chama ────────────────────────────────────────────────
const ROTAS = [
  'app/api/heygen/oauth/device/route.ts',
  'app/api/heygen/identidade/route.ts',
  'app/api/heygen/image-video/route.ts',
  'app/api/heygen/image-video/arquivo/route.ts',
  'app/api/heygen/audio-asset/route.ts',
  'app/api/heygen/voices/route.ts',
];
for (const r of ROTAS) {
  const src = ler(r);
  const gatesAdmin = (src.match(/requireTier\(\s*'admin'/g) || []).length;
  ok(gatesAdmin === 0, `${r.split('/').slice(-2).join('/')} não tem gate fixo em 'admin'`);
  ok(src.includes('famousHeyGratis'), `${r.split('/').slice(-2).join('/')} respeita a janela`);
}

// ── as DUAS listas do middleware ─────────────────────────────────────────────
const mid = ler('lib/supabase/middleware.ts');
const bloco = (nome: string) => {
  const i = mid.indexOf(nome);
  return i < 0 ? '' : mid.slice(i, mid.indexOf('];', i));
};
ok(bloco('FREE_ALLOWED_TOOLS').includes(FAMOUS_HEY_PATH), 'middleware libera pro FREE');
ok(
  bloco('ADMIN_ONLY_PREFIXES_BASE').includes('famousHeyGratis'),
  'middleware tira do gate de ADMIN durante a janela',
);

// ── a UI ─────────────────────────────────────────────────────────────────────
ok(ler('lib/use-tier.ts').includes('famousHeyLiberaPath'), 'tierAllowsTool respeita a janela');
ok(ler('components/ToolsHub.tsx').includes('adminOnly: !famousHeyGratis()'), 'card aparece na grade');

// ── a contagem ───────────────────────────────────────────────────────────────
ok(famousHeyGratis(Date.UTC(2026, 7, 19)), 'aberta em 19/08');
ok(!famousHeyGratis(Date.UTC(2026, 7, 29)), 'fechada em 29/08');
ok(famousHeyDiasRestantes(Date.UTC(2026, 7, 19, 12)) === 9, 'contagem cai a cada dia');

console.log(falhas ? `\n✗ ${falhas} falha(s)` : '\n✓ tudo aberto');
process.exit(falhas ? 1 : 0);
