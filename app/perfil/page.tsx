'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { createClient } from '@/lib/supabase/client';
import {
  AVATAR_BUCKET,
  uploadAvatar,
  deleteByPublicUrl,
} from '@/lib/portfolio-upload';

type Profile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  portfolio_cover: string;
  portfolio_show_avatar: boolean;
};

const COVER_OPTIONS: Array<{ id: string; label: string; desc: string }> = [
  { id: 'default', label: 'Padrao', desc: 'Gradiente cinza/lime suave.' },
  { id: 'matrix', label: 'Codigo', desc: 'Chuva de caracteres estilo Matrix.' },
  { id: 'dollars', label: 'Dollars', desc: 'Dinheiro caindo, vibe premium.' },
  { id: 'tech', label: 'Tech', desc: 'Grade tecnologica com nos brilhando.' },
  { id: 'minimal', label: 'Minimal', desc: 'Apenas ruido sutil.' },
];

const MAX_AVATAR_MB = 5;
const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024;

export default function EditarPerfilPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [avatarStage, setAvatarStage] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [savingCover, setSavingCover] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, portfolio_cover, portfolio_show_avatar')
        .eq('id', data.user.id)
        .maybeSingle();
      if (prof) {
        const p: Profile = {
          id: prof.id,
          name: prof.name ?? null,
          avatar_url: prof.avatar_url ?? null,
          portfolio_cover: prof.portfolio_cover ?? 'default',
          portfolio_show_avatar: prof.portfolio_show_avatar ?? true,
        };
        setProfile(p);
        setNameDraft(p.name ?? '');
      }
    });
  }, []);

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
      flashToast('Nome salvo.');
    } catch (e) {
      console.error('[perfil] saveName error:', e);
      flashToast('Erro ao salvar: ' + (e as Error).message);
    } finally {
      setSavingName(false);
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
      deleteByPublicUrl(AVATAR_BUCKET, prev).catch(() => null);
      flashToast('Foto removida.');
    } catch (e) {
      flashToast('Erro: ' + (e as Error).message);
    }
  }

  async function toggleShowAvatar(on: boolean) {
    if (!profile) return;
    setProfile({ ...profile, portfolio_show_avatar: on });
    const supabase = createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ portfolio_show_avatar: on })
      .eq('id', profile.id);
    if (error) {
      console.error('[perfil] toggleShowAvatar error:', error);
      setProfile((p) => (p ? { ...p, portfolio_show_avatar: !on } : p));
      flashToast('Erro ao salvar preferencia.');
    }
  }

  async function saveCover(id: string) {
    if (!profile) return;
    const prev = profile.portfolio_cover;
    setProfile({ ...profile, portfolio_cover: id });
    setSavingCover(id);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ portfolio_cover: id })
        .eq('id', profile.id);
      if (error) throw error;
      flashToast('Capa atualizada.');
    } catch (e) {
      console.error('[perfil] saveCover error:', e);
      setProfile((p) => (p ? { ...p, portfolio_cover: prev } : p));
      flashToast('Erro ao salvar capa: ' + (e as Error).message);
    } finally {
      setSavingCover(null);
    }
  }

  if (!profile) {
    return (
      <ToolShell title="Editar perfil" description="Carregando seu perfil...">
        <div className="py-8 text-center text-sm text-text-muted">
          Aguarde...
        </div>
      </ToolShell>
    );
  }

  const displayName = profile.name?.trim() || 'Editor';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <ToolShell
      title="Editar perfil"
      description="Altere seu nome, foto de perfil e capa do portfolio publico."
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
            Esse nome aparece no header, no dropdown e no seu portfolio publico.
          </p>
        </section>

        {/* Avatar */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Foto de perfil
          </h2>
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

          <div className="flex items-center gap-3 rounded-[10px] border border-line bg-bg px-4 py-3">
            <input
              id="show-avatar-toggle-perfil"
              type="checkbox"
              checked={profile.portfolio_show_avatar}
              onChange={(e) => toggleShowAvatar(e.target.checked)}
              className="h-4 w-4 accent-lime"
            />
            <label
              htmlFor="show-avatar-toggle-perfil"
              className="flex-1 text-sm text-white"
            >
              Mostrar minha foto de perfil no portfolio publico
            </label>
          </div>
        </section>

        {/* Capa */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Capa do portfolio
          </h2>
          <p className="text-xs text-text-muted">
            A capa aparece atras do seu nome no /p/&lt;seu-slug&gt;.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COVER_OPTIONS.map((opt) => {
              const active = profile.portfolio_cover === opt.id;
              const pending = savingCover === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => saveCover(opt.id)}
                  disabled={!!savingCover}
                  className={
                    'flex flex-col items-start gap-1 rounded-[12px] border px-4 py-3 text-left transition ' +
                    (active
                      ? 'border-lime bg-lime/10 text-lime'
                      : 'border-line bg-bg text-text-muted hover:border-lime/40 hover:text-white') +
                    (pending ? ' opacity-60' : '')
                  }
                >
                  <span className="text-sm font-semibold">
                    {pending ? 'Salvando...' : opt.label}
                  </span>
                  <span className="text-[11px] text-text-muted">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </section>

        {toast ? (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-lime/40 bg-bg px-4 py-2 text-xs text-lime shadow-2xl">
            {toast}
          </div>
        ) : null}
      </div>
    </ToolShell>
  );
}
