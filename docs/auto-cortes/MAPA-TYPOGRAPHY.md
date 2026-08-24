# Mapa do engine de legendas (lib/typography) — levantado 22.08.2026

## engine.ts (2773 linhas)
- `drawCaptions(realCtx, blocks: Block[], basePreset: TypoPreset, styleIn: StyleState, tMs: number, W: number, H: number): void` (L1291) — único renderer. Escolhe o bloco ativo (`tMs >= b.start && tMs < b.end`), NUNCA limpa o canvas nem desenha o vídeo (caller é dono do fundo). Determinístico (PRNG por hash do bloco). `ctx.save/restore` interno. Usa offscreen para glitch bands.
- `captionBBoxAt(ctx, blocks, preset, style, tMs, W, H)` (L2591), `wordBoxesAt(...)` (L2648), `drawPresetDemo(ctx, preset, tLoop, W, H, demoText='SUA LEGENDA AQUI')` (L2733), `autoEmphasisIndex(block)` (L439), `DEFAULT_STYLE` (L395: fontScale 1, posY 0.76, posX 0.5, autoEmphasis true, autoFit true, bgMode 'preset'...).
- Tipos: `TWord = { text; start; end }` (ms), `Block = { id; words: TWord[]; start; end }` (L53-54). `StyleState` (L304-352): presetId, fontScale, posY, primary, accent, uppercase, highlights, autoEmphasis?, fontOverride?, posX?, textCase?, bold/italic/underline?, fxStroke/fxShadow/fxGlow/fxSmoke?, autoFit?, bgMode?, bgColor?, bgOpacity?, wordStyles?, perBlock?. `TypoPreset` (L127-302): id, name, cat, font: FontKey, size (fração da LARGURA do canvas), unit, in, out, loop?, defaultPrimary, defaultAccent + ~70 opcionais.
- Layout: `fontPx = preset.size * W * style.fontScale` (L597); wrap `maxLineW = W*0.86`; `topY = style.posY*H - blockH/2` clamp [H*0.04, H*0.96-blockH]; `cx = posX*W`. SEM lógica de aspecto: tamanho segue a LARGURA → em 16:9 a legenda parece maior; compensar via `style.fontScale` por aspecto.

## presets.ts / presets-gen.ts
- `TYPO_PRESETS: TypoPreset[]` (491 = 208 manuais + 283 gerados), `TYPO_CATEGORIES: string[]` (17: Viral, Cartoon, Glitch, Destaque, Máquina, Minimal, Kinetic, Impacto, Neon, Estilo, Premium, Cor, Karaokê, Bounce, Foco, Reveal, Editorial), `getPreset(id)` (fallback TYPO_PRESETS[0] = 'titulo-viral').
- Favoritos do Silas: Vermelho Sangue, Título Ouro, Glitch Viral, Verde Dinheiro, Empilhado, Extensão Script.

## group.ts
- `type GroupPace = 'palavra' | 'rapido' | 'equilibrado' | 'frases'`; `groupWords(rawWords: TWord[], pace): Block[]`; `blockText(b)`, `retimeBlockText(b, newText)`, `splitBlock(b)`, `mergeBlocks(a,b)`, `blocksToSrt(blocks)`. Ids por contador global do módulo (únicos na sessão).

## fonts.ts
- `FontKey` (48 fontes), `TYPO_FONTS`, `ensureTypoFonts(keys?: FontKey[]): Promise<void>` (subset OK; aguardar ANTES do 1º fillText), `fontCss(key, px)`.

## export.ts (726 linhas) — ÚNICA função exportada
- `renderTypographyVideo({ file, blocks, preset, style, onProgress?, signal?, forceSeekPath? }): Promise<RenderResult>`; `RenderProgress = { phase: 'fontes'|'frames'|'audio'|'finalizando'; ratio; frame?; totalFrames? }`; `RenderResult = { blob; audioOk; width; height; fps; mode: 'decode'|'seek' }`.
- SEM hook por frame, SEM trim, SEM crop/saída custom: W/H vêm do vídeo-fonte (L611-614), duração = container inteiro. Desenho hardwired: `ctx.drawImage(src,0,0,W,H); drawCaptions(...)` em L291-293 (fast) e L508-510 (seek).
- Internos reutilizáveis: `makeSink(codec,W,H,bitrate)` (mp4-muxer, fastStart in-memory, keyframe a cada 4s), `pickCodec` (avc1.640033→...→42e01f via isConfigSupported), `nextTask()` via MessageChannel (backpressure imune a aba oculta; decodeQueue>12 / encodeQueue>6), demux mp4box `createFile(true)` + append ÚNICO + `setExtractionOptions(track.id,null,{nbSamples:100})`; fallback seek quando: sem VideoDecoder, arquivo >300MB (FASTPATH_MAX_BYTES), não-ISOBMFF, sem avcC/hvcC/vpcC/av1C, rotação/SAR divergente, ou throw.
- Bitrate: `min(max(W*H*30*0.12, min(srcRate, 20M), 2.5M), budgetRate)`; RENDER_BYTES_BUDGET = 300MB (MEMFS do mux de áudio).
- Áudio: `runFfmpegExclusive(() => extractAudio(file) → muxAudioIntoVideo(videoOnly, wav))`; falha = não-fatal (`audioOk:false`).
- Cancel: `signal` + `CANCELLED_ERROR`/`isCancellationError` de `@/lib/ffmpeg-worker`.
- CFR: decoder em ordem de exibição; cada tick 30fps usa o último frame com pts <= tick. PONTO DE ENGATE pra clipe: pular ticks fora de [startSec,endSec] e deslocar t.

## copy-fix.ts
- `correctBlocksByCopy(blocks, copyText): { blocks; corrected; added; coverage }` — não mexe em timing/contagem.

## app/tools/tipografia/page.tsx (3818 linhas, tudo local)
- Limites: MAX_FILE_BYTES 800MB, MAX_DURATION_SEC 20min.
- Transcrição: `extractAudioForTranscription(file, {onStage,onProgress}, durationSec)` (lib/ffmpeg-worker L1639 → opus mono 16k, `pickTranscribeBitrateKbps` L1632 com budget 3.8MB, 12..64kbps) → guard 4.4MB → `POST /api/tipografia/transcribe` FormData(audio, language) → `{ words: TWord[], provider }`. Rota: runtime nodejs, maxDuration 300, requireTier('free'), `transcribeAudio(audio, { provider:'groq', language })` (Groq whisper → fallback AssemblyAI). Word shape = `lib/decupagem-matcher.ts:61 Word {text,start,end,confidence?}` (ms).
- `PresetGallery({ presetId, onPick, favs, onToggleFav, disabled? })` L1953-2191 — LOCAL à page (pra reusar: extrair pra components/). Um canvas por card, rAF único, IO rootMargin 160px, prepaint máx 3/tick, FAV_CAT '⭐ Favoritos'.
- `LangPicker({ value, onChange, disabled? })` L2840-2939 — local; usa `@/components/Popover`; `langLabel(code)` L133; `LANGS` lista.
- Favoritos: localStorage 'tipografia:favs' + Supabase `user_tool_prefs.tipografia_favs` (upsert). Estado via `useToolState<T>(key, default)` de `@/components/ToolsStateProvider`.
- Export: `renderTypographyVideo({file, blocks, preset, style, signal, onProgress})`; depois `logHistory({ tool:'tipografia', ... })` + `downloadBlob(out.blob, nome)`.
- PreviewPane: canvas TRANSPARENTE sobre `<video>`; rAF `clearRect + drawCaptions(ctx, b, p, s, v.currentTime*1000, W, H)`; dpr = min(devicePixelRatio, 2).

## components/TipoShowcase.tsx
- `TipoShowcase({ className?, variant?: 'hero'|'card' })` — canvas cicla lista fixa; padrão canônico de `ensureTypoFonts(subset)` antes do 1º frame + IO gating + `drawPresetDemo`.

## Notas práticas
- Tempos de Block/TWord são ABSOLUTOS do vídeo-fonte → pra clipe [t0,t1] deslocar por -t0 e filtrar/clampar blocos.
- Reuso verbatim: groupWords, correctBlocksByCopy, ensureTypoFonts, drawCaptions, getPreset/TYPO_PRESETS.
- Precisa de um export NOVO (fork de export.ts) com startSec/endSec, outW/outH, compose/onDrawFrame, mantendo makeSink/pickCodec/nextTask/demux/audio-mux.
