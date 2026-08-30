'use client';

import React, { useMemo, useState } from 'react';
import { CompactAvatarPicker } from './CompactAvatarPicker';
import { CompactVoiceSelector } from './CompactVoiceSelector';
import type { AvatarOption } from './HeyGenAvatarPicker';
import { IndicacaoPanel } from './IndicacaoPanel';
import type { IndicacaoAvatar, LinkIndicacao } from '@/lib/pilot-indicacoes';

/**
 * RedispatchPanel — a ANÁLISE daquele disparo, reaberta DENTRO do card da
 * task pra reorganizar e reiniciar do zero.
 *
 * De onde vem o conteúdo: do `replan` do batch, o plano serializável gravado
 * no ATO do disparo e persistido no localStorage. Por isso o painel abre
 * igual depois de fechar a análise, de trocar de aba ou de dar F5: ele mostra
 * o que REALMENTE foi disparado (avatar, voz, motor, gesto e texto de cada
 * take), não o que a análise em memória diria agora.
 *
 * O que ele NÃO é: a fila. Aqui não existe START. O botão é REINICIAR, vale
 * só pra ESTA task e re-dispara este mesmo disparo com as trocas que você
 * fizer (outra voz, outro avatar, outro texto).
 *
 * ── Desenho (revisão 24.08, depois do Silas reprovar a primeira versão) ──
 * A v1 tinha os três dedos da IA: rótulo em CAIXA ALTA espaçada em todo
 * campo, aurora roxa de fundo e card genérico (borda + sombra + fundo) em
 * cada take. Regras aplicadas agora:
 *  · Rótulo em sentença (`.field-label`), nunca eyebrow. O uppercase fica
 *    reservado pro que é de fato um eyebrow.
 *  · Duplo bisel: casca externa com padding fino + núcleo interno com raio
 *    concêntrico. É o que faz a peça parecer hardware em vez de retângulo.
 *  · Um acento só (o roxo do site) e ele aparece onde muda decisão: o que
 *    você alterou e o botão que dispara. Marca de estado é neutra.
 *  · Zero travessão no texto visível, zero ponto decorativo, hairline no
 *    lugar de borda cinza, sombra difusa tintada, curva de mola no movimento.
 *  · Raio concêntrico: 18 na casca, 13 no núcleo, 10 nos controles, pílula
 *    nos botões. Uma escala só.
 */

export type RedispatchPart = {
  label: string;
  text: string;
  avatarId: string | null;
  /** Nome/thumb do avatar gravados no disparo: é o que aparece quando a
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
  /** ÁUDIO POR AVATAR/TAKE (29.08): chave IDB do áudio upado. Do slot
   *  (audioParte=false) = um arquivo dividido entre os takes; do painel
   *  (audioParte=true) = o arquivo inteiro só neste take. */
  audioKey?: string | null;
  audioName?: string | null;
  /** Voice Mirror: re-sintetiza o áudio na voz do take (STS). */
  audioMirror?: boolean;
  audioParte?: boolean;
  /** Preview do briefing (o que o copy pediu no Docs) — só tela. */
  role?: string | null;
  username?: string | null;
  briefingFileId?: string | null;
  /** Duração do áudio (s) — regra dos 30s. */
  audioDur?: number | null;
  /** Indicações DE AVATAR (comentários do Docs) do avatar deste take. */
  indicacoes?: IndicacaoAvatar[];
  /** Indicações DE COPY: comentário ancorado no TEXTO deste take
   *  (trecho comentado + nota). Botão azul na linha do take. */
  indicacoesCopy?: Array<{ trecho: string; nota: string; links?: LinkIndicacao[] }>;
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
    (a.motionPrompt || '').trim() === (b.motionPrompt || '').trim() &&
    // Áudio conta como mudança: trocar/tirar o áudio (ou ligar o mirror) é
    // motivo real de reinício — sem isto o "alterado" não acendia.
    (a.audioKey || null) === (b.audioKey || null) &&
    !!a.audioMirror === !!b.audioMirror
  );
}

// ── ícones: traço fino e uma espessura só, no padrão do resto do estúdio ──

function IconRestart({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
      <path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
    </svg>
  );
}
function IconFrame({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="9.5" cy="9" r="1.5" />
      <path d="m5 18 4.5-5 3.5 3.5L16 14l3 4" />
    </svg>
  );
}
function IconBolt({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4.1 12.97a1 1 0 0 0 .77 1.63H11l-1 7.4 8.9-10.97a1 1 0 0 0-.77-1.63H12l1-7.4z" />
    </svg>
  );
}
function IconPen({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function IconUndo({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}
function IconAlerta({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.4v.01" />
    </svg>
  );
}

/** Rótulo de campo. Sentença, não eyebrow. */
function Campo({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="field-label text-[11px] text-text-muted">{children}</span>
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
  salvarAudioTake,
  analisarAudioTake,
  audioInfo,
  indicacoesAvatar = [],
  indicacoesCopy = [],
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
  /** ÁUDIO POR TAKE (29.08): guarda os bytes no IDB e devolve a chave. Sem
   *  este prop o botão de áudio nem aparece (painel legado segue igual). */
  salvarAudioTake?: (label: string, file: File) => Promise<string>;
  /** Dispara a comparação ASR × texto do take (advisory, nunca bloqueia). */
  analisarAudioTake?: (audioKey: string, file: File, texto: string) => void;
  /** Estado da análise por audioKey (compartilhado com o card da análise). */
  audioInfo?: Record<string, { status: 'analisando' | 'ok' | 'divergente' | 'erro'; resumo?: string }>;
  /** INDICAÇÕES do copy desta task (comentários do Docs), pros mesmos dois
   *  botões da análise aparecerem aqui no cabeçalho do painel: dourado =
   *  indicação de AVATAR, azul = comentário NO TEXTO. */
  indicacoesAvatar?: IndicacaoAvatar[];
  indicacoesCopy?: Array<{ take?: string | null; trecho?: string; nota: string; links?: LinkIndicacao[] }>;
}) {
  const [draft, setDraft] = useState<RedispatchPart[]>(() =>
    partesOriginais.map((p) => ({ ...p })),
  );
  const [abertos, setAbertos] = useState<Record<number, boolean>>({});
  /** Indicação do papel aberta (cards "O que o copy pediu"). */
  const [indicacaoAberta, setIndicacaoAberta] = useState<Record<number, boolean>>({});
  /** Comentário de COPY aberto por take (botão azul na linha). */
  const [copyNotaAberta, setCopyNotaAberta] = useState<Record<number, boolean>>({});
  /** Painéis de indicação do CABEÇALHO (os mesmos dois botões da análise). */
  const [indTaskAberta, setIndTaskAberta] = useState<'avatar' | 'copy' | null>(null);
  // O que foi aplicado "em todos": só pra tela mostrar a escolha em vez de
  // voltar pro estado vazio (e pra reaparecer o "voltar pra voz padrão").
  const [avatarGlobal, setAvatarGlobal] = useState<AvatarOption | null>(null);
  const [vozGlobal, setVozGlobal] = useState<{ id: string; name: string } | null>(null);

  const patch = (idx: number, campos: Partial<RedispatchPart>) =>
    setDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, ...campos } : p)));

  /** Avatar de exibição: biblioteca primeiro; se ela não tem (ainda não
   *  carregou, ou o look foi apagado lá), monta um a partir do que o disparo
   *  gravou. O painel NUNCA aparece "sem avatar" pra um take que tinha um. */
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
   *  estava herdando a voz do look ANTIGO, a voz acompanha; senão o avatar
   *  novo sairia falando com a voz do antigo, o erro clássico de trocar só o
   *  rosto. Voz escolhida na mão, com nome, é preservada. */
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

  /** Impedimentos REAIS de disparo, os mesmos que o runner checa. */
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
    // CASCA do duplo bisel: fina, quase invisível, existe pra dar espessura.
    <div className="rdp-shell rounded-[18px] p-[5px]">
      {/* NÚCLEO: raio concêntrico (18 menos o padding da casca). */}
      <div className="rdp-core rounded-[13px] p-4">
        {/* ─────────────────────── Cabeçalho ─────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <span className="rdp-tile dark-island flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white">
            <IconRestart size={16} />
          </span>

          <div className="min-w-0 flex-1">
            <h4
              className="text-[15px] font-semibold leading-tight text-white"
              style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
            >
              Reiniciar disparo
            </h4>
            <p className="mt-0.5 truncate text-[12px] leading-snug text-text-muted" title={taskName}>
              {taskName}
              <span className="ml-2 tabular-nums text-white/45" style={{ fontFamily: 'var(--font-mono)' }}>
                {adName}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2.5 self-center">
            {/* INDICADORES DO COPY — os mesmos dois botões da análise, aqui
             *  também (pedido 30.08): azul = comentário no texto do AD,
             *  dourado = indicação de avatar. Só aparecem quando existem. */}
            {indicacoesCopy.length > 0 ? (
              <button
                type="button"
                onClick={() => setIndTaskAberta((v) => (v === 'copy' ? null : 'copy'))}
                aria-expanded={indTaskAberta === 'copy'}
                className={'pilot-ind-btn is-copy shrink-0' + (indTaskAberta === 'copy' ? ' is-open' : '')}
                title={`Comentário do copy no texto deste AD (${indicacoesCopy.length}) — clica pra ver`}
              >
                <span className="pilot-ind-halo" aria-hidden />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <path d="M8 9h.01M12 9h.01M16 9h.01" />
                </svg>
                {indicacoesCopy.length > 1 ? <span className="pilot-ind-count">{indicacoesCopy.length}</span> : null}
              </button>
            ) : null}
            {indicacoesAvatar.length > 0 ? (
              <button
                type="button"
                onClick={() => setIndTaskAberta((v) => (v === 'avatar' ? null : 'avatar'))}
                aria-expanded={indTaskAberta === 'avatar'}
                className={'pilot-ind-btn shrink-0' + (indTaskAberta === 'avatar' ? ' is-open' : '')}
                title={`Indicação de avatar do copy (${indicacoesAvatar.length}) — clica pra ver`}
              >
                <span className="pilot-ind-halo" aria-hidden />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m3 11 14-6v14L3 13v-2z" />
                  <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                  <path d="M21 8.5c.7.8.7 5.2 0 6" />
                </svg>
                {indicacoesAvatar.length > 1 ? <span className="pilot-ind-count">{indicacoesAvatar.length}</span> : null}
              </button>
            ) : null}
            <div className="text-right">
              <div className="text-[17px] font-semibold leading-none tabular-nums text-white" style={{ fontFamily: 'var(--font-mono)' }}>
                {draft.length}
              </div>
              <div className="field-label mt-1 text-[10.5px] text-text-muted">takes</div>
            </div>
            <span className="h-8 w-px bg-white/10" />
            <div className="text-right">
              <div
                className={`text-[17px] font-semibold leading-none tabular-nums ${alteradas > 0 ? 'text-violet-300' : 'text-white/30'}`}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {alteradas}
              </div>
              <div className="field-label mt-1 text-[10.5px] text-text-muted">alterados</div>
            </div>
          </div>
        </div>

        <p className="mt-2.5 text-[11.5px] leading-relaxed text-text-muted">
          Este disparo, do jeito que ele saiu. Troque o que quiser e reinicie: vale só para esta task,
          não entra na fila.
          {bibliotecaCarregando ? (
            <span className="ml-1.5 text-cyan-300">Carregando a biblioteca de avatares.</span>
          ) : null}
        </p>

        {indTaskAberta === 'copy' && indicacoesCopy.length > 0 ? (
          <IndicacaoPanel
            tipo="copy"
            itens={indicacoesCopy.map((ic) => ({ nota: ic.nota, links: ic.links, take: ic.take, trecho: ic.trecho }))}
          />
        ) : null}
        {indTaskAberta === 'avatar' && indicacoesAvatar.length > 0 ? (
          <IndicacaoPanel tipo="avatar" itens={indicacoesAvatar.map((ia) => ({ nota: ia.nota, links: ia.links }))} />
        ) : null}

        {/* ─────────────── O que o copy pediu (briefing do Docs) ───────────────
         *  O MESMO preview da análise — thumb do arquivo do Drive, papel e
         *  @username — na gramática deste painel. Só aparece quando o replan
         *  gravou o briefing (disparos a partir de 29.08). */}
        {(() => {
          // A seção NUNCA fica vazia (revisão 30.08): quando o replan é antigo
          // e não tem role/username/briefingFileId, ela mostra o AVATAR que o
          // disparo usou — com a thumb resolvida na biblioteca do HeyGen.
          type Papel = {
            role: string;
            username: string | null;
            fileId: string | null;
            avatarNome: string | null;
            avatarThumb: string | null;
            indicacoes: IndicacaoAvatar[];
          };
          const papeis: Papel[] = [];
          const vistos = new Map<string, number>();
          for (const p of partesOriginais) {
            const role = (p.role || '').trim();
            const av = avatarDaParte(p);
            // chave: papel do doc quando existe; senão o avatar do disparo
            const k = role || p.username || p.briefingFileId
              ? `${role.toLowerCase()}|${p.username || ''}|${p.briefingFileId || ''}`
              : `av|${p.avatarId || 'sem'}`;
            const idxExistente = vistos.get(k);
            if (idxExistente !== undefined) {
              for (const ind of p.indicacoes || []) {
                if (!papeis[idxExistente].indicacoes.some((x) => x.nota === ind.nota)) {
                  papeis[idxExistente].indicacoes.push(ind);
                }
              }
              continue;
            }
            vistos.set(k, papeis.length);
            papeis.push({
              role: role || 'Avatar do disparo',
              username: p.username || null,
              fileId: p.briefingFileId || null,
              avatarNome: av?.name || p.avatarName || null,
              avatarThumb: av?.thumb || p.avatarThumb || null,
              indicacoes: [...(p.indicacoes || [])],
            });
          }
          if (papeis.length === 0) return null;
          const semBriefing = papeis.every((pp) => !pp.fileId && !pp.username);
          return (
            <section className="rdp-bloco mt-3.5 rounded-[13px] p-3">
              <Campo
                aside={
                  semBriefing ? (
                    <span className="field-label whitespace-nowrap text-[10.5px] text-white/35">
                      analise a task pra ver o do Docs
                    </span>
                  ) : undefined
                }
              >
                {semBriefing ? 'Quem falou neste disparo' : 'O que o copy pediu no Docs'}
              </Campo>
              <div className="grid gap-2 sm:grid-cols-2">
                {papeis.map((pp, k) => {
                  const thumb = pp.fileId
                    ? `https://drive.google.com/thumbnail?id=${pp.fileId}&sz=w200`
                    : pp.avatarThumb;
                  return (
                    <div key={k} className="rdp-nota rounded-[10px] px-2.5 py-2">
                      <div className="flex items-center gap-2.5">
                        {thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={thumb}
                            alt={pp.username || pp.role}
                            className="h-12 w-12 shrink-0 rounded-[8px] object-cover"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.05] text-white/35">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="8" r="4" />
                              <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
                            </svg>
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-semibold text-white" style={{ fontFamily: 'var(--font-tech)' }}>
                            {pp.role}
                          </div>
                          <div className="truncate text-[10.5px] text-text-muted">
                            {pp.username ? `@${pp.username}` : pp.avatarNome || 'sem referência no doc'}
                          </div>
                        </div>
                        {pp.indicacoes.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setIndicacaoAberta((prev) => ({ ...prev, [k]: !prev[k] }))}
                            aria-expanded={!!indicacaoAberta[k]}
                            className={'pilot-ind-btn shrink-0' + (indicacaoAberta[k] ? ' is-open' : '')}
                            title={`Indicação do copy pra este avatar (${pp.indicacoes.length}) — clica pra ver`}
                          >
                            <span className="pilot-ind-halo" aria-hidden />
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="m3 11 14-6v14L3 13v-2z" />
                              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                              <path d="M21 8.5c.7.8.7 5.2 0 6" />
                            </svg>
                            {pp.indicacoes.length > 1 ? <span className="pilot-ind-count">{pp.indicacoes.length}</span> : null}
                          </button>
                        ) : null}
                        {pp.fileId ? (
                          <a
                            href={`https://drive.google.com/uc?export=download&id=${pp.fileId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rdp-btn-ghost shrink-0 rounded-full px-2.5 py-1.5 text-[10px]"
                            title="Baixar o arquivo de referência do copywriter (Drive)"
                          >
                            Baixar
                          </a>
                        ) : null}
                      </div>
                      {indicacaoAberta[k] && pp.indicacoes.length > 0 ? (
                        <IndicacaoPanel tipo="avatar" itens={pp.indicacoes.map((ia) => ({ nota: ia.nota, links: ia.links }))} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* ─────────────── Aplicar em todos os takes ─────────────── */}
        <section className="rdp-bloco mt-3.5 rounded-[13px] p-3">
          <Campo>Aplicar em todos os takes</Campo>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <CompactAvatarPicker
              selected={avatarGlobal}
              setSelected={aplicarAvatarEmTodos}
              disabled={busy}
              label="Avatar para todos os takes"
            />
            <CompactVoiceSelector selected={vozGlobal} setSelected={aplicarVozEmTodos} />
          </div>
        </section>

        {/* ─────────────────────── Take a take ───────────────────────
         *  Sem card por linha: o que separa é o espaço e o número. Só o take
         *  ALTERADO ganha superfície e o filete do acento, então o olho acha
         *  na hora o que você mexeu. */}
        <ul className="rdp-lista mt-2 grid max-h-[54vh] gap-1 overflow-y-auto pr-1.5">
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
                className={`rdp-take relative rounded-[13px] px-3 py-2.5 ${alterada ? 'is-alterada' : ''}`}
                style={{ animationDelay: `${Math.min(idx, 12) * 26}ms` }}
              >
                {/* Linha 1: número, nome, estado, motor, editar */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span
                    className="w-5 shrink-0 text-[11px] tabular-nums text-white/35"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="text-[12.5px] font-semibold text-white"
                    style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.01em' }}
                  >
                    {p.label}
                  </span>
                  {modoImagem ? (
                    <span className="rdp-marca" title="Cena gerada a partir de um frame">
                      <IconFrame size={11} /> frame
                    </span>
                  ) : null}
                  {temGesto ? (
                    <span className="rdp-marca" title="Esta cena pede movimento ao HeyGen">
                      <IconBolt size={11} /> gesto
                    </span>
                  ) : null}
                  {alterada ? <span className="rdp-marca is-acento">alterado</span> : null}
                  {/* Comentário do copy NO TEXTO deste take (indicação de COPY) —
                   *  botão azul, distinto do dourado de avatar. */}
                  {(p.indicacoesCopy || []).length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setCopyNotaAberta((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      aria-expanded={!!copyNotaAberta[idx]}
                      className={'pilot-ind-btn is-copy shrink-0' + (copyNotaAberta[idx] ? ' is-open' : '')}
                      style={{ width: 26, height: 26 }}
                      title={`Comentário do copy neste take (${(p.indicacoesCopy || []).length}) — clica pra ver`}
                    >
                      <span className="pilot-ind-halo" aria-hidden />
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        <path d="M8 9h.01M12 9h.01M16 9h.01" />
                      </svg>
                      {(p.indicacoesCopy || []).length > 1 ? (
                        <span className="pilot-ind-count">{(p.indicacoesCopy || []).length}</span>
                      ) : null}
                    </button>
                  ) : null}

                  <div className="ml-auto flex items-center gap-1.5">
                    {/* Só III/IV/V, sem item "auto" e sem tag (revisão 29.08): em
                     *  automático o motor EFETIVO simplesmente fica ACESO. Clicar
                     *  trava na mão; clicar de novo volta pro automático. */}
                    <div className="rdp-seg flex items-center gap-0.5 rounded-full p-[3px]">
                      {(['III', 'IV', 'V'] as const).map((op) => {
                        const sel = motor === op;
                        // `saida` já é o motorDeSaida (III com gesto sobe pro IV):
                        // o aceso mostra o que VAI SAIR, não o que foi clicado.
                        const aceso = saida === op;
                        return (
                          <button
                            key={op}
                            type="button"
                            disabled={busy}
                            onClick={() => patch(idx, { engine: sel ? undefined : op })}
                            title={
                              sel
                                ? `Avatar ${op} escolhido na mão — clica de novo pra voltar pro automático`
                                : aceso
                                  ? `Automático: sai no ${saida} (com gesto sobe pro IV). Clica pra travar no ${op}.`
                                  : `Avatar ${op}`
                            }
                            className={`rdp-seg-item rounded-full px-2 py-[3px] text-[10px] disabled:opacity-40 ${aceso ? 'dark-island is-on text-white' : 'text-text-muted hover:text-white'}`}
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {op}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAbertos((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      title={aberto ? 'Fechar texto e movimento' : 'Editar texto e movimento deste take'}
                      aria-expanded={aberto}
                      className={`rdp-icone flex h-7 w-7 items-center justify-center rounded-full ${aberto ? 'is-on' : ''}`}
                    >
                      <IconPen size={12} />
                    </button>
                  </div>
                </div>

                {/* Linha 2: avatar e voz */}
                <div className="mt-2 grid gap-2.5 pl-[30px] sm:grid-cols-2">
                  <div>
                    <Campo>Avatar</Campo>
                    {modoImagem ? (
                      <div className="rdp-nota flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[11px] leading-snug">
                        <IconFrame size={13} />
                        O frame desta cena faz o papel do avatar e é preservado no reinício.
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
                    <Campo
                      aside={
                        <span className="field-label whitespace-nowrap text-[10.5px] text-white/35">
                          {p.voiceName ? 'escolhida' : p.voiceId ? 'do disparo' : 'do avatar'}
                        </span>
                      }
                    >
                      Voz
                    </Campo>
                    <CompactVoiceSelector
                      selected={p.voiceId ? { id: p.voiceId, name: p.voiceName || 'voz do disparo' } : null}
                      setSelected={(v) => patch(idx, { voiceId: v?.id || null, voiceName: v?.name || null })}
                    />
                  </div>
                </div>

                {/* ÁUDIO DO TAKE (29.08): o take pode sair de um ÁUDIO upado em
                 *  vez do TTS — aqui dá pra ver o áudio que o disparo usou,
                 *  trocar por outro, tirar, e ligar o Voice Mirror. Áudio
                 *  colocado AQUI vale só neste take (vai inteiro, sem dividir). */}
                {salvarAudioTake && !modoImagem ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-[30px]">
                    {p.audioKey ? (
                      <>
                        <span
                          className="rdp-marca max-w-[240px]"
                          title={p.audioParte ? 'Áudio deste take (vai inteiro, sem dividir)' : 'Áudio do avatar no disparo (dividido entre os takes dele)'}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          </svg>
                          <span className="truncate">{p.audioName || 'áudio do disparo'}</span>
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => patch(idx, { audioMirror: !p.audioMirror })}
                          className={`rdp-marca ${p.audioMirror ? 'is-acento' : ''}`}
                          title={
                            p.audioMirror
                              ? 'Voice Mirror LIGADO: o HeyGen re-sintetiza o áudio na voz deste take (timing do arquivo, timbre da voz).'
                              : 'Voice Mirror: usa a voz selecionada com o áudio usado. Clica pra ligar.'
                          }
                        >
                          🪞 mirror {p.audioMirror ? 'on' : 'off'}
                        </button>
                        {(() => {
                          const st = p.audioKey ? audioInfo?.[p.audioKey] : undefined;
                          if (!st) return null;
                          if (st.status === 'analisando') return <span className="rdp-marca">comparando com a copy…</span>;
                          if (st.status === 'ok') return <span className="rdp-marca" style={{ color: '#c8e87c' }}>✓ bate com o texto</span>;
                          if (st.status === 'divergente') return (
                            <span className="rdp-marca" style={{ color: '#fcd34d' }} title={st.resumo || ''}>
                              ⚠ áudio ≠ texto do take
                            </span>
                          );
                          return null;
                        })()}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => patch(idx, { audioKey: null, audioName: null, audioMirror: false, audioParte: false })}
                          className="rdp-icone flex h-6 w-6 items-center justify-center rounded-full"
                          title="Tirar o áudio — este take volta a sair por TTS (texto)"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                        </button>
                      </>
                    ) : (
                      <label className={`rdp-btn-ghost inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] ${busy ? 'pointer-events-none opacity-40' : ''}`}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                        </svg>
                        Colocar áudio neste take
                        <input
                          type="file"
                          accept="audio/*,video/mp4,video/webm,video/ogg"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (!f || !salvarAudioTake) return;
                            void salvarAudioTake(p.label, f)
                              .then((key) => {
                                patch(idx, { audioKey: key, audioName: f.name, audioParte: true });
                                analisarAudioTake?.(key, f, p.text || '');
                              })
                              .catch((err) => console.error('[RedispatchPanel] áudio do take falhou:', err));
                          }}
                        />
                      </label>
                    )}
                  </div>
                ) : null}

                {/* Nota(s) do copy neste take — abre pelo botão azul acima. */}
                {copyNotaAberta[idx] && (p.indicacoesCopy || []).length > 0 ? (
                  <div className="pl-[30px]">
                    <IndicacaoPanel
                      tipo="copy"
                      itens={(p.indicacoesCopy || []).map((ic) => ({ nota: ic.nota, links: ic.links, trecho: ic.trecho }))}
                    />
                  </div>
                ) : null}

                {/* Texto: prévia quando fechado, editor quando aberto */}
                {!aberto ? (
                  <p className="mt-2 line-clamp-2 pl-[30px] text-[11.5px] leading-relaxed text-text-muted">
                    {p.text.trim() || <span className="text-rose-300">sem texto</span>}
                  </p>
                ) : (
                  <div className="rdp-abre mt-2.5 grid gap-2.5 pl-[30px]">
                    <div>
                      <Campo
                        aside={
                          <span className="text-[10.5px] tabular-nums text-white/30" style={{ fontFamily: 'var(--font-mono)' }}>
                            {p.text.length}
                          </span>
                        }
                      >
                        Texto do take
                      </Campo>
                      <textarea
                        value={p.text}
                        onChange={(e) => patch(idx, { text: e.target.value })}
                        disabled={busy}
                        rows={4}
                        className="rdp-input w-full resize-y rounded-[10px] px-3 py-2.5 text-[12px] leading-relaxed text-white outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <Campo
                        aside={
                          <span className="field-label text-[10.5px] text-white/35">sai no avatar {saida}</span>
                        }
                      >
                        Movimento
                      </Campo>
                      <input
                        type="text"
                        value={p.motionPrompt || ''}
                        onChange={(e) => patch(idx, { motionPrompt: e.target.value || null })}
                        disabled={busy}
                        placeholder="cobrir o peito com uma das maos no comeco e falar"
                        className={'rdp-input w-full rounded-[10px] px-3 py-2.5 text-[12px] text-white outline-none disabled:opacity-50' + ((p.motionPrompt || '').trim() ? ' is-on' : '')}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* ───────────────────────── Pendências ───────────────────────── */}
        {problemas.length > 0 ? (
          <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-rose-400/35 bg-rose-500/[0.08] px-3 py-2.5 text-[11.5px] leading-snug text-rose-200">
            <span className="mt-[1px] shrink-0"><IconAlerta size={13} /></span>
            <span>Resolva antes de reiniciar: {problemas.join(', ')}</span>
          </div>
        ) : null}

        {/* ─────────── Rodapé: REINICIAR (roxo), nunca START ─────────── */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
          <span className="field-label text-[11px] text-text-muted">
            {mudou ? (
              <span className="text-violet-300">
                {alteradas} take{alteradas === 1 ? '' : 's'} alterado{alteradas === 1 ? '' : 's'}
              </span>
            ) : (
              'igual ao disparo anterior'
            )}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {mudou ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setDraft(partesOriginais.map((p) => ({ ...p })))}
                title="Volta tudo para o que foi disparado"
                className="rdp-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] disabled:opacity-40"
              >
                <IconUndo size={12} /> Desfazer
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rdp-btn-ghost rounded-full px-3.5 py-2 text-[11px] disabled:opacity-40"
            >
              Cancelar
            </button>
            {/* CTA: pílula com o ícone no próprio círculo, encostado na borda
                interna. `btn-primary` é o roxo oficial do site e a única
                pílula que mantém texto branco no tema claro. */}
            <button
              type="button"
              disabled={!podeReiniciar}
              onClick={() => onReiniciar(draft)}
              title={
                problemas.length > 0
                  ? 'Tem take sem avatar, voz ou texto. Resolva acima.'
                  : 'Re-dispara esta task do zero com o plano acima'
              }
              className="btn-primary group/cta !gap-2.5 !rounded-full !py-1.5 !pl-5 !pr-1.5 !text-[12px] !font-semibold"
            >
              Reiniciar
              <span className="rdp-cta-icone flex h-7 w-7 items-center justify-center rounded-full">
                <span className={busy ? 'animate-spin' : 'transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/cta:rotate-180'}>
                  <IconRestart size={13} />
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        /* ── Duplo bisel ─────────────────────────────────────────────
           Casca fina por fora, núcleo com raio concêntrico por dentro.
           A espessura é o que faz a peça parecer encaixada, e não colada. */
        .rdp-shell {
          background: rgba(255, 255, 255, 0.045);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.07),
            0 24px 60px -32px rgba(93, 62, 188, 0.55);
          animation: rdpEntra 0.4s cubic-bezier(0.32, 0.72, 0, 1) both;
        }
        .rdp-core {
          background:
            radial-gradient(120% 90% at 50% -20%, rgba(139, 92, 246, 0.10), transparent 60%),
            rgba(12, 12, 16, 0.72);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        :global(html[data-theme='light']) .rdp-shell {
          background: rgba(16, 16, 24, 0.05);
          box-shadow:
            inset 0 0 0 1px rgba(16, 16, 24, 0.06),
            0 24px 60px -34px rgba(93, 62, 188, 0.35);
        }
        :global(html[data-theme='light']) .rdp-core {
          background:
            radial-gradient(120% 90% at 50% -20%, rgba(139, 92, 246, 0.07), transparent 60%),
            rgba(255, 255, 255, 0.86);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
        }

        .rdp-tile {
          background: linear-gradient(155deg, #a78bfa 0%, #7c5cf6 60%, #6366f1 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.35),
            0 8px 18px -10px rgba(124, 92, 246, 0.9);
        }

        .rdp-bloco {
          background: rgba(255, 255, 255, 0.035);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
        }
        :global(html[data-theme='light']) .rdp-bloco {
          background: rgba(16, 16, 24, 0.035);
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.05);
        }

        /* ── Take ───────────────────────────────────────────────────
           Sem superfície no estado normal: o espaço separa. Superfície e
           filete só quando você mexeu naquele take. */
        .rdp-take {
          animation: rdpEntra 0.34s cubic-bezier(0.32, 0.72, 0, 1) both;
          transition: background-color 0.25s cubic-bezier(0.32, 0.72, 0, 1);
        }
        .rdp-take:hover {
          background: rgba(255, 255, 255, 0.028);
        }
        :global(html[data-theme='light']) .rdp-take:hover {
          background: rgba(16, 16, 24, 0.028);
        }
        .rdp-take.is-alterada {
          background: rgba(139, 92, 246, 0.09);
          box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.22);
        }
        .rdp-take.is-alterada::before {
          content: '';
          position: absolute;
          left: 0;
          top: 10px;
          bottom: 10px;
          width: 2px;
          border-radius: 999px;
          background: linear-gradient(180deg, #a78bfa, #7c5cf6);
        }

        /* Marca de estado: neutra por padrão, acento só no "alterado". */
        .rdp-marca {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border-radius: 999px;
          padding: 2px 8px;
          font-family: var(--font-label), var(--font-display), system-ui;
          font-size: 10.5px;
          font-weight: 500;
          color: rgb(var(--text-muted));
          background: rgba(255, 255, 255, 0.05);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
        }
        :global(html[data-theme='light']) .rdp-marca {
          background: rgba(16, 16, 24, 0.045);
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.06);
        }
        .rdp-marca.is-acento {
          color: #ddd2ff;
          background: rgba(139, 92, 246, 0.2);
          box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.45);
        }
        :global(html[data-theme='light']) .rdp-marca.is-acento {
          color: #4c2ea8;
          background: rgba(139, 92, 246, 0.14);
          box-shadow: inset 0 0 0 1px rgba(124, 92, 246, 0.35);
        }

        .rdp-seg {
          background: rgba(255, 255, 255, 0.05);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
        }
        :global(html[data-theme='light']) .rdp-seg {
          background: rgba(16, 16, 24, 0.05);
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.05);
        }
        .rdp-seg-item {
          transition: color 0.2s cubic-bezier(0.32, 0.72, 0, 1), background-color 0.2s cubic-bezier(0.32, 0.72, 0, 1);
        }
        .rdp-seg-item.is-on {
          background: linear-gradient(180deg, #8b5cf6, #6d4ee8);
          box-shadow: 0 3px 10px -4px rgba(109, 78, 232, 0.9);
        }

        .rdp-icone {
          color: rgb(var(--text-muted));
          background: rgba(255, 255, 255, 0.05);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
          transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), color 0.2s, background-color 0.2s;
        }
        :global(html[data-theme='light']) .rdp-icone {
          background: rgba(16, 16, 24, 0.05);
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.06);
        }
        .rdp-icone:hover {
          transform: translateY(-1px);
          color: #c4b5fd;
        }
        .rdp-icone.is-on {
          color: #ddd2ff;
          background: rgba(139, 92, 246, 0.22);
        }
        :global(html[data-theme='light']) .rdp-icone.is-on {
          color: #4c2ea8;
          background: rgba(139, 92, 246, 0.16);
        }

        .rdp-nota {
          color: rgb(var(--text-muted));
          background: rgba(255, 255, 255, 0.04);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
        }
        :global(html[data-theme='light']) .rdp-nota {
          background: rgba(16, 16, 24, 0.04);
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.06);
        }

        .rdp-input {
          font-family: var(--font-display), system-ui;
          background: rgba(0, 0, 0, 0.28);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
          transition: box-shadow 0.2s cubic-bezier(0.32, 0.72, 0, 1);
        }
        .rdp-input::placeholder {
          color: rgba(255, 255, 255, 0.28);
        }
        /* Campo do MOVIMENTO com gesto escrito: acende igual ao do Pilot. */
        .rdp-input.is-on {
          background: rgba(139, 92, 246, 0.14);
          box-shadow:
            inset 0 0 0 1.5px rgba(167, 139, 250, 0.75),
            0 0 20px -8px rgba(167, 139, 250, 0.9);
        }
        .rdp-input:focus {
          box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
        }
        :global(html[data-theme='light']) .rdp-input {
          background: rgba(255, 255, 255, 0.9);
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.12);
        }
        :global(html[data-theme='light']) .rdp-input::placeholder {
          color: rgba(16, 16, 24, 0.35);
        }

        .rdp-btn-ghost {
          font-family: var(--font-label), var(--font-display), system-ui;
          font-weight: 500;
          color: rgb(var(--text-muted));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.09);
          transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), color 0.2s, box-shadow 0.2s;
        }
        :global(html[data-theme='light']) .rdp-btn-ghost {
          box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.1);
        }
        .rdp-btn-ghost:hover:not(:disabled) {
          transform: translateY(-1px);
          color: rgb(var(--text));
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
        }

        /* Ícone do CTA no seu próprio círculo, encostado na borda interna. */
        .rdp-cta-icone {
          background: rgba(255, 255, 255, 0.16);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
          transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), background-color 0.3s;
        }
        :global(.btn-primary:hover:not(:disabled)) .rdp-cta-icone {
          background: rgba(255, 255, 255, 0.26);
          transform: translateX(1px);
        }

        /* Lista: rola por dentro, com as bordas em fade. */
        .rdp-lista {
          scrollbar-width: thin;
          mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 12px), transparent 100%);
        }
        .rdp-lista::-webkit-scrollbar {
          width: 5px;
        }
        .rdp-lista::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.3);
          border-radius: 999px;
        }

        .rdp-abre {
          animation: rdpEntra 0.28s cubic-bezier(0.32, 0.72, 0, 1) both;
        }

        @keyframes rdpEntra {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .rdp-shell, .rdp-take, .rdp-abre { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
