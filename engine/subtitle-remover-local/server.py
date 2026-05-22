"""
DarkoLab — Subtitle Remover LOCAL server.

Roda em http://127.0.0.1:8765 (apenas localhost). O front-end do DarkoLab
(rota /tools/remover-elementos) fala diretamente com este server, sem
passar pela API do Next.js — assim nao temos limite de 4.5MB do Vercel
e nada sobe pra nuvem.

Seguranca:
  - bind so em 127.0.0.1 (nao acessivel da rede local)
  - CORS aberto pra http://localhost:3000 / 127.0.0.1:3000 / Vercel preview
  - shared token opcional via env DARKO_LOCAL_TOKEN (header X-Darko-Token)

Use 'start.bat' pra iniciar; ou:
    .venv\\Scripts\\activate
    python server.py
"""

from __future__ import annotations

import os
import sys
import asyncio
import tempfile
import time
import uuid
import shutil
import threading
from typing import Optional, Dict

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Garante que o package "pipeline" seja resolvivel
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import process_video, check_runtime  # noqa: E402


HOST = "127.0.0.1"
PORT = int(os.environ.get("DARKO_LOCAL_PORT", "8765"))
SHARED_TOKEN = os.environ.get("DARKO_LOCAL_TOKEN", "")  # opcional

JOBS_DIR = os.path.join(tempfile.gettempdir(), "darko-subtitle-remover")
os.makedirs(JOBS_DIR, exist_ok=True)

app = FastAPI(title="Darko Subtitle Remover (Local)", version="1.0.0")

# Origens permitidas: dev local + preview do Vercel (qualquer subdominio).
# Para localhost->127.0.0.1 funcionar com fetch, precisa do allow_credentials=False
# (nao mandamos cookies — usamos token opcional via header).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://.*\.vercel\.app$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
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


def _check_token(token: Optional[str]):
    if SHARED_TOKEN and token != SHARED_TOKEN:
        raise HTTPException(status_code=401, detail="invalid local token")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    rt = check_runtime()
    return {
        "ok": True,
        "service": "darko-subtitle-remover",
        "version": "1.0.0",
        "ready": rt["ready"],
        "deps": rt["deps"],
        "auth_required": bool(SHARED_TOKEN),
    }


@app.post("/process")
async def process(
    file: UploadFile = File(...),
    mode: str = Form("telea"),
    x_darko_token: Optional[str] = Header(default=None),
):
    """Sincrono: processa e devolve direto o MP4. Pra videos curtos."""
    _check_token(x_darko_token)
    if mode not in ("telea", "lama"):
        raise HTTPException(status_code=400, detail="mode must be telea|lama")

    jid = uuid.uuid4().hex[:12]
    job_dir = os.path.join(JOBS_DIR, jid)
    os.makedirs(job_dir, exist_ok=True)
    in_path = os.path.join(job_dir, "input" + os.path.splitext(file.filename or "")[1] or ".mp4")
    out_path = os.path.join(job_dir, "output.mp4")

    with open(in_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    try:
        stats = await asyncio.to_thread(
            process_video, in_path, out_path, mode, 16, 0.4, None,
        )
    except Exception as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))

    def stream_and_cleanup():
        try:
            with open(out_path, "rb") as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)

    headers = {
        "Content-Disposition": f'attachment; filename="{os.path.splitext(file.filename or "video")[0]}_clean.mp4"',
        "X-Darko-Stats": str(stats),
    }
    return StreamingResponse(stream_and_cleanup(), media_type="video/mp4", headers=headers)


@app.post("/jobs")
async def create_job(
    file: UploadFile = File(...),
    mode: str = Form("telea"),
    x_darko_token: Optional[str] = Header(default=None),
):
    """Assincrono: cria o job, retorna id; cliente faz polling em /jobs/{id}."""
    _check_token(x_darko_token)
    if mode not in ("telea", "lama"):
        raise HTTPException(status_code=400, detail="mode must be telea|lama")

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
            stats = process_video(in_path, out_path, mode, 16, 0.4, on_prog)
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
async def get_job(jid: str, x_darko_token: Optional[str] = Header(default=None)):
    _check_token(x_darko_token)
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
async def get_job_result(jid: str, x_darko_token: Optional[str] = Header(default=None)):
    _check_token(x_darko_token)
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
            with open(out, "rb") as f:
                while True:
                    chunk = f.read(1024 * 1024)
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
async def delete_job(jid: str, x_darko_token: Optional[str] = Header(default=None)):
    _check_token(x_darko_token)
    with JOBS_LOCK:
        job = JOBS.pop(jid, None)
    if job:
        shutil.rmtree(os.path.dirname(job.in_path), ignore_errors=True)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"[darko] Subtitle Remover Local @ http://{HOST}:{PORT}")
    print(f"[darko] Auth header required: {bool(SHARED_TOKEN)}")
    rt = check_runtime()
    print(f"[darko] Runtime check: {rt}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
