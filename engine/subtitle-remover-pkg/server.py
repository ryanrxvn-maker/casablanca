"""
DarkoLab — Subtitle Remover LOCAL server.

Roda em http://127.0.0.1:8765 (apenas localhost). O front-end do DarkoLab
fala diretamente com este server, sem passar pela API do Next.js — assim
nao temos limite de 4.5MB do Vercel e nada sobe pra nuvem.

Seguranca / pareamento — ZERO-CONFIG (sem codigo de pareamento):
  - bind so em 127.0.0.1 (nao acessivel da rede local)
  - guard de Origin: TODA request (exceto /health) precisa vir com
    header Origin de uma whitelist hardcoded (darkolab.com,
    *.vercel.app, localhost, 127.0.0.1). Origin eh setado pelo
    browser e NAO pode ser forjado por JavaScript em outro site
    (a spec do fetch / XHR garante isso). Logo, basta o motor
    estar rodando — quando o usuario abre o DarkoLab, o browser
    automaticamente manda Origin: https://darkolab.com (ou
    localhost em dev), e o motor aceita.
  - /health e PUBLICO (sem guard) — qualquer site pode pingar
    pra detectar se o motor esta rodando, mas isso nao expoe
    nenhum dado nem permite processar videos.
  - Token (legado): ainda eh gerado e persistido em
    %LOCALAPPDATA%\\DarkoSubtitleRemover\\config.json, mas a UI
    nao usa mais. Pode ser usado por scripts manuais via
    Authorization: Bearer <token>, que tambem libera o acesso
    (bypass do Origin guard) — util pra automacoes locais.

Use 'start.bat' pra iniciar; ou:
    .venv\\Scripts\\activate
    python server.py
"""

from __future__ import annotations

import os
import sys
import json
import socket
import secrets
import asyncio
import tempfile
import time
import uuid
import shutil
import threading
from typing import Optional, Dict

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Garante que o package "pipeline" seja resolvivel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import process_video, check_runtime  # noqa: E402


# ---------------------------------------------------------------------------
# Config + token persistente
# ---------------------------------------------------------------------------

DEFAULT_PORT = 8765
PORT_FALLBACKS = [8765, 8766, 8767, 8768, 8769]


def _config_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = os.path.join(base, "DarkoSubtitleRemover")
    os.makedirs(d, exist_ok=True)
    return d


def _load_or_create_config() -> dict:
    """
    Carrega config (token + porta) do LOCALAPPDATA; cria no 1o uso.
    Se DARKO_LOCAL_TOKEN estiver definido no env, sobrescreve.
    """
    cfg_path = os.path.join(_config_dir(), "config.json")
    cfg: dict = {}
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            cfg = {}

    if not cfg.get("token"):
        cfg["token"] = secrets.token_hex(16)  # 32 hex chars
    if not cfg.get("port"):
        cfg["port"] = DEFAULT_PORT

    env_tok = os.environ.get("DARKO_LOCAL_TOKEN")
    if env_tok:
        cfg["token"] = env_tok
    env_port = os.environ.get("DARKO_LOCAL_PORT")
    if env_port and env_port.isdigit():
        cfg["port"] = int(env_port)

    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return cfg


def _pick_free_port(preferred: int) -> int:
    """Tenta a porta preferida; se ocupada, busca alternativa na lista."""
    candidates = [preferred] + [p for p in PORT_FALLBACKS if p != preferred]
    for p in candidates:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", p))
            s.close()
            return p
        except OSError:
            s.close()
            continue
    raise RuntimeError("Sem portas livres no range Darko (8765-8769).")


CONFIG = _load_or_create_config()
HOST = "127.0.0.1"
TOKEN = CONFIG["token"]
PORT = _pick_free_port(int(CONFIG["port"]))
# Persiste a porta efetivamente usada (caso tenha caido pra fallback)
if PORT != CONFIG["port"]:
    CONFIG["port"] = PORT
    with open(os.path.join(_config_dir(), "config.json"), "w", encoding="utf-8") as _f:
        json.dump(CONFIG, _f, indent=2)


JOBS_DIR = os.path.join(tempfile.gettempdir(), "darko-subtitle-remover")
os.makedirs(JOBS_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

ALLOWED_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    r"|^https://([a-z0-9-]+\.)*darkolab\.com$"
    r"|^https://.*\.vercel\.app$"
)

import re as _re
_origin_re = _re.compile(ALLOWED_ORIGIN_REGEX)


def _extract_token(authorization: Optional[str], x_darko_token: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return x_darko_token


def _origin_ok(origin: Optional[str]) -> bool:
    """Valida que Origin vem de uma origem confiavel."""
    if not origin:
        return False
    return _origin_re.match(origin) is not None


def _auth_or_403(
    request_origin: Optional[str],
    authorization: Optional[str],
    x_darko_token: Optional[str],
):
    """
    Autorizacao zero-config:
      - se Origin esta na whitelist -> OK (browser nao deixa origin ser
        forjado em fetch/XHR, entao isso eh seguro contra sites maliciosos)
      - OU se Bearer token bate -> OK (fallback pra scripts locais)
      - Caso contrario -> 403
    """
    if _origin_ok(request_origin):
        return
    tok = _extract_token(authorization, x_darko_token)
    if tok and tok == TOKEN:
        return
    raise HTTPException(
        status_code=403,
        detail="origin not allowed (browser must come from darkolab.com or localhost)",
    )


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Darko Subtitle Remover (Local)", version="1.1.0")

# CORS amplo pra origens permitidas; o gate real eh o token Bearer.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Darko-Stats", "Content-Disposition"],
)


# ---------------------------------------------------------------------------
# Job tracking (memoria) — single-process; sem persistencia entre restarts.
# ---------------------------------------------------------------------------

class Job:
    __slots__ = (
        "id", "state", "progress", "stage", "in_path", "out_path",
        "started_at", "finished_at", "error", "stats", "lock",
    )

    def __init__(self, jid: str, in_path: str, out_path: str):
        self.id = jid
        self.state = "queued"   # queued | running | done | error
        self.progress = 0.0
        self.stage = ""
        self.in_path = in_path
        self.out_path = out_path
        self.started_at = time.time()
        self.finished_at: Optional[float] = None
        self.error: Optional[str] = None
        self.stats: Optional[dict] = None
        self.lock = threading.Lock()


JOBS: Dict[str, Job] = {}
JOBS_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    """Publico — status/porta/deps. Nao vaza token nem dado sensivel."""
    rt = check_runtime()
    return {
        "ok": True,
        "service": "darko-subtitle-remover",
        "version": "1.2.0",
        "port": PORT,
        "ready": rt["ready"],
        "deps": rt["deps"],
        "auth_mode": "origin",  # gate por Origin whitelist (zero-config)
    }


@app.post("/process")
async def process(
    file: UploadFile = File(...),
    mode: str = Form("auto"),
    origin: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
    x_darko_token: Optional[str] = Header(default=None),
):
    """Sincrono: processa e devolve direto o MP4. Pra videos curtos."""
    _auth_or_403(origin, authorization, x_darko_token)
    if mode not in ("auto", "propainter", "sttn", "lama", "telea"):
        raise HTTPException(status_code=400, detail="mode must be auto|sttn|lama|telea")

    jid = uuid.uuid4().hex[:12]
    job_dir = os.path.join(JOBS_DIR, jid)
    os.makedirs(job_dir, exist_ok=True)
    in_path = os.path.join(job_dir, "input" + (os.path.splitext(file.filename or "")[1] or ".mp4"))
    out_path = os.path.join(job_dir, "output.mp4")

    with open(in_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    try:
        stats = await asyncio.to_thread(
            process_video, in_path, out_path, mode, 20, 0.30, None,
        )
    except Exception as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))

    def stream_and_cleanup():
        try:
            with open(out_path, "rb") as fh:
                while True:
                    chunk = fh.read(1024 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    headers = {
        "Content-Disposition": f'attachment; filename="{os.path.splitext(file.filename or "video")[0]}_clean.mp4"',
        "X-Darko-Stats": json.dumps(stats),
    }
    return StreamingResponse(stream_and_cleanup(), media_type="video/mp4", headers=headers)


@app.post("/jobs")
async def create_job(
    file: UploadFile = File(...),
    mode: str = Form("auto"),
    origin: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
    x_darko_token: Optional[str] = Header(default=None),
):
    """Assincrono: cria o job, retorna id; cliente faz polling em /jobs/{id}."""
    _auth_or_403(origin, authorization, x_darko_token)
    if mode not in ("auto", "propainter", "sttn", "lama", "telea"):
        raise HTTPException(status_code=400, detail="mode must be auto|sttn|lama|telea")

    jid = uuid.uuid4().hex[:12]
    job_dir = os.path.join(JOBS_DIR, jid)
    os.makedirs(job_dir, exist_ok=True)
    in_path = os.path.join(job_dir, "input" + (os.path.splitext(file.filename or "")[1] or ".mp4"))
    out_path = os.path.join(job_dir, "output.mp4")

    with open(in_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    job = Job(jid, in_path, out_path)
    with JOBS_LOCK:
        JOBS[jid] = job

    def _worker():
        with job.lock:
            job.state = "running"
        try:
            def on_prog(p: float, msg: str):
                with job.lock:
                    job.progress = float(max(0.0, min(1.0, p)))
                    job.stage = msg
            stats = process_video(in_path, out_path, mode, 20, 0.30, on_prog)
            with job.lock:
                job.state = "done"
                job.progress = 1.0
                job.stage = "Done."
                job.stats = stats
                job.finished_at = time.time()
        except Exception as e:
            with job.lock:
                job.state = "error"
                job.error = str(e)
                job.finished_at = time.time()

    threading.Thread(target=_worker, daemon=True).start()
    return {"job_id": jid, "state": "queued"}


@app.get("/jobs/{jid}")
async def get_job(
    jid: str,
    origin: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
    x_darko_token: Optional[str] = Header(default=None),
):
    _auth_or_403(origin, authorization, x_darko_token)
    with JOBS_LOCK:
        job = JOBS.get(jid)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    with job.lock:
        return {
            "id": job.id,
            "state": job.state,
            "progress": job.progress,
            "stage": job.stage,
            "error": job.error,
            "stats": job.stats,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
        }


@app.get("/jobs/{jid}/result")
async def get_job_result(
    jid: str,
    origin: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
    x_darko_token: Optional[str] = Header(default=None),
):
    _auth_or_403(origin, authorization, x_darko_token)
    with JOBS_LOCK:
        job = JOBS.get(jid)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    with job.lock:
        if job.state != "done":
            raise HTTPException(status_code=409, detail=f"job state={job.state}")
        out = job.out_path

    def stream_and_cleanup():
        try:
            with open(out, "rb") as fh:
                while True:
                    chunk = fh.read(1024 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            with JOBS_LOCK:
                JOBS.pop(jid, None)
            shutil.rmtree(os.path.dirname(out), ignore_errors=True)

    headers = {
        "Content-Disposition": f'attachment; filename="darko_clean_{jid}.mp4"',
    }
    return StreamingResponse(stream_and_cleanup(), media_type="video/mp4", headers=headers)


@app.delete("/jobs/{jid}")
async def delete_job(
    jid: str,
    origin: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
    x_darko_token: Optional[str] = Header(default=None),
):
    _auth_or_403(origin, authorization, x_darko_token)
    with JOBS_LOCK:
        job = JOBS.pop(jid, None)
    if job:
        shutil.rmtree(os.path.dirname(job.in_path), ignore_errors=True)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Linha JSON pro instalador GUI capturar — zero-config: nao mostra
    # token, o instalador so confirma que o server subiu OK.
    print(json.dumps({
        "event": "ready",
        "service": "darko-subtitle-remover",
        "version": "1.2.0",
        "port": PORT,
        "auth_mode": "origin",
    }), flush=True)
    print(f"[darko] Subtitle Remover Local @ http://{HOST}:{PORT}", flush=True)
    rt = check_runtime()
    print(f"[darko] Runtime check: {rt}", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
