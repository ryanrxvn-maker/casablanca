# AUTO CORTES — fases de execução (agentes Opus)

Leia antes: `ARQUITETURA.md` (o quê e por quê), `lib/auto-cortes/types.ts` (contrato — NÃO mudar
sem avisar; pode ADICIONAR campos opcionais), `lib/auto-cortes/prompts.ts` (inteligência — não
reescrever os prompts), `MAPA-TYPOGRAPHY.md` (engine de legendas), `REGISTRO.md` (camadas da
tool + ponte da extensão + limites), `OPUS-REFERENCIA.md` (o que estamos copiando).

Regras pra TODO agente:
- Fix aditivo: não alterar comportamento de nada que já existe (Tipografia, Compressor, Downloader, Pilot). Se precisar de algo privado (ex.: `makeInputsAvailable`), EXPORTE com nome novo e mantenha o original.
- Erros sempre `FriendlyError` (lib/friendly-error.ts) com texto PT-BR acionável; nunca stack/JSON cru pro cliente.
- Aba em 2º plano: nunca `setTimeout` pra esperar trabalho longo — `sleepUnthrottled` (lib/unthrottled-clock.ts) ou MessageChannel.
- Nada de `Date.now()`/`Math.random()` dentro do desenho de frame (determinismo do render).
- `npx tsc --noEmit` limpo e testes novos entrando no script `test` do package.json (padrão: `tsc arquivo.ts arquivo.test.ts --outDir .test-tmp ... && node .test-tmp/arquivo.test.js`, ver package.json).
- Comentários e mensagens em PT-BR (padrão do repo). Sem emoji no código.
- Ao terminar: relatório curto com arquivos criados/alterados, o que foi testado e o que ficou pendente. Não commitar (o orquestrador commita).

---

## FASE 1 — fundações (4 agentes em paralelo, arquivos disjuntos)

### A1 · ffmpeg + transcrição em pedaços
Arquivos: `lib/ffmpeg-worker.ts` (aditivo), `lib/auto-cortes/transcribe.ts`, `lib/auto-cortes/transcript.ts`, `lib/auto-cortes/transcript.test.ts`, `app/api/auto-cortes/transcribe/route.ts`.

1. Em `lib/ffmpeg-worker.ts` (só ADICIONAR exports):
   - `export async function mountInputs(ff, entries)` = wrapper público de `makeInputsAvailable` (mesma assinatura/retorno).
   - `export async function extractAsrChunk(ff, mountedPath, startSec, durSec, kbps): Promise<Blob>` — `['-ss', S, '-t', D, '-i', path, '-vn', '-c:a', 'libopus', '-b:a', `${kbps}k`, '-ac', '1', '-ar', '16000', '-application', kbps >= 24 ? 'audio' : 'voip', '-vbr', 'on', out.opus]`, via `execOrThrow`, lê e apaga o arquivo. Nome de saída único por chamada (pool).
   - `export async function cutClipCopy(ff, mountedPath, startSec, endSec): Promise<Blob>` — `['-ss', S, '-to', E, '-i', path, '-c', 'copy', '-copyts', '-avoid_negative_ts', 'disabled', '-movflags', '+faststart', out.mp4]`; se a saída < 4 KB ou falhar, fallback sem `-copyts` (`-avoid_negative_ts make_zero`) e retorna `{ blob, copyts: boolean }`. `assertValidMp4`.
   - `export async function probeFirstPts(ff, blob): Promise<number>` — escreve no MEMFS, roda `['-i', name, '-vf', 'showinfo', '-frames:v', '1', '-f', 'null', '-']` e captura `pts_time:(\d+\.?\d*)` do log (`ff.on('log')`). Sem match → 0.
   - `export async function extractAudioRangeAac(clip: Blob, startSec, durSec): Promise<Blob>` — `-ss S -t D -i clip -vn -c:a aac -b:a 160k -ar 48000 -ac 2 out.m4a` (MEMFS; clip é pequeno).
2. `lib/auto-cortes/transcript.ts` (PURO, sem DOM): `planAudioChunks(durationSec, opts)`, `mergeChunkWords(chunks: ChunkWords[], overlapSec): Word[]`, `buildSentences(words, language): Sentence[]` (regras na ARQUITETURA §3.2; ids `S0001`), `transcriptHash(words, language)` (FNV-1a 32 bits em hex), `wordsInRange(words, startMs, endMs)`.
3. `lib/auto-cortes/transcribe.ts` (browser): `transcribeSource(file: File, opts: { durationSec, language, pool, onProgress, signal }): Promise<Transcript>` — monta o arquivo em cada instância do pool (até `LIMITS.asrConcurrency`), extrai chunks em paralelo, envia cada um pra `/api/auto-cortes/transcribe` (FormData `audio`, `language`), `withRetry` (lib/retry.ts) 3× com backoff e respeito a `retry-after` no 429, merge + sentences + hash. Progresso: `{ stage: 'audio'|'asr', done, total }`. Cancelamento via `signal` (aborta fetches + `cancelFFmpeg` não — o pool é de quem chama).
4. Rota `app/api/auto-cortes/transcribe/route.ts`: cópia de `app/api/tipografia/transcribe/route.ts` com `requireToolAccess('/tools/auto-cortes', 'basic')`, `provider: 'groq'` e fallback AAI (já é o comportamento de `transcribeAudio`). Devolve `{ words, provider }`. 413 amigável.
5. Testes em `transcript.test.ts`: overlap/dedup/rebase (inclusive palavra duplicada na fronteira), sentences por pontuação, por pausa de 700 ms, por teto de 28 palavras, ids sequenciais e estáveis, hash determinístico.

### A2 · LLM + análise
Arquivos: `package.json` (dep `@anthropic-ai/sdk`), `lib/llm/anthropic.ts`, `lib/auto-cortes/analyze.ts`, `lib/auto-cortes/analyze.test.ts`, `app/api/auto-cortes/analyze/route.ts`, `lib/auto-cortes/analyze-client.ts`.

1. `npm i @anthropic-ai/sdk` (versão atual). Ler o skill/SDK: usar `client.messages.stream({...}).finalMessage()`; `output_config: { format: { type: 'json_schema', schema } }` (structured output) e `output_config.effort`; `thinking: { type: 'adaptive' }`; modelo `process.env.AUTO_CORTES_MODEL ?? 'claude-opus-5'`; `betas: ['server-side-fallback-2026-07-01']` + `fallbacks: 'default'` via `client.beta.messages.stream` quando o modelo for da família 5 (se o SDK instalado não expuser o campo, passar por `// @ts-expect-error` com comentário e testar; se a API rejeitar, retirar o fallback e registrar no relatório). Tratar `stop_reason === 'refusal'` (mensagem amigável "a IA recusou esse trecho") e `'max_tokens'` (retry com `max_tokens` ×1.5, 1×).
2. `lib/llm/anthropic.ts`: `createAnthropicClient(apiKey)`; `structuredMessage<T>({ client, model, system, user, schema, effort, maxTokens, signal }): Promise<{ data: T; usage; model }>` — parse do bloco `text` com `JSON.parse`, erro amigável se inválido (retry 1× pedindo correção). Mapear erros do SDK: `AuthenticationError` → `{ showConfig: true, message: 'Sua chave de IA de texto não foi aceita…' }`, `RateLimitError` → retry honrando `retry-after` (máx 3), `APIConnectionError`/5xx → retry 2×.
3. `lib/auto-cortes/analyze.ts` (PURO): `planWindows(sentences, { windowSec, overlapSec })` → `{ idx, sentences }[]`; `resolveCandidates(windowIdx, raw: MapResult, sentences, lengthPreset)` → `ResolvedCandidate[]` (ids válidos, ordem, faixa de duração com 15 % de tolerância, `id = 'w{idx}c{n}'`); `dedupCandidates(all)` (sobreposição > 60 % do menor → fica o de maior soma de scores); `applyExtensions(plan, candidate, sentences)`; `refineBounds(startMs, endMs, words, lengthPreset)` (ARQUITETURA §3.3 passo 5); `finalizeClips(reduce: ReduceResult, candidates, sentences, words, settings)` → `Array<{ plan: ClipPlan; startMs; endMs }>` ordenado por score, saneado com `sanitizeHeadline/sanitizeHashtags/clampScore`.
4. Rota `analyze`: `runtime 'nodejs'`, `maxDuration 300`, `dynamic 'force-dynamic'`; gate Premium; `getUserKey('anthropic')`; body `AnalyzeRequest` (discriminado por `op`). `op:'map'` → MAP da janela (`effort 'medium'`, `max_tokens 6000`) e devolve `AnalyzeMapResponse` com `resolveCandidates` já aplicado. `op:'reduce'` → REDUCE (`effort 'high'`, `max_tokens 16000`) e devolve `AnalyzeReduceResponse` (clips saneados). Erros → `AnalyzeErrorResponse` com status (401/400 chave → `showConfig`, 429 → `retryAfterSec`, 502 modelo, 500).
5. `analyze-client.ts` (browser): `analyzeTranscript({ transcript, settings, source }, { onProgress, signal }): Promise<{ candidates: ResolvedCandidate[]; clips: Array<{ plan; startMs; endMs }>; warnings: string[] }>` — `planWindows` → map com concorrência `LIMITS.analyzeMapConcurrency` (`withRetry` 3×, honra `retryAfterSec`), `onProgress` por janela, janela que falha 3× vira warning; `dedupCandidates`; `count = settings.count === 'auto' ? autoClipCount(durationSec) : count`; reduce (retry 2×); `finalizeClips`. Cancelável por `signal`.
6. Testes: `planWindows` (overlap, última janela), `resolveCandidates` (ids inválidos descartados, ordem invertida descartada, faixa), `dedupCandidates`, `refineBounds` (nunca no meio de palavra; snap em silêncio; respeita faixa), `finalizeClips` (sanitização, ordenação). Schemas: objeto válido passa/ inválido falha com um validador mínimo (escrever `validateBySchema` simples pra `type/required/enum/min/max/pattern/maxItems` — suficiente pros dois schemas).

### A3 · render + reenquadro + headline
Arquivos: `lib/auto-cortes/render.ts`, `lib/auto-cortes/reframe.ts`, `lib/auto-cortes/reframe.test.ts`, `lib/auto-cortes/headline.ts`, `lib/auto-cortes/captions.ts`, `lib/typography/presets.ts` (ADICIONAR categoria `Headline`), `lib/face-detector.ts` (ADICIONAR export).

1. `render.ts`: fork de `lib/typography/export.ts` com a API `renderClip(...)` da ARQUITETURA §3.5. Copiar literalmente `pickCodec`, `makeSink`, `nextTask`, demux mp4box, fallback seek, bitrate; mudar: (a) emitir ticks só no intervalo `[absStart, absEnd)` usando `clipFirstPts` pra mapear pts → tempo absoluto (fast path: `tAbs = clipFirstPts + (pts - basePts)/1e6`; seek path: `video.currentTime = tAbs - clipFirstPts`); (b) canvas de saída `out.w × out.h`; (c) por frame: `compose(ctx, frame, tAbs)` → `overlay(ctx, (tAbs-absStart)*1000)`; (d) áudio: se `audio` veio, `muxAudioIntoVideo(videoOnly, audio)` via `runFfmpegExclusive`; senão silencioso (`audioOk:false`). Também exportar `composeFns` prontos: `makeComposer(plan: CropPlan, srcW, srcH, out)` → `(ctx, frame, tAbs)` com `drawImage` recortado (single/split/fit com fundo desfocado via `ctx.filter = 'blur(40px)'` + escurecimento) e interpolação linear entre keyframes. Frames de thumb: `renderThumb(clipBlob, tAbs, compose, overlay, out)` → JPEG 540 px.
2. `reframe.ts`: `sampleFaces(clip: Blob, clipFirstPts, absStart, absEnd, fps = 5, signal)` → `FaceSample[]` usando `<video>` + canvas 320 px + `detectFacesInImage` (adicionar em `lib/face-detector.ts`: `export async function detectFacesInImage(src: CanvasImageSource): Promise<Array<NormBox & { score }>>` reutilizando `getDetector()`; manter tudo que existe). `sceneCuts(samples de histograma)` (histograma 16 bins de luminância por amostra; diff > 0,45 = corte). `planCrop(samples, cuts, { srcW, srcH, aspect, mode }): CropPlan` (PURO — ARQUITETURA §3.4: tracks por IoU, zona morta 8 %, headroom, τ 0,5 s, vmax 0,25 W/s, salto no corte de cena, auto single/split/center). Aspecto alvo igual à fonte → `{ layout: 'none' }`.
3. `headline.ts`: `HEADLINE_PRESET_IDS` (curado: os 8 novos + `vermelho-sangue`, `titulo-ouro`, `glitch-viral`, `verde-dinheiro`, `empilhado`, `extensao-script`, `keynote`, `faixa-suave` e mais ~10 presets existentes que fiquem bons como título estático); `makeHeadlineBlock(text, durationMs)` (palavras espaçadas em 1,2 s, `end = durationMs`); `headlineStyle(aspect, preset)` (`posY` 0.15/0.12, `fontScale` 0.82, `autoEmphasis: preset.autoEmphasis ?? false`); `drawHeadline(ctx, block, preset, style, tMs, W, H)` = `drawCaptions`. Presets novos em `presets.ts` (cat `'Headline'`, `unit:'block'`, `uppercase:false`, `autoEmphasis:false`, `in: pop/fade`):
   - `hl-caixa-branca` "Caixa Branca" — réplica do Opus: `font:'montserrat800'`, `size:0.058`, `box:{ mode:'line', fill:'#ffffff', radius:0.28, padX:0.5, padY:0.28, autoText:true }`, `defaultPrimary:'#111111'`.
   - `hl-caixa-preta` "Caixa Preta" — idem com `fill:'#111111'`, texto branco.
   - `hl-marca-texto` "Marca-texto" — `font:'inter800'`, `box:{ mode:'line', fill:'#ffe34d', radius:0.08, padX:0.35, padY:0.12, autoText:true }`.
   - `hl-faixa-vermelha` "Faixa Vermelha" — `box:{ mode:'block', fill:'#e0163a', radius:0.12 }`, texto branco, `font:'anton'`, `uppercase:true`.
   - `hl-pilula` "Pílula" — `box line` radius 0.5 fundo `rgba(0,0,0,0.72)` texto branco `dmsans900`.
   - `hl-jornal` "Manchete" — `font` serifada 900 disponível em fonts.ts, fundo branco, texto preto, `bar` fina embaixo.
   - `hl-gradiente` "Gradiente" — sem caixa, `gradient` ouro→branco (copiar receita do `titulo-ouro`) + sombra dura.
   - `hl-contorno` "Contorno" — sem caixa, `stroke` preto grosso + `shadow`, `anton`, uppercase.
   Conferir cada um no harness (`drawPresetDemo`) antes de entregar; regra do dono: variante só se muda ESTRUTURA.
4. `captions.ts`: `buildClipCaptions(words, startMs, endMs, pace)` → `groupWords(wordsInRange, pace)` + `shiftBlocks(-startMs)` + clamp; `captionStyleFor(aspect, presetId)` (fontScale 1/1/0.95/0.62; posY 0.76 em 9:16, 0.8 em 16:9).
5. Testes `reframe.test.ts`: tracks sintéticos (1 rosto parado → crop fixo; rosto andando devagar → segue com zona morta; salto em corte de cena; 2 rostos estáveis → split; nenhum → centro; vmax respeitada).

### A4 · ingestão por link (extensão v1.8.0 + página)
Arquivos: `extension-downloader/manifest.json`, `extension-downloader/bg.js`, `extension-downloader/bridge.js`, `lib/auto-cortes/ext-bridge.ts`, `lib/auto-cortes/ext-bridge.test.ts`, `lib/auto-cortes/opfs.ts`, `lib/auto-cortes/ingest.ts`, `app/api/auto-cortes/drive/route.ts`.

1. Extensão (ver REGISTRO.md "Ingestão de links" — protocolo atual e receita do `extension/background.js` `handleDownloadDrive`): `manifest.version = '1.8.0'`; host_permissions + Drive; `bg.js`: handler `darko-fetch` `{ reqId, url, kind, mode, quality }` → (engine) pareia e `fetch` do `/get` do Motor; (drive) fetch credenciado com cadeia de confirm; stream `body.getReader()` → mensagens `darko-fetch-meta`, `darko-fetch-chunk` (base64 de 8 MB crus), `darko-fetch-done`, `darko-fetch-error` via `chrome.tabs.sendMessage(tabId, …)`; inatividade 90 s; `bridge.js`: relaia `DL_FETCH` → SW e converte chunks em `ArrayBuffer` (transfer) → `DL_FETCH_*` (ver `ExtFetchEvent` em types.ts). Manter 100 % do comportamento atual (`DL_ENGINE_DOWNLOAD`, `DL_IG_*`, `DL_PING/PONG`). Validar que a extensão carrega sem erro no Chrome (`chrome://extensions` não abre pelo MCP — validar por lint estático + teste manual do orquestrador).
2. `ext-bridge.ts`: `pingExtension(timeoutMs)` → `{ version, engine, port } | null`; `fetchViaExtension(req, { onProgress, onChunk, signal })` — ordena chunks por `idx`, detecta buraco, timeout 90 s sem chunk (retry 1×), 45 min absoluto; `onChunk(buf)` é chamado em ordem (a página grava no OPFS). Teste: montagem em ordem, chunk fora de ordem, buraco, timeout.
3. `opfs.ts`: `opfsWriteStream(path)` → `{ write(buf), close(): Promise<File> }`; `opfsGetFile(path)`; `opfsDelete(path)`; `opfsUsage()`; fallback quando OPFS indisponível: acumular em Blob parts (aviso de memória acima de 1,5 GB).
4. `ingest.ts`: `resolveSourceKind(url)` (youtube/drive/url/inválido), `ingestLink(url, { projectId, onProgress, signal })` → `{ file: File, source: SourceRef }`: extensão ≥ 1.8.0 → `fetchViaExtension`; Drive sem extensão → `fetch('/api/auto-cortes/drive?id=…')` com stream pro OPFS (cap `LIMITS.driveServerFallbackMaxBytes`); YouTube sem Motor → `FriendlyError` orientando (texto igual ao do Downloader). `ingestUpload(file)` → `SourceRef` (assinatura) + `probeVideoMetadata` (com timeout e fallback nulo).
5. Rota `drive`: `runtime nodejs`, `maxDuration 300`, `dynamic force-dynamic`, gate Premium, `safeFetch`, hosts permitidos, trata `confirm=`/`uuid=` (cadeia do `handleDownloadDrive`), rejeita HTML de login (`'Arquivo privado — use a extensão ou suba o arquivo'`), `content-length` > cap → 413 amigável, stream passthrough com `content-disposition`.

---

## FASE 2 — estado, orquestração e UI (2 agentes em paralelo)

### B1 · store + pipeline
Arquivos: `lib/auto-cortes/store.ts`, `lib/auto-cortes/pipeline.ts`, `lib/auto-cortes/pipeline.test.ts` (máquina de estados pura).

- `store.ts`: IDB `autoedit-auto-cortes` v1 (stores `projects`, `blobs`); `saveProject/loadProject/listProjects/deleteProject`, `saveBlob/loadBlob/deleteBlob`, `pruneProjects({ maxProjects: 6, maxAgeMs: 7d, maxBytes: 1.5GB })`, timeouts como `lib/zip-store.ts`.
- `pipeline.ts`: `createPipeline(opts: { projectId, getFile: () => File | null, pool, callbacks })` → `{ getState(): Project; subscribe(fn): unsubscribe; start(settings, source): Promise<void>; resume(): Promise<void>; cancel(): void; reanalyze(): Promise<void>; rerenderClip(id, patch?): Promise<void>; updateClip(id, patch): void }`. Máquina: `fonte → baixando → audio → transcrevendo → analisando → renderizando → pronto`, cada transição persiste (`saveProject` com debounce 300 ms e flush nas transições). `resume()` retoma da fase persistida (transcrição pronta → pula pra análise; análise pronta → só renders pendentes/erro). Fila de render com 2 slots + watchdog de órfãs (30 s) + retry 1× por corte; erro num corte não derruba o lote. Thumbs geradas antes do render completo (assim que o clip é cortado) pro grid aparecer cedo. `logHistory({ tool:'auto-cortes', ... })` no `pronto`.
- Testes da máquina de estados com dependências mockadas (sem DOM): ordem das fases, retomada de cada fase, falha de 1 corte não bloqueia, cancelamento limpa slots.

### B2 · UI
Arquivos: `components/typography/PresetGallery.tsx` (EXTRAIR de `app/tools/tipografia/page.tsx` mantendo props e comportamento; a page da Tipografia passa a importar — zero mudança visual lá), `components/auto-cortes/*.tsx`, `app/tools/auto-cortes/page.tsx`.

- Seguir ARQUITETURA §4. Componentes: `SourceInput`, `ClipSettingsPanel`, `CaptionPresetPicker`, `HeadlinePresetPicker`, `ReframePicker`, `PipelineProgress`, `ClipGrid`/`ClipCard`, `ClipPreview`, `ClipEditor`, `TranscriptPanel`, `ResultsBar` (Baixar todos ZIP / SRTs / copiar textos).
- Integra com `createPipeline` (B1) por `subscribe`. Enquanto o B1 não existe, codar contra a assinatura acima.
- Galeria de legenda reusa favoritos por conta (`user_tool_prefs.tipografia_favs` — mesmo campo).
- `MissingKeyBanner services={['groq','anthropic']}` no topo do passo 2.
- Status da extensão/Motor no `SourceInput` (chip verde/amarelo) com link pro guia do Downloader.
- Design premium; modo claro; `prefers-reduced-motion`; Popover via `components/Popover.tsx`.

---

## FASE 3 — registro, guia, marketing (1 agente, paralelo à fase 2)
Arquivos: todos do checklist em `REGISTRO.md` + `components/tool-guides/guides.tsx` (guia `size:'large'`, passos: Fonte · Ajustes · Gerar · Resultado · Ajustar um corte; tips: requisito da extensão pra link; chaves; tempo esperado) + `components/ToolIcons.tsx` (`IconAutoCortes`: tesoura + play, estilo dos outros) + Plans/landing (`plan:'premium'`, copy honesta) + `lib/history.ts` + admin + `app/layout.tsx` featureList + `llms.txt`. Migração Supabase `user_tool_prefs.auto_cortes_defaults jsonb` (arquivo em `supabase/migrations/` seguindo a numeração; NÃO rodar — o dono roda).

---

## FASE 4 — integração e verificação (orquestrador + 1 agente)
1. `npx tsc --noEmit`, `npm test`, `npm run build`.
2. Dev server + navegador: upload de um vídeo real longo (≥ 40 min), fluxo completo até o ZIP; conferir: transcrição coerente nas fronteiras dos chunks, cortes com bordas limpas, legenda sincronizada (comparar com a Tipografia no mesmo trecho), headline legível, reenquadro sem tremor, áudio em sync (±1 frame), MP4 abre no Chrome e no CapCut, F5 em cada fase retoma.
3. Link do YouTube pela extensão 1.8.0 (recarregar unpacked) e Drive (público e privado).
4. Modo claro + mobile.
5. Harness de prompts: rodar a análise em 2 transcrições reais e avaliar manualmente bordas/headlines — ajustar só os pós-filtros (não os prompts) salvo erro claro.

## FASE 5 — entrega
Commits por fase na branch `claude/auto-edit-video-cuts-tool-9083ea`; ao final PR → main (deploy Vercel automático). Memória do projeto atualizada.
