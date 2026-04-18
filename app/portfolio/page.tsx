'use client';

import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { createClient } from '@/lib/supabase/client';
import { slugify } from '@/lib/utils';
import {
  VIDEO_BUCKET,
  THUMB_BUCKET,
  uploadPortfolioItem,
  deleteByPublicUrl,
} from '@/lib/portfolio-upload';

type Profile = {
  id: string;
  name: string | null;
  portfolio_slug: string | null;
  portfolio_public: boolean;
};

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
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [newCategory, setNewCategory] = useState('');
  const [activeCategory, setActiveCategory] = useState('Microleads');
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const loadItems = useCallback(async (userId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('portfolio_items')
      .select('id, title, category, niche, video_url, thumbnail_url, order, created_at')
      .eq('user_id', userId)
      .order('order', { ascending: true })
      .order('created_at', { ascending: false });
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
        .select('id, name, portfolio_slug, portfolio_public')
        .eq('id', data.user.id)
        .maybeSingle();
      if (prof) {
        setProfile(prof as Profile);
        setSlugDraft(prof.portfolio_slug ?? '');
        await Promise.all([loadItems(prof.id), loadCategories(prof.id)]);
      }
    });
  }, [loadItems, loadCategories]);

  async function saveSlug() {
    if (!profile) return;
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from('profiles')
      .update({ portfolio_slug: slugify(slugDraft) })
      .eq('id', profile.id);
    setSaving(false);
  }

  async function togglePublic(on: boolean) {
    if (!profile) return;
    const supabase = createClient();
    await supabase
      .from('profiles')
      .update({ portfolio_public: on })
      .eq('id', profile.id);
    setProfile({ ...profile, portfolio_public: on });
  }

  async function addCategory() {
    if (!profile || !newCategory.trim()) return;
    const name = newCategory.trim();
    const supabase = createClient();
    await supabase.from('portfolio_categories').insert({
      user_id: profile.id,
      name,
      type: 'custom',
    });
    setCategories((prev) => Array.from(new Set([...prev, name])));
    setActiveCategory(name);
    setNewCategory('');
  }

  async function uploadNewVideo() {
    if (!profile || !newFile) return;
    setUploadError(null);
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
      console.error(e);
      setUploadError((e as Error).message ?? 'Falha no upload.');
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

  /**
   * Reordena os items da categoria ativa: move `fromIdx` -> `toIdx` e atualiza
   * o campo `order` de TODOS os items da categoria em batch (Promise.all).
   * Faz update otimista na UI pra nao ter flash; se o Supabase falhar, recarrega.
   */
  async function reorderItems(fromIdx: number, toIdx: number) {
    if (!profile || fromIdx === toIdx) return;
    const inCat = items.filter((i) => i.category === activeCategory);
    if (fromIdx < 0 || fromIdx >= inCat.length) return;
    if (toIdx < 0 || toIdx >= inCat.length) return;

    // Aplica o move localmente
    const reordered = [...inCat];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // Update otimista: reescreve `order` com o novo indice
    const newOrderById = new Map(reordered.map((it, idx) => [it.id, idx]));
    setItems((prev) =>
      prev.map((it) =>
        it.category === activeCategory && newOrderById.has(it.id)
          ? { ...it, order: newOrderById.get(it.id)! }
          : it,
      ),
    );

    // Batch update no Supabase
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
    // Precisa setar algum data pro Firefox disparar o drag
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

  return (
    <ToolShell
      title="Seu portfolio"
      description="Gerencie videos por categoria, defina um link publico e compartilhe com clientes."
    >
      <div className="flex flex-col gap-8">
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
            <div className="flex items-center gap-3 rounded-[12px] border border-line bg-bg px-4 py-3">
              <input
                id="public-toggle"
                type="checkbox"
                checked={profile?.portfolio_public ?? false}
                onChange={(e) => togglePublic(e.target.checked)}
                className="h-4 w-4 accent-lime"
              />
              <label htmlFor="public-toggle" className="text-sm text-white">
                Portfolio publico
              </label>
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <aside className="card card-pad h-fit">
            <div className="label-field">Categorias</div>
            <nav className="flex flex-col gap-1">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCategory(c)}
                  className={
                    activeCategory === c
                      ? 'rounded-[8px] bg-lime/10 px-3 py-2 text-left text-sm font-medium text-lime'
                      : 'rounded-[8px] px-3 py-2 text-left text-sm text-text-muted hover:bg-bg-softer hover:text-white'
                  }
                >
                  {c}
                </button>
              ))}
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

            <div className="card card-pad flex flex-col gap-3">
              <div className="label-field !mb-0">Adicionar video</div>
              <FileUpload
                accept="video/mp4,video/webm,video/quicktime"
                value={newFile}
                onChange={setNewFile}
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
