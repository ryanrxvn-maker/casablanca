'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { createClient } from '@/lib/supabase/client';
import { slugify } from '@/lib/utils';
import {
  AVATAR_BUCKET,
  uploadAvatar,
  deleteByPublicUrl,
} from '@/lib/portfolio-upload';

type Profile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  portfolio_slug: string | null;
  portfolio_public: boolean;
  whatsapp: string | null;
};

const MAX_AVATAR_MB = 5;
const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024;

export default function EditarPerfilPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [slugDraft, setSlugDraft] = useState('');
  const [whatsappDraft, setWhatsappDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingSlug, setSavingSlug] = useState(false);
  const [savingWhats, setSavingWhats] = useState(false);
  const [avatarStage, setAvatarStage] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const { data: userData, error: userErr } = await supabase.auth.getUser();

        if (userErr) throw userErr;
        if (!userData.user) {
          router.replace('/login');
          return;
        }

        const { data: prof, error } = await supabase
          .from('profiles')
          .select('id, name, avatar_url, portfolio_slug, portfolio_public, whatsapp')
          .eq('id', userData.user.id)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        if (!prof) {
          setLoadError(
            'Seu perfil ainda nao foi criado. Rode a migration 001_init.sql no Supabase.',
          );
          setLoading(false);
          return;
        }

        const p: Profile = {
          id: prof.id,
          name: prof.name ?? null,
          avatar_url: prof.avatar_url ?? null,
          portfolio_slug: prof.portfolio_slug ?? null,
          portfolio_public: prof.portfolio_public ?? false,
          whatsapp: prof.whatsapp ?? null,
        };
        setProfile(p);
        setNameDraft(p.name ?? '');
        setSlugDraft(p.portfolio_slug ?? '');
        setWhatsappDraft(p.whatsapp ?? '');
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error('[perfil] load error:', e);
        setLoadError((e as Error).message ?? 'Falha ao carregar perfil.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function saveName() {
    if (!profile) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      flashToast('O nome nao pode ficar vazio.');
      return;
    }
    setSavingName(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ name: trimmed })
        .eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, name: trimmed });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('darko:profile-updated'));
      }
      flashToast('Nome salvo.');
    } catch (e) {
      console.error('[perfil] saveName error:', e);
      flashToast('Erro ao salvar: ' + (e as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  async function saveSlug() {
    if (!profile) return;
    const clean = slugify(slugDraft);
    if (!clean) {
      flashToast('Slug invalido. Use letras, numeros e hifens.');
      return;
    }
    setSavingSlug(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ portfolio_slug: clean })
        .eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, portfolio_slug: clean });
      setSlugDraft(clean);
      flashToast('Link do portfolio atualizado.');
    } catch (e) {
      console.error('[perfil] saveSlug error:', e);
      flashToast('Erro: ' + (e as Error).message);
    } finally {
      setSavingSlug(false);
    }
  }

  async function saveWhatsapp() {
    if (!profile) return;
    setSavingWhats(true);
    try {
      const supabase = createClient();
      const clean = whatsappDraft.trim() || null;
      const { error } = await supabase
        .from('profiles')
        .update({ whatsapp: clean })
        .eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, whatsapp: clean });
      flashToast(clean ? 'WhatsApp salvo.' : 'Botao WhatsApp escondido.');
    } catch (e) {
      console.error('[perfil] saveWhatsapp error:', e);
      flashToast('Erro: ' + (e as Error).message);
    } finally {
      setSavingWhats(false);
    }
  }

  async function togglePublic(on: boolean) {
    if (!profile) return;
    setTogglingPublic(true);
    const prev = profile.portfolio_public;
    setProfile({ ...profile, portfolio_public: on });
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ portfolio_public: on })
        .eq('id', profile.id);
      if (error) throw error;
      flashToast(on ? 'Portfolio publico.' : 'Portfolio agora esta privado.');
    } catch (e) {
      console.error('[perfil] togglePublic error:', e);
      setProfile((p) => (p ? { ...p, portfolio_public: prev } : p));
      flashToast('Erro: ' + (e as Error).message);
    } finally {
      setTogglingPublic(false);
    }
  }

  async function onAvatarSelected(file: File | null) {
    if (!profile || !file) return;
    setAvatarError(null);
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(
        'Imagem muito grande (' + (file.size / 1024 / 1024).toFixed(1) +
          'MB). Limite: ' + MAX_AVATAR_MB + 'MB.',
      );
      return;
    }
    if (!file.type.startsWith('image/')) {
      setAvatarError('Envie um arquivo de imagem (JPG/PNG/WEBP).');
      return;
    }
    setAvatarStage('Enviando imagem...');
    try {
      const prevUrl = profile.avatar_url;
      const { publicUrl } = await uploadAvatar(profile.id, file);
      setAvatarStage('Atualizando perfil...');
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, avatar_url: publicUrl });
      setAvatarStage(null);
      flashToast('Foto de perfil atualizada.');
      // Notifica o Header pra atualizar a foto no canto superior direito
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('darko:profile-updated'));
      }
      if (prevUrl && !prevUrl.startsWith('data:')) {
        deleteByPublicUrl(AVATAR_BUCKET, prevUrl).catch(() => null);
      }
    } catch (e) {
      console.error('[perfil] avatar upload error:', e);
      setAvatarError((e as Error).message ?? 'Falha ao enviar imagem.');
      setAvatarStage(null);
    }
  }

  async function removeAvatar() {
    if (!profile?.avatar_url) return;
    if (!confirm('Remover sua foto de perfil?')) return;
    const prev = profile.avatar_url;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, avatar_url: null });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('darko:profile-updated'));
      }
      deleteByPublicUrl(AVATAR_BUCKET, prev).catch(() => null);
      flashToast('Foto removida.');
    } catch (e) {
      flashToast('Erro: ' + (e as Error).message);
    }
  }

  function copyPortfolioLink() {
    if (!profile?.portfolio_slug || typeof window === 'undefined') return;
    const url = window.location.origin + '/p/' + profile.portfolio_slug;
    navigator.clipboard
      .writeText(url)
      .then(() => flashToast('Link copiado! Cole no WhatsApp, email, Instagram...'))
      .catch(() => flashToast('Falha ao copiar. Copie manualmente: ' + url));
  }

  if (loading) {
    return (
      <ToolShell title="Editar perfil" description="Carregando seu perfil...">
        <div className="flex flex-col items-center gap-3 py-14 text-center text-sm text-text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-lime" />
          <div>Carregando dados do Supabase...</div>
        </div>
      </ToolShell>
    );
  }

  if (loadError || !profile) {
    return (
      <ToolShell title="Editar perfil" description="Nao foi possivel carregar.">
        <div className="flex flex-col gap-4 rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-4 text-sm text-red-300">
          <div className="font-semibold">Erro ao carregar perfil</div>
          <pre className="mono whitespace-pre-wrap text-xs">{loadError}</pre>
          <div className="text-xs text-red-200">
            Cheque se voce rodou as migrations SQL no Supabase (001 ate 007) e
            se seu usuario esta autenticado.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary !py-2 text-xs self-start"
          >
            Tentar novamente
          </button>
        </div>
      </ToolShell>
    );
  }

  const displayName = profile.name?.trim() || 'Editor';
  const initial = displayName.charAt(0).toUpperCase();
  const publicUrl =
    typeof window !== 'undefined' && profile.portfolio_slug
      ? window.location.origin + '/p/' + profile.portfolio_slug
      : null;

  return (
    <ToolShell
      title="Editar perfil"
      description="Foto, nome, link, WhatsApp e visibilidade do seu portfolio."
    >
      <div className="flex flex-col gap-8">
        <div>
          <Link
            href="/tools"
            className="group inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-text-muted transition hover:text-lime"
          >
            <svg
              className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 010 1.06L9.08 10l3.71 3.71a.75.75 0 11-1.06 1.06l-4.24-4.24a.75.75 0 010-1.06l4.24-4.24a.75.75 0 011.06 0z"
                clipRule="evenodd"
              />
            </svg>
            Voltar para as ferramentas
          </Link>
        </div>

        {/* Foto de perfil */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Foto de perfil
          </h2>
          <p className="text-xs text-text-muted">
            Essa foto aparece no header e no seu portfolio publico (pros clientes).
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              {profile.avatar_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-24 w-24 rounded-full border border-line object-cover"
                />
              ) : (
                <span className="flex h-24 w-24 items-center justify-center rounded-full border border-line bg-bg text-3xl font-bold text-lime">
                  {initial}
                </span>
              )}
              <div className="flex flex-col gap-1 text-xs text-text-muted">
                <div>Formatos: JPG, PNG ou WEBP.</div>
                <div>Tamanho maximo: {MAX_AVATAR_MB}MB.</div>
              </div>
            </div>

            <div className="sm:ml-auto flex flex-col gap-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onAvatarSelected(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary !py-2 text-xs"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={!!avatarStage}
                >
                  {avatarStage ?? 'Enviar foto do PC'}
                </button>
                {profile.avatar_url ? (
                  <button
                    type="button"
                    className="btn-ghost !py-2 text-xs text-red-300 hover:text-red-400"
                    onClick={removeAvatar}
                    disabled={!!avatarStage}
                  >
                    Remover
                  </button>
                ) : null}
              </div>
              {avatarError ? (
                <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                  {avatarError}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* Nome */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Nome exibido
          </h2>
          <div className="flex gap-2">
            <input
              className="input-field"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Seu nome profissional"
            />
            <button
              onClick={saveName}
              className="btn-primary !py-2 text-sm"
              disabled={savingName}
            >
              {savingName ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Aparece no header, no dropdown e no seu portfolio publico.
          </p>
        </section>

        {/* Link do portfolio */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Link do portfolio
          </h2>
          <div className="flex gap-2">
            <input
              className="input-field mono"
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              placeholder="seu-nome"
            />
            <button
              onClick={saveSlug}
              className="btn-primary !py-2 text-sm"
              disabled={savingSlug}
            >
              {savingSlug ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
          {publicUrl ? (
            <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-bg px-4 py-3 text-xs sm:flex-row sm:items-center">
              <div className="flex-1 min-w-0">
                <div className="text-text-dim">Seu link publico:</div>
                <div className="mono truncate text-white">{publicUrl}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyPortfolioLink}
                  className="btn-primary !py-1.5 !px-3 text-xs"
                >
                  Copiar link
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost !py-1.5 !px-3 text-xs"
                >
                  Abrir
                </a>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-text-muted">
            Defina um slug e use &quot;Copiar link&quot; pra enviar pro cliente
            direto no WhatsApp ou email.
          </p>
        </section>

        {/* WhatsApp */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            WhatsApp do botao flutuante
          </h2>
          <div className="flex gap-2">
            <input
              className="input-field"
              value={whatsappDraft}
              onChange={(e) => setWhatsappDraft(e.target.value)}
              placeholder="+5511999998888"
            />
            <button
              onClick={saveWhatsapp}
              className="btn-primary !py-2 text-sm"
              disabled={savingWhats}
            >
              {savingWhats ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Formato internacional com DDI (ex: +5511999998888). Se omitir o DDI,
            a gente assume Brasil (+55). Deixe vazio pra esconder o botao.
          </p>
        </section>

        {/* Visibilidade */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Visibilidade
          </h2>
          <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-bg px-4 py-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={profile.portfolio_public}
                onChange={(e) => togglePublic(e.target.checked)}
                disabled={togglingPublic}
                className="mt-1 h-4 w-4 accent-lime"
              />
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">
                  {profile.portfolio_public
                    ? 'Portfolio publico'
                    : 'Portfolio privado (modo rascunho)'}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {profile.portfolio_public
                    ? 'Qualquer pessoa com o link consegue ver seu portfolio. Deixe marcado quando estiver pronto pra mandar pros clientes.'
                    : 'Ninguem ve seu /p/slug (responde 404). Perfeito pra voce ajustar videos, capa e textos antes de soltar. Marque a caixa quando tudo estiver perfeito.'}
                </div>
              </div>
            </label>
            <div
              className={
                'rounded-[8px] px-3 py-2 text-[11px] ' +
                (profile.portfolio_public
                  ? 'border border-lime/40 bg-lime/10 text-lime'
                  : 'border border-line bg-bg/60 text-text-muted')
              }
            >
              {profile.portfolio_public
                ? 'STATUS: PUBLICO — clientes veem seu portfolio.'
                : 'STATUS: PRIVADO — invisivel pros clientes.'}
            </div>
          </div>
        </section>

        {toast ? (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-lime/40 bg-bg px-4 py-2 text-xs text-lime shadow-2xl z-50">
            {toast}
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
