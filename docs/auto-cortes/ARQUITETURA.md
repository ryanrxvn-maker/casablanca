# AUTO CORTES — arquitetura (v1)

> Ferramenta nova do AutoEdit: **vídeo longo (podcast, live, aula, entrevista) → cortes prontos**
> com corte por contexto, headline, título, descrição, legenda animada (os 491 modelos das
> Legendas Automáticas) e reenquadro inteligente (9:16 · 4:5 · 1:1 · 16:9).
> Referência copiada e melhorada: Opus Clip (levantamento ao vivo em `docs/auto-cortes/OPUS-REFERENCIA.md`).
>
> Estruturado pelo Fable 5 em 22.08.2026. Executado por agentes Opus por fase (ver `FASES.md`).
> Rota: `/tools/auto-cortes` · id interno `auto-cortes` · tier **Premium** (`basic`).

---

## 0. Princípios (não negociáveis)

1. **Custo zero pro dono em qualquer escala.** Transcrição = Groq Whisper (chave BYOK do cliente, fallback AssemblyAI BYOK). Inteligência = Claude (chave BYOK "IA de texto" = `anthropic`). Render = 100% no navegador (WebCodecs + ffmpeg-wasm). Nenhum byte de vídeo sobe pro servidor.
2. **Arquivo grande é o caso normal, não a exceção.** Podcast de 2-3 h / 2-4 GB entra. Nada carrega o original no heap: WORKERFS (já provado no Compressor) + OPFS pra links.
3. **Blindagem total** (`feedback_blindagem_fluxos`): persistir cedo (projeto nasce no IDB antes de qualquer trabalho), todo passo termina e entrega (timeout + retry + degradação), nenhum botão morto (todo estado travado tem "Retomar" que funciona), aba em 2º plano não trava (MessageChannel / Worker clock), concorrência com gate, nunca entregar MP4 quebrado (`assertValidMp4`), fix aditivo sem desfazer o que existe.
4. **WYSIWYG.** O que o card de preview mostra é pixel a pixel o que o MP4 terá — mesmo `drawCaptions`, mesmo compositor, mesmo plano de crop.
5. **Marketing honesto.** Copy fala só do que funciona. Link do YouTube/Drive exige a extensão + Motor (mesmo requisito do Downloader) — dizer isso com clareza na UI e no guia. Sem "viral garantido": o score é um **ranking relativo** dentro do vídeo.
6. **Erro nunca é cru.** `FriendlyError` / `toFriendlyMessage`; chave faltando → `MissingKeyBanner services={['groq','anthropic']}`.

---

## 1. Fluxo do cliente (UX)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. FONTE        cola link (YouTube/Drive) │ solta arquivo │ (Motor: status)│
│ 2. PRÉ-DISPARO  proporção · duração · nº cortes · gênero · idioma        │
│                 legenda (galeria 491 + Sem legenda) · headline (galeria)  │
│                 reenquadro (Auto/Seguir/Dividir/Centro/Ajustar)           │
│                 momentos específicos (texto) · trecho (timeframe)         │
│                 [ Gerar cortes ]                                           │
│ 3. PROGRESSO    Abrindo → Áudio (n/N) → Transcrevendo (n/N) → Analisando  │
│                 (janelas n/N) → Cortes encontrados (grid aparece AQUI,     │
│                 com score/título/headline, antes de renderizar) →          │
│                 Renderizando (n/N, 2 em paralelo)                          │
│ 4. RESULTADO    grid estilo Opus: thumb vertical + headline queimada,     │
│                 score 0-99 (verde), duração, título, ações (▶ preview     │
│                 WYSIWYG, ✎ ajustar bordas/título/headline, ⬇ baixar,      │
│                 ⧉ copiar descrição+hashtags, SRT). "Baixar todos (ZIP)".  │
│                 Transcrição completa em painel lateral (clicável → pula). │
└──────────────────────────────────────────────────────────────────────────┘
```

Estados terminais sempre com ação: `Retomar` (re-roda só o que falta), `Refazer análise` (mantém transcrição), `Renderizar de novo` (1 corte), `Trocar legenda/headline e re-renderizar` (sem re-transcrever nem re-analisar).

F5 em qualquer fase: restaura do IDB. Se a fonte era **upload**, pede pra re-selecionar o MESMO arquivo (assinatura `nome:tamanho:lastModified`) — igual Tipografia. Se era **link**, o arquivo está no OPFS e volta sozinho.

---

## 2. Pré-disparo — opções (copiadas do Opus + melhoradas)

| Opção | Valores | Default | Observação |
|---|---|---|---|
| Proporção | `9:16` · `4:5` · `1:1` · `16:9` | 9:16 | saída 1080×1920 / 1080×1350 / 1080×1080 / 1920×1080 |
| Duração do corte | `auto` · `<30s` · `30-59s` · `60-89s` · `90s-3min` · `3-5min` | auto (30-90s viés) | faixa vai no prompt + pós-filtro duro |
| Quantidade | `auto` · 5 · 10 · 15 · 20 · 30 | auto (≈1 por 6 min, mín 3, máx 30) | |
| Gênero | 17 do Opus em PT + `auto` | auto | muda as instruções de curadoria (ver prompts) |
| Idioma da fala | LangPicker (36 + auto) | `auto` | Whisper detecta; saída textual sempre no idioma do vídeo |
| Legenda | galeria completa (491) + **Sem legenda** + ritmo (`palavra`/`rapido`/`equilibrado`/`frases`) | Vermelho Sangue · rapido | reuso total de `lib/typography` |
| Headline | galeria `HEADLINE_PRESETS` + **Sem headline** + duração (`todo o corte` / `primeiros 5s`) | Caixa Branca (Opus) · todo o corte | |
| Reenquadro | `auto` · `seguir` · `dividir` · `centro` · `ajustar` (fit c/ fundo desfocado) | auto | só quando a proporção muda |
| Momentos específicos | texto livre | vazio | "encontra tudo sobre tráfego pago" |
| Trecho | range do vídeo (início/fim) | tudo | economiza transcrição |
| Remover pausas longas | toggle | off | P2 — pausas >1,2 s dentro do corte |
| Salvar como padrão | botão | — | `useToolState` + Supabase `user_tool_prefs.auto_cortes_defaults` (coluna nova, migração) |

---

## 3. Pipeline técnico (client-side, orquestrado por `lib/auto-cortes/pipeline.ts`)

```
[INGEST] ──► File (upload) | OPFS File (link via extensão v1.8.0)
   │
[AUDIO]  WORKERFS mount ► plano de chunks (9 min, overlap 3 s) ► pool ffmpeg (N paralelo)
   │     `-ss S -t D -i in -vn -c:a libopus -b:a 48k -ac 1 -ar 16000 -vbr on` (≈3,2 MB/chunk)
   │
[ASR]    POST /api/auto-cortes/transcribe (audio, language) por chunk, 4 paralelos, retry 429
   │     ► words[] com offset rebase + dedup no overlap ► Transcript { words, sentences }
   │
[ANALYZE] POST /api/auto-cortes/analyze (1 chamada por passo) ─ map por janela (12 min, overlap 90 s, conc 2)
   │      ► candidatos (ids de sentença, nunca timestamps crus) ─ reduce (top N, títulos,
   │      headlines, descrição, score) ► refino determinístico de bordas (snap palavra/silêncio)
   │
[RENDER por corte, 2 paralelos]
   │   a) cutClipCopy: `-ss (t0-6) -to (t1+1) -i src -c copy -copyts -avoid_negative_ts disabled` (WORKERFS → blob pequeno)
   │   b) probeFirstPts: `-i clip -vf showinfo -frames:v 1 -f null -` → absStart real
   │   c) reframe (se proporção ≠ fonte): amostra 5 fps ► faces (MediaPipe) ► CropPlan
   │   d) renderClip (WebCodecs): decode ► compose(crop/fit) ► drawCaptions ► drawHeadline ► encode
   │   e) áudio: extractAudioRange(clip, absStart→t0, t1) (AAC) ► muxAudioIntoVideo ► assertValidMp4
   │   f) saveBlob IDB `auto-cortes:<proj>:clip:<id>` + thumb JPEG
   │
[DONE]  grid + ZIP (buildZip) + SRT por corte + logHistory
```

Tempo esperado (PC médio, podcast 2 h, 10 cortes 9:16): áudio ~1-2 min · ASR ~1 min · análise ~2 min · render ~6-10 min.

### 3.1 Ingestão (`lib/auto-cortes/ingest.ts`)

- **Upload**: `File` direto (já é disk-backed). Guard: ≤ 4 GB, duração lida por `probeVideoMetadata` (timeout em aba oculta → ler do log do ffmpeg como no Compressor). Formatos: mp4/mov/webm/mkv (mkv passa pelo WORKERFS normal; o cutClipCopy sai sempre `.mp4`).
- **Link YouTube / Drive** → `fetchViaExtension(url, { kind: 'engine' | 'drive', onProgress })` (`lib/auto-cortes/ext-bridge.ts`):
  - handshake `DL_PING` → `DL_PONG { version, engine, port }`; exige `versionAtLeast(version, [1,8,0])`; YouTube exige `engine === true`.
  - envia `DL_FETCH { reqId, url, kind, mode:'video', quality:'1080' }`; recebe `DL_FETCH_META { reqId, filename, size|null, mime }`, N× `DL_FETCH_CHUNK { reqId, idx, buf: ArrayBuffer }` (transferível), `DL_FETCH_DONE { reqId, total }` ou `DL_FETCH_ERROR { reqId, error }`.
  - página grava cada chunk num `FileSystemWritableFileStream` do OPFS (`/auto-cortes/<projId>/source.<ext>`); ao final `handle.getFile()` → `File` (zero heap).
  - timeouts: 90 s sem chunk = falha (retry 1×); 45 min absoluto.
  - Sem extensão/Motor: mensagem-orientação imediata (passo 1 do guia) + botão "Subir o arquivo em vez disso".
  - Drive sem extensão: fallback servidor `GET /api/auto-cortes/drive?id=` (stream via `safeFetch`, trata `confirm=`/`uuid=`, cap **800 MB** por `content-length`, `maxDuration 300`) — acima disso orienta a instalar a extensão ou subir o arquivo.
- **Extensão v1.8.0** (`extension-downloader/`): `bg.js` ganha handler `darko-fetch`:
  - `kind:'engine'`: pareia com o Motor (já existe), `fetch(http://127.0.0.1:<port>/get?t=<token>&url=&mode=&quality=)` e faz stream do body em chunks de 8 MB pro content script (`chrome.runtime` com base64 ≤ 24 MB por mensagem — reusar receita do `extension/background.js` `handleDownloadDrive`).
  - `kind:'drive'`: fetch com `credentials:'include'` + cadeia de URLs de confirm do Drive (portar `handleDownloadDrive` — inclusive arquivo PRIVADO do próprio usuário logado), mesmo stream.
  - `bridge.js` relaia `DL_FETCH*` (decodifica base64 → `ArrayBuffer` e `postMessage` com transfer).
  - `manifest.json`: `version 1.8.0`, `host_permissions` + `https://drive.google.com/*`, `https://drive.usercontent.google.com/*`, `https://docs.google.com/*`.
  - Banner de atualização do Downloader: `MIN_EXT_VERSION` só sobe pra `[1,8,0]` **na página do Auto Cortes** (o Downloader continua aceitando 1.7.0 — não forçar reinstall em quem só usa o Downloader).
- `yt-dlp` já pede `--merge-output-format mp4` e `ext:mp4:m4a` (`lib/downloader-core.ts:440-444`) → H.264/AAC na maioria; se vier VP9/AV1 em mp4 o WebCodecs decodifica (Chrome) e o `-c copy` mantém.

### 3.2 Áudio + ASR em pedaços (`lib/auto-cortes/transcribe.ts`)

- `planAudioChunks(durationSec, { chunkSec: 540, overlapSec: 3 })` → `[{ idx, start, dur }]`.
- Extração via **pool** (`getFFmpegPool`), cada instância monta o MESMO `File` (`mountInputs` — exportar o `makeInputsAvailable`). Arg: `-ss S -t D -i <path> -vn -c:a libopus -b:a 48k -ac 1 -ar 16000 -application voip -vbr on out.opus`. Guard: chunk > 4,2 MB → re-extrai a 32 k.
- Upload: `POST /api/auto-cortes/transcribe` (FormData `audio`, `language`, `vocab?`) → `{ words, provider }`. Rota = cópia da `/api/tipografia/transcribe` com `requireToolAccess('/tools/auto-cortes','basic')`, `provider:'groq'` (fallback AAI). Paralelismo 4, `withRetry` 3× com backoff (429 respeita `retry-after`).
- Merge (`mergeChunkWords(chunks)` — **puro, testável**): rebase `start/end += chunk.start*1000`; no overlap `[B, B+overlap]` entre chunk i e i+1: fica com as palavras do chunk i que terminam antes de `B + overlap/2` e as do i+1 que começam depois disso; remove duplicata exata adjacente (mesmo texto normalizado, |Δstart| < 300 ms).
- `buildSentences(words, lang)` (**puro, testável**): frases por pontuação final `[.!?…]` OU pausa ≥ 700 ms OU ≥ 28 palavras; cada `Sentence { id: 'S0001', start, end, text, wordFrom, wordTo }`. Transcrição é persistida no IDB assim que pronta.

### 3.3 Inteligência (`app/api/auto-cortes/analyze/route.ts` + `lib/auto-cortes/prompts.ts` + `lib/llm/anthropic.ts`)

- Helper novo `lib/llm/anthropic.ts`: `@anthropic-ai/sdk` (dependência nova), `createAnthropic(apiKey)`, `structuredMessage<T>({ model, system, user, schema, effort, maxTokens })` usando `output_config.format` (JSON schema) + `thinking adaptive` + **streaming interno** (`.stream().finalMessage()`) + `fallbacks:'default'` com beta `server-side-fallback-2026-07-01` + tratamento de `stop_reason:'refusal'` e `max_tokens`. Modelo padrão `claude-opus-5` (env `AUTO_CORTES_MODEL` sobrescreve). Erros → mapear 401 (chave inválida → `showConfig`), 429 (`retry-after`), 529/5xx (retry 2×).
- Rota `analyze` (nodejs, `maxDuration 300`, `dynamic='force-dynamic'`), gate Premium, `getUserKey('anthropic')`. **Uma chamada por passo** — `op:'map'` (1 janela) ou `op:'reduce'` — porque uma função da Vercel tem teto de 300 s e um podcast de 2 h tem ~10 janelas. Quem orquestra é o navegador (`lib/auto-cortes/analyze-client.ts`): map com concorrência 2, retry por janela, depois reduce; progresso natural por janela. Tipos: `AnalyzeMapRequest/Response`, `AnalyzeReduceRequest/Response` em `types.ts`.
- Orquestração interna:
  1. (cliente) `planWindows(sentences, { windowSec: 720, overlapSec: 90 })`.
  2. (servidor, por janela) MAP (`effort:'medium'`): prompt `MAP_SYSTEM` + janela formatada `S0123 [12:34] texto`. Saída `MapResult` (schema em `prompts.ts`). Candidato referencia **ids de sentença** (`startId`, `endId`, `hookId`) — timestamps nunca são inventados pelo modelo. O servidor já devolve `ResolvedCandidate[]` (ids → tempo, filtro de faixa).
  3. (cliente) dedup global por sobreposição > 60 % (fica o de maior soma de scores) quando todas as janelas voltaram.
  4. (servidor) REDUCE (`effort:'high'`): prompt `REDUCE_SYSTEM` + candidatos compactos (id, tempo, duração, scores, 1ª frase, última frase, topic) + settings (N, gênero, momentos específicos, idioma). Saída `ReduceResult { clips: ClipPlan[] }` com `title`, `headline` (≤ 8 palavras, 2 linhas máx), `hook`, `description`, `hashtags[5]`, `score 0-99`, `scoreBreakdown {hook, value, emotion, completeness, shareability}`, `why`.
  5. (cliente) Refino de bordas (**puro, testável**, `refineBounds`): start = `word.start - 150 ms` da 1ª palavra da frase; end = `word.end + 300 ms`; se gap até a palavra anterior < 250 ms, recua até o início do silêncio anterior (snap no silêncio — mesma filosofia do Decupagem Inteligente); garante `end - start` dentro da faixa; nunca corta no meio de palavra.
- Sem candidatos numa janela = normal (ex.: abertura do podcast). Janela que falha 3× (após retries com backoff/`retry-after`) = pula e registra em `warnings` (não aborta o lote). Reduce que falha = erro com botão "Refazer análise" (candidatos persistidos, não re-roda o map).
- Cache: hash (sentences + settings) → reaproveita resultado no IDB ("Refazer análise" ignora cache).

### 3.4 Reenquadro (`lib/auto-cortes/reframe.ts`)

- Entrada: clip blob, `absStart/absEnd`, proporção alvo, modo. Saída `CropPlan { mode, keyframes: { t, x, y, w, h }[] , layout?: 'single'|'split' , splitBoxes? }` — tudo em coordenadas da fonte.
- Amostragem: 5 fps via `<video>` seek (ou decoder com stride 6 — implementar com o decoder se o fast path estiver ativo, fallback seek). Detector: reutilizar `lib/face-detector.ts` (expor `detectFacesInImage(source): FaceBox[]` — hoje só existe por segmento).
- Rastreamento: associa caixas entre amostras por IoU > 0,3; track vivo se ≥ 40 % das amostras. Escolha:
  - `auto`: 1 track dominante → `seguir`; 2 tracks estáveis e distantes (|Δx| > 35 % W) → `dividir` (9:16: dois crops 1080×960 empilhados; 4:5/1:1: lado a lado); 0 tracks → `centro`.
  - `seguir`: crop com zona morta de 8 % da largura do crop; alvo = centro do rosto com **headroom** (rosto no terço superior do crop); suavização exponencial (τ = 0,5 s) com velocidade máx 0,25 W/s; **corte de cena** (diferença de histograma > 0,45 entre amostras) → salto instantâneo, sem deslizar.
  - `ajustar`: vídeo inteiro centralizado (fit) sobre fundo = o próprio frame escalado 1,6× + blur 40 px + escurecido 35 %.
- Interpolação linear entre keyframes no compositor. Plano persiste no IDB junto do corte (editor usa pra mostrar a caixa).

### 3.5 Render (`lib/auto-cortes/render.ts` — fork controlado de `lib/typography/export.ts`)

Manter **idênticos**: `pickCodec`, `makeSink`, `nextTask` (MessageChannel), demux mp4box (`createFile(true)`, append único, `setExtractionOptions nbSamples 100`), CFR por "último frame com pts ≤ tick", fallback seek, bitrate adaptativo (clamp MEMFS 300 MB), abort via `signal`, áudio por `runFfmpegExclusive`.

Novo na API:
```ts
renderClip({
  clip: Blob,            // saída do cutClipCopy (pequena, -copyts)
  absStart, absEnd,      // segundos ABSOLUTOS do corte na fonte
  clipFirstPts,          // segundos: pts do 1º frame do blob (probeFirstPts)
  out: { w, h },         // 1080×1920 etc.
  compose: (ctx, frame, tAbs) => void,   // crop/fit/split (usa CropPlan)
  overlay: (ctx, tRelMs) => void,        // drawCaptions + drawHeadline (+ marca d'água P2)
  audio: Blob | null,    // AAC já cortado (extractAudioRange)
  onProgress, signal,
}): Promise<RenderResult>
```
- Emite ticks só pra `tAbs ∈ [absStart, absEnd)`; `t` passado ao overlay é **relativo ao corte** (ms) — os blocos de legenda já vêm deslocados por `-absStart`.
- Legendas: `shiftBlocks(blocks, -absStart*1000)` + filtro dos que intersectam; `fontScale` por proporção: 9:16 = 1,0 · 4:5 = 1,0 · 1:1 = 0,95 · 16:9 = 0,62 (compensa o tamanho relativo à largura).
- Headline: `drawHeadline` = `drawCaptions` com 1 `Block` estático (`start 0`, `end = todo|5000`), palavras espaçadas em 1,2 s (animações karaokê revelam), `StyleState { posY: 0.15 (9:16) / 0.12 (16:9), fontScale: 0.82, autoEmphasis: preset.autoEmphasis ?? false }`. Com layout `dividir`, headline fica na junção (posY 0.5) — opção.
- Thumb: frame em `absStart + 1,0 s` com overlay aplicado (JPEG 540 px) → card.
- Paralelismo: 2 renders simultâneos (2 `VideoEncoder`), fila com gate que auto-cura (contador + watchdog 30 s).
- Saída: `assertValidMp4`; MP4 < 2 KB = falha retryável.

### 3.6 Persistência (`lib/auto-cortes/store.ts`) — IDB próprio `autoedit-auto-cortes` (v1)

Stores: `projects` (keyPath `id`), `blobs` (keyPath `key`). Registro `Project` (ver `types.ts`): fonte (assinatura/OPFS path), settings, `phase`, `transcript`, `analysis`, `clips[]` com `renderStatus`, `blobKey`, `thumbKey`, `warnings[]`, `updatedAt`. Poda: LRU 6 projetos / 7 dias / 1,5 GB (reusar a lógica de `lib/zip-store-prune.ts`). `getStorageEstimate` antes de renderizar: se quota < 2× tamanho previsto → avisa e segue (download automático por corte como rede de segurança, opcional no painel).

### 3.7 Segurança / limites

- Rotas: `requireToolAccess('/tools/auto-cortes','basic')` em `transcribe`, `analyze`, `drive`. `drive` usa `safeFetch` (anti-SSRF) e só hosts `drive.google.com` / `drive.usercontent.google.com` / `docs.google.com`.
- Limite duro de entrada: **4 GB** e **4 h**. Chunks de áudio ≤ 4,4 MB (limite Vercel).
- Anthropic: `max_tokens` 16 000 no reduce, 6 000 no map; sem dados pessoais no prompt além da transcrição.
- Sem marca d'água (Premium).

---

## 4. UI / design (premium, "design studio" v3)

- Página `app/tools/auto-cortes/page.tsx` (< 900 linhas; resto em `components/auto-cortes/`): `TierGate require="basic"` → `ToolHero` (eyebrow "IA · cortes", título "Auto Cortes", subtítulo "Podcast, live ou aula viram cortes prontos — com legenda, headline e enquadro.") → `ToolStep` 1 Fonte · 2 Ajustes · 3 Gerar · resultado.
- Componentes: `SourceInput` (campo único estilo Opus: cola link OU solta arquivo; chip de status do Motor/extensão), `ClipSettings` (grid de `ToolChoice`s + galerias), `CaptionPresetPicker` (→ **extrair** `PresetGallery` da Tipografia pra `components/typography/PresetGallery.tsx` com os mesmos props, favoritos por conta), `HeadlinePresetPicker` (mesma galeria filtrada por `HEADLINE_PRESETS`, demo "ESSE É O SEGREDO"), `ReframePicker`, `PipelineProgress` (etapas com tempo decorrido e o que está rodando), `ClipGrid` + `ClipCard` (score verde 0-99 com `font-mono`, thumb com headline, duração, ações), `ClipPreview` (modal: `<video>` do MP4 final; antes de renderizar = canvas WYSIWYG ao vivo sobre o clip cortado), `ClipEditor` (ajuste de bordas ±, título/headline editáveis, troca de legenda/headline → "Renderizar de novo"), `TranscriptPanel` (frases clicáveis, destaca as que viraram corte).
- Tipografia do app: Space Grotesk / Bricolage / Inter em `.label-tech` — **não** criar fontes novas. Mono só em números (score, tempo). Paleta: hue da tool `rgba(244,114,182,0.42)` (rosa-coral, não colide com amarelo da Tipografia nem índigo do Compressor). Cards `card-tool`, botões `btn-primary`/`btn-lime`, `.dark-island` onde o card é escuro por design, Popover sempre via `components/Popover.tsx`.
- Modo claro testado. `prefers-reduced-motion` respeitado nas animações de card.

---

## 5. Registro da tool (todas as camadas)

Checklist exato em `docs/auto-cortes/REGISTRO.md` (linhas e entradas-modelo). Resumo: middleware `PREMIUM_ONLY_TOOLS`; `TIER_PATHS.basic/pro`; ToolsHub `TOOLS` (+ `TOOL_LABELS`, badge `IA`, 1º dos Destaques); SubSidebar; Sidebar `TOOL_PATHS`; GlobalSearch; TopBar; ToolIcons `IconAutoCortes`; Plans `ALL_TOOLS` + `TOOL_DETAILS`; landing v3 `TOOLS` (`plan:'premium'`) + destaque; guias `GUIDE_PATHS` + `GUIDES`; `HISTORY_TOOLS`; admin `TOOL_LABELS`; `app/layout.tsx` featureList/keywords; `llms.txt`.

---

## 6. Testes obrigatórios (entram no `npm test`)

- `lib/auto-cortes/transcript.test.ts`: `mergeChunkWords` (overlap, dedup, rebase), `buildSentences` (pontuação, pausa, teto de palavras, ids estáveis).
- `lib/auto-cortes/bounds.test.ts`: `refineBounds` (snap, faixa de duração, nunca meio de palavra), `resolveCandidate` (ids → tempos), dedup por sobreposição.
- `lib/auto-cortes/reframe.test.ts`: planner com tracks sintéticos (zona morta, velocidade máx, salto em corte de cena, escolha auto single/split/center).
- `lib/auto-cortes/schemas.test.ts`: JSON schema do map/reduce aceita saída válida e rejeita inválida; `sanitizeClipPlan` (headline ≤ 8 palavras, hashtags 5, score clamp).
- `lib/auto-cortes/ext-bridge.test.ts`: montagem de chunks em ordem, detecção de buraco, timeout.
- Type-check (`npx tsc --noEmit`) e `npm run build` limpos.

---

## 7. O que NÃO entra na v1 (P2, depois de rodar com cliente)

B-roll automático nos cortes · dublagem · remover palavras de preenchimento por LLM · marca/logo (brand template) · agendamento/postagem · edição por transcrição (clicar palavra = cortar) · multi-speaker por áudio (diarização) no split.
