# DARKO LAB Magnific Auto — Chrome Extension

Automacao de B-Rolls via Magnific (ex-Freepik) Spaces.
Usa sua propria conta logada em Magnific — **NUNCA gasta creditos**
(funciona em modo Unlimited).

## Pre-requisitos

- **Chrome** ou Chromium
- **Conta Magnific Premium+** logada em `www.magnific.com`
- Modo **Unlimited** ligado (default no Premium+)

## Instalacao (1 vez so)

1. Descompacte este ZIP numa pasta no seu computador
2. Abra `chrome://extensions` no Chrome
3. Liga o **Modo de desenvolvedor** (canto superior direito)
4. Clica **"Carregar sem compactacao"** (botao esquerdo superior)
5. Seleciona a pasta onde descompactou
6. Volte para o DARKO LAB (`/tools/auto-broll`) — a extensao deve
   aparecer como **conectada**

## Como funciona

A extension roda em 2 contextos:

1. **`bridge.js`** carrega no DARKO LAB (`darkolab.vercel.app` e
   `localhost`) e faz ponte entre a pagina e o background worker
2. **`magnific-content.js`** carrega em `www.magnific.com` e executa
   a automacao no Magnific (criar Spaces, configurar nodes Image
   Generator + Video Generator, conectar, disparar workflows)

Quando voce dispara um lote no DARKO LAB:

1. Bridge envia ao background worker via `chrome.runtime.sendMessage`
2. Background acha (ou abre) uma aba do `www.magnific.com`
3. Content-script no Magnific cria N pares Image + Video conectados
4. Configura: **Nano Banana 2 + 1K + 9:16 + Unlimited** (image) e
   **Kling 2.5 + 720p + 9:16 + 10s + Unlimited** (video)
5. Dispara `POST /app/api/spaces/{id}/workflows/execute` em ondas de
   **12 imagens simultaneas + 6 videos simultaneos** (limite Magnific)
6. Detecta renders pelo DOM (`pikaso.cdnpk.net/private/.../render.jpg`
   + `.mp4`)
7. Baixa MP4s com cookies da sessao + empacota tudo em ZIP final

## Seguranca

- **NUNCA digita senha** — voce loga manualmente em `www.magnific.com`
- **NUNCA consome API paga** — usa Spaces UI direto (sessao do user)
- **NUNCA gasta creditos** — pre-check `is_unlimited_mode_enabled=true`
  bloqueia disparo se Unlimited estiver OFF; wallet snapshot
  antes/depois confirma `creditDelta=0`

## Suporte

Se algo nao funcionar:

1. Abra DevTools na aba `www.magnific.com` (F12)
2. Procure logs `[DARKO Magnific Content]` no Console
3. Cole o erro no canal de suporte do DARKO LAB

Versao: 3.1.1
