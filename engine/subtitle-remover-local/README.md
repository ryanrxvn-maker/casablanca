# DarkoLab — Subtitle Remover Local

Substitui o motor pago (Claude Haiku Vision) da ferramenta **Remover Legenda** do DarkoLab por uma stack 100% local, equivalente ao motor do `vmake.ai/video-watermark-remover` em modo Smart.

## Stack

- **PaddleOCR** — detecta hard-sub burned-in em frames amostrados.
- **Mascara persistente** — consolida bboxes que aparecem consistentemente (>40% dos frames de amostra), com viés inferior pra favorecer legendas.
- **Inpainting:**
  - `telea` (default, rápido, sem GPU, CPU-only)
  - `lama` (opcional, qualidade superior, ~3-5x mais lento, usa torch)
- **ffmpeg** — remux com áudio original sem perda.

## Restrições

- Apenas a **conta admin** do DarkoLab tem acesso à UI desta ferramenta.
- O server escuta **só em 127.0.0.1** — nada exposto na rede.
- Nenhum vídeo sai do seu PC.

## Setup (uma vez)

Requisitos:
- Python 3.10 ou 3.11 (recomendado; 3.12 também funciona)
- ffmpeg no PATH (`winget install Gyan.FFmpeg`)

```cmd
cd "D:\Área de Trabalho\CASABLANCA\engine\subtitle-remover-local"
python -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

A primeira instalação baixa ~2 GB (paddlepaddle + torch). Os pesos do PaddleOCR (~10 MB) baixam no primeiro uso.

Se você **não** quer LaMa (modo qualidade superior), edite `requirements.txt` e comente as linhas `torch` e `simple-lama-inpainting` — instalação fica em ~400 MB.

## Inicialização

A cada vez que for usar a ferramenta no DarkoLab:

```cmd
start.bat
```

Deixa a janela aberta. O Next.js (rodando em `localhost:3000`) detecta automaticamente o servidor em `127.0.0.1:8765`. Se o servidor não estiver rodando, a UI mostra "Servidor local offline" e bloqueia o upload.

## API

```
GET  /health                          → {ok, ready, deps}
POST /process   multipart file,mode   → MP4 streaming (sincrono)
POST /jobs      multipart file,mode   → {job_id} (assincrono)
GET  /jobs/{id}                       → {state, progress, stage}
GET  /jobs/{id}/result                → MP4 streaming
DELETE /jobs/{id}                     → cleanup
```

`mode = telea | lama`. Default `telea`.

## Custo

**Zero.** Nenhum vídeo sai do PC, nenhum token de API é consumido. Comparado ao motor antigo (Claude Haiku, ~$0.015/vídeo) e ao vmake.ai (~$9.90/mês), economia total.

## Token compartilhado (opcional)

Se quiser exigir um header de autenticação local extra, defina `DARKO_LOCAL_TOKEN` antes de iniciar:

```cmd
set DARKO_LOCAL_TOKEN=meusegredo
start.bat
```

E adicione o mesmo valor em `.env.local` do Next.js como `DARKO_LOCAL_TOKEN`.
Sem isso, o server só confia no fato de estar em 127.0.0.1.
