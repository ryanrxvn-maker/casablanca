"""
Modal app — Decupagem de silêncios serverless (ffmpeg REAL, CPU).

Por que existe: a decupagem do navegador roda em ffmpeg-wasm, que tem teto de
memória (~2GB) e NÃO aguenta vídeo grande (1.5GB) — estoura e/ou entrega MP4
corrompido. Aqui é ffmpeg nativo num container com RAM de verdade: processa
1.5GB tranquilo e SEMPRE devolve um MP4 íntegro (ou um erro claro).

Deploy:  modal deploy modal/decupagem.py

Endpoints (ASGI):
- POST /up?ext=mp4              → sobe bytes (input) → { id }
- GET  /file?id=X[&dl=nome.mp4] → serve arquivo (streaming). Com dl= força
                                    download (Content-Disposition: attachment).
- POST /decupar { video_url, keep_silence, output_kind }
                               → dispara job async → { call_id }
- GET  /status?call_id=X        → { status: processing|done|failed, id, ... }
- GET  /health

Pipeline (1 passada de ffmpeg, frame-accurate):
  measure volume → silencedetect (piso de ruído ADAPTATIVO) → monta segmentos de
  fala (mesma lógica do app: padding keep_silence, descarta gap < 0.05s) →
  select/aselect num único encode libx264 +faststart.
"""

import re
import subprocess
import urllib.request
import uuid
from pathlib import Path

import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi[standard]")
)

app = modal.App("casablanca-decupagem", image=image)
vol = modal.Volume.from_name("decupagem-work", create_if_missing=True)

# Segredo `casablanca-decup` deve conter:
#   DECUP_KEY            — token mestre; só o backend (Vercel) chama /decupar.
#   DECUP_UPLOAD_SECRET  — segredo HMAC dos tickets de upload descartáveis. O
#                          backend emite um ticket curto (~10min) e o navegador
#                          usa ele pra subir o arquivo grande direto no /up, SEM
#                          nunca ver o token mestre.
#   DECUP_ALLOWED_HOSTS  — hosts permitidos pra video_url (anti-SSRF), separados
#                          por vírgula. Ex.: "supabase.co,modal.run"
#   DECUP_CORS_ORIGINS   — origens do navegador liberadas pro /up (CORS),
#                          separadas por vírgula. Ex.: "https://darkoautoedit.com"
decup_secret = modal.Secret.from_name("casablanca-decup")

MIN_SILENCE_S = 0.35          # gap mínimo pra considerar "silêncio removível"
NOISE_BELOW_PEAK_DB = 35.0    # piso de ruído = pico - 35dB (adaptativo)
NOISE_FLOOR_MIN_DB = -50.0
NOISE_FLOOR_MAX_DB = -26.0


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def _probe_duration(path: Path) -> float:
    p = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
              "-of", "default=noprint_wrappers=1:nokey=1", str(path)])
    try:
        return float(p.stdout.strip())
    except (ValueError, AttributeError):
        return 0.0


def _measure_peak_db(path: Path) -> float:
    p = _run(["ffmpeg", "-hide_banner", "-i", str(path),
              "-af", "volumedetect", "-f", "null", "-"])
    m = re.search(r"max_volume:\s*(-?[\d.]+)\s*dB", p.stderr)
    return float(m.group(1)) if m else -3.0


def _detect_silences(path: Path, noise_db: float, min_sil: float) -> list[tuple[float, float]]:
    p = _run(["ffmpeg", "-hide_banner", "-i", str(path),
              "-af", f"silencedetect=noise={noise_db}dB:d={min_sil}",
              "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?[\d.]+)", p.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*(-?[\d.]+)", p.stderr)]
    sils: list[tuple[float, float]] = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        if e is not None and e > s:
            sils.append((max(0.0, s), e))
    return sils


def _speech_segments(sils, total: float, keep: float):
    """Mesma lógica do computeSpeechSegments do app."""
    segs: list[tuple[float, float]] = []
    cursor = 0.0
    for (s, e) in sils:
        sil_start = max(0.0, s + keep)
        sil_end = min(total, e - keep)
        if sil_end > sil_start:
            if sil_start > cursor:
                segs.append((cursor, sil_start))
            cursor = sil_end
    if cursor < total:
        segs.append((cursor, total))
    return [(a, b) for (a, b) in segs if (b - a) > 0.05]


@app.function(cpu=8.0, memory=8192, timeout=3600, volumes={"/work": vol})
def run_decupagem(video_url: str, keep_silence: float, output_kind: str) -> dict:
    """Decupa silêncios com ffmpeg nativo. Grava no volume e retorna o id."""
    job = uuid.uuid4().hex[:12]
    d = Path(f"/tmp/{job}")
    d.mkdir(parents=True, exist_ok=True)
    src = d / "in.mp4"

    _download(video_url, src)
    total = _probe_duration(src)
    if total <= 0:
        raise RuntimeError("Não consegui ler a duração do vídeo (arquivo inválido?).")

    peak = _measure_peak_db(src)
    noise_db = max(NOISE_FLOOR_MIN_DB, min(NOISE_FLOOR_MAX_DB, peak - NOISE_BELOW_PEAK_DB))
    sils = _detect_silences(src, noise_db, MIN_SILENCE_S)
    segs = _speech_segments(sils, total, max(0.01, float(keep_silence)))
    if not segs:
        segs = [(0.0, total)]  # sem fala detectada → mantém tudo (nunca quebra)
    new_dur = sum(b - a for (a, b) in segs)

    sel = "+".join(f"between(t,{a:.3f},{b:.3f})" for (a, b) in segs)
    is_audio = output_kind == "audio"
    ext = "mp3" if is_audio else "mp4"
    out = Path(f"/work/{job}.{ext}")

    if is_audio:
        cmd = [
            "ffmpeg", "-y", "-i", str(src),
            "-af", f"aselect='{sel}',asetpts=N/SR/TB,dynaudnorm=f=200:g=15:p=0.9:m=4",
            "-vn", "-c:a", "libmp3lame", "-q:a", "2", str(out),
        ]
    else:
        cmd = [
            "ffmpeg", "-y", "-i", str(src),
            "-vf", f"select='{sel}',setpts=N/FRAME_RATE/TB",
            "-af", f"aselect='{sel}',asetpts=N/SR/TB,dynaudnorm=f=200:g=15:p=0.9:m=4",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", str(out),
        ]

    r = _run(cmd)
    if r.returncode != 0 or not out.exists() or out.stat().st_size < 4096:
        raise RuntimeError(f"ffmpeg falhou (rc={r.returncode}): {r.stderr[-1500:]}")
    if not is_audio and b"ftyp" not in out.read_bytes()[:200]:
        raise RuntimeError("MP4 de saída sem ftyp (corrompido).")

    vol.commit()
    return {
        "id": f"{job}.{ext}",
        "original_dur": round(total, 3),
        "new_dur": round(new_dur, 3),
        "segments": len(segs),
        "size_mb": round(out.stat().st_size / 1024 / 1024, 2),
    }


@app.function(timeout=1800, memory=2048, volumes={"/work": vol}, max_containers=20, secrets=[decup_secret])
@modal.asgi_app()
def web():
    import hashlib
    import hmac
    import os
    import time
    from urllib.parse import urlparse

    from fastapi import FastAPI, Header, HTTPException, Query, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse, JSONResponse
    from modal.functions import FunctionCall

    api = FastAPI(docs_url=None, redoc_url=None)

    origins = [o.strip() for o in os.environ.get("DECUP_CORS_ORIGINS", "").split(",") if o.strip()]
    api.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _auth(key: str | None):
        expected = os.environ.get("DECUP_KEY", "")
        if not expected or not key or not hmac.compare_digest(key, expected):
            raise HTTPException(401, "não autorizado")

    def _verify_ticket(ticket: str | None):
        """Ticket de upload descartável: '<exp>.<hmac>' (HMAC-SHA256 do exp)."""
        secret = os.environ.get("DECUP_UPLOAD_SECRET", "").encode()
        if not secret or not ticket or "." not in ticket:
            raise HTTPException(401, "ticket inválido")
        exp_s, sig = ticket.split(".", 1)
        try:
            if int(exp_s) < int(time.time()):
                raise HTTPException(401, "ticket expirado")
        except ValueError:
            raise HTTPException(401, "ticket inválido")
        expected = hmac.new(secret, exp_s.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(401, "ticket inválido")

    def _check_ssrf(url: str):
        """video_url só pode apontar pros hosts da allowlist (anti-SSRF)."""
        allowed = [h.strip().lower() for h in os.environ.get("DECUP_ALLOWED_HOSTS", "").split(",") if h.strip()]
        host = (urlparse(url).hostname or "").lower()
        scheme = urlparse(url).scheme
        if scheme not in ("http", "https") or not host:
            raise HTTPException(400, "URL inválida")
        if not any(host == a or host.endswith("." + a) for a in allowed):
            raise HTTPException(400, f"host não permitido: {host}")

    @api.get("/health")
    async def health():
        return {"ok": True, "app": "casablanca-decupagem"}

    @api.post("/up")
    async def up(request: Request, ext: str = Query("mp4"), x_decup_ticket: str = Header(None)):
        _verify_ticket(x_decup_ticket)
        if ext not in ("mp4", "mov", "webm", "mkv", "m4a", "mp3", "wav"):
            ext = "mp4"
        fid = uuid.uuid4().hex[:12]
        path = Path(f"/work/{fid}.{ext}")
        total = 0
        # Streaming pra disco: arquivo de 1.5GB nunca fica inteiro na RAM.
        with open(path, "wb") as f:
            async for chunk in request.stream():
                if chunk:
                    f.write(chunk)
                    total += len(chunk)
        if total < 1:
            path.unlink(missing_ok=True)
            raise HTTPException(400, "Body vazio")
        vol.commit()
        return {"id": f"{fid}.{ext}", "size_mb": round(total / 1024 / 1024, 2)}

    @api.get("/file")
    async def file(id: str = Query(...), dl: str = Query(None)):
        vol.reload()
        path = Path(f"/work/{id}")
        if not path.exists():
            raise HTTPException(404, "Arquivo não encontrado")
        media = "video/mp4" if id.endswith(".mp4") else (
            "audio/mpeg" if id.endswith(".mp3") else "application/octet-stream")
        headers = {}
        if dl:
            headers["Content-Disposition"] = f'attachment; filename="{dl}"'
        return FileResponse(str(path), media_type=media, headers=headers)

    @api.post("/decupar")
    async def decupar(item: dict, x_decup_key: str = Header(None)):
        _auth(x_decup_key)
        video_url = item.get("video_url")
        if not video_url:
            raise HTTPException(400, "video_url obrigatório")
        _check_ssrf(video_url)
        keep = float(item.get("keep_silence", 0.05))
        kind = item.get("output_kind", "video")
        call = run_decupagem.spawn(video_url, keep, kind)
        return {"success": True, "call_id": call.object_id}

    @api.get("/status")
    async def status(call_id: str = Query(...)):
        fc = FunctionCall.from_id(call_id)
        try:
            res = fc.get(timeout=0)
            return JSONResponse({"status": "done", **res})
        except TimeoutError:
            return JSONResponse({"status": "processing"})
        except Exception as e:
            return JSONResponse({"status": "failed", "error": str(e)[:800]})

    return api
