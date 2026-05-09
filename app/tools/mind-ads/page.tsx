'use client';

import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Heartbeat } from '@/components/Heartbeat';
import { ToolShell } from '@/components/ToolShell';
import { CancelButton } from '@/components/CancelButton';
import { MissingKeyBanner } from '@/components/MissingKeyBanner';
import { useToolState } from '@/components/ToolsStateProvider';
import {
  cancelFFmpeg,
  concatAvatarParts,
  estimateTakeBoundaries,
  extractAudioForTranscription,
  isCancellationError,
  mindAdsMontage,
  probeVideoMetadata,
  removeAvatarSilences,
  type MindAdsTakeSegment,
} from '@/lib/ffmpeg-worker';
import {
  CancelledError,
  downloadAsBlob,
  generateBrolls,
  generateSrtFromAudio,
  heygenPollUntilDone,
  heygenStart,
  type BrollResult,
  type PipelineSignal,
} from '@/lib/mind-ads-pipeline';
import {
  MIND_ADS_TIERS,
  estimateAdCost,
  type MindAdsTier,
} from '@/lib/mind-ads-models';
import {
  detectExtension,
  generateAvatarPart,
  splitCopyIntoParts,
  type ExtensionStatus,
} from '@/lib/heygen-extension-bridge';
import {
  HeyGenAvatarPicker,
  type AvatarOption,
} from '@/components/HeyGenAvatarPicker';
import {
  HeyGenVoicePicker,
  type VoiceOption,
  type ClonedVoice,
} from '@/components/HeyGenVoicePicker';
import { buildZip } from '@/lib/zip-builder';

/**
 * Mind Ads Suite — pipeline completo MEGAZORD.
 *
 * Etapas:
 *  1. Claude segmenta copy em takes (avatar/broll) + gera prompts B-roll
 *  2. HeyGen gera avatar falando a copy completa (sem timeout, polling)
 *  3. Em paralelo: Replicate Nano Banana Pro -> Wan 2.1 pra cada take broll
 *  4. FFmpeg WASM corta silencios do avatar (tolerancia 50ms)
 *  5. FFmpeg WASM monta video final: avatar slices + broll videos + bg music + hook
 *  6. AssemblyAI gera SRT final alinhado a copy
 *
 * Deliverables: MP4 final, MP4 avatar isolado, ZIP de brolls, SRT.
 * Acesso restrito ao admin.
 */

type AvatarType = 'III' | 'IV' | 'V';
type HookLayout = 'fullscreen' | 'split' | 'react';
type AvatarSource = 'auto' | 'upload';

type Take = {
  n: number;
  type: 'avatar' | 'broll';
  copyText: string;
  broll?: {
    imagePrompt: string;
    animationPrompt: string;
  };
};

type PipelineResult = {
  finalVideo: Blob;
  avatarIsolated: Blob;
  brolls: Array<{ n: number; video: Blob; image: Blob }>;
  srt: string;
  srtProvider: string;
  tier: MindAdsTier;
};

export default function MindAdsPage() {
  const [adName, setAdName] = useToolState<string>('mindads:adName', '');
  const [niche, setNiche] = useToolState<string>('mindads:niche', '');
  const [mainHook, setMainHook] = useToolState<string>('mindads:mainHook', '');
  const [altHook1, setAltHook1] = useToolState<string>('mindads:altHook1', '');
  const [altHook2, setAltHook2] = useToolState<string>('mindads:altHook2', '');
  const [altHook3, setAltHook3] = useToolState<string>('mindads:altHook3', '');
  const [body, setBody] = useToolState<string>('mindads:body', '');
  // Avatar picker state (substituiu o input de link bruto)
  const [avatarQuery, setAvatarQuery] = useToolState<string>(
    'mindads:avatarQuery',
    '',
  );
  const [selectedAvatar, setSelectedAvatar] = useToolState<AvatarOption | null>(
    'mindads:avatar',
    null,
  );
  // Voice picker state
  const [overrideVoice, setOverrideVoice] = useToolState<boolean>(
    'mindads:overrideVoice',
    false,
  );
  const [voiceQuery, setVoiceQuery] = useToolState<string>(
    'mindads:voiceQuery',
    '',
  );
  const [selectedVoice, setSelectedVoice] = useToolState<VoiceOption | null>(
    'mindads:voice',
    null,
  );
  const [clonedVoices, setClonedVoices] = useToolState<ClonedVoice[]>(
    'mindads:clonedVoices',
    [],
  );
  const [avatarType, setAvatarType] = useToolState<AvatarType>(
    'mindads:avatarType',
    'IV',
  );
  const [hookLayout, setHookLayout] = useToolState<HookLayout>(
    'mindads:hookLayout',
    'fullscreen',
  );
  const [avatarSource, setAvatarSource] = useToolState<AvatarSource>(
    'mindads:avatarSource',
    'auto',
  );
  const [bgMusicVolume, setBgMusicVolume] = useToolState<number>(
    'mindads:bgVolume',
    20,
  );
  const [tier, setTier] = useToolState<MindAdsTier>('mindads:tier', 'eco');
  const [extStatus, setExtStatus] = useState<ExtensionStatus>({
    connected: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await detectExtension();
      if (!cancelled) setExtStatus(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [hookVideo, setHookVideo] = useState<File | null>(null);
  const [bgMusic, setBgMusic] = useState<File | null>(null);
  const [avatarUpload, setAvatarUpload] = useState<File | null>(null);

  const [takes, setTakes] = useState<Take[] | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);

  const cancelRef = useRef<boolean>(false);
  const fullCopy = [mainHook, body].filter((s) => s.trim()).join('\n\n');
  const safeName = (adName.trim() || 'mindads').replace(/[^a-z0-9_-]/gi, '_');

  function reset() {
    setTakes(null);
    setStage(null);
    setProgress(null);
    setError(null);
    setResult(null);
  }

  function cancel() {
    cancelRef.current = true;
    cancelFFmpeg();
    setStage('Cancelando...');
  }

  async function generatePrompts(): Promise<Take[]> {
    setStage('Claude segmentando copy em takes...');
    const altHooks = [altHook1, altHook2, altHook3]
      .map((h) => h.trim())
      .filter((h) => h.length > 0);

    const res = await fetch('/api/mind-ads/generate-prompts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        copy: fullCopy,
        niche,
        hookVariants: altHooks,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Falha em gerar prompts.');
    const list = json.takes as Take[];
    setTakes(list);
    return list;
  }

  async function runPipeline() {
    if (fullCopy.trim().length < 50) {
      setError('Copy muito curta. Preencha hook + body (minimo 50 chars).');
      return;
    }
    if (!niche.trim()) {
      setError('Informe o nicho.');
      return;
    }
    if (avatarSource === 'auto' && !selectedAvatar) {
      setError('Selecione um avatar HeyGen pelo nome (busca acima) ou troque pra upload.');
      return;
    }
    if (avatarSource === 'upload' && !avatarUpload) {
      setError('Envie o video do avatar pre-pronto.');
      return;
    }

    cancelRef.current = false;
    reset();
    setProcessing(true);

    const signal: PipelineSignal = {
      isCancelled: () => cancelRef.current,
      onStage: (s) => setStage(s),
      onProgress: (p) => setProgress(p),
    };

    try {
      // 1) Prompts via Claude
      const allTakes = await generatePrompts();
      if (cancelRef.current) throw new CancelledError();

      // 2) Avatar: extensao DARKO LAB (preferido) → API HeyGen (fallback) → upload
      let avatarBlob: Blob;
      if (avatarSource === 'upload' && avatarUpload) {
        setStage('Usando avatar pre-pronto...');
        avatarBlob = avatarUpload;
      } else if (extStatus.connected) {
        // Caminho preferido: extension automatiza usando sua sessao HeyGen.
        // Divide copy em paragrafos (≤40s cada). Cada paragrafo = 1 geracao
        // separada no Script-to-Video do HeyGen. Depois concat tudo.
        const copyParts = splitCopyIntoParts(fullCopy, {
          targetSec: 20,
          minSec: 10,
          maxSec: 35,
        });
        setStage(
          `Extensao DARKO LAB gerando avatar — ${copyParts.length} parte(s)...`,
        );

        const partUrls: string[] = [];
        for (let i = 0; i < copyParts.length; i++) {
          if (cancelRef.current) throw new CancelledError();
          const partLabel = `parte${i + 1}`;
          setStage(
            `Gerando ${partLabel}/${copyParts.length} via HeyGen Script-to-Video...`,
          );
          const url = await generateAvatarPart(
            {
              copy: copyParts[i],
              avatarId: selectedAvatar!.id,
              voiceId:
                overrideVoice && selectedVoice ? selectedVoice.id : undefined,
              motor: avatarType,
              partLabel,
            },
            (s) =>
              setStage(`${partLabel} (${i + 1}/${copyParts.length}): ${s}`),
          );
          partUrls.push(url);
        }
        if (cancelRef.current) throw new CancelledError();

        setStage('Baixando partes via proxy...');
        const partBlobs = await Promise.all(
          partUrls.map((u) => downloadAsBlob(u, signal, 'video/mp4')),
        );

        if (partBlobs.length === 1) {
          avatarBlob = partBlobs[0];
        } else {
          avatarBlob = await concatAvatarParts(partBlobs, {
            onStage: (s) => setStage(s),
            onProgress: (p) => setProgress(p.ratio),
          });
        }
      } else {
        // Fallback: API HeyGen (consome credito da API)
        setStage('HeyGen API iniciando geracao (extensao nao detectada)...');
        const { videoId } = await heygenStart({
          avatarId: selectedAvatar!.id,
          copy: fullCopy,
          voiceId:
            overrideVoice && selectedVoice ? selectedVoice.id : undefined,
          avatarType,
        });
        if (cancelRef.current) throw new CancelledError();
        const avatarUrl = await heygenPollUntilDone(videoId, signal);
        if (cancelRef.current) throw new CancelledError();

        setStage('Baixando avatar do HeyGen...');
        avatarBlob = await downloadAsBlob(avatarUrl, signal, 'video/mp4');
      }

      // 3) Silence cut do avatar
      setProgress(null);
      const avatarCut = await removeAvatarSilences(avatarBlob, 0.05, {
        onStage: (s) => setStage(s),
        onProgress: (p) => setProgress(p.ratio),
      });
      if (cancelRef.current) throw new CancelledError();

      // 4) Brolls em paralelo (Replicate)
      const brollTakes = allTakes
        .filter((t) => t.type === 'broll' && t.broll)
        .map((t) => ({
          n: t.n,
          imagePrompt: t.broll!.imagePrompt,
          animationPrompt: t.broll!.animationPrompt,
        }));

      let brollResults: BrollResult[] = [];
      if (brollTakes.length > 0) {
        setStage(
          `Gerando ${brollTakes.length} b-rolls (${MIND_ADS_TIERS[tier].shortDesc})...`,
        );
        setProgress(null);
        brollResults = await generateBrolls(brollTakes, signal, 3, tier);
        if (cancelRef.current) throw new CancelledError();
      }

      // 5) Baixa os videos brolls + imagens
      setStage('Baixando b-rolls...');
      const brollAssets = await Promise.all(
        brollResults.map(async (br) => ({
          n: br.n,
          video: await downloadAsBlob(br.videoUrl, signal, 'video/mp4'),
          image: await downloadAsBlob(br.imageUrl, signal, 'image/jpeg'),
        })),
      );
      if (cancelRef.current) throw new CancelledError();

      // 6) Montagem final
      setStage('Calculando duracao do avatar...');
      const meta = await probeVideoMetadata(avatarCut);
      const totalDur = meta?.durationSec ?? 0;
      if (totalDur < 1) {
        throw new Error(
          'Duracao do avatar invalida. Verifique o video do HeyGen.',
        );
      }

      const lengths = allTakes.map((t) => t.copyText.length);
      const boundaries = estimateTakeBoundaries(lengths, totalDur);
      const segments: MindAdsTakeSegment[] = allTakes.map((t, i) => ({
        n: t.n,
        type: t.type,
        startSec: boundaries[i].startSec,
        endSec: boundaries[i].endSec,
        brollVideo:
          t.type === 'broll'
            ? brollAssets.find((b) => b.n === t.n)?.video
            : undefined,
      }));

      setStage('Montando video final (FFmpeg WASM)...');
      setProgress(null);
      const finalVideo = await mindAdsMontage(
        {
          avatar: avatarCut,
          takes: segments,
          bgMusic: bgMusic ?? null,
          bgVolume: bgMusicVolume,
          hookVideo: hookVideo ?? null,
          hookLayout,
        },
        {
          onStage: (s) => setStage(s),
          onProgress: (p) => setProgress(p.ratio),
        },
      );
      if (cancelRef.current) throw new CancelledError();

      // 7) Gera SRT — extrai audio do AVATAR cortado (mais limpo, sem bg music
      //    e sem hook video). Se houver hook, o usuario shifta o SRT no editor.
      setStage('Extraindo audio pra SRT...');
      setProgress(null);
      const audioForSrt = await extractAudioForTranscription(avatarCut, {
        onStage: (s) => setStage(s),
        onProgress: (p) => setProgress(p.ratio),
      });
      if (cancelRef.current) throw new CancelledError();

      setStage(
        tier === 'premium'
          ? 'Gerando SRT (AssemblyAI)...'
          : 'Gerando SRT (Groq Whisper)...',
      );
      const { srt, provider: srtProvider } = await generateSrtFromAudio(
        audioForSrt,
        fullCopy,
        tier,
      );

      setResult({
        finalVideo,
        avatarIsolated: avatarCut,
        brolls: brollAssets,
        srt,
        srtProvider,
        tier,
      });
      setStage(null);
      setProgress(null);
    } catch (e) {
      if (e instanceof CancelledError || isCancellationError(e)) {
        setError('Pipeline cancelado.');
      } else {
        setError((e as Error).message || 'Falha desconhecida.');
      }
      setStage(null);
      setProgress(null);
    } finally {
      setProcessing(false);
      cancelRef.current = false;
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadBrollsZip() {
    if (!result || result.brolls.length === 0) return;
    const entries = result.brolls.flatMap((b) => [
      {
        name: `brolls/take_${String(b.n).padStart(2, '0')}.mp4`,
        data: b.video,
      },
      {
        name: `brolls/take_${String(b.n).padStart(2, '0')}.jpg`,
        data: b.image,
      },
    ]);
    const blob = await buildZip(entries);
    downloadBlob(blob, `${safeName}_brolls.zip`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Heartbeat />
      <Header />
      <main className="container-app flex-1 py-10">
        <ToolShell
          title="Mind Ads Suite"
          description="Megazord. Voce manda copy + nicho + avatar HeyGen, a Mind Ads gera o anuncio completo: avatar falando + b-rolls IA + montagem + SRT. Pipeline em 6 etapas (Claude → HeyGen → Replicate Nano Banana Pro → Wan 2.1 → FFmpeg → AssemblyAI). Acesso restrito ao admin."
        >
          <div className="mb-6 rounded-[12px] border border-yellow-500/40 bg-yellow-500/5 px-4 py-3">
            <div className="flex items-start gap-2">
              <span className="text-yellow-300">⚡</span>
              <div className="text-xs text-yellow-300/90">
                <strong className="text-yellow-300">
                  Em fase revolucionaria
                </strong>
                . Pipeline completo ligado: Claude segmenta copy, HeyGen gera
                avatar, Replicate gera b-rolls, FFmpeg monta, AssemblyAI
                legenda. A revolucao do trafego pago em uma ferramenta so.
              </div>
            </div>
          </div>

          <MissingKeyBanner
            services={
              tier === 'premium'
                ? ['anthropic', 'heygen', 'replicate', 'assemblyai']
                : ['anthropic', 'heygen', 'replicate', 'groq']
            }
          />

          <div className="mt-6 flex flex-col gap-6">
            {/* Tier de qualidade / custo */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="label-field !mb-0">
                  Qualidade / custo por anuncio
                </h2>
                <span className="mono text-[11px] text-text-muted">
                  ad ~60s, 8 brolls
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(['eco', 'padrao', 'premium'] as const).map((t) => {
                  const cfg = MIND_ADS_TIERS[t];
                  const active = tier === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTier(t)}
                      disabled={processing}
                      className={
                        'flex flex-col gap-1 rounded-[12px] border px-4 py-3 text-left transition-all duration-200 active:scale-[0.98] ' +
                        (active
                          ? 'border-lime bg-lime/10 text-white shadow-[0_0_18px_-4px_rgba(200,255,0,0.5)]'
                          : 'border-line-strong bg-bg-soft/30 text-text-muted hover:border-lime hover:text-white')
                      }
                    >
                      <div className="flex items-baseline justify-between">
                        <span
                          className={
                            'mono text-xs uppercase tracking-widest ' +
                            (active ? 'text-lime' : '')
                          }
                        >
                          {cfg.label}
                        </span>
                        <span
                          className={
                            'mono text-sm font-semibold ' +
                            (active ? 'text-lime' : 'text-text-muted')
                          }
                        >
                          {cfg.costEstimate}
                        </span>
                      </div>
                      <span className="text-[11px] leading-snug text-text-muted">
                        {cfg.shortDesc}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                {tier === 'eco'
                  ? '⚡ Default. Flux schnell + Kling 1.6 + Groq Whisper. Custo minimo, qualidade muito boa pra ad.'
                  : tier === 'padrao'
                    ? '⚡ Equilibrio. Flux dev (mais detalhado) + Luma Ray 2 (movimento mais natural) + Groq.'
                    : '👑 Premium. Nano Banana Pro + Wan 2.1 + AssemblyAI. Para hero ads onde cada frame conta.'}
              </p>

              {/* Estimativa de custo dinamica */}
              {takes && takes.length > 0 ? (
                <CostEstimate
                  tier={tier}
                  numBrolls={takes.filter((t) => t.type === 'broll').length}
                />
              ) : null}
            </section>

            {/* Identidade */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Identidade</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={adName}
                  onChange={(e) => setAdName(e.target.value)}
                  placeholder="Nomenclatura do AD (nome do arquivo)"
                  className="input-field"
                  disabled={processing}
                />
                <input
                  type="text"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="Nicho do produto (ex: emagrecimento, financas)"
                  className="input-field"
                  disabled={processing}
                />
              </div>
            </section>

            {/* Copy */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Copy completa</h2>
              <div className="grid gap-3">
                <input
                  type="text"
                  value={mainHook}
                  onChange={(e) => setMainHook(e.target.value)}
                  placeholder="Hook principal"
                  className="input-field"
                  disabled={processing}
                />
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={altHook1}
                    onChange={(e) => setAltHook1(e.target.value)}
                    placeholder="Hook alternativo 1"
                    className="input-field"
                    disabled={processing}
                  />
                  <input
                    type="text"
                    value={altHook2}
                    onChange={(e) => setAltHook2(e.target.value)}
                    placeholder="Hook alternativo 2"
                    className="input-field"
                    disabled={processing}
                  />
                  <input
                    type="text"
                    value={altHook3}
                    onChange={(e) => setAltHook3(e.target.value)}
                    placeholder="Hook alternativo 3"
                    className="input-field"
                    disabled={processing}
                  />
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Body da copy (problema → mecanismo → solucao → prova → oferta → CTA)..."
                  rows={8}
                  className="input-field resize-y font-mono text-sm"
                  disabled={processing}
                />
              </div>
            </section>

            {/* HeyGen Avatar — fonte primeiro, depois picker condicional */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Avatar do anuncio</h2>
              <div className="flex flex-wrap gap-2">
                <span className="label-field !mb-0 mr-2 self-center">Fonte:</span>
                {(
                  [
                    { id: 'auto' as const, label: 'Gerar via HeyGen' },
                    { id: 'upload' as const, label: 'Upload pre-pronto' },
                  ]
                ).map((s) => {
                  const active = avatarSource === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setAvatarSource(s.id)}
                      disabled={processing}
                      className={
                        'rounded-[12px] px-4 py-2 text-sm transition-all duration-200 active:scale-[0.97] ' +
                        (active
                          ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                          : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                      }
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {avatarSource === 'auto' ? (
                <>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                    <span className="label-field !mb-0 mr-2 self-center">Motor:</span>
                    {(['III', 'IV', 'V'] as const).map((t) => {
                      const active = avatarType === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setAvatarType(t)}
                          disabled={processing}
                          className={
                            'rounded-[12px] px-4 py-2 text-sm transition-all duration-200 active:scale-[0.97] ' +
                            (active
                              ? 'bg-lime font-semibold text-black shadow-[0_0_18px_-4px_rgba(200,255,0,0.6)]'
                              : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                          }
                        >
                          Avatar {t}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-text-muted">
                    {avatarType === 'III'
                      ? '✓ Avatar III (Photo) — ilimitado, nao consome creditos'
                      : avatarType === 'IV'
                        ? 'Avatar IV (Studio) — creditos do plano'
                        : 'Avatar V (Studio Plus / Premium) — creditos premium'}
                  </p>
                  <div className="mt-4 border-t border-line pt-4">
                    <HeyGenAvatarPicker
                      query={avatarQuery}
                      setQuery={setAvatarQuery}
                      selected={selectedAvatar}
                      setSelected={setSelectedAvatar}
                      disabled={processing}
                      label="Avatar (sua biblioteca HeyGen)"
                    />
                  </div>
                  <div className="mt-4 border-t border-line pt-4">
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
                  </div>
                </>
              ) : (
                <div className="mt-4 border-t border-line pt-4">
                  <h3 className="label-field !mb-3">Upload do video do avatar</h3>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={(e) => setAvatarUpload(e.target.files?.[0] ?? null)}
                    className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                    disabled={processing}
                  />
                  {avatarUpload ? (
                    <div className="mt-1 text-[11px] text-text-muted">
                      {avatarUpload.name} ({(avatarUpload.size / 1024 / 1024).toFixed(1)} MB)
                    </div>
                  ) : null}
                  <p className="mt-2 text-[11px] text-text-muted">
                    Use um video MP4 vertical (9:16) com o avatar falando a copy
                    completa. Ferramenta corta silencios e usa esse video direto
                    no pipeline (sem chamar HeyGen).
                  </p>
                </div>
              )}
            </section>

            {/* Hook video */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Hook video (opcional)</h2>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={(e) => setHookVideo(e.target.files?.[0] ?? null)}
                className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                disabled={processing}
              />
              {hookVideo ? (
                <>
                  <div className="mt-1 text-[11px] text-text-muted">
                    {hookVideo.name}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="label-field !mb-0 mr-2 self-center">
                      Layout:
                    </span>
                    {(
                      [
                        { id: 'fullscreen' as const, label: 'Tela cheia' },
                        { id: 'split' as const, label: 'Tela dividida' },
                        { id: 'react' as const, label: 'React (sobreposto)' },
                      ]
                    ).map((l) => {
                      const active = hookLayout === l.id;
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setHookLayout(l.id)}
                          disabled={processing}
                          className={
                            'rounded-[12px] px-4 py-2 text-sm transition-all duration-200 active:scale-[0.97] ' +
                            (active
                              ? 'bg-lime font-semibold text-black'
                              : 'border border-line-strong text-text-muted hover:border-lime hover:text-white')
                          }
                        >
                          {l.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </section>

            {/* BG music */}
            <section className="border-t border-line pt-6">
              <h2 className="label-field !mb-3">Musica de fundo (opcional)</h2>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setBgMusic(e.target.files?.[0] ?? null)}
                className="input-field file:mr-3 file:rounded-md file:border-0 file:bg-lime file:px-3 file:py-1 file:text-xs file:font-semibold file:text-black"
                disabled={processing}
              />
              {bgMusic ? (
                <>
                  <div className="mt-1 text-[11px] text-text-muted">
                    {bgMusic.name}
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <label className="label-field !mb-0">
                        Volume da musica
                      </label>
                      <span className="mono text-xs text-lime">
                        {bgMusicVolume}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={bgMusicVolume}
                      onChange={(e) => setBgMusicVolume(parseInt(e.target.value))}
                      className="mt-3"
                      disabled={processing}
                    />
                  </div>
                </>
              ) : null}
            </section>

            {/* Action */}
            <div className="flex flex-wrap gap-3 border-t border-line pt-6">
              {processing ? (
                <CancelButton onClick={cancel} label="Cancelar pipeline" />
              ) : (
                <button
                  onClick={runPipeline}
                  className="btn-primary"
                  disabled={
                    !niche.trim() ||
                    fullCopy.trim().length < 50 ||
                    (avatarSource === 'auto' && !selectedAvatar)
                  }
                >
                  Gerar anuncio completo (pipeline)
                </button>
              )}
            </div>

            {error ? (
              <div
                key={error}
                role="alert"
                className="error-shake rounded-[12px] border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300 shadow-[0_0_22px_-8px_rgba(248,113,113,0.6)]"
              >
                {error}
              </div>
            ) : null}

            {stage ? (
              <div className="scan-line rounded-[12px] border border-lime/40 bg-bg-soft/40 px-4 py-3 text-xs text-lime">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_8px_rgba(200,255,0,0.9)]" />
                  </span>
                  <span className="mono uppercase tracking-widest">{stage}</span>
                </div>
                {progress !== null ? (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full bg-lime transition-all"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Takes preview (durante e apos pipeline) */}
            {takes && takes.length > 0 ? (
              <div className="fade-in-up mt-2 border-t border-line pt-6">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-lime">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-pulse-soft rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_rgba(200,255,0,0.9)]" />
                  </span>
                  {takes.length} takes segmentados
                </h3>
                <ul className="grid gap-2">
                  {takes.map((t) => (
                    <li
                      key={t.n}
                      className="rounded-[12px] border border-line bg-bg p-3 text-xs"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="mono rounded-full bg-lime/10 px-2 py-0.5 text-lime">
                          TAKE {String(t.n).padStart(2, '0')}
                        </span>
                        <span
                          className={
                            'mono rounded-full px-2 py-0.5 ' +
                            (t.type === 'avatar'
                              ? 'bg-blue-500/10 text-blue-300'
                              : 'bg-purple-500/10 text-purple-300')
                          }
                        >
                          {t.type === 'avatar' ? 'AVATAR' : 'B-ROLL'}
                        </span>
                      </div>
                      <p className="text-sm text-white">{t.copyText}</p>
                      {t.broll ? (
                        <div className="mt-2 grid gap-1 text-[11px] text-text-muted">
                          <div>
                            <strong className="text-purple-300">imagem:</strong>{' '}
                            {t.broll.imagePrompt}
                          </div>
                          <div>
                            <strong className="text-purple-300">animacao:</strong>{' '}
                            {t.broll.animationPrompt}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Resultado final — 4 downloads */}
            {result ? (
              <div className="fade-in-up mt-2 rounded-[12px] border border-lime/50 bg-lime/5 p-4 shadow-[0_0_28px_-8px_rgba(200,255,0,0.6)]">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-lime">
                    <span className="text-lg">✓</span>
                    Pipeline concluido
                  </h3>
                  <span className="mono rounded-full bg-lime/10 px-2 py-0.5 text-[10px] uppercase text-lime">
                    {MIND_ADS_TIERS[result.tier].label}
                  </span>
                  <span className="mono rounded-full bg-bg/60 px-2 py-0.5 text-[10px] uppercase text-text-muted">
                    SRT via {result.srtProvider}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() =>
                      downloadBlob(result.finalVideo, `${safeName}_final.mp4`)
                    }
                    className="btn-primary w-full"
                  >
                    Baixar MP4 final
                  </button>
                  <button
                    onClick={() =>
                      downloadBlob(
                        result.avatarIsolated,
                        `${safeName}_avatar.mp4`,
                      )
                    }
                    className="rounded-[12px] border border-line-strong bg-bg-soft px-4 py-2.5 text-sm text-white transition-all hover:border-lime hover:text-lime"
                  >
                    Avatar isolado (MP4)
                  </button>
                  <button
                    onClick={downloadBrollsZip}
                    disabled={result.brolls.length === 0}
                    className="rounded-[12px] border border-line-strong bg-bg-soft px-4 py-2.5 text-sm text-white transition-all hover:border-lime hover:text-lime disabled:opacity-50"
                  >
                    B-rolls ({result.brolls.length}) — ZIP
                  </button>
                  <button
                    onClick={() =>
                      downloadBlob(
                        new Blob([result.srt], { type: 'text/plain' }),
                        `${safeName}.srt`,
                      )
                    }
                    className="rounded-[12px] border border-line-strong bg-bg-soft px-4 py-2.5 text-sm text-white transition-all hover:border-lime hover:text-lime"
                  >
                    Legendas (SRT)
                  </button>
                </div>
                <pre className="mt-3 max-h-48 overflow-auto rounded-[10px] border border-line bg-bg p-3 text-[10px] text-text-muted">
                  {result.srt.slice(0, 600)}
                  {result.srt.length > 600 ? '\n...' : ''}
                </pre>
              </div>
            ) : null}
          </div>
        </ToolShell>
      </main>
    </div>
  );
}

/**
 * CostEstimate — chip mostrando estimativa de custo do anuncio em USD,
 * baseado no tier escolhido + numero de takes broll detectados pelo Claude.
 */
function CostEstimate({
  tier,
  numBrolls,
}: {
  tier: MindAdsTier;
  numBrolls: number;
}) {
  const est = estimateAdCost(tier, numBrolls, 1);
  return (
    <div className="mt-3 rounded-[10px] border border-lime/30 bg-lime/5 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mono text-[10px] uppercase tracking-widest text-lime">
          Estimativa pra esse anuncio
        </span>
        <span className="mono text-base font-semibold text-lime">
          ${est.total.toFixed(2)}
        </span>
        <span className="text-[11px] text-text-muted">
          ({numBrolls} broll{numBrolls === 1 ? '' : 's'})
        </span>
      </div>
      <div className="mt-1 grid gap-0.5 text-[10px] text-text-muted">
        <div>
          Imagens: ${est.breakdown.images.toFixed(3)} · Videos: $
          {est.breakdown.videos.toFixed(3)}
        </div>
        <div>
          Transcricao: ${est.breakdown.transcription.toFixed(3)} · Claude: $
          {est.breakdown.claude_prompts.toFixed(3)} · HeyGen: $0 (mensalidade)
        </div>
      </div>
    </div>
  );
}
