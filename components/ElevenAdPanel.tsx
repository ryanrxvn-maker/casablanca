'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ElevenVoicePicker, type ElevenVoiceChoice } from './ElevenVoicePicker';
import { ElevenVoiceSettings } from './ElevenVoiceSettings';
import {
  planElevenDispatch,
  runElevenDispatch,
  type ElevenDeliverable,
  type ElevenHookInput,
} from '@/lib/eleven-dispatch';
import { getElevenSubscription, type ElevenSubscription } from '@/lib/elevenlabs-api-direct';
import { testElevenSession } from '@/lib/elevenlabs-extension-bridge';
import {
  elevenZipName,
  getElevenPreset,
  setElevenPreset,
  getLastElevenVoice,
  setLastElevenVoice,
  type ElevenPreset,
} from '@/lib/eleven-pilot-config';

/**
 * Painel do MODO ELEVEN — um AD do DR MILLION virando áudio.
 *
 * A regra que manda aqui: o CORPO é gerado UMA vez e entra em todos os
 * ganchos marcados. Três ganchos = três MP3 ("gancho + corpo"), mas o corpo
 * sai do ElevenLabs uma única vez. Quem decide isso é o
 * [[planElevenDispatch]] — este componente só mostra a conta e dispara.
 *
 * A economia aparece na tela ANTES de disparar, de propósito: é caractere do
 * plano do user indo embora, ele tem que ver o que está gastando.
 */

type Props = {
  /** Grupo do AD (AD07) — dono do corpo. */
  groupId: string;
  /** Um por gancho (cada gancho é uma task do ClickUp). */
  hooks: Array<{ taskId: string; adId: string; taskName: string; text: string }>;
  bodyText: string;
  /** Extensão conectada? Sem ela nada gera. */
  extensionConnected: boolean;
};

type Fase = 'idle' | 'gerando' | 'pronto' | 'erro';

const fmt = (n: number) => n.toLocaleString('pt-BR');

export function ElevenAdPanel({ groupId, hooks, bodyText, extensionConnected }: Props) {
  const [voice, setVoice] = useState<ElevenVoiceChoice | null>(null);
  const [preset, setPreset] = useState<ElevenPreset>(() => getElevenPreset());
  const [marcados, setMarcados] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(hooks.map((h) => [h.adId, true])),
  );
  const [fase, setFase] = useState<Fase>('idle');
  const [etapa, setEtapa] = useState('');
  const [progresso, setProgresso] = useState({ feitas: 0, total: 0 });
  const [erro, setErro] = useState<string | null>(null);
  const [entregas, setEntregas] = useState<Array<{ filename: string; adId: string; url: string; size: number }>>([]);
  const [falhas, setFalhas] = useState<Array<{ adId: string; error: string }>>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [assinatura, setAssinatura] = useState<ElevenSubscription | null>(null);
  const [sessao, setSessao] = useState<{ ok: boolean; detail?: string } | null>(null);
  const [testando, setTestando] = useState(false);
  const cancelRef = useRef(false);

  /* Ganchos novos (re-análise) entram marcados; o que o user desmarcou continua
   * desmarcado. Sem isso, reanalisar a task ressuscitava gancho descartado. */
  useEffect(() => {
    setMarcados((prev) => {
      const next: Record<string, boolean> = {};
      let mudou = false;
      for (const h of hooks) {
        next[h.adId] = prev[h.adId] ?? true;
        if (prev[h.adId] === undefined) mudou = true;
      }
      if (Object.keys(prev).length !== Object.keys(next).length) mudou = true;
      return mudou ? next : prev;
    });
  }, [hooks]);

  /* Última voz usada — no DR MILLION é quase sempre a mesma. */
  useEffect(() => {
    if (!voice) {
      const ultima = getLastElevenVoice();
      if (ultima) setVoice(ultima);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (voice) setLastElevenVoice(voice);
  }, [voice]);

  useEffect(() => {
    setElevenPreset(preset);
  }, [preset]);

  /* Saldo de caracteres — o equivalente aos créditos do HeyGen. */
  useEffect(() => {
    if (!extensionConnected) return;
    let vivo = true;
    void getElevenSubscription().then((s) => {
      if (vivo && s.ok) setAssinatura(s);
    });
    return () => {
      vivo = false;
    };
  }, [extensionConnected]);

  useEffect(
    () => () => {
      for (const e of entregas) URL.revokeObjectURL(e.url);
      if (zipUrl) URL.revokeObjectURL(zipUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const hooksInput: ElevenHookInput[] = useMemo(
    () => hooks.map((h) => ({ taskId: h.taskId, adId: h.adId, text: h.text, selected: !!marcados[h.adId] })),
    [hooks, marcados],
  );

  const plano = useMemo(
    () => planElevenDispatch({ groupId, bodyText, hooks: hooksInput }),
    [groupId, bodyText, hooksInput],
  );

  const nMarcados = hooksInput.filter((h) => h.selected).length;
  const podeDisparar =
    extensionConnected && !!voice && plano.assemblies.length > 0 && fase !== 'gerando';
  const semSaldo =
    assinatura?.ok && assinatura.characterLimit > 0 && plano.charsToGenerate > assinatura.remaining;

  async function testarSessao() {
    setTestando(true);
    const r = await testElevenSession();
    setSessao(r);
    setTestando(false);
    if (r.ok) void getElevenSubscription().then((s) => s.ok && setAssinatura(s));
  }

  async function disparar() {
    if (!voice) return;
    cancelRef.current = false;
    setFase('gerando');
    setErro(null);
    setFalhas([]);
    for (const e of entregas) URL.revokeObjectURL(e.url);
    setEntregas([]);
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    setZipUrl(null);
    setProgresso({ feitas: 0, total: plano.jobs.length });

    try {
      const r = await runElevenDispatch(plano, {
        voiceId: voice.id,
        modelId: preset.modelId,
        settings: preset.settings,
        languageCode: preset.languageCode,
        isCancelled: () => cancelRef.current,
        onProgress: (info) => {
          setProgresso({ feitas: info.feitas, total: info.total });
          setEtapa(info.etapa);
        },
      });

      // Persiste ANTES de mostrar: um F5 no meio não pode comer a entrega
      // que já custou caractere do plano ([[feedback_blindagem_fluxos]]).
      await persistir(groupId, r.deliverables);

      setEntregas(
        r.deliverables.map((d) => ({
          filename: d.filename,
          adId: d.adId,
          url: URL.createObjectURL(d.blob),
          size: d.blob.size,
        })),
      );
      setFalhas(r.failures);
      if (r.deliverables.length > 1) setZipUrl(await montarZip(groupId, r.deliverables));
      setFase(r.deliverables.length > 0 ? 'pronto' : 'erro');
      if (r.deliverables.length === 0) setErro('Nenhum áudio foi gerado.');
      setEtapa('');
      void getElevenSubscription().then((s) => s.ok && setAssinatura(s));
    } catch (e) {
      setErro((e as Error)?.message || String(e));
      setFase('erro');
      setEtapa('');
    }
  }

  return (
    <div className="mt-2.5 rounded-[12px] border border-white/25 bg-white/[0.03] p-3">
      {/* ── cabeçalho ── */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span
          className="mono rounded-full border border-white/50 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white"
          title="Este AD sai como ÁUDIO gerado no ElevenLabs, pela sua sessão — não como vídeo do HeyGen."
        >
          ▮▮▮ voz · elevenlabs
        </span>
        {assinatura?.ok ? (
          <span
            className="mono text-[9.5px] uppercase tracking-widest text-text-muted"
            title={`Plano ${assinatura.tier || '—'}: ${fmt(assinatura.characterCount)} de ${fmt(assinatura.characterLimit)} caracteres usados neste ciclo.`}
          >
            saldo {fmt(assinatura.remaining)} car.
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void testarSessao()}
          disabled={testando}
          className="mono ml-auto rounded-full border border-line-strong px-2.5 py-1 text-[9px] uppercase tracking-widest text-text-muted transition hover:border-white/50 hover:text-white disabled:opacity-50"
          title="Confere se a extensão consegue falar com a sua conta do ElevenLabs"
        >
          {testando ? 'testando…' : 'testar sessão'}
        </button>
      </div>

      {!extensionConnected ? (
        <p className="mb-2.5 rounded-[10px] border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
          A extensão Hey Auto não está conectada. Ela é quem gera a voz pela SUA sessão do
          ElevenLabs (sem gastar crédito de API). Instale/atualize a extensão e recarregue a página.
        </p>
      ) : null}

      {sessao && !sessao.ok ? (
        <p className="mb-2.5 rounded-[10px] border border-red-400/40 bg-red-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-red-200">
          {sessao.detail}
        </p>
      ) : sessao?.ok ? (
        <p className="mono mb-2.5 text-[9.5px] uppercase tracking-widest text-lime">✓ {sessao.detail}</p>
      ) : null}

      {/* ── voz + ajustes ── */}
      <div className="grid gap-2.5 md:grid-cols-2">
        <div>
          <div className="label-tech mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
            Voz do ElevenLabs
          </div>
          <ElevenVoicePicker
            selected={voice}
            setSelected={setVoice}
            disabled={fase === 'gerando'}
            label="Voz que vai narrar este anúncio"
          />
        </div>
        <ElevenVoiceSettings preset={preset} onChange={setPreset} disabled={fase === 'gerando'} />
      </div>

      {/* ── ganchos ── */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="label-tech text-[9px] font-bold uppercase tracking-[0.16em] text-text-muted">
            Ganchos ({nMarcados} de {hooks.length})
          </span>
          {hooks.length > 1 ? (
            <button
              type="button"
              onClick={() =>
                setMarcados(
                  Object.fromEntries(hooks.map((h) => [h.adId, nMarcados !== hooks.length])),
                )
              }
              className="mono ml-auto rounded-full border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-widest text-text-muted transition hover:border-white/50 hover:text-white"
            >
              {nMarcados === hooks.length ? 'desmarcar todos' : 'marcar todos'}
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          {hooks.map((h) => {
            const on = !!marcados[h.adId];
            const vazio = !h.text.trim();
            return (
              <label
                key={h.adId}
                className={
                  'flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-2.5 py-2 transition ' +
                  (vazio
                    ? 'border-red-400/35 bg-red-500/[0.06]'
                    : on
                      ? 'border-white/45 bg-white/[0.06]'
                      : 'border-line bg-bg-soft/30 opacity-65 hover:opacity-90')
                }
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={fase === 'gerando' || vazio}
                  onChange={(e) => setMarcados((p) => ({ ...p, [h.adId]: e.target.checked }))}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-white"
                />
                <span className="min-w-0 flex-1">
                  <span className="mono flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white">
                    {h.adId}
                    <span className="font-normal normal-case tracking-normal text-text-muted">
                      {vazio ? 'gancho vazio no doc' : `${fmt(h.text.trim().length)} car.`}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted" title={h.text}>
                    {h.text.trim() || '—'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* ── corpo ── */}
      <div className="mt-2.5 rounded-[10px] border border-line bg-bg-soft/30 px-2.5 py-2">
        <div className="mono flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white">
          Corpo
          <span className="font-normal normal-case tracking-normal text-text-muted">
            {bodyText.trim() ? `${fmt(bodyText.trim().length)} car.` : 'vazio'}
          </span>
          {nMarcados > 1 && bodyText.trim() ? (
            <span
              className="ml-auto rounded-full border border-lime/50 bg-lime/10 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-widest text-lime"
              title={`O corpo é gerado UMA vez e entra nos ${nMarcados} áudios. Gerar um corpo por gancho custaria ${fmt(plano.charsNaive)} caracteres em vez de ${fmt(plano.charsToGenerate)}.`}
            >
              gerado 1× · usado {nMarcados}×
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-text-muted" title={bodyText}>
          {bodyText.trim() || '—'}
        </p>
      </div>

      {/* ── a conta ── */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line bg-bg/40 px-2.5 py-2">
        <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
          gera <span className="font-bold text-white">{fmt(plano.charsToGenerate)}</span> car.
        </span>
        {plano.charsSaved > 0 ? (
          <span
            className="mono text-[10px] uppercase tracking-widest text-lime"
            title={`Reusando o corpo você deixa de gerar ${fmt(plano.charsSaved)} caracteres neste disparo.`}
          >
            economiza {fmt(plano.charsSaved)}
          </span>
        ) : null}
        <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
          entrega <span className="font-bold text-white">{plano.assemblies.length}</span> áudio
          {plano.assemblies.length === 1 ? '' : 's'}
        </span>
        {semSaldo ? (
          <span className="mono text-[10px] font-bold uppercase tracking-widest text-red-300">
            ⚠ passa do saldo do plano
          </span>
        ) : null}
      </div>

      {plano.issues.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {plano.issues.map((i, n) => (
            <li key={n} className="text-[11px] leading-snug text-amber-200">
              ⚠ {i}
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── disparo ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void disparar()}
          disabled={!podeDisparar}
          title={
            !extensionConnected
              ? 'A extensão Hey Auto precisa estar conectada'
              : !voice
                ? 'Escolha a voz primeiro'
                : plano.assemblies.length === 0
                  ? 'Marque ao menos um gancho'
                  : `Gera ${plano.assemblies.length} áudio(s) na sua conta do ElevenLabs`
          }
          className="group relative inline-flex items-center gap-2 rounded-[12px] border border-white/60 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-black transition-all hover:-translate-y-[1px] active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            fontFamily: 'var(--font-tech)',
            background: 'linear-gradient(135deg, #ffffff 0%, #d8dde6 100%)',
            boxShadow: '0 3px 0 rgba(0,0,0,0.35), 0 0 22px -6px rgba(255,255,255,0.6)',
          }}
        >
          {fase === 'gerando' ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/60 border-t-transparent" />
              Gerando…
            </>
          ) : (
            <>▶ Gerar voz</>
          )}
        </button>

        {fase === 'gerando' ? (
          <>
            <span className="mono text-[10px] uppercase tracking-widest text-text-muted">
              {etapa} {progresso.total > 0 ? `(${progresso.feitas}/${progresso.total})` : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                cancelRef.current = true;
              }}
              className="mono rounded-full border border-red-500/50 bg-red-500/10 px-2.5 py-1 text-[9px] uppercase tracking-widest text-red-300 hover:bg-red-500/25"
            >
              cancelar
            </button>
          </>
        ) : null}
      </div>

      {erro ? (
        <p className="mt-2 rounded-[10px] border border-red-400/40 bg-red-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-red-200">
          {erro}
        </p>
      ) : null}

      {falhas.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {falhas.map((f, n) => (
            <li key={n} className="text-[11px] leading-snug text-amber-200">
              ⚠ <b>{f.adId}</b>: {f.error}
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── entregas ── */}
      {entregas.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="label-tech text-[9px] font-bold uppercase tracking-[0.16em] text-lime">
              ✓ {entregas.length} áudio{entregas.length === 1 ? '' : 's'} pronto
              {entregas.length === 1 ? '' : 's'}
            </span>
            {zipUrl ? (
              <a
                href={zipUrl}
                download={elevenZipName(groupId)}
                className="mono ml-auto rounded-full border border-lime/60 bg-lime/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-lime transition hover:bg-lime/20"
              >
                ↓ baixar tudo (.zip)
              </a>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            {entregas.map((e) => (
              <div
                key={e.filename}
                className="flex flex-wrap items-center gap-2 rounded-[10px] border border-lime/30 bg-lime/[0.05] px-2.5 py-2"
              >
                <span className="mono text-[10.5px] font-bold uppercase tracking-widest text-white">
                  {e.filename}
                </span>
                <span className="mono text-[9.5px] uppercase tracking-widest text-text-muted">
                  {(e.size / 1024 / 1024).toFixed(2)} MB
                </span>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio src={e.url} controls preload="none" className="ml-auto h-8 max-w-[240px]" />
                <a
                  href={e.url}
                  download={e.filename}
                  className="mono rounded-full border border-lime/60 bg-lime/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-lime transition hover:bg-lime/20"
                >
                  ↓ baixar
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════ persistência + zip ═══════════════════════ */

/** Guarda cada MP3 no IndexedDB. O áudio já custou caractere do plano — se a
 *  aba recarregar antes do download, ele não pode simplesmente sumir. */
async function persistir(groupId: string, deliverables: ElevenDeliverable[]): Promise<void> {
  try {
    const { saveBlob } = await import('@/lib/zip-store');
    for (const d of deliverables) {
      await saveBlob(`eleven:${groupId}:${d.filename}`, d.blob, 'audio/mpeg');
    }
  } catch (e) {
    // Falhar aqui não pode derrubar a entrega: o blob em memória continua
    // baixável nesta sessão.
    console.warn('[eleven] não consegui persistir os áudios no IndexedDB:', e);
  }
}

async function montarZip(groupId: string, deliverables: ElevenDeliverable[]): Promise<string | null> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const d of deliverables) zip.file(d.filename, d.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    try {
      const { saveZip } = await import('@/lib/zip-store');
      await saveZip(`eleven:${groupId}:zip`, blob, elevenZipName(groupId));
    } catch {
      /* o download direto continua valendo */
    }
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('[eleven] falha ao montar o zip:', e);
    return null;
  }
}
