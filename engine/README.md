# DarkoLab Downloader — Extensão + Motor local

Permite que **qualquer usuário** use o Downloader **no PC dele**, sem
depender de servidor/VPS e sem o seu PC ligado. Roda 100% local.

## Arquitetura

```
[Extensão do navegador]  --HTTP 127.0.0.1 + token-->  [Motor local]
   (UI: cola links)         (auto-pareada via /pair)   (yt-dlp + ffmpeg +
                                                         Chromium embutidos)
                                                              |
                                                   lib/downloader-core
                                            (mesma lógica do app web:
                                             YouTube/IG/TikTok/Pinterest/+18)
```

- **Extensão** (`extension-downloader/`): Manifest V3. Só UI. Fala com o
  motor em `http://127.0.0.1:<porta>`. **Pareamento é automático** —
  cada operação varre as portas conhecidas, encontra o motor vivo e
  pega o token corrente via `GET /pair` (só responde para Origin de
  extensão). O usuário **nunca** cola código.
- **Motor** (`engine/`): servidor Node standalone. Bind só em
  `127.0.0.1`, exige `Authorization: Bearer <token>` e `Origin` de
  extensão. Token é gerado **uma vez** e persistido em
  `%LOCALAPPDATA%\DarkoDownloader\config.json` — nunca regerado.
  Reusa `lib/downloader-core.ts` (fonte única, igual à rota Next).
- **+18**: só funciona se o motor estiver com `allowAdult: true`
  (env `DARKO_ALLOW_ADULT=1` ou `config.json`). A extensão só mostra o
  botão +18 quando o motor reporta isso.

## Build (quem gera o pacote — você)

```bash
npm install
node engine/build.mjs       # bundla o motor -> engine/dist/server.cjs
node engine/package.mjs     # monta:
                            #   engine/pkg/                  (scripts crus)
                            #   engine/pkg.zip               (zip dos scripts)
                            #   engine/DarkoDownloaderSetup.exe  ← distribuir
                            #     stub C# nativo (csc.exe v4) com pkg.zip
                            #     embutido + ícone da extensão DarkoLab.
                            #     1 clique = instala tudo.
```

`engine/pkg/` é leve (~KB). Os binários pesados (~250 MB: Node + yt-dlp
+ ffmpeg + Chromium do Playwright) são **baixados pelo instalador no PC
do usuário**, na primeira execução. Cada componente já presente é
**pulado** (`Test-Path` antes de baixar).

## Instalação (usuário final — 1 clique)

1. Baixa **`DarkoDownloaderSetup.exe`** e dá duplo-clique.
2. UI bonita mostra "Instalando..." → "Instalado e vinculado!"
3. Instala a extensão **DarkoLab Downloader** no navegador.
4. Pronto. **Sem código, sem pareamento**: a extensão pega o token vivo
   do motor automaticamente via `/pair` toda vez que precisa.

Se um dia o motor regerar o token (não acontece, mas em teoria), a
extensão refaz pair sozinha no próximo download. Zero atrito.

Desinstalar: rode `Desinstalar.ps1` em `%LOCALAPPDATA%\DarkoDownloaderApp`.

## Segurança

- Motor só escuta `127.0.0.1` (não exposto na rede).
- `/download` exige token **e** Origin de extensão. Site comum não consegue.
- `/health` é público mas não vaza o token (só status/porta/allowAdult).
- `/pair` entrega o token **apenas** quando o Origin é de extensão
  (`chrome-extension://`/`moz-extension://`) ou sem Origin (service
  worker). Site comum bate `403`.
- Token é gerado por `crypto.randomBytes(24)` (192 bits) e persistido.
- +18 desligado por padrão; precisa habilitar explicitamente.
