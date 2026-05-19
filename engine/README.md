# DarkoLab Downloader — Extensão + Motor local

Permite que **qualquer usuário** use o Downloader **no PC dele**, sem
depender de servidor/VPS e sem o seu PC ligado. Roda 100% local.

## Arquitetura

```
[Extensão do navegador]  --HTTP 127.0.0.1 + token-->  [Motor local]
   (UI: cola links)                                    (yt-dlp + ffmpeg +
                                                         Chromium embutidos)
                                                              |
                                                   lib/downloader-core
                                            (mesma lógica do app web:
                                             YouTube/IG/TikTok/Pinterest/+18)
```

- **Extensão** (`extension-downloader/`): Manifest V3. Só UI. Fala com o
  motor em `http://127.0.0.1:<porta>` usando um **token** (pareado 1x).
- **Motor** (`engine/`): servidor Node standalone. Bind só em
  `127.0.0.1`, exige `Authorization: Bearer <token>` e `Origin` de
  extensão. Reusa `lib/downloader-core.ts` (fonte única, igual à rota
  Next `app/api/downloader`).
- **+18**: só funciona se o motor estiver com `allowAdult: true`
  (env `DARKO_ALLOW_ADULT=1` ou `config.json`). A extensão só mostra o
  botão +18 quando o motor reporta isso.

## Build (quem gera o pacote — você)

```bash
npm install
node engine/build.mjs       # bundla o motor -> engine/dist/server.cjs
node engine/package.mjs     # monta engine/pkg/ autocontido:
                            #   node.exe + server.cjs + playwright +
                            #   Chromium + bin/yt-dlp.exe + bin/ffmpeg.exe
                            #   + Instalar.ps1 / Desinstalar.ps1
```

`engine/pkg/` (~800 MB) NÃO vai pro git — é gerado pelo `package.mjs`.
Zipe a pasta `engine/pkg/` e distribua (ou gere um instalador a partir
dela).

## Instalação (usuário final — não instala nada manualmente)

1. Baixa o pacote (zip de `engine/pkg/`), extrai.
2. Clique direito em **`Instalar.ps1`** → *Executar com PowerShell*.
   - Copia pra `%LOCALAPPDATA%\DarkoDownloaderApp`
   - Cria atalho na **Inicialização** (sobe junto com o Windows, oculto)
   - Inicia o motor e **mostra + copia** o CÓDIGO DE PAREAMENTO
3. Instala a extensão **DarkoLab Downloader** no navegador.
4. Abre a extensão → cola o **código** → *Parear*.
5. Pronto: cola links e baixa. Funciona sempre, no PC do usuário,
   independente do seu PC.

Desinstalar: clique direito em **`Desinstalar.ps1`** → *Executar com
PowerShell*.

## Segurança

- Motor só escuta `127.0.0.1` (não exposto na rede).
- `/download` exige token (gerado aleatório no 1º run) **e** Origin de
  extensão. Site comum não consegue chamar.
- `/health` é público mas não vaza o token (só status/porta/allowAdult).
- +18 desligado por padrão; precisa habilitar explicitamente.
