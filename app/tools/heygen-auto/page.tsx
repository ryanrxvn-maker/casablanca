'use client';

import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Heartbeat } from '@/components/Heartbeat';
import { ToolShell } from '@/components/ToolShell';
import { CancelButton } from '@/components/CancelButton';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  detectExtension,
  splitCopyIntoParts,
  testHeygenSession,
  type ExtensionStatus,
} from '@/lib/heygen-extension-bridge';
import { runHeyGenJobs, type RunnerResult } from '@/lib/heygen-job-runner';
import {
  HeyGenAvatarPicker,
  type AvatarOption,
} from '@/components/HeyGenAvatarPicker';
import {
  HeyGenVoicePicker,
  type VoiceOption,
  type ClonedVoice,
} from '@/components/HeyGenVoicePicker';

/**
 * HeyGen Auto Avatar — automacao do HeyGen sem API.
 *
 * Como funciona:
 *  1. User instala a extensao DARKO LAB (Chrome)
 *  2. Faz login no HeyGen normalmente
 *  3. Aqui na ferramenta: escolhe avatar (preview via API, lookup), motor,
 *     voz (default ou override), modo (copy ou audios)
 *  4. Cola copy ou faz upload das partes de audio
 *  5. Clica gerar — extensao automatiza o HeyGen no fundo, parte por parte
 *  6. Recebe ZIP com parte1.mp4, parte2.mp4, ... na ordem certa
 *
 * IMPORTANTE: a geracao via extensao NAO consome a API HeyGen — usa a
 * mensalidade do user. So previews (lookup avatar/voz) usam a API.
 */

type Motor = 'III' | 'IV' | 'V';
type Mode = 'copy' | 'audio';
type SessionTest = {
  state: 'idle' | 'testing' | 'ok' | 'fail';
  detail?: string;
};

type PartResult = RunnerResult;

export default function HeyGenAutoPage() {
  const [extStatus, setExtStatus] = useState<ExtensionStatus>({
    connected: false,
  });
  const [extLoading, setExtLoading] = useState(true);

  const [adName, setAdName] = useToolState<string>('hgauto:adName', '');
  const [motor, setMotor] = useToolState<Motor>('hgauto:motor', 'IV');
  const [mode, setMode] = useToolState<Mode>('hgauto:mode', 'copy');
  const [avatarQuery, setAvatarQuery] = useToolState<string>(
    'hgauto:avatarQuery',
    '',
  );
  const [selectedAvatar, setSelectedAvatar] = useToolState<AvatarOption | null>(
    'hgauto:avatar',
    null,
  );
  const [voiceQuery, setVoiceQuery] = useToolState<string>('hgauto:voiceQuery', '');
  const [selectedVoice, setSelectedVoice] = useToolState<VoiceOption | null>(
    'hgauto:voice',
    null,
  );
  const [overrideVoice, setOverrideVoice] = useToolState<boolean>(
    'hgauto:overrideVoice',
    false,
  );

  const [copy, setCopy] = useToolState<string>('hgauto:copy', '');
  const [audioParts, setAudioParts] = useState<File[]>([]);

  const [clonedVoices, setClonedVoices] = useToolState<ClonedVoice[]>(
    'hgauto:clonedVoices',
    [],
  );
  const [sessionTest, setSessionTest] = useState<SessionTest>({ state: 'idle' });

  const [parts, setParts] = useState<string[]>([]);
  const [results, setResults] = useState<PartResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<boolean>(false);

  const safeName = (adName.trim() || 'heygen').replace(/[^a-z0-9_-]/gi, '_');

  /* --------------- Extension detection --------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await detectExtension();
      if (!cancelled) {
        setExtStatus(s);
        setExtLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* (avatar + voice search delegados aos componentes compartilhados) */

  /* --------------- Copy split preview --------------- */
  useEffect(() => {
    if (mode !== 'copy') {
      setParts([]);
      return;
    }
    if (!copy.trim()) {
      setParts([]);
      return;
    }
    setParts(
      splitCopyIntoParts(copy, { targetSec: 20, minSec: 10, maxSec: 35 }),
    );
  }, [copy, mode]);

  function cancel() {
    cancelRef.current = true;
    setStage('Cancelando...');
  }

  async function testSession() {
    setSessionTest({ state: 'testing' });
    const r = await testHeygenSession();
    setSessionTest({
      state: r.ok ? 'ok' : 'fail',
      detail: r.detail,
    });
  }

  async function run() {
    if (!extStatus.connected) {
      setError(
        'Extensao DARKO LAB nao detectada. Instale primeiro (instrucoes abaixo).',
      );
      return;
    }
    if (!selectedAvatar) {
      setError('Selecione um avatar primeiro.');
      return;
    }

    type JobEntry = { label: string; copy?: string; audio?: File };
    let jobs: JobEntry[] = [];
    if (mode === 'copy') {
      if (parts.length === 0) {
        setError('Cola uma copy primeiro.');
        return;
      }
      if (!selectedVoice) {
        setError('Modo copy precisa de uma voz selecionada.');
        return;
      }
      jobs = parts.map((p, i) => ({
        label: `parte${i + 1}`,
        copy: p,
      }));
    } else {
      if (audioParts.length === 0) {
        setError('Faca upload de pelo menos um arquivo de audio.');
        return;
      }
      const ordered = [...audioParts].sort((a, b) =>
        a.name.localeCompare(b.name, 'pt', { numeric: true }),
      );
      jobs = ordered.map((a, i) => ({
        label: `parte${i + 1}`,
        audio: a,
      }));
    }

    cancelRef.current = false;
    setError(null);
    setResults([]);
    setProcessing(true);

    try {
      const collected: PartResult[] = [];
      const finalResults = await runHeyGenJobs(jobs, {
        parallel: 3,
        mode,
        avatarId: selectedAvatar.id,
        voiceId:
          mode === 'copy' && selectedVoice ? selectedVoice.id : undefined,
        motor,
        adNameSafe: safeName,
        isCancelled: () => cancelRef.current,
        onProgress: (msg) => setStage(msg),
        onResult: (r) => {
          collected.push(r);
          setResults([...collected].sort((a, b) => a.index - b.index));
        },
      });
      setResults([...finalResults].sort((a, b) => a.index - b.index));
      setStage(null);
    } catch (e) {
      setError((e as Error).message ?? 'Falha desconhecida.');
      setStage(null);
    } finally {
      setProcessing(false);
      cancelRef.current = false;
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Heartbeat />
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="HeyGen Auto Avatar"
          description="Automacao do HeyGen via extensao Chrome — gera o avatar parte por parte usando sua propria conta HeyGen (sem custo de API). Voce manda copy ou audios, recebe ZIP organizado por parte na ordem certa."
        >
          {/* Status da extensao */}
          {!extLoading ? (
            extStatus.connected ? (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-lime/40 bg-lime/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                  </span>
                  <span className="text-lime">
                    Extensao DARKO LAB v{extStatus.version}
                  </span>
                  {sessionTest.state === 'ok' ? (
                    <span className="mono ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] uppercase text-lime">
                      ✓ {sessionTest.detail}
                    </span>
                  ) : sessionTest.state === 'fail' ? (
                    <span className="mono ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase text-red-300">
                      ✗ {sessionTest.detail}
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={testSession}
                  disabled={sessionTest.state === 'testing'}
                  className="rounded-md border border-line-strong bg-bg-soft px-3 py-1 text-[11px] uppercase tracking-widest text-text-muted transition hover:border-lime hover:text-lime disabled:opacity-50"
                >
                  {sessionTest.state === 'testing'
                    ? 'Testando...'
                    : 'Testar conexao HeyGen'}
                </button>
              </div>
            ) : (
              <div className="mb-5 rounded-[12px] border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-300">⚠</span>
                  <div className="flex-1 text-xs text-yellow-300/90">
                    <strong className="text-yellow-300">
                      Extensao DARKO LAB nao instalada
                    </strong>
                    . Voce precisa dela pra gerar avatares (a automacao usa sua
                    conta HeyGen logada, sem consumir API).
                    <details className="mt-2">
                      <summary className="cursor-pointer text-yellow-300/80 hover:text-yellow-200">
                        Como instalar (passo a passo)
                      </summary>
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-yellow-300/80">
                        <li>
                          Baixa o pacote da extensao:{' '}
                          <a
                            href="/api/extension/download"
                            className="underline hover:text-lime"
                            download
                          >
                            darkolab-heygen-extension.zip
                          </a>
                        </li>
                        <li>
                          Descompacta numa pasta no seu computador
                        </li>
                        <li>
                          Abre <code className="mono">chrome://extensions</code>
                        </li>
                        <li>
                          Liga &quot;Modo de desenvolvedor&quot; (canto superior direito)
                        </li>
                        <li>
                          Clica &quot;Carregar sem compactacao&quot; e seleciona a pasta
                        </li>
                        <li>
                          Faz login no HeyGen normalmente em outra aba
                        </li>
                        <li>
                          Volta aqui — a extensao deve aparecer como conectada
                        </li>
                      </ol>
                    </details>
                  </div>
                </div>
              </div>
            )
          ) : null}

          <MissingKeyBanner services={['heygen']} />

          <div className="mt-6 flex flex-col gap-6">
            {/* Identidade */}
            <section>
              <h2 className="label-field !mb-3">Identidade</h2>
              <input
                type="text"
                value={adName}
                onChange={(e) => setAdName(e.target.value)}
                placeholder="Nome do AD (vai virar prefixo dos arquivos)"
                className="input-field"
                disabled={processing}
              />
            </section>

            {/* Motor */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Motor do avatar</h2>
              <div className="flex flex-wrap gap-2">
                {(['III', 'IV', 'V'] as const).map((m) => {
                  const active = motor === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMotor(m)}
                      disabled={processing}
                      className={
                        'rounded-[12px] px-5 py-2.5 text-sm transition-all duration-200 active:scale-[0.97] ' +
                        (active
                          ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                          : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                      }
                    >
                      Avatar {m}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Avatar — biblioteca real da conta HeyGen via extensao */}
            <section className="border-t border-line pt-6">
              <HeyGenAvatarPicker
                query={avatarQuery}
                setQuery={setAvatarQuery}
                selected={selectedAvatar}
                setSelected={setSelectedAvatar}
                disabled={processing}
                label="Avatar (sua biblioteca HeyGen)"
              />
              <p className="mt-2 text-[11px] text-text-muted">
                Lista 100% espelhada da sua conta HeyGen. O motor selecionado
                acima ({motor}) sera usado na hora de gerar — escolha o avatar
                aqui livremente.
              </p>
            </section>

            {mode === 'copy' ? (
              <section className="border-t border-line pt-6">
                <HeyGenVoicePicker
                  override={overrideVoice}
                  setOverride={setOverrideVoice}
                  query={voiceQuery}
                  setQuery={setVoiceQuery}
                  selected={selectedVoice}
                  setSelected={setSelectedVoice}
                  clonedVoices={clonedVoices}
                  setClonedVoices={setClonedVoices}
                  disabled={processing}
                />
              </section>
            ) : (
              <section className="border-t border-line pt-6">
                <div className="rounded-[12px] border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-xs text-blue-300">
                  ℹ Modo audio: a voz vem do proprio audio enviado (lipsync).
                  Voice picker desativado.
                </div>
              </section>
            )}

            {/* Modo: copy ou audio */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Modo de input</h2>
              <div className="flex gap-2">
                {(
                  [
                    { id: 'copy' as const, label: 'Cole a copy (texto)' },
                    {
                      id: 'audio' as const,
                      label: 'Upload de audios (parte1, parte2...)',
                    },
                  ]
                ).map((m) => {
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      disabled={processing}
                      className={
                        'flex-1 rounded-[12px] px-4 py-2.5 text-sm transition-all duration-200 active:scale-[0.98] ' +
                        (active
                          ? 'bg-lime font-semibold text-black'
                          : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                      }
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {mode === 'copy' ? (
                <div className="mt-4">
                  <textarea
                    value={copy}
                    onChange={(e) => setCopy(e.target.value)}
                    placeholder="Cole aqui a copy completa. A ferramenta vai dividir em takes de ~20s sem cortar frase."
                    rows={10}
                    className="input-field resize-y font-mono text-sm"
                    disabled={processing}
                  />
                  {parts.length > 0 ? (
                    <div className="mt-3 rounded-[10px] border border-line bg-bg-soft/40 px-3 py-2 text-[11px] text-text-muted">
                      <strong className="text-lime">
                        {parts.length} take{parts.length === 1 ? '' : 's'}
                      </strong>{' '}
                      ({parts.length} arquivo
                      {parts.length === 1 ? '' : 's'} no ZIP final). Cada um
                      sera 1 video gerado pelo HeyGen via extensao.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4">
                  <input
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={(e) =>
                      setAudioParts(Array.from(e.target.files ?? []))
                    }
                    className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                    disabled={processing}
                  />
                  {audioParts.length > 0 ? (
                    <div className="mt-2 text-[11px] text-text-muted">
                      {audioParts.length} arquivo
                      {audioParts.length === 1 ? '' : 's'} —{' '}
                      {audioParts.map((a) => a.name).join(', ')}
                    </div>
                  ) : null}
                  <div className="mt-2 rounded-[10px] border border-lime/30 bg-lime/5 px-3 py-2 text-[11px] text-lime/80">
                    ✓ Modo audio: a extensao envia cada arquivo pro HeyGen e
                    gera o avatar usando esse audio (lipsync). Os arquivos sao
                    processados na ordem dos nomes (parte1, parte2...).
                  </div>
                </div>
              )}
            </section>

            {/* Action */}
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              {processing ? (
                <CancelButton onClick={cancel} label="Cancelar" />
              ) : (
                <button
                  onClick={run}
                  className="btn-primary"
                  disabled={
                    !extStatus.connected ||
                    !selectedAvatar ||
                    (mode === 'copy' && parts.length === 0) ||
                    (mode === 'audio' && audioParts.length === 0)
                  }
                >
                  Gerar todas as partes via HeyGen
                </button>
              )}
              {results.length > 0 && !processing ? (
                <a
                  href="https://app.heygen.com/projects"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                >
                  Abrir HeyGen Projects
                </a>
              ) : null}
            </div>

            {error ? (
              <div className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                {error}
              </div>
            ) : null}

            {stage ? (
              <div className="scan-line rounded-[12px] border border-lime/40 bg-bg-soft/40 px-4 py-3 text-xs text-lime">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
                  </span>
                  <span className="mono uppercase tracking-widest">{stage}</span>
                </div>
              </div>
            ) : null}

            {/* Resultados parciais — modo dispatch only */}
            {results.length > 0 ? (
              <div className="fade-in-up mt-2 rounded-[12px] border border-lime/30 bg-lime/5 p-4">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-lime">
                  {results.filter((r) => r.error == null).length}/{results.length}{' '}
                  parte{results.length === 1 ? '' : 's'} disparada
                  {results.length === 1 ? '' : 's'} no HeyGen
                </h3>
                <p className="mb-2 text-[11px] text-text-muted">
                  A geracao roda na fila do HeyGen. Acompanhe na sua pagina
                  Projects e baixe quando ficar pronto.
                </p>
                <ul className="grid gap-1 text-xs">
                  {results.map((r) => (
                    <li
                      key={r.label}
                      className="flex items-center justify-between rounded-md border border-line bg-bg px-3 py-2"
                    >
                      <span>
                        <span className="mono text-lime">{r.label}</span>
                        {r.videoId ? (
                          <span className="ml-2 text-text-muted">
                            id: {r.videoId.slice(0, 12)}...
                          </span>
                        ) : null}
                      </span>
                      {r.error ? (
                        <span className="text-[11px] text-red-300">
                          ✗ {r.error}
                        </span>
                      ) : (
                        <span className="text-[11px] text-lime">✓ disparado</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </ToolShell>
      </main>
    </div>
  );
}
