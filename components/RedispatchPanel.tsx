'use client';

import React, { useMemo, useState } from 'react';
import { CompactAvatarPicker } from './CompactAvatarPicker';
import { CompactVoiceSelector } from './CompactVoiceSelector';
import type { AvatarOption } from './HeyGenAvatarPicker';

/**
 * RedispatchPanel — a ANÁLISE daquele disparo, reaberta DENTRO do card da
 * task pra reorganizar e reiniciar do zero.
 *
 * De onde vem o conteúdo: do `replan` do batch — o plano serializável que é
 * gravado no ATO do disparo e persiste no localStorage. Por isso o painel
 * abre igual depois de fechar a análise, de trocar de aba ou de dar F5: ele
 * mostra o que REALMENTE foi disparado (avatar, voz, motor, gesto e texto de
 * cada take), não o que a análise em memória diria agora.
 *
 * O que ele NÃO é: a fila. Aqui não existe START — o botão é REINICIAR, ele
 * vale só pra ESTA task e re-dispara este mesmo disparo com as trocas que
 * você fizer (outra voz, outro avatar, outro texto).
 */

export type RedispatchPart = {
  label: string;
  text: string;
  avatarId: string | null;
  /** Nome/thumb do avatar gravados no disparo — é o que aparece quando a
   *  biblioteca do HeyGen ainda não carregou (ou o look sumiu de lá). */
  avatarName?: string | null;
  avatarThumb?: string | null;
  voiceId: string | null;
  voiceName?: string | null;
  motionPrompt?: string | null;
  engine?: 'III' | 'IV' | 'V';
  /** Cena em MODO IMAGEM: a imagem faz o papel do avatar (não tem avatarId).
   *  A chave dos bytes no IndexedDB tem que viajar intacta pro re-disparo. */
  imageKey?: string | null;
};

type Motor = 'auto' | 'III' | 'IV' | 'V';

/** Motor que o take vai usar de fato: o III DESCARTA gesto, então cena com
 *  movimento sobe pro IV sozinha (mesma regra do runner e do EditPartModal). */
function motorDeSaida(engine: Motor, motion: string | null | undefined): 'III' | 'IV' | 'V' {
  const temGesto = !!(motion || '').trim();
  if (engine !== 'auto') return engine === 'III' && temGesto ? 'IV' : engine;
  return temGesto ? 'IV' : 'III';
}

function mesmaParte(a: RedispatchPart, b: RedispatchPart): boolean {
  return (
    a.text.trim() === b.text.trim() &&
    (a.avatarId || null) === (b.avatarId || null) &&
    (a.voiceId || null) === (b.voiceId || null) &&
    (a.engine || null) === (b.engine || null) &&
    (a.motionPrompt || '').trim() === (b.motionPrompt || '').trim()
  );
}

export function RedispatchPanel({
  taskName,
  adName,
  partesOriginais,
  resolverAvatar,
  bibliotecaCarregando = false,
  busy = false,
  onCancel,
  onReiniciar,
}: {
  taskName: string;
  adName: string;
  /** O plano EXATO do disparo (replan). Fonte da verdade do painel. */
  partesOriginais: RedispatchPart[];
  /** Resolve um avatarId na biblioteca do HeyGen (nome/thumb/versão). */
  resolverAvatar: (id: string | null | undefined) => AvatarOption | null;
  bibliotecaCarregando?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onReiniciar: (partes: RedispatchPart[]) => void;
}) {
  const [draft, setDraft] = useState<RedispatchPart[]>(() =>
    partesOriginais.map((p) => ({ ...p })),
  );
  const [abertos, setAbertos] = useState<Record<number, boolean>>({});
  // O que foi aplicado "em todos" — só pra tela mostrar a escolha em vez de
  // voltar pro estado vazio (e pra reaparecer o "voltar pra voz padrão").
  const [avatarGlobal, setAvatarGlobal] = useState<AvatarOption | null>(null);
  const [vozGlobal, setVozGlobal] = useState<{ id: string; name: string } | null>(null);

  const patch = (idx: number, campos: Partial<RedispatchPart>) =>
    setDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, ...campos } : p)));

  /** Avatar de exibição: biblioteca primeiro; se ela não tem (ainda não
   *  carregou, ou o look foi apagado lá), monta um a partir do que o disparo
   *  gravou — o painel NUNCA aparece "sem avatar" pra um take que tinha um. */
  const avatarDaParte = (p: RedispatchPart): AvatarOption | null => {
    if (!p.avatarId) return null;
    const daBiblioteca = resolverAvatar(p.avatarId);
    if (daBiblioteca) return daBiblioteca;
    return {
      id: p.avatarId,
      name: p.avatarName || 'avatar deste disparo',
      thumb: p.avatarThumb || null,
      videoPreview: null,
      type: 'avatar',
      version: 'III',
    } as AvatarOption;
  };

  /** Troca o avatar de UM take. Quando o look novo tem voz própria e o take
   *  estava herdando a voz do look ANTIGO, a voz acompanha — senão o avatar
   *  novo sairia falando com a voz do antigo (o erro clássico de trocar só o
   *  rosto). Voz escolhida na mão, com nome, é preservada. */
  const trocarAvatar = (idx: number, novo: AvatarOption | null) => {
    const atual = draft[idx];
    const vozHerdada = !atual.voiceName; // sem nome = veio do look, não foi escolhida
    const vozDoNovo = (novo as any)?.voiceId as string | null | undefined;
    patch(idx, {
      avatarId: novo?.id || null,
      avatarName: novo?.name || null,
      avatarThumb: novo?.thumb || null,
      ...(novo && vozHerdada && vozDoNovo
        ? { voiceId: vozDoNovo, voiceName: (novo as any)?.voiceName || null }
        : {}),
    });
  };

  const aplicarAvatarEmTodos = (novo: AvatarOption | null) => {
    if (!novo) return;
    setAvatarGlobal(novo);
    setDraft((prev) =>
      prev.map((p) => {
        if (p.imageKey && !p.avatarId) return p; // cena por imagem não tem avatar
        const vozHerdada = !p.voiceName;
        const vozDoNovo = (novo as any)?.voiceId as string | null | undefined;
        return {
          ...p,
          avatarId: novo.id,
          avatarName: novo.name || null,
          avatarThumb: novo.thumb || null,
          ...(vozHerdada && vozDoNovo
            ? { voiceId: vozDoNovo, voiceName: (novo as any)?.voiceName || null }
            : {}),
        };
      }),
    );
  };

  const aplicarVozEmTodos = (v: { id: string; name: string } | null) => {
    setVozGlobal(v);
    setDraft((prev) =>
      prev.map((p) => ({ ...p, voiceId: v?.id || null, voiceName: v?.name || null })),
    );
  };

  const alteradas = useMemo(
    () => draft.filter((p, i) => !partesOriginais[i] || !mesmaParte(p, partesOriginais[i])).length,
    [draft, partesOriginais],
  );
  const mudou = alteradas > 0 || draft.length !== partesOriginais.length;

  /** Impedimentos REAIS de disparo — os mesmos que o runner checa. */
  const problemas = useMemo(() => {
    const out: string[] = [];
    draft.forEach((p) => {
      const temImagem = !!p.imageKey;
      if (!p.avatarId && !temImagem) out.push(`${p.label}: sem avatar`);
      if (temImagem && !p.avatarId && !p.voiceId) out.push(`${p.label}: cena por imagem exige voz`);
      if (!p.text.trim()) out.push(`${p.label}: texto vazio`);
    });
    return out;
  }, [draft]);

  const podeReiniciar = problemas.length === 0 && draft.length > 0 && !busy;

  return (
    <div className="rounded-[14px] border border-violet-400/45 bg-gradient-to-br from-violet-500/[0.10] via-violet-500/[0.04] to-transparent p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_40px_-20px_rgba(167,139,250,0.55)]">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="label-tech flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-violet-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-300" />
            </span>
            Reiniciar disparo · reorganize antes
          </div>
          <div className="mono mt-1 truncate text-[12px] font-bold text-white" title={taskName}>
            {taskName}
            <span className="ml-2 text-[10px] font-normal text-text-muted">{adName}</span>
          </div>
        </div>
        <span
          className="label-tech shrink-0 rounded-full border border-violet-400/45 bg-violet-500/10 px-2.5 py-1 text-[8.5px] uppercase tracking-widest text-violet-200"
          title="Não vai pra fila do START — este botão re-dispara só esta task."
        >
          fora da fila · só esta task
        </span>
      </div>

      {/* ── O que vai acontecer ── */}
      <p className="mt-2 text-[10.5px] leading-snug text-text-muted">
        É o mesmo disparo de antes, aberto do jeito que ele saiu.{' '}
        <span className="text-violet-200">Troque o avatar, a voz, o motor ou o texto</span> do que
        quiser e clique REINICIAR — os {draft.length} take{draft.length === 1 ? '' : 's'} são gerados
        de novo no HeyGen e a montagem antiga é substituída.
      </p>
      {bibliotecaCarregando ? (
        <div className="mono mt-1.5 text-[10px] text-cyan-200">Carregando a biblioteca de avatares…</div>
      ) : null}

      {/* ── Atalhos: aplicar em TODOS os takes ── */}
      <div className="mt-3 grid gap-2.5 rounded-[12px] border border-white/10 bg-black/20 p-2.5 sm:grid-cols-2">
        <div>
          <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-violet-200">
            Avatar em todos os takes
          </div>
          <CompactAvatarPicker
            selected={avatarGlobal}
            setSelected={aplicarAvatarEmTodos}
            disabled={busy}
            label="Avatar pra todos os takes"
          />
        </div>
        <div>
          <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-violet-200">
            Voz em todos os takes
          </div>
          <CompactVoiceSelector selected={vozGlobal} setSelected={aplicarVozEmTodos} />
        </div>
      </div>

      {/* ── Take a take ──
       *  Rola por dentro: um AD de 20 takes empurraria o botão REINICIAR pra
       *  fora da tela, e ele tem que ficar sempre à mão. */}
      <ul className="mt-3 grid max-h-[52vh] gap-2 overflow-y-auto pr-1">
        {draft.map((p, idx) => {
          const original = partesOriginais[idx];
          const alterada = original ? !mesmaParte(p, original) : true;
          const aberto = !!abertos[idx];
          const motor: Motor = (p.engine as Motor) || 'auto';
          const saida = motorDeSaida(motor, p.motionPrompt);
          const modoImagem = !!p.imageKey && !p.avatarId;
          const av = avatarDaParte(p);
          return (
            <li
              key={`${p.label}-${idx}`}
              className={`rounded-[12px] border p-2.5 transition-colors ${
                alterada
                  ? 'border-violet-400/55 bg-violet-500/[0.07]'
                  : 'border-white/10 bg-black/20'
              }`}
            >
              {/* Linha 1 — label + motor + ações */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono rounded-md border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white">
                  {p.label}
                </span>
                {modoImagem ? (
                  <span className="label-tech rounded-full border border-fuchsia-400/45 bg-fuchsia-500/10 px-2 py-0.5 text-[8.5px] uppercase tracking-widest text-fuchsia-200">
                    cena por imagem
                  </span>
                ) : null}
                {alterada ? (
                  <span className="label-tech rounded-full border border-violet-400/50 bg-violet-500/15 px-2 py-0.5 text-[8.5px] uppercase tracking-widest text-violet-100">
                    alterado
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  {(['auto', 'III', 'IV', 'V'] as const).map((op) => {
                    const sel = motor === op;
                    return (
                      <button
                        key={op}
                        type="button"
                        disabled={busy}
                        onClick={() => patch(idx, { engine: op === 'auto' ? undefined : op })}
                        title={op === 'auto' ? 'auto: III, ou IV quando tem gesto' : `Avatar ${op}`}
                        className={`label-tech rounded-full border px-2 py-0.5 text-[8.5px] uppercase tracking-widest transition-colors disabled:opacity-40 ${
                          sel
                            ? 'border-violet-400/70 bg-violet-500/20 text-violet-100'
                            : 'border-white/15 text-text-muted hover:border-white/35 hover:text-white'
                        }`}
                      >
                        {op === 'auto' ? `auto·${saida}` : op}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setAbertos((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                    className="label-tech rounded-full border border-white/15 px-2 py-0.5 text-[8.5px] uppercase tracking-widest text-text-muted transition-colors hover:border-violet-400/60 hover:text-violet-100"
                    title={aberto ? 'Fechar texto e gesto' : 'Editar texto e gesto deste take'}
                  >
                    {aberto ? 'fechar' : 'texto · gesto'}
                  </button>
                </div>
              </div>

              {/* Linha 2 — avatar + voz */}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                    Avatar
                  </div>
                  {modoImagem ? (
                    <div className="mono rounded-[10px] border border-fuchsia-400/35 bg-fuchsia-500/[0.07] px-2.5 py-2 text-[10.5px] text-fuchsia-100">
                      O frame desta cena faz o papel do avatar — ele é preservado no reinício.
                    </div>
                  ) : (
                    <CompactAvatarPicker
                      selected={av}
                      setSelected={(novo) => trocarAvatar(idx, novo)}
                      disabled={busy}
                      label={`Avatar do take ${p.label}`}
                    />
                  )}
                </div>
                <div>
                  <div className="label-tech mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-text-muted">
                    Voz
                    <span className="ml-auto normal-case tracking-normal text-text-muted/70">
                      {p.voiceName ? p.voiceName : p.voiceId ? 'voz do disparo' : 'voz padrão do avatar'}
                    </span>
                  </div>
                  <CompactVoiceSelector
                    selected={p.voiceId ? { id: p.voiceId, name: p.voiceName || 'voz do disparo' } : null}
                    setSelected={(v) => patch(idx, { voiceId: v?.id || null, voiceName: v?.name || null })}
                  />
                </div>
              </div>

              {/* Prévia do texto (fechado) */}
              {!aberto ? (
                <p className="mono mt-2 line-clamp-2 text-[10.5px] leading-snug text-text-muted">
                  {p.text.trim() || <span className="text-rose-300">— sem texto —</span>}
                </p>
              ) : (
                <div className="mt-2 grid gap-2">
                  <div>
                    <div className="label-tech mb-1 flex items-center justify-between text-[9px] uppercase tracking-widest text-text-muted">
                      <span>Texto deste take</span>
                      <span className="text-text-muted/60">{p.text.length} chars</span>
                    </div>
                    <textarea
                      value={p.text}
                      onChange={(e) => patch(idx, { text: e.target.value })}
                      disabled={busy}
                      rows={4}
                      className="mono w-full resize-y rounded-[10px] border border-white/12 bg-bg-soft/60 px-3 py-2 text-[11.5px] leading-relaxed text-white outline-none transition-colors placeholder:text-text-muted/50 hover:border-white/25 focus:border-violet-400/60 disabled:opacity-50"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div>
                    <div className="label-tech mb-1 text-[9px] uppercase tracking-widest text-text-muted">
                      Apply Custom Motion (gesto)
                    </div>
                    <input
                      type="text"
                      value={p.motionPrompt || ''}
                      onChange={(e) => patch(idx, { motionPrompt: e.target.value || null })}
                      disabled={busy}
                      placeholder="ex: cobrir o peito com uma das maos no comeco e falar"
                      className="mono w-full rounded-[8px] border border-white/12 bg-bg/60 px-3 py-2 text-[11px] text-white outline-none transition-colors placeholder:text-text-muted/50 hover:border-white/25 focus:border-violet-400/60 disabled:opacity-50"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <div className="mono mt-1 text-[9px] leading-snug text-text-muted/80">
                      Com gesto o take sai no Avatar {saida} — o III descarta movimento.
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ── Pendências ── */}
      {problemas.length > 0 ? (
        <div className="mono mt-3 rounded-[10px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[10.5px] leading-snug text-rose-200">
          Resolva antes de reiniciar: {problemas.join(' · ')}
        </div>
      ) : null}

      {/* ── Rodapé: REINICIAR (roxo) — nunca START ── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <span className="mono text-[10px] text-text-muted">
          {mudou ? (
            <span className="text-violet-200">
              {alteradas} take{alteradas === 1 ? '' : 's'} alterado{alteradas === 1 ? '' : 's'}
            </span>
          ) : (
            'nada alterado — reinicia igual ao disparo anterior'
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {mudou ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(partesOriginais.map((p) => ({ ...p })))}
              className="label-tech rounded-full border border-white/15 px-3 py-2 text-[10px] uppercase tracking-widest text-text-muted transition-colors hover:border-white/35 hover:text-white disabled:opacity-40"
              title="Volta tudo pro que foi disparado"
            >
              Desfazer
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="label-tech rounded-full border border-white/15 px-4 py-2 text-[10px] uppercase tracking-widest text-text-muted transition-colors hover:border-white/35 hover:text-white disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!podeReiniciar}
            onClick={() => onReiniciar(draft)}
            title={
              problemas.length > 0
                ? 'Tem take sem avatar/voz/texto — resolva acima'
                : 'Re-dispara ESTA task do zero com o plano acima'
            }
            /* `btn-primary` = o roxo oficial do site (o mesmo gradiente do
               "Iniciar tasks"), e é a única pílula que mantém texto branco no
               modo claro. Aqui ele NÃO é o start da fila: é o REINICIAR desta
               task. */
            className="btn-primary label-tech !px-5 !py-2 !text-[10.5px] font-extrabold uppercase tracking-[0.16em]"
          >
            {busy ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="animate-spin" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
              </svg>
            )}
            Reiniciar ({draft.length})
          </button>
        </div>
      </div>
    </div>
  );
}
