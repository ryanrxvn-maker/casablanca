import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LipSyncTool from '@/components/tools/LipSyncTool';

/**
 * /tools/lipsync — Ferramenta admin-only.
 *
 * Usa o mesmo check que o resto do projeto: profiles.is_admin = true.
 * Em vez de redirect silencioso pra /tools, mostra uma pagina de
 * diagnostico explicito pra facilitar setup (sabe se o problema eh
 * login expirado, falta is_admin no DB, ou conta inativa).
 */

export const dynamic = 'force-dynamic';

type Diag = {
  authed: boolean;
  email: string | null;
  userId: string | null;
  profileFound: boolean;
  isAdmin: boolean;
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
        isActive: false,
        profileError: null,
      },
    };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin, is_active')
    .eq('id', user.id)
    .maybeSingle();

  const isAdmin = Boolean(profile?.is_admin);
  const isActive = Boolean(profile?.is_active);

  if (isAdmin && isActive) {
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
              <div className="mono text-[10px] uppercase tracking-widest text-red-300">
                Acesso negado · /tools/lipsync
              </div>
              <h1 className="mt-1 text-2xl font-bold text-white">
                Esta ferramenta eh admin-only
              </h1>
              <p className="mt-1 text-[13px] text-text-muted">
                Voce esta logado, mas sua conta nao tem{' '}
                <span className="mono text-white">profiles.is_admin = true</span> no Supabase.
              </p>
            </div>

            <div className="rounded-[10px] border border-line-strong bg-bg-soft/40 p-4 space-y-1 text-[12px]">
              <div className="mono text-[10px] uppercase tracking-widest text-text-muted">
                Diagnostico
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 mt-2">
                <span className="text-text-muted">Email</span>
                <span className="mono text-white">{d.email ?? '—'}</span>
                <span className="text-text-muted">User ID</span>
                <span className="mono text-white break-all text-[11px]">{d.userId ?? '—'}</span>
                <span className="text-text-muted">Profile encontrado</span>
                <span className={`mono ${d.profileFound ? 'text-lime' : 'text-red-300'}`}>
                  {d.profileFound ? 'sim' : 'NAO'}
                </span>
                <span className="text-text-muted">is_admin</span>
                <span className={`mono ${d.isAdmin ? 'text-lime' : 'text-red-300'}`}>
                  {String(d.isAdmin)}
                </span>
                <span className="text-text-muted">is_active</span>
                <span className={`mono ${d.isActive ? 'text-lime' : 'text-red-300'}`}>
                  {String(d.isActive)}
                </span>
                {d.profileError ? (
                  <>
                    <span className="text-text-muted">Erro</span>
                    <span className="mono text-red-300 text-[11px]">{d.profileError}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="rounded-[10px] border border-cyan-500/40 bg-cyan-500/5 p-4 space-y-2 text-[12px] text-cyan-100">
              <div className="mono text-[10px] uppercase tracking-widest text-cyan-300">
                Como liberar (Supabase dashboard)
              </div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Abra o Supabase do projeto CASABLANCA.</li>
                <li>
                  Table editor →{' '}
                  <span className="mono rounded bg-bg/50 px-1.5 py-0.5">profiles</span>
                </li>
                <li>
                  Procure a linha onde{' '}
                  <span className="mono rounded bg-bg/50 px-1.5 py-0.5 break-all">
                    id = {d.userId ?? '<seu user id acima>'}
                  </span>
                </li>
                <li>
                  Marque{' '}
                  <span className="mono rounded bg-bg/50 px-1.5 py-0.5">is_admin = true</span>{' '}
                  e{' '}
                  <span className="mono rounded bg-bg/50 px-1.5 py-0.5">is_active = true</span>
                </li>
                <li>Salve, atualize esta pagina.</li>
              </ol>
              <div className="mt-2 text-[11px] text-cyan-200/80">
                Atalho via SQL editor:
                <pre className="mt-1 rounded bg-bg/60 p-2 mono text-[11px] text-white overflow-x-auto">
{`update profiles
set is_admin = true, is_active = true
where id = '${d.userId ?? '<seu-user-id>'}';`}
                </pre>
              </div>
            </div>

            <div className="flex gap-2">
              <Link
                href="/tools"
                className="mono rounded-lg border border-line-strong px-4 py-2 text-[11px] uppercase tracking-widest text-text-muted hover:border-lime hover:text-lime"
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
