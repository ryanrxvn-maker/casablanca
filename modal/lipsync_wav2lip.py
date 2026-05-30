"""
Modal app — Wav2Lip lipsync serverless.

Deploy: modal deploy modal/lipsync_wav2lip.py

3 endpoints:
- POST /up?ext=mp4  → upload raw bytes; retorna { id }
- GET  /file?id=X   → serve arquivo upado ou gerado
- POST /generate    → { video_url, audio_url } → roda Wav2Lip → { id }

Custo aprox: T4 GPU $0.59/h → chunk 25s = ~38s GPU = $0.006 (R$ 0.03)
300 min/mes (720 chunks 25s) = $4.46 (R$ 24)
"""

import modal
import subprocess
import urllib.request
import uuid
from pathlib import Path

# ---------- Image ----------
image = (
    modal.Image.from_registry(
        "pytorch/pytorch:2.0.1-cuda11.7-cudnn8-runtime",
        add_python="3.10",
    )
    .env({"DEBIAN_FRONTEND": "noninteractive", "TZ": "Etc/UTC"})
    .apt_install("ffmpeg", "git", "libsm6", "libxext6", "libgl1", "wget")
    .pip_install(
        "numpy<2",
        "opencv-python",
        "librosa==0.9.2",
        "scipy",
        "tqdm",
        "numba",
        "Pillow",
        "requests",
        "fastapi[standard]",
    )
    .run_commands(
        "git clone https://github.com/Rudrabha/Wav2Lip.git /Wav2Lip",
        "mkdir -p /Wav2Lip/checkpoints",
        "wget -q -O /Wav2Lip/checkpoints/wav2lip_gan.pth "
        "'https://github.com/justinjohn0306/Wav2Lip/releases/download/models/wav2lip_gan.pth'",
        "mkdir -p /Wav2Lip/face_detection/detection/sfd",
        "wget -q -O /Wav2Lip/face_detection/detection/sfd/s3fd.pth "
        "'https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth'",
    )
)

app = modal.App("casablanca-lipsync", image=image)
output_volume = modal.Volume.from_name("lipsync-outputs", create_if_missing=True)


@app.function(
    gpu="A10G",  # ~3x mais rapido que T4 pra Wav2Lip
    timeout=600,
    volumes={"/outputs": output_volume},
    min_containers=0,  # serverless (paga so quando usa)
)
def run_wav2lip(video_bytes: bytes, audio_bytes: bytes, job_id: str) -> bytes:
    """Roda Wav2Lip na GPU. Retorna bytes do mp4 gerado."""
    work_dir = Path(f"/tmp/{job_id}")
    work_dir.mkdir(parents=True, exist_ok=True)

    video_path = work_dir / "input.mp4"
    audio_path = work_dir / "input.wav"
    output_path = work_dir / "output.mp4"

    video_path.write_bytes(video_bytes)
    audio_path.write_bytes(audio_bytes)

    cmd = [
        "python",
        "/Wav2Lip/inference.py",
        "--checkpoint_path", "/Wav2Lip/checkpoints/wav2lip_gan.pth",
        "--face", str(video_path),
        "--audio", str(audio_path),
        "--outfile", str(output_path),
        "--pads", "0", "15", "0", "0",
        # resize_factor 2 = processa em 640p ao inves de 1280p.
        # ~4x mais rapido. Qualidade lipsync inalterada (modelo opera
        # em 96x96 face crop de qualquer jeito), so a borda do rosto
        # tem ligeira reducao de res — pos-process recupera.
        "--resize_factor", "2",
        # Batches maiores aproveitam mais a GPU A10G
        "--wav2lip_batch_size", "256",
        "--face_det_batch_size", "32",
        "--nosmooth",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd="/Wav2Lip")
    if result.returncode != 0:
        raise RuntimeError(
            f"Wav2Lip exit {result.returncode}\n"
            f"stdout: {result.stdout[-2000:]}\n"
            f"stderr: {result.stderr[-2000:]}"
        )
    if not output_path.exists():
        raise RuntimeError(f"Output nao gerado. stderr: {result.stderr[-1000:]}")
    return output_path.read_bytes()


# ---------- ASGI app (todos endpoints num lugar so) ----------
@app.function(
    timeout=600,
    volumes={"/outputs": output_volume},
    max_containers=10,
)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Request, HTTPException, Query
    from fastapi.responses import Response, JSONResponse

    api = FastAPI(docs_url=None, redoc_url=None)

    @api.post("/up")
    async def upload(request: Request, ext: str = Query("mp4")):
        """Upload de arquivo. POST com body bytes. Retorna {id, ext}."""
        body = await request.body()
        if not body:
            raise HTTPException(status_code=400, detail="Body vazio")
        if ext not in ("mp4", "wav", "mp3", "m4a"):
            ext = "mp4"
        file_id = uuid.uuid4().hex[:12]
        path = Path(f"/outputs/{file_id}.{ext}")
        path.write_bytes(body)
        output_volume.commit()
        return JSONResponse({
            "success": True,
            "id": file_id,
            "ext": ext,
            "size_mb": round(len(body) / 1024 / 1024, 2),
        })

    @api.get("/file")
    async def serve_file(id: str = Query(...)):
        """Serve arquivo pelo id (procura .mp4, .wav, .mp3, .m4a)."""
        output_volume.reload()
        for ext in ("mp4", "wav", "mp3", "m4a"):
            path = Path(f"/outputs/{id}.{ext}")
            if path.exists():
                media_type = "video/mp4" if ext == "mp4" else f"audio/{ext}"
                return Response(
                    content=path.read_bytes(),
                    media_type=media_type,
                    headers={"Cache-Control": "public, max-age=3600"},
                )
        raise HTTPException(status_code=404, detail="Arquivo nao encontrado")

    @api.post("/generate")
    async def generate(item: dict):
        """Gera lipsync. Body: { video_url, audio_url } → {id, size_mb}."""
        video_url = item.get("video_url")
        audio_url = item.get("audio_url")
        if not video_url or not audio_url:
            raise HTTPException(400, "video_url e audio_url obrigatorios")

        job_id = uuid.uuid4().hex[:12]
        try:
            req_v = urllib.request.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
            video_bytes = urllib.request.urlopen(req_v, timeout=120).read()
            req_a = urllib.request.Request(audio_url, headers={"User-Agent": "Mozilla/5.0"})
            audio_bytes = urllib.request.urlopen(req_a, timeout=120).read()

            output_bytes = run_wav2lip.remote(video_bytes, audio_bytes, job_id)

            output_path = Path(f"/outputs/{job_id}.mp4")
            output_path.write_bytes(output_bytes)
            output_volume.commit()

            return JSONResponse({
                "success": True,
                "id": job_id,
                "size_mb": round(len(output_bytes) / 1024 / 1024, 2),
            })
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    return api
