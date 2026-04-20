'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { createClient } from '@/lib/supabase/client';
import { slugify } from '@/lib/utils';
import {
  VIDEO_BUCKET,
  THUMB_BUCKET,
  uploadPortfolioItem,
  uploadAvatar,
  deleteByPublicUrl,
} from '@/lib/portfolio-upload';

const MAX_VIDEO_MB = 100;
const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;
const MAX_AVATAR_MB = 5;
const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024;

type Profile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
  portfolio_slug: string | null;
  whatsapp: string | null;
  portfolio_show_avatar: boolean;
  portfolio_cover: string;
};

const COVER_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'default', label: 'Padrao' },
  { id: 'matrix', label: 'Codigo' },
  { id: 'dollars', label: 'Dollars' },
  { id: 'tech', label: 'Tech' },
  { id: 'minimal', label: 'Minimal' },
];

type PortfolioItem = {
  id: string;
  title: string;
  category: string;
  niche: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  order: number;
  created_at: string;
};

const DEFAULT_CATEGORIES = ['Microleads', 'Ads'];

export default function PortfolioEditor() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [slugDraft, setSlugDraft] = useState('');
  const [whatsappDraft, setWhatsappDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingWhats, setSavingWhats] = useState(false);
  const [savingCover, setSavingCover] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [newCategory, setNewCategory] = useState('');
  const [activeCategory, setActiveCategory] = useState('Microleads');
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [avatarStage, setAvatarStage] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const loadItems = useCallback(async (userId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('id, title, category, niche, video_url, thumbnail_url, order, created_at')
      .eq('user_id', userId)
      .order('order', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[portfolio] loadItems error:', error);
      return;
    }
    if (data) setItems(data as PortfolioItem[]);
  }, []);

  const loadCategories = useCallback(async (userId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('portfolio_categories')
      .select('name')
      .eq('user_id', userId);
    const names = (data ?? []).map((c: { name: string }) => c.name);
    const merged = Array.from(new Set([...DEFAULT_CATEGORIES, ...names]));
    setCategories(merged);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: prof } = await supabase
        .from('profiles')
        .select(
          'id, name, avatar_url, portfolio_slug, whatsapp, portfolio_show_avatar, portfolio_cover',
        )
        .eq('id', data.user.id)
        .maybeSingle();
      if (prof) {
        setProfile({
          ...(prof as Profile),
          portfolio_show_avatar: prof.portfolio_show_avatar ?? true,
          portfolio_cover: prof.portfolio_cover ?? 'default',
        });
        setSlugDraft(prof.portfolio_slug ?? '');
        setWhatsappDraft(prof.whatsapp ?? '');
        await Promise.all([loadItems(prof.id), loadCategories(prof.id)]);
      }
    });
  }, [loadItems, loadCategories]);

  async function saveSlug() {
    if (!profile) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ portfolio_slug: slugify(slugDraft) })
      .eq('id', profile.id);
    if (error) console.error('[portfolio] saveSlug error:', error);
    else setProfile({ ...profile, portfolio_slug: slugify(slugDraft) });
    setSaving(false);
  }

  async function toggleShowAvatar(on: boolean) {
    if (!profile) return;
    // Update otimista pra feedback imediato
    setProfile({ ...profile, portfolio_show_avatar: on });
    const supabase = createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ portfolio_show_avatar: on })
      .eq('id', profile.id);
    if (error) {
      console.error('[portfolio] toggleShowAvatar error:', error);
      // reverte
      setProfile((p) => (p ? { ...p, portfolio_show_avatar: !on } : p));
    }
  }

  async function saveCover(id: string) {
    if (!profile) return;
    // Update otimista pra UI responder clique de imediato
    const prev = profile.portfolio_cover;
    setProfile({ ...profile, portfolio_cover: id });
    setSavingCover(id);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ portfolio_cover: id })
        .eq('id', profile.id);
      if (error) {
        console.error('[portfolio] saveCover error:', error);
        // reverte
        setProfile((p) => (p ? { ...p, portfolio_cover: prev } : p));
        alert('Nao foi possivel salvar a capa: ' + error.message);
      }
    } finally {
      setSavingCover(null);
    }
  }

  async function saveWhatsapp() {
    if (!profile) return;
    setSavingWhats(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ whatsapp: whatsappDraft.trim() || null })
      .eq('id', profile.id);
    if (error) console.error('[portfolio] saveWhatsapp error:', error);
    else setProfile({ ...profile, whatsapp: whatsappDraft.trim() || null });
    setSavingWhats(false);
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
    setAvatarStage('Enviando...');
    try {
      const prevUrl = profile.avatar_url;
      const { publicUrl } = await uploadAvatar(profile.id, file);
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, avatar_url: publicUrl });
      setAvatarStage(null);
      if (prevUrl && !prevUrl.startsWith('data:')) {
        deleteByPublicUrl('avatars', prevUrl).catch(() => null);
      }
    } catch (e) {
      console.error('[portfolio] avatar upload error:', e);
      setAvatarError((e as Error).message ?? 'Falha ao enviar imagem.');
      setAvatarStage(null);
    }
  }

  async function addCategory() {
    if (!profile || !newCategory.trim()) return;
    const name = newCategory.trim();
    const supabase = createClient();
    const { error } = await supabase.from('portfolio_categories').insert({
      user_id: profile.id,
      name,
      type: 'custom',
    });
    if (error) {
      console.error('[portfolio] addCategory error:', error);
      alert('Nao foi possivel adicionar categoria: ' + error.message);
      return;
    }
    setCategories((prev) => Array.from(new Set([...prev, name])));
    setActiveCategory(name);
    setNewCategory('');
  }

  /**
   * Remove uma categoria. Agora TODAS podem ser excluidas (inclusive as
   * defaults Microleads/Ads). Se a categoria excluida e uma default,
   * simplesmente escondemos do sidebar (a gente remove do state), ja que
   * nao existe row correspondente em portfolio_categories pra elas.
   * Videos da categoria tambem sao removidos junto.
   */
  async function deleteCategory(name: string) {
    if (!profile) return;
    const inCatCount = items.filter((i) => i.category === name).length;
    const msg =
      inCatCount > 0
        ? 'A categoria "' + name + '" tem ' + inCatCount +
            ' video(s). Excluir assim mesmo? Os videos serao removidos.'
        : 'Excluir a categoria "' + name + '"?';
    if (!confirm(msg)) return;

    const supabase = createClient();
    const victims = items.filter((i) => i.category === name);
    for (const v of victims) {
      await supabase.from('portfolio_items').delete().eq('id', v.id);
      if (v.video_url) await deleteByPublicUrl(VIDEO_BUCKET, v.video_url).catch(() => null);
      if (v.thumbnail_url)
        await deleteByPublicUrl(THUMB_BUCKET, v.thumbnail_url).catch(() => null);
    }
    // Remove registro da categoria (so existe pra custom, mas e noop pras defaults)
    await supabase
      .from('portfolio_categories')
      .delete()
      .eq('user_id', profile.id)
      .eq('name', name);

    setCategories((prev) => prev.filter((c) => c !== name));
    if (activeCategory === name) {
      const remaining = categories.filter((c) => c !== name);
      setActiveCategory(remaining[0] ?? 'Microleads');
    }
    await loadItems(profile.id);
  }

  async function uploadNewVideo() {
    if (!profile) {
      setUploadError('Perfil ainda carregando. Aguarde e tente novamente.');
      return;
    }
    if (!newFile) {
      setUploadError('Selecione um arquivo de video primeiro.');
      return;
    }
    setUploadError(null);
    if (newFile.size > MAX_VIDEO_BYTES) {
      setUploadError(
        'Arquivo muito grande: ' + (newFile.size / (1024 * 1024)).toFixed(1) +
          'MB. O limite por video e ' + MAX_VIDEO_MB + 'MB.',
      );
      return;
    }
    setUploadStage('Iniciando...');
    try {
      await uploadPortfolioItem({
        userId: profile.id,
        file: newFile,
        title: newTitle.trim() || newFile.name.replace(/\.[^.]+$/, ''),
        category: activeCategory,
        order: items.filter((i) => i.category === activeCategory).length,
        onProgress: (s) => setUploadStage(s),
      });
      await loadItems(profile.id);
      setNewFile(null);
      setNewTitle('');
      setUploadStage(null);
    } catch (e) {
      console.error('[portfolio] uploadNewVideo error:', e);
      const msg = (e as Error).message ?? 'Falha no upload.';
      setUploadError(
        msg +
          ' — Verifique se voce rodou as migrations SQL no Supabase e se os buckets de Storage existem.',
      );
      setUploadStage(null);
    }
  }

  async function deleteItem(item: PortfolioItem) {
    if (!profile) return;
    if (!confirm('Excluir "' + item.title + '"? Isso nao pode ser desfeito.')) return;
    const supabase = createClient();
    await supabase.from('portfolio_items').delete().eq('id', item.id);
    if (item.video_url) await deleteByPublicUrl(VIDEO_BUCKET, item.video_url).catch(() => null);
    if (item.thumbnail_url) await deleteByPublicUrl(THUMB_BUCKET, item.thumbnail_url).catch(() => null);
    await loadItems(profile.id);
  }

  async function reorderItems(fromIdx: number, toIdx: number) {
    if (!profile || fromIdx === toIdx) return;
    const inCat = items.filter((i) => i.category === activeCategory);
    if (fromIdx < 0 || fromIdx >= inCat.length) return;
    if (toIdx < 0 || toIdx >= inCat.length) return;

    const reordered = [...inCat];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    const newOrderById = new Map(reordered.map((it, idx) => [it.id, idx]));
    setItems((prev) =>
      prev.map((it) =>
        it.category === activeCategory && newOrderById.has(it.id)
          ? { ...it, order: newOrderById.get(it.id)! }
          : it,
      ),
    );

    const supabase = createClient();
    try {
      await Promise.all(
        reordered.map((it, idx) =>
          supabase.from('portfolio_items').update({ order: idx }).eq('id', it.id),
        ),
      );
    } catch (e) {
      console.error('[portfolio] reorder falhou, recarregando:', e);
    }
    await loadItems(profile.id);
  }

  function handleDragStart(e: DragEvent<HTMLLIElement>, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragOverId) setDragOverId(id);
  }

  function handleDragLeave(id: string) {
    if (id === dragOverId) setDragOverId(null);
  }

  function handleDrop(e: DragEvent<HTMLLIElement>, targetId: string) {
    e.preventDefault();
    const sourceId = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const inCat = items.filter((i) => i.category === activeCategory);
    const fromIdx = inCat.findIndex((i) => i.id === sourceId);
    const toIdx = inCat.findIndex((i) => i.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    reorderItems(fromIdx, toIdx);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  const publicUrl =
    typeof window !== 'undefined' && profile?.portfolio_slug
      ? window.location.origin + '/p/' + profile.portfolio_slug
      : null;

  const visibleItems = items.filter((i) => i.category === activeCategory);
  const displayName = profile?.name?.trim() || 'Editor';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <ToolShell
      title="Seu portfolio"
      description="Gerencie videos por categoria, defina um link publico e compartilhe com clientes."
    >
      <div className="flex flex-col gap-8">
        <div>
          <Link
            href="/tools"
            className="group inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-text-muted transition hover:text-lime"
          >
            <svg
              className="h-4 w-4 -translate-x-0 transition-transform duration-300 group-hover:-translate-x-1"
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

        {/* Avatar + nome */}
        <div className="card-3d card-pad flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={profile.avatar_url}
                alt=""
                className="h-20 w-20 rounded-full border border-line object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full border border-line bg-bg text-2xl font-bold text-lime">
                {initial}
              </span>
            )}
            <div className="flex flex-col gap-1">
              <div className="text-sm font-semibold text-white">{displayName}</div>
              <div className="text-xs text-text-muted">
                Foto de perfil exibida no header e no portfolio publico.
              </div>
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
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary !py-1.5 !px-3 text-xs"
                onClick={() => avatarInputRef.current?.click()}
                disabled={!!avatarStage}
              >
                {avatarStage ?? 'Enviar foto do PC'}
              </button>
              <Link
                href="/perfil"
                className="btn-ghost !py-1.5 !px-3 text-xs"
              >
                Editar perfil
              </Link>
            </div>
            {avatarError ? (
              <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
                {avatarError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label-field">Slug publico</label>
            <div className="flex gap-2">
              <input
                className="input-field"
                value={slugDraft}
                onChange={(e) => setSlugDraft(e.target.value)}
                placeholder="seu-nome"
              />
              <button onClick={saveSlug} className="btn-secondary" disabled={saving}>
                {saving ? '...' : 'Salvar'}
              </button>
            </div>
            {publicUrl ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <span className="mono truncate">{publicUrl}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(publicUrl)}
                  className="btn-ghost !py-1 !px-2 text-xs"
                >
                  Copiar
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost !py-1 !px-2 text-xs"
                >
                  Abrir
                </a>
              </div>
            ) : null}
          </div>

          <div>
            <label className="label-field">Visibilidade</label>
            <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-bg px-4 py-3">
              <div className="flex items-center gap-3">
                <input
                  id="show-avatar-toggle"
                  type="checkbox"
                  checked={profile?.portfolio_show_avatar ?? true}
                  onChange={(e) => toggleShowAvatar(e.target.checked)}
                  className="h-4 w-4 accent-lime"
                />
                <label htmlFor="show-avatar-toggle" className="text-sm text-white">
                  Mostrar minha foto de perfil pro cliente
                </label>
              </div>
              <p className="text-[11px] text-text-muted">
                Seu portfolio e sempre publico. Voce controla apenas se sua foto
                aparece pros clientes.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label-field">WhatsApp (botao flutuante)</label>
            <div className="flex gap-2">
              <input
                className="input-field"
                value={whatsappDraft}
                onChange={(e) => setWhatsappDraft(e.target.value)}
                placeholder="+5511999998888"
              />
              <button
                onClick={saveWhatsapp}
                className="btn-secondary"
                disabled={savingWhats}
              >
                {savingWhats ? '...' : 'Salvar'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Formato internacional com DDI. Deixe vazio para esconder o botao.
            </p>
          </div>

          <div>
            <label className="label-field">Capa do portfolio</label>
            <div className="flex flex-wrap gap-2">
              {COVER_OPTIONS.map((opt) => {
                const active = (profile?.portfolio_cover ?? 'default') === opt.id;
                const pending = savingCover === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => saveCover(opt.id)}
                    disabled={!!savingCover}
                    className={
                      'rounded-full border px-3 py-1.5 text-xs transition ' +
                      (active
                        ? 'border-lime bg-lime/10 text-lime'
                        : 'border-line bg-bg text-text-muted hover:border-lime/40 hover:text-white') +
                      (pending ? ' opacity-60' : '')
                    }
                  >
                    {pending ? '...' : opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Clique pra trocar. A mudanca e salva automaticamente.
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <aside className="card-3d card-pad h-fit">
            <div className="label-field">Categorias</div>
            <nav className="flex flex-col gap-1">
              {categories.map((c) => {
                const isActive = activeCategory === c;
                return (
                  <div
                    key={c}
                    className={
                      'group flex items-center gap-1 rounded-[8px] ' +
                      (isActive ? 'bg-lime/10' : 'hover:bg-bg-softer')
                    }
                  >
                    <button
                      onClick={() => setActiveCategory(c)}
                      className={
                        isActive
                          ? 'flex-1 px-3 py-2 text-left text-sm font-medium text-lime'
                          : 'flex-1 px-3 py-2 text-left text-sm text-text-muted hover:text-white'
                      }
                    >
                      {c}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCategory(c);
                      }}
                      className="mr-1 rounded p-1 text-text-dim transition hover:bg-red-500/10 hover:text-red-400 opacity-60 group-hover:opacity-100"
                      aria-label={`Excluir categoria ${c}`}
                      title="Excluir categoria"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M2.5 3h7l-.5 7a1 1 0 01-1 1h-4a1 1 0 01-1-1L2.5 3zm2-1.5A.5.5 0 015 1h2a.5.5 0 01.5.5V2h3a.5.5 0 010 1h-9a.5.5 0 010-1h3v-.5z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              <input
                className="input-field !py-2 text-xs"
                placeholder="Nova categoria"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <button
                onClick={addCategory}
                className="btn-ghost justify-start !px-3 text-xs"
                disabled={!newCategory.trim()}
              >
                + Adicionar
              </button>
            </div>
          </aside>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{activeCategory}</h2>
              <span className="text-xs text-text-muted">
                {visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="card-3d card-pad flex flex-col gap-3">
              <div className="label-field !mb-0">Adicionar video</div>
              <FileUpload
                accept="video/mp4,video/webm,video/quicktime"
                value={newFile}
                onChange={(f) => {
                  setNewFile(f);
                  setUploadError(null);
                }}
                hint="MP4, WEBM ou MOV"
              />
              <input
                className="input-field"
                placeholder="Titulo (opcional)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={uploadNewVideo}
                  className="btn-primary !py-2 text-xs"
                  disabled={!newFile || !!uploadStage}
                >
                  {uploadStage ? 'Enviando...' : 'Enviar'}
                </button>
                {newFile ? (
                  <button
                    onClick={() => {
                      setNewFile(null);
                      setNewTitle('');
                      setUploadError(null);
                    }}
                    className="btn-ghost !py-2 text-xs"
                    disabled={!!uploadStage}
                  >
                    Cancelar
                  </button>
                ) : null}
              </div>
              {uploadStage ? (
                <div className="rounded-[8px] border border-line bg-bg px-3 py-2 text-xs text-text-muted">
                  {uploadStage}
                </div>
              ) : null}
              {uploadError ? (
                <div className="rounded-[8px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {uploadError}
                </div>
              ) : null}
            </div>

            {visibleItems.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-line bg-bg/60 px-6 py-10 text-center text-sm text-text-muted">
                Nenhum video nesta categoria ainda.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleItems.map((item) => {
                  const isDragging = draggingId === item.id;
                  const isDragOver = dragOverId === item.id && draggingId !== item.id;
                  return (
                    <li
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onDragOver={(e) => handleDragOver(e, item.id)}
                      onDragLeave={() => handleDragLeave(item.id)}
                      onDrop={(e) => handleDrop(e, item.id)}
                      onDragEnd={handleDragEnd}
                      className={
                        'group flex cursor-grab items-center gap-3 rounded-[12px] border p-3 transition active:cursor-grabbing ' +
                        (isDragging
                          ? 'border-lime/40 bg-bg opacity-40'
                          : isDragOver
                            ? 'border-lime bg-lime/5'
                            : 'border-line bg-bg hover:border-line/80')
                      }
                    >
                      <div
                        className="select-none text-text-dim transition group-hover:text-text-muted"
                        title="Arraste para reordenar"
                        aria-hidden
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                          <circle cx="4" cy="3" r="1" />
                          <circle cx="4" cy="7" r="1" />
                          <circle cx="4" cy="11" r="1" />
                          <circle cx="10" cy="3" r="1" />
                          <circle cx="10" cy="7" r="1" />
                          <circle cx="10" cy="11" r="1" />
                        </svg>
                      </div>
                      <div className="h-16 w-28 shrink-0 overflow-hidden rounded-[8px] bg-line">
                        {item.thumbnail_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={item.thumbnail_url}
                            alt={item.title}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-white">{item.title}</div>
                        <div className="mono text-xs text-text-muted">
                          {item.category}
                          {item.niche ? ' | ' + item.niche : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {item.video_url ? (
                          <a
                            href={item.video_url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-ghost !py-1 !px-2 text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Ver
                          </a>
                        ) : null}
                        <button
                          onClick={() => deleteItem(item)}
                          className="btn-ghost !py-1 !px-2 text-xs text-red-300 hover:text-red-400"
                        >
                          Excluir
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </ToolShell>
  );
}
