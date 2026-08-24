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
 *
 * Desenho: mesma linguagem dos painéis premium do estúdio — copy mínima,
 * ícones SVG (zero emoji), rótulos em .label-tech, números em --font-mono,
 * relevo por luz (inset highlight + glow tinted) e movimento contido: entrada
 * em cascata, lift de 1px no hover, shimmer só no CTA. Ver
 * [[feedback_autobroll_paineis_premium]] e [[project_premium_typography]].
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

// ───────────────────────────── ícones ─────────────────────────────

function IconRestart({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
      <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
    </svg>
  );
}
function IconUser({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
    </svg>
  );
}
function IconMic({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
    </svg>
  );
}
function IconBolt({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4.1 12.97a1 1 0 0 0 .77 1.63H11l-1 7.4 8.9-10.97a1 1 0 0 0-.77-1.63H12l1-7.4z" />
    </svg>
  );
}
function IconFrame({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="9.5" cy="9" r="1.6" />
      <path d="m5 18 4.5-5 3.5 3.5L16 14l3 4" />
    </svg>
  );
}
function IconPen({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function IconUndo({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}

/** Rótulo de bloco com régua que some — o primitivo dos painéis premium. */
function BlocoLabel({ icon, children, aside }: { icon?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="label-tech inline-flex items-center gap-1.5 whitespace-nowrap text-[9px] uppercase tracking-[0.18em] text-text-muted">
        {icon}
        {children}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-white/12 to-transparent dark:from-white/12" />
      {aside}
    </div>
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
    <div className="rdp-root relative overflow-hidden rounded-[16px] border border-violet-400/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_20px_50px_-26px_rgba(139,92,246,0.65)]">
      {/* Aurora de fundo — luz, não cor chapada. */}
      <span aria-hidden className="rdp-aurora pointer-events-none absolute inset-0" />
      {/* Fio de luz no topo do painel */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-300/70 to-transparent" />

      <div className="relative">
        {/* ───────────────────────── Header ───────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          {/* Tile do ícone */}
          <span className="rdp-tile dark-island relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-violet-400/50 text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_18px_-8px_rgba(139,92,246,0.8)]">
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[12px] bg-gradient-to-b from-white/20 to-transparent" />
            <span className="relative"><IconRestart size={17} /></span>
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4
                className="truncate text-[14px] font-extrabold leading-none tracking-tight text-white"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
              >
                Reiniciar disparo
              </h4>
              <span className="rdp-chip label-tech inline-flex items-center gap-1.5 rounded-full border border-violet-400/45 px-2 py-[3px] text-[8.5px] uppercase tracking-[0.16em] text-violet-100">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-300" />
                </span>
                fora da fila
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="truncate text-[11.5px] font-semibold text-white/90" title={taskName}>
                {taskName}
              </span>
              <span className="text-[10px] tabular-nums text-text-muted" style={{ fontFamily: 'var(--font-mono)' }}>
                {adName}
              </span>
            </div>
          </div>

          {/* Contadores */}
          <div className="flex shrink-0 items-center gap-3 self-center">
            <div className="text-right">
              <div className="text-[16px] font-bold leading-none text-white tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
                {draft.length}
              </div>
              <div className="label-tech mt-1 text-[8.5px] uppercase tracking-[0.16em] text-text-muted">takes</div>
            </div>
            <span className="h-7 w-px bg-white/10" />
            <div className="text-right">
              <div
                className={`text-[16px] font-bold leading-none tabular-nums ${alteradas > 0 ? 'text-violet-200' : 'text-white/35'}`}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {alteradas}
              </div>
              <div className="label-tech mt-1 text-[8.5px] uppercase tracking-[0.16em] text-text-muted">alterados</div>
            </div>
          </div>
        </div>

        {bibliotecaCarregando ? (
          <div className="label-tech mt-2.5 inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-cyan-200">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-cyan-300 border-t-transparent" />
            carregando biblioteca de avatares
          </div>
        ) : null}

        {/* ─────────────────── Aplicar em todos ─────────────────── */}
        <div className="rdp-bloco mt-3.5 rounded-[13px] border border-white/12 p-3">
          <BlocoLabel icon={<IconBolt size={10} />}>Aplicar em todos os takes</BlocoLabel>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <CompactAvatarPicker
              selected={avatarGlobal}
              setSelected={aplicarAvatarEmTodos}
              disabled={busy}
              label="Avatar pra todos os takes"
            />
            <CompactVoiceSelector selected={vozGlobal} setSelected={aplicarVozEmTodos} />
          </div>
        </div>

        {/* ───────────────────── Take a take ─────────────────────
         *  Rola por dentro (com fade nas bordas): um AD de 20 takes empurraria
         *  o REINICIAR pra fora da tela, e ele tem que ficar sempre à mão. */}
        <ul className="rdp-lista mt-3 grid max-h-[54vh] gap-2 overflow-y-auto pr-1.5">
          {draft.map((p, idx) => {
            const original = partesOriginais[idx];
            const alterada = original ? !mesmaParte(p, original) : true;
            const aberto = !!abertos[idx];
            const motor: Motor = (p.engine as Motor) || 'auto';
            const saida = motorDeSaida(motor, p.motionPrompt);
            const modoImagem = !!p.imageKey && !p.avatarId;
            const av = avatarDaParte(p);
            const temGesto = !!(p.motionPrompt || '').trim();
            return (
              <li
                key={`${p.label}-${idx}`}
                className={`rdp-card group/take relative overflow-hidden rounded-[13px] border p-2.5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-[1px] ${
                  alterada
                    ? 'border-violet-400/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_10px_26px_-16px_rgba(139,92,246,0.9)]'
                    : 'border-white/10 hover:border-white/20'
                }`}
                style={{ animationDelay: `${Math.min(idx, 12) * 28}ms` }}
              >
                {/* Faixa lateral de "alterado" */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-[13px] bg-gradient-to-b from-violet-300 via-violet-400 to-violet-500 transition-opacity duration-300 ${
                    alterada ? 'opacity-100' : 'opacity-0'
                  }`}
                />

                {/* Linha 1 — número + label + chips + motor + editar */}
                <div className="flex flex-wrap items-center gap-2 pl-1.5">
                  <span
                    className="flex h-6 min-w-[24px] items-center justify-center rounded-[7px] border border-white/12 bg-white/[0.06] px-1.5 text-[10px] font-bold tabular-nums text-white/70"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {idx + 1}
                  </span>
                  <span
                    className="text-[11.5px] font-bold tracking-tight text-white"
                    style={{ fontFamily: 'var(--font-tech)' }}
                  >
                    {p.label}
                  </span>
                  {modoImagem ? (
                    <span className="label-tech inline-flex items-center gap-1 rounded-full border border-fuchsia-400/45 bg-fuchsia-500/12 px-2 py-[2px] text-[8px] uppercase tracking-[0.14em] text-fuchsia-200">
                      <IconFrame size={9} /> frame
                    </span>
                  ) : null}
                  {temGesto ? (
                    <span className="label-tech inline-flex items-center gap-1 rounded-full border border-amber-400/45 bg-amber-400/12 px-2 py-[2px] text-[8px] uppercase tracking-[0.14em] text-amber-200">
                      <IconBolt size={9} /> gesto
                    </span>
                  ) : null}
                  {alterada ? (
                    <span className="label-tech rounded-full border border-violet-400/55 bg-violet-500/18 px-2 py-[2px] text-[8px] uppercase tracking-[0.14em] text-violet-100">
                      alterado
                    </span>
                  ) : null}

                  <div className="ml-auto flex items-center gap-1.5">
                    {/* Segmented control do motor */}
                    <div className="rdp-seg flex items-center gap-0.5 rounded-full border border-white/12 p-0.5">
                      {(['auto', 'III', 'IV', 'V'] as const).map((op) => {
                        const sel = motor === op;
                        return (
                          <button
                            key={op}
                            type="button"
                            disabled={busy}
                            onClick={() => patch(idx, { engine: op === 'auto' ? undefined : op })}
                            title={op === 'auto' ? 'auto: III, ou IV quando tem gesto' : `Avatar ${op}`}
                            className={`label-tech rounded-full px-2 py-[3px] text-[8px] uppercase tracking-[0.14em] transition-all duration-200 disabled:opacity-40 ${
                              sel
                                ? 'dark-island bg-violet-500/90 text-white shadow-[0_2px_8px_-2px_rgba(139,92,246,0.9)]'
                                : 'text-text-muted hover:text-white'
                            }`}
                          >
                            {op === 'auto' ? `auto·${saida}` : op}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAbertos((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      title={aberto ? 'Fechar texto e gesto' : 'Editar texto e gesto deste take'}
                      aria-expanded={aberto}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200 hover:-translate-y-[1px] hover:scale-105 ${
                        aberto
                          ? 'border-violet-400/60 bg-violet-500/20 text-violet-100'
                          : 'border-white/12 bg-white/[0.04] text-text-muted hover:border-violet-400/50 hover:text-violet-100'
                      }`}
                    >
                      <IconPen size={12} />
                    </button>
                  </div>
                </div>

                {/* Linha 2 — avatar + voz */}
                <div className="mt-2 grid gap-2 pl-1.5 sm:grid-cols-2">
                  <div>
                    <BlocoLabel icon={<IconUser size={10} />}>Avatar</BlocoLabel>
                    {modoImagem ? (
                      <div className="flex items-center gap-2 rounded-[11px] border border-fuchsia-400/35 bg-fuchsia-500/[0.07] px-2.5 py-2 text-[10.5px] leading-snug text-fuchsia-100">
                        <IconFrame size={13} />
                        O frame desta cena faz o papel do avatar — preservado no reinício.
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
                    <BlocoLabel
                      icon={<IconMic size={10} />}
                      aside={
                        <span className="label-tech whitespace-nowrap text-[8.5px] uppercase tracking-[0.14em] text-text-muted/80">
                          {p.voiceName ? 'escolhida' : p.voiceId ? 'do disparo' : 'do avatar'}
                        </span>
                      }
                    >
                      Voz
                    </BlocoLabel>
                    <CompactVoiceSelector
                      selected={p.voiceId ? { id: p.voiceId, name: p.voiceName || 'voz do disparo' } : null}
                      setSelected={(v) => patch(idx, { voiceId: v?.id || null, voiceName: v?.name || null })}
                    />
                  </div>
                </div>

                {/* Texto: prévia quando fechado, editor quando aberto */}
                {!aberto ? (
                  <p className="mt-2 line-clamp-2 pl-1.5 text-[10.5px] leading-snug text-text-muted">
                    {p.text.trim() || <span className="text-rose-300">— sem texto —</span>}
                  </p>
                ) : (
                  <div className="rdp-expand mt-2 grid gap-2 pl-1.5">
                    <div>
                      <BlocoLabel
                        aside={
                          <span className="text-[8.5px] tabular-nums text-text-muted/70" style={{ fontFamily: 'var(--font-mono)' }}>
                            {p.text.length}
                          </span>
                        }
                      >
                        Texto do take
                      </BlocoLabel>
                      <textarea
                        value={p.text}
                        onChange={(e) => patch(idx, { text: e.target.value })}
                        disabled={busy}
                        rows={4}
                        className="w-full resize-y rounded-[11px] border border-white/12 bg-black/25 px-3 py-2 text-[11.5px] leading-relaxed text-white outline-none transition-colors placeholder:text-text-muted/50 hover:border-white/25 focus:border-violet-400/60 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <BlocoLabel icon={<IconBolt size={10} />}>Movimento (Apply Custom Motion)</BlocoLabel>
                      <input
                        type="text"
                        value={p.motionPrompt || ''}
                        onChange={(e) => patch(idx, { motionPrompt: e.target.value || null })}
                        disabled={busy}
                        placeholder="ex: cobrir o peito com uma das maos no comeco e falar"
                        className="w-full rounded-[10px] border border-white/12 bg-black/25 px-3 py-2 text-[11px] text-white outline-none transition-colors placeholder:text-text-muted/50 hover:border-white/25 focus:border-violet-400/60 disabled:opacity-50"
                      />
                      <div className="label-tech mt-1.5 text-[8.5px] uppercase tracking-[0.14em] text-text-muted/80">
                        sai no avatar {saida}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* ─────────────────────── Pendências ─────────────────────── */}
        {problemas.length > 0 ? (
          <div className="mt-3 flex items-start gap-2 rounded-[11px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[10.5px] leading-snug text-rose-200">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="mt-[1px] shrink-0" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
            </svg>
            <span>Resolva antes de reiniciar: {problemas.join(' · ')}</span>
          </div>
        ) : null}

        {/* ──────────── Rodapé: REINICIAR (roxo) — nunca START ──────────── */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="label-tech text-[9px] uppercase tracking-[0.16em] text-text-muted">
            {mudou ? (
              <span className="text-violet-200">
                {alteradas} take{alteradas === 1 ? '' : 's'} alterado{alteradas === 1 ? '' : 's'}
              </span>
            ) : (
              'igual ao disparo anterior'
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {mudou ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setDraft(partesOriginais.map((p) => ({ ...p })))}
                title="Volta tudo pro que foi disparado"
                className="label-tech inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-text-muted transition-all hover:-translate-y-[1px] hover:border-white/35 hover:text-white disabled:opacity-40"
              >
                <IconUndo size={11} /> Desfazer
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="label-tech rounded-full border border-white/15 px-4 py-2 text-[9px] uppercase tracking-[0.16em] text-text-muted transition-all hover:-translate-y-[1px] hover:border-white/35 hover:text-white disabled:opacity-40"
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
              className="btn-primary label-tech group/cta !px-5 !py-2 !text-[10px] font-extrabold uppercase tracking-[0.16em]"
            >
              <span className={busy ? 'animate-spin' : 'transition-transform duration-500 group-hover/cta:rotate-180'}>
                <IconRestart size={13} />
              </span>
              Reiniciar ({draft.length})
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .rdp-root {
          background:
            linear-gradient(180deg, rgba(139, 92, 246, 0.10) 0%, rgba(139, 92, 246, 0.03) 42%, transparent 100%),
            rgba(10, 10, 14, 0.35);
          animation: rdpPanelIn 0.34s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        :global(html[data-theme='light']) .rdp-root {
          background:
            linear-gradient(180deg, rgba(139, 92, 246, 0.10) 0%, rgba(139, 92, 246, 0.03) 42%, transparent 100%),
            rgba(255, 255, 255, 0.55);
        }
        .rdp-aurora {
          background:
            radial-gradient(38% 60% at 8% 0%, rgba(167, 139, 250, 0.20), transparent 70%),
            radial-gradient(34% 55% at 96% 8%, rgba(103, 232, 249, 0.12), transparent 70%);
          opacity: 0.9;
        }
        .rdp-tile {
          background: linear-gradient(150deg, #a78bfa 0%, #7c5cf6 55%, #6366f1 100%);
        }
        .rdp-chip {
          background: rgba(139, 92, 246, 0.14);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
        }
        .rdp-bloco,
        .rdp-card {
          background: rgba(0, 0, 0, 0.22);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        :global(html[data-theme='light']) .rdp-bloco,
        :global(html[data-theme='light']) .rdp-card {
          background: rgba(255, 255, 255, 0.62);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 1px 2px rgba(16, 16, 24, 0.05);
        }
        .rdp-card {
          animation: rdpIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .rdp-expand {
          animation: rdpIn 0.26s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .rdp-seg {
          background: rgba(0, 0, 0, 0.28);
        }
        :global(html[data-theme='light']) .rdp-seg {
          background: rgba(16, 16, 24, 0.06);
        }
        /* Fade nas bordas do scroll — o corte some em vez de cortar seco. */
        .rdp-lista {
          scrollbar-width: thin;
          mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 12px), transparent 100%);
        }
        .rdp-lista::-webkit-scrollbar {
          width: 6px;
        }
        .rdp-lista::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.35);
          border-radius: 999px;
        }
        @keyframes rdpPanelIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.995); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes rdpIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .rdp-root, .rdp-card { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
