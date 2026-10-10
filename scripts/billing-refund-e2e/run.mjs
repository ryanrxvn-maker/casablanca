// Prova de ponta a ponta do cancelamento com reembolso (09.10) contra o
// Stripe em MODO DE TESTE — nenhum dinheiro real. Banco (Supabase), login e
// e-mail viram stubs; o Stripe é o de verdade (sk_test).
//
//   node scripts/billing-refund-e2e/run.mjs              # lib + painel admin (8 cenários)
//   node scripts/billing-refund-e2e/run.mjs routes       # rotas do cliente (10 cenários)
//
// Chave: STRIPE_SECRET_KEY do ambiente ou do .env.local da pasta atual (ou o
// arquivo em BILLING_ENV_FILE). Recusa qualquer chave que não seja sk_test_.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const entry = process.argv[2] === 'routes' ? 'routes.e2e.ts' : 'core.e2e.ts';
const out = path.join(root, '.test-tmp', 'billing-refund-e2e.cjs');

await build({
  entryPoints: [path.join(here, entry)],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: out,
  tsconfig: path.join(root, 'tsconfig.json'),
  absWorkingDir: root,
  nodePaths: [path.join(root, 'node_modules')],
  external: ['stripe', 'next', 'next/*', '@supabase/*'],
  logLevel: 'warning',
  plugins: [
    {
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /(^@\/app\/api\/admin\/_helpers$|\/_helpers$)/ }, () => ({
          path: path.join(here, 'stub-helpers.ts'),
        }));
        b.onResolve({ filter: /^@\/lib\/supabase\/server$/ }, () => ({
          path: path.join(here, 'stub-supabase-server.ts'),
        }));
      },
    },
  ],
});

let key = process.env.STRIPE_SECRET_KEY ?? '';
if (!key) {
  const file = process.env.BILLING_ENV_FILE || path.join(root, '.env.local');
  if (existsSync(file)) {
    const m = /^STRIPE_SECRET_KEY=(.+)$/m.exec(readFileSync(file, 'utf8'));
    key = m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  }
}
if (!key.startsWith('sk_test_')) {
  console.error('ABORTADO: precisa de uma STRIPE_SECRET_KEY de TESTE (sk_test_...).');
  process.exit(1);
}
process.env.STRIPE_SECRET_KEY = key;
delete process.env.RESEND_API_KEY; // não manda e-mail pro dono durante o teste

req(out);
