import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import RemoverLegendaTool from '@/components/tools/RemoverLegendaTool';

/**
 * /tools/remover-elementos — Removedor de Legenda / Marca d'Água.
 *
 * AGORA: vmake Smart (server-side, conta do admin). SEM instalador, SEM
 * motor local. Mesmo modelo do lipsync — liberado pra Pro + Admin
 * (profiles.tier = 'pro'/'beta' OU profiles.is_admin = true).
 *
 * O bloqueio real é em camadas: middleware (PRO_ONLY_TOOLS) + requirePro()
 * nas rotas /api/tools/remove-subtitle/*. Esta checagem é defesa extra.
 */

export const dynamic = 'force-dynamic';

type Diag = {
  authed: boolean;
  email: string | null;
  userId: string | null;
  profileFound: boolean;
  isAdmin: boolean;
  isPro: boolean;
  isActive: boolean;
  profileError: string | null;
};

async function checkAccess(): Promise<{ ok: true } | { ok: false; diag: Diag }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      diag: { authed: false, email: null, userId: null, profileFound: false, isAdmin: false, isPro: false, isActive: false, profileError: null },
    };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin, is_active, tier')
    .eq('id', user.id)
    .maybeSingle();

  const isAdmin = Boolean(profile?.is_admin);
  const isActive = Boolean(profile?.is_active);
  const rawTier = (profile as { tier?: string | null } | null)?.tier ?? '';
  const isPro = rawTier === 'pro' || rawTier === 'beta';

  // Liberado pra Pro + Admin (conta ativa).
  if ((isAdmin || isPro) && isActive) return { ok: true };

  return {
    ok: false,
    diag: {
      authed: true,
      email: user.email ?? null,
      userId: user.id,
      profileFound: Boolean(profile),
      isAdmin,
      isPro,
      isActive,
      profileError: error?.message ?? null,
    },
  };
}

export default async function RemoverLegendaPage() {
  const access = await checkAccess();

  if (!access.ok && !access.diag.authed) {
    redirect('/login?next=/tools/remover-elementos');
  }

  if (!access.ok) {
    const d = access.diag;
    return (
      <main className="min-h-screen bg-bg py-10">
        <div className="mx-auto w-full max-w-2xl px-5">
          <div className="rounded-[16px] border border-red-500/40 bg-red-500/5 p-6 space-y-4">
            <div>
              <div className="mono text-[10px] uppercase tracking-widest text-red-300">
                Acesso negado · /tools/remover-elementos
              </div>
              <h1 className="mt-1 text-2xl font-bold text-white">Esta ferramenta é Pro</h1>
              <p className="mt-1 text-[13px] text-text-muted">
                Você está logado, mas sua conta não é{' '}
                <span className="mono text-white">Pro</span> nem{' '}
                <span className="mono text-white">Admin</span>. Faça upgrade em{' '}
                <span className="mono text-white">/planos</span>.
              </p>
            </div>

            <div className="rounded-[10px] border border-line-strong bg-bg-soft/40 p-4 space-y-1 text-[12px]">
              <div className="mono text-[10px] uppercase tracking-widest text-text-muted">Diagnóstico</div>
              <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 mt-2">
                <span className="text-text-muted">Email</span>
                <span className="mono text-white">{d.email ?? '—'}</span>
                <span className="text-text-muted">User ID</span>
                <span className="mono text-white break-all text-[11px]">{d.userId ?? '—'}</span>
                <span className="text-text-muted">is_admin</span>
                <span className={`mono ${d.isAdmin ? 'text-lime' : 'text-red-300'}`}>{String(d.isAdmin)}</span>
                <span className="text-text-muted">is_pro</span>
                <span className={`mono ${d.isPro ? 'text-lime' : 'text-red-300'}`}>{String(d.isPro)}</span>
                <span className="text-text-muted">is_active</span>
                <span className={`mono ${d.isActive ? 'text-lime' : 'text-red-300'}`}>{String(d.isActive)}</span>
              </div>
            </div>

            <Link
              href="/tools"
              className="mono inline-block rounded-lg border border-line-strong px-4 py-2 text-[11px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
            >
              ← Voltar pras ferramentas
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg pt-8 pb-20">
      <RemoverLegendaTool />
    </main>
  );
}
