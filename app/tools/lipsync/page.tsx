import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LipSyncTool from '@/components/tools/LipSyncTool';

/**
 * /tools/lipsync — Ferramenta Pro (Lipsync Video to Video).
 *
 * Liberada pra Pro + Admin (profiles.tier = 'pro'/'beta' OU is_admin).
 * O bloqueio real é em camadas: middleware (PRO_ONLY_TOOLS) +
 * requireToolAccess('/tools/lipsync','pro') nas rotas /api/tools/lipsync/*.
 * Esta checagem é defesa extra; em vez de redirect silencioso pra /tools,
 * mostra diagnostico explicito (login expirado, tier insuficiente, inativa).
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
      diag: {
        authed: false,
        email: null,
        userId: null,
        profileFound: false,
        isAdmin: false,
        isPro: false,
        isActive: false,
        profileError: null,
      },
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
  if ((isAdmin || isPro) && isActive) {
    return { ok: true };
  }

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

export default async function LipSyncPage() {
  const access = await checkAccess();

  if (!access.ok && !access.diag.authed) {
    // Sem sessao — vai pro login normal do projeto.
    redirect('/login?next=/tools/lipsync');
  }

  if (!access.ok) {
    const d = access.diag;
    return (
      <main className="min-h-screen bg-bg py-10">
        <div className="mx-auto w-full max-w-2xl px-5">
          <div className="rounded-[16px] border border-red-500/40 bg-red-500/5 p-6 space-y-4">
            <div>
              <div className="label-tech text-[10px] uppercase tracking-widest text-red-300">
                Acesso restrito
              </div>
              <h1 className="mt-1 text-2xl font-bold text-white">
                Esta ferramenta é do plano Pro
              </h1>
              <p className="mt-1 text-[13px] text-text-muted">
                Você está logado, mas sua conta ainda não tem o{' '}
                <span className="mono text-white">Pro</span>. Faça o upgrade pra
                liberar o acesso na hora.
              </p>
            </div>

            <div className="rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-4 space-y-2 text-[12px] text-cyan-100">
              <div className="label-tech text-[10px] uppercase tracking-widest text-cyan-300">
                Como liberar
              </div>
              <p>
                A ferramenta de criar avatar (lipsync) faz parte do plano{' '}
                <span className="mono text-white">Pro</span>. Assine ou faça
                upgrade na página de planos pra liberar o acesso na hora.
              </p>
            </div>

            {/* Detalhes técnicos recolhidos — úteis quando o suporte pedir um print. */}
            <details className="rounded-[10px] border border-line-strong bg-bg-soft/40 p-4 text-[12px]">
              <summary className="label-tech cursor-pointer text-[10px] uppercase tracking-widest text-text-muted">
                Detalhes técnicos (pro suporte)
              </summary>
              <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 mt-3">
                <span className="text-text-muted">Email</span>
                <span className="mono text-white">{d.email ?? '—'}</span>
                <span className="text-text-muted">Conta encontrada</span>
                <span className={`mono ${d.profileFound ? 'text-lime' : 'text-red-300'}`}>
                  {d.profileFound ? 'sim' : 'NÃO'}
                </span>
                <span className="text-text-muted">Plano Pro</span>
                <span className={`mono ${d.isPro ? 'text-lime' : 'text-red-300'}`}>
                  {d.isPro ? 'sim' : 'não'}
                </span>
                <span className="text-text-muted">Conta ativa</span>
                <span className={`mono ${d.isActive ? 'text-lime' : 'text-red-300'}`}>
                  {d.isActive ? 'sim' : 'não'}
                </span>
                {d.profileError ? (
                  <>
                    <span className="text-text-muted">Erro</span>
                    <span className="mono text-red-300 text-[11px]">{d.profileError}</span>
                  </>
                ) : null}
              </div>
            </details>

            <div className="flex gap-2">
              <Link
                href="/planos"
                className="label-tech rounded-lg border border-lime/60 px-4 py-2 text-[11px] uppercase tracking-widest text-lime hover:bg-lime/10"
              >
                Fazer upgrade pra Pro →
              </Link>
              <Link
                href="/tools"
                className="label-tech rounded-lg border border-line-strong px-4 py-2 text-[11px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
              >
                ← Voltar pras ferramentas
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg pt-8 pb-20">
      <LipSyncTool />
    </main>
  );
}
