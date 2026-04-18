'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { createClient } from '@/lib/supabase/client';
import {
  PROOFS_BUCKET,
  deleteByPublicUrl,
  uploadProof,
} from '@/lib/portfolio-upload';

type Proof = {
  id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
};

export default function ProvasSociais() {
  const [userId, setUserId] = useState<string | null>(null);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (uid: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('social_proofs')
      .select('id, image_url, caption, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (data) setProofs(data as Proof[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      await load(data.user.id);
    });
  }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || !userId) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        setStage('Enviando ' + (i + 1) + '/' + arr.length + ': ' + f.name);
        const up = await uploadProof(userId, f);
        const { error: insErr } = await supabase.from('social_proofs').insert({
          user_id: userId,
          image_url: up.publicUrl,
          caption: null,
        });
        if (insErr) throw insErr;
      }
      await load(userId);
      setStage(null);
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? 'Falha no upload.');
      setStage(null);
    } finally {
      setUploading(false);
    }
  }

  async function deleteProof(p: Proof) {
    if (!userId) return;
    if (!confirm('Excluir esta imagem?')) return;
    const supabase = createClient();
    await supabase.from('social_proofs').delete().eq('id', p.id);
    if (p.image_url) await deleteByPublicUrl(PROOFS_BUCKET, p.image_url).catch(() => null);
    await load(userId);
  }

  async function updateCaption(p: Proof, caption: string) {
    if (!userId) return;
    const supabase = createClient();
    await supabase
      .from('social_proofs')
      .update({ caption: caption.trim() || null })
      .eq('id', p.id);
    setProofs((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, caption: caption.trim() || null } : x)),
    );
  }

  return (
    <ToolShell
      title="Provas sociais"
      description="Envie prints e depoimentos. Aparecem no seu portfolio publico em layout masonry."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => inputRef.current?.click()}
            className="btn-primary"
            disabled={uploading || !userId}
          >
            {uploading ? 'Enviando...' : '+ Adicionar prints'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          <span className="text-xs text-text-muted">
            Aceita PNG e JPG. Selecione varios de uma vez.
          </span>
        </div>

        {stage ? (
          <div className="rounded-[12px] border border-line bg-bg px-4 py-3 text-xs text-text-muted">
            {stage}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        {proofs.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-line bg-bg/60 px-6 py-12 text-center text-sm text-text-muted">
            Nenhuma prova social ainda. Adicione screenshots de resultados, depoimentos, metricas...
          </div>
        ) : (
          <div className="columns-2 gap-3 md:columns-3 lg:columns-4 [column-fill:_balance]">
            {proofs.map((p) => (
              <div
                key={p.id}
                className="group mb-3 inline-block w-full overflow-hidden rounded-[12px] border border-line bg-bg"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.image_url}
                  alt={p.caption ?? 'Prova social'}
                  className="block h-auto w-full"
                  loading="lazy"
                />
                <div className="flex flex-col gap-2 p-2">
                  <input
                    type="text"
                    defaultValue={p.caption ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (p.caption ?? '')) updateCaption(p, v);
                    }}
                    placeholder="Legenda (opcional)"
                    className="w-full rounded-[6px] border border-transparent bg-bg-softer px-2 py-1 text-xs text-white placeholder:text-text-muted focus:border-lime focus:outline-none"
                  />
                  <button
                    onClick={() => deleteProof(p)}
                    className="self-end text-[10px] uppercase tracking-widest text-text-muted hover:text-red-400"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolShell>
  );
}
