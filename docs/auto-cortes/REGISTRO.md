# Mapa: registro de tool + ingestão de links — levantado 22.08.2026

## Registro de tool Premium (tier interno 'basic') — checklist mínimo
Acesso:
- lib/supabase/middleware.ts:67 `PREMIUM_ONLY_TOOLS` (add '/tools/auto-cortes') — free vai pra /planos
- lib/use-tier.ts:26 `TIER_PATHS.basic` e :48 `TIER_PATHS.pro` (add nos dois; NÃO no free)
- página: `<TierGate require="basic" toolName="Auto Cortes">` (components/TierGate.tsx; exemplo app/tools/decupagem-copy/page.tsx:87)
- API: `const gate = await requireToolAccess('/tools/auto-cortes','basic'); if (!gate.ok) return gate.response;` (lib/require-tier.ts:181; TierGate = {ok:true; userId; email; tier; isAdmin} | {ok:false; response})
- lib/maintenance.ts:11 `MAINTENANCE_TOOLS` — só se quiser admin-gated durante build
Descoberta:
- components/ToolsHub.tsx:91 `TOOLS: ToolEntry[]` ({href,label,description,icon,hue,badge?:'IA'|'ADMIN'|'GRÁTIS',adminOnly?}) + :2514 `TOOL_LABELS`
  exemplo: { href:'/tools/tipografia', label:'Legendas Automáticas', description:'A fala vira legenda animada, no tempo exato do áudio.', icon:<IconTipografia size={26}/>, hue:'rgba(251, 191, 36, 0.42)', badge:'IA' }
- components/SubSidebar.tsx:39 `TOOL_ITEMS` ({href,label,icon,hue,adminOnly?}) — ex: { href:'/tools/compressor', label:'Compressor', icon:<IconCompressor size={20}/>, hue:'rgba(129,140,248,0.4)' }
- components/Sidebar.tsx:465 `TOOL_PATHS` (string[])
- components/GlobalSearch.tsx:66 `ENTRIES` — ex: { id:'compressor', group:'Ferramentas', label:'Compressor', hint:'Reduz peso do arquivo', href:'/tools/compressor', icon:<IconCompressor size={20}/>, keywords:[...] }
- components/TopBar.tsx:19 `TITLES` ('/tools/compressor': 'Compressor')
- components/ToolIcons.tsx — criar `IconAutoCortes` (IconProps = {size?}) seguindo IconCompressor (L101-117). Ícones de passo: IconStepUpload, IconStepLink, IconStepSliders, IconStepWand, IconStepPlay, IconStepDownload, IconStepText, IconStepFormat, IconStepTarget, IconStepPipeline...
Marketing:
- components/Plans.tsx:32 `ALL_TOOLS` ({key,label}) + :901 `TOOL_DETAILS` ({key,name,cat,hue,desc,win}); NÃO pôr em UNLOCKED.free (:49) → vira Premium automático
- components/landing/v3/sections.tsx:464 `TOOLS` ({name,desc,plan:'free'|'premium',icon})
- opcional: app/layout.tsx:79 keywords + :188 JSON-LD featureList; app/llms.txt/route.ts:11 BODY
Suporte:
- components/tool-guides/routes.ts:11 `GUIDE_PATHS` + components/tool-guides/guides.tsx `GUIDES['/tools/auto-cortes']` (ToolGuide = {title, tagline, size?:'large', steps: {title,text,visual?}[], tips?}); mocks: MBtn, MChip, MDoc, MDocL, MDrop, MField, MQueueItem, MRow, MSlider, MStack, MToggle, Shot
- lib/history.ts:36 `HISTORY_TOOLS` ({id,label}); `logHistory({tool, kind:'done'|'export'|'dispatch'|'download', title, meta?})`
- app/admin/page.tsx:72 `TOOL_LABELS` (slug → label)
- sitemap: nada (tools não indexadas)

## Esqueleto de página
- app/tools/layout.tsx monta ToolsStateProvider, Heartbeat, Sidebar, SubSidebar, ContentWrap(TopBar + PaymentBlockedBanner + main), ToolGuideFab, RouteLoader. ChunkGuard está no root layout.
- components/tool-kit/index.tsx exports: ToolHero({title, subtitle?, eyebrow?, hue?, icon?}), ToolStep({n?, title, hint?, hue?, icon?, action?, children}), ToolDropzone({accept, file, onFile, hint?, hue?, disabled?, icon?, multiple?, onFiles?}), ToolChoice<T>({value, onChange, options:{value,label,sub?,icon?}[], disabled?, hue?}), ToolSlider({label,min,max,step?,value,onChange,display?,disabled?}), ToolAction({children,onClick?,loading?,disabled?,variant?:'primary'|'lime'|'secondary',icon?,fullWidth?,type?}), ToolResultCard({title,meta?,children,hue?}), ToolMetric({value,label,accent?:'violet'|'lime'|'rose'}).
- NÃO existem ToolHero3D/ToolError/T3D neste repo. Erros: `toFriendlyMessage(e, fallback)` + `class FriendlyError` (lib/friendly-error.ts), render inline `<p className="… border-red-500/30 bg-red-500/10 …">`.
- Outros: components/ToolShell.tsx ({title, description?, eyebrow?, hue?, icon?, children}); components/Popover.tsx ({open, anchorRef, onClose, width, children, align?}) — SEMPRE pra menu ancorado; `downloadBlob(blob, filename)` em lib/audio-engine.ts:497 (object URL); CancelButton; BatchFileUpload; FileUpload; `useToolState<T>(key, initial)` (components/ToolsStateProvider.tsx:64).
- Exemplo de página free: app/tools/compressor/page.tsx (825 linhas): HUE const, ToolStep n=1 upload+ToolMetric, n=2 ToolSlider, n=3 ToolChoice, n=4 ToolAction/CancelButton/btn-secondary; buildZip de lib/zip-builder; formatBytes de lib/utils.
- Classes de botão em app/globals.css: .btn-primary (407), .btn-lime (460), .btn-secondary.

## Ingestão de links
### YouTube — hoje
- Página ⇄ extensão via window.postMessage: page→ext source 'darko-dl' types DL_PING, DL_ENGINE_DOWNLOAD {url,mode,quality,reqId}, DL_IG_DOWNLOAD {url,reqId}; ext→page source 'darko-dl-ext' DL_PONG {version, engine:boolean, port}, DL_ENGINE_RESULT {reqId, ok, error?}, DL_IG_RESULT.
- `versionAtLeast(v, min)` (downloader/page.tsx:51-60), `MIN_EXT_VERSION=[1,7,0]` (:233), `engineOk = ext.connected && ext.engine===true` (:455). Cache localStorage 'darkolab:downloader:ext-cache' (10 min). Ping burst + poll 2s, MAX_MISSED=5.
- **A página NUNCA recebe bytes pelo Motor**: o SW chama chrome.downloads.download('http://127.0.0.1:<port>/get?t=token&url=&mode=&quality=') → cai na barra de downloads. Só o fallback POST /api/downloader (TikTok) entrega bytes (res.body.getReader()).
- Motor (engine/pkg/server.cjs, VERSION 1.1.0, porta 47923..47931, loopback): GET /health (sem auth), GET /pair (Origin de extensão → {token,port}), POST /download (Origin extensão + Bearer), GET /get?t=token&url&mode&quality (sem check de Origin). CORS SÓ pra origens chrome-extension:// — **a página do site NÃO consegue fetch direto do Motor** (sem ACAO pro site, sem Access-Control-Allow-Private-Network, sem token). Motores instalados NÃO se auto-atualizam.
- Extensão downloader (extension-downloader/, MV3 v1.7.0): host_permissions 127.0.0.1, localhost, *.darkoautoedit.com, *.instagram.com. bridge.js = relay content script (darkoautoedit.com + localhost, document_start). bg.js: probePort→/health→/pair→chrome.storage.local {token,port}; ENGINE_PORTS 47923-47931; keepalive chrome.alarms 0.4min; tryDownloadOnce monta /get URL e chrome.downloads.download; re-pareia a cada download. Banner de update no site por MIN_EXT_VERSION via DL_PONG.version; distribuição /api/downloader-extension/download zipa a pasta.
- modes: 'video'|'audio-mp3'|'audio-wav'; quality '1080'|'720'|'480'|'best' (lib/downloader-core.ts:18-19).

### Google Drive — hoje
- NÃO existe rota/lib que baixe arquivo do Drive por link. Só: app/api/docs/fetch (Docs → export txt, requireTier('free'), safeFetch), builders de URL `uc?export=download&id=` no Pilot/Hey Auto, `extractDriveFileIdFromText` em lib/clickup-client.ts:221 (regex /file/d/ID, ?id=ID, /d/ID; ignora /folders/).
- Único downloader real de bytes: extension/background.js `handleDownloadDrive` (extensão DARKO LAB do HeyGen, admin): fetch credentials:'include', sniff HTML → confirm=/uuid=/form action → cadeia de 6 URLs (uc?export=download&id; +confirm/uuid; drive.usercontent.google.com/download?id&export=download&authuser=0&confirm=t; ...), detecta login wall; stream em chunks RAW 18MB (base64 ~24MB por mensagem; cap 64MiB); msgs HG_DRIVE_DOWNLOAD_CHUNK/PROGRESS/RESULT; inatividade 90s. Cliente: lib/heygen-extension-bridge.ts:764 `downloadDriveFileViaExtension(fileId, {onProgress}) → {ok,bytes:Uint8Array,size}|{ok:false,error}` (fila serial, 2 tentativas).

### SSRF / limites
- lib/safe-fetch.ts: `assertPublicHttpUrl(url)`, `safeFetch(url, init?, {maxRedirects?=5})` (DNS all-records, rejeita privado; redirect manual re-validado por hop — Drive/CDN funcionam).
- Sem bodyParser/sizeLimit no repo; limites à mão (ex app/api/tools/lipsync/route.ts:63 MAX_VIDEO_BYTES 300MB, `download(url,maxBytes,label)` checa content-length ANTES e byteLength DEPOIS).
- vercel.json: sem functions block; crons; headers globais COOP same-origin + **COEP credentialless** (SharedArrayBuffer pro ffmpeg; mídia cross-origin em canvas precisa CORS).
- Rotas: `export const runtime='nodejs'`; maxDuration até 300 (cap Vercel); proxies grandes + `dynamic='force-dynamic'`.
- next.config.js: serverComponentsExternalPackages ['@gradio/client','undici']; CSP headers() L47.

### IndexedDB
- lib/zip-store.ts (hand-rolled, DB 'darkolab-zip-store', store 'zips'): saveZip/loadZip/listZipKeys/deleteZip/getStorageEstimate/saveBlob(key, blob, mime)/loadBlob(key, mime)/pruneZipStore/deletePrefix. Timeouts 15s/90s. Prune LRU no boot (8/12h/800MB).
