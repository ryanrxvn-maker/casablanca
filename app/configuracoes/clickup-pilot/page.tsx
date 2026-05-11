'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { ToolShell } from '@/components/ToolShell';
import {
  getClickUpToken,
  setClickUpToken,
  listTeams,
  getCurrentUser,
  type ClickUpTeam,
  type ClickUpUser,
} from '@/lib/clickup-client';
import { ClickUpPilotStatusSection } from '@/components/ClickUpPilotStatusSection';
import { memoryCount } from '@/lib/voice-avatar-memory';
import { getPilotTeam, setPilotTeam, getPilotEditor, setPilotEditor } from '@/lib/clickup-pilot-config';

/**
 * /configuracoes/clickup-pilot — central de config do Pilot.
 *
 * Tudo que era no painel da ferramenta foi movido pra ca:
 * - Token ClickUp
 * - Workspace + Editor (auto-detectado pelo token)
 * - Filtro de status (CSV — qual status conta como "editar")
 * - Memoria voz<->avatar (info + clear)
 *
 * O painel principal do ClickUp Pilot fica enxuto: so Carregar Tasks +
 * toggles de modo (IA Search, Camuflagem).
 */
export default function ClickUpPilotConfigPage() {
  const router = useRouter();
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [teams, setTeams] = useState<ClickUpTeam[]>([]);
  const [authUser, setAuthUser] = useState<ClickUpUser | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [selectedTeam, setSelectedTeamState] = useState<string | null>(null);
  const [selectedEditor, setSelectedEditorState] = useState<string | null>(null);
  function setSelectedTeam(v: string | null) { setSelectedTeamState(v); setPilotTeam(v); }
  function setSelectedEditor(v: string | null) { setSelectedEditorState(v); setPilotEditor(v); }
  useEffect(() => {
    setSelectedTeamState(getPilotTeam());
    setSelectedEditorState(getPilotEditor());
  }, []);

  function flash(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast((c) => (c?.msg === msg ? null : c)), 3200);
  }

  useEffect(() => {
    setHasToken(!!getClickUpToken());
  }, []);

  useEffect(() => {
    if (!hasToken) return;
    setLoadingTeams(true);
    Promise.all([listTeams(), getCurrentUser()])
      .then(([t, u]) => {
        setTeams(t);
        setAuthUser(u);
        // Auto-pick B2c se existir e nada selecionado
        if (!selectedTeam) {
          const b2c = t.find((x) => /b2c/i.test(x.name));
          if (b2c) setSelectedTeam(b2c.id);
        }
        if (!selectedEditor && u) setSelectedEditor(String(u.id));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingTeams(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken]);

  function saveToken() {
    if (!tokenInput.trim()) return;
    setClickUpToken(tokenInput.trim());
    setHasToken(true);
    setTokenInput('');
    flash('ok', 'Token salvo. Workspace + editor detectados em seguida.');
  }

  function clearToken() {
    if (!confirm('Limpar token + workspace/editor? Voce vai precisar configurar de novo.')) return;
    setClickUpToken(null);
    setHasToken(false);
    setSelectedTeam(null);
    setSelectedEditor(null);
    setTeams([]);
    setAuthUser(null);
    flash('ok', 'Token limpo.');
  }

  const currentTeam = teams.find((t) => t.id === selectedTeam) || null;
  const editorOptions = currentTeam?.members ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container-app flex-1 py-10">
        <div className="mb-3 flex items-center gap-2 text-[11px]">
          <Link href="/configuracoes" className="text-text-muted hover:text-lime">← Configuracoes</Link>
        </div>
        <ToolShell
          title="ClickUp Pilot — Configuracoes"
          description="Token ClickUp, workspace + editor padrao, filtro de status e memoria de voz<->avatar. O painel da ferramenta fica enxuto pra acelerar o uso diario."
        >
          {error ? (
            <div className="mb-4 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
              {error}
            </div>
          ) : null}

          <div className="grid gap-6">
            {/* TOKEN */}
            <section>
              <h2 className="label-field !mb-3">Token ClickUp</h2>
              {hasToken ? (
                <div className="flex items-center justify-between rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-2 text-xs">
                  <span className="text-lime">✓ Token configurado</span>
                  <button
                    type="button"
                    onClick={clearToken}
                    className="rounded-md border border-line-strong px-2 py-0.5 text-[10px] uppercase tracking-widest text-text-muted hover:border-red-500/60 hover:text-red-300"
                  >
                    Limpar
                  </button>
                </div>
              ) : (
                <div className="rounded-[12px] border border-fuchsia-500/40 bg-fuchsia-500/5 px-4 py-3 text-sm">
                  <p className="mb-2 text-[11px] text-text-muted">
                    Pega seu token em{' '}
                    <a
                      href="https://app.clickup.com/settings/apps"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lime hover:underline"
                    >
                      app.clickup.com → Settings → Apps → API Token
                    </a>
                    . Comeca com <code className="mono text-fuchsia-200">pk_</code>. Salvo no localStorage do browser.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="pk_..."
                      className="input-field flex-1"
                    />
                    <button
                      type="button"
                      onClick={saveToken}
                      disabled={!tokenInput.trim()}
                      className="btn-primary"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* WORKSPACE + EDITOR */}
            {hasToken ? (
              <section>
                <h2 className="label-field !mb-3">Workspace + Editor padrao</h2>
                <p className="mb-3 text-[12px] text-text-muted">
                  O Pilot vai listar tasks deste workspace, filtradas pra esse editor.
                  Default: B2c + voce.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={selectedTeam || ''}
                    onChange={(e) => { setSelectedTeam(e.target.value); setSelectedEditor(null); }}
                    disabled={loadingTeams}
                    className="input-field"
                  >
                    <option value="">— Workspace —</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.members.length} membros)</option>
                    ))}
                  </select>
                  <select
                    value={selectedEditor || ''}
                    onChange={(e) => setSelectedEditor(e.target.value)}
                    disabled={!currentTeam || loadingTeams}
                    className="input-field"
                  >
                    <option value="">— Editor —</option>
                    {authUser ? (
                      <option value={String(authUser.id)}>{authUser.username || authUser.email} (voce)</option>
                    ) : null}
                    {editorOptions.filter(m => m.user?.id !== authUser?.id).map((m) => (
                      <option key={m.user.id} value={String(m.user.id)}>{m.user.username || m.user.email}</option>
                    ))}
                  </select>
                </div>
              </section>
            ) : null}

            {/* STATUS FILTER */}
            <ClickUpPilotStatusSection flash={flash} />

            {/* VOICE MEMORY */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Memoria voz ↔ avatar</h2>
              <div className="rounded-[12px] border border-line bg-bg-soft/40 p-4 text-[12px] text-text-muted">
                <p className="mb-2">
                  Quando voce escolhe um avatar pra uma voz no ClickUp Pilot, salvamos
                  o pareamento. Proxima vez que o copy mencionar <code className="mono text-lime">@x.mp4</code>
                  e a voz <code className="mono text-lime">@x</code> existir no HeyGen, o Pilot
                  ja resolve o avatar correto sozinho.
                </p>
                <p className="mb-3">
                  Memorias ativas: <strong className="text-white">
                    <VoiceMemoryCount />
                  </strong>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm('Apagar TODAS as memorias voz<->avatar? O Pilot vai precisar re-aprender.')) return;
                    if (typeof window !== 'undefined') {
                      localStorage.removeItem('darkolab:voice-avatar-memory');
                    }
                    flash('ok', 'Memorias apagadas.');
                  }}
                  className="rounded-[12px] border border-line-strong px-4 py-2 text-sm text-text-muted hover:border-red-500/60 hover:text-red-300"
                >
                  Apagar todas as memorias
                </button>
              </div>
            </section>

            {/* Voltar pro Pilot */}
            <div className="flex justify-end border-t border-line pt-6">
              <button
                type="button"
                onClick={() => router.push('/tools/clickup-pilot')}
                className="btn-primary"
              >
                ▶ Voltar pro ClickUp Pilot
              </button>
            </div>
          </div>
        </ToolShell>
      </main>

      {toast ? (
        <div className={'fixed bottom-6 right-6 z-50 max-w-[320px] rounded-[12px] border px-4 py-3 text-sm shadow-2xl ' + (toast.kind === 'ok' ? 'border-lime/40 bg-lime/10 text-lime' : 'border-red-500/40 bg-red-500/10 text-red-300')}>
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

/** Cliente-only: conta de memorias na hora */
function VoiceMemoryCount() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { setN(memoryCount()); }, []);
  return <span>{n ?? '...'}</span>;
}
