"""
Modal app — MuseTalk lipsync serverless (Tencent).

QUALIDADE: significativamente superior ao Wav2Lip — sem halo, resolucao
nativa 256x256 na face, dentes nitidos, blending suave no queixo.

Deploy: modal deploy modal/lipsync_musetalk.py

Endpoint base: https://ryanrxvn-maker--casablanca-musetalk-web.modal.run

Endpoints:
- POST /up?ext=mp4  → upload bytes; retorna { id }
- GET  /file?id=X   → serve arquivo
- POST /generate    → { video_url, audio_url, bbox_shift? } → roda MuseTalk

Custo: A10G GPU ($1.10/h = $0.000306/s)
  Chunk 25s × ~5x ratio = 125s GPU = $0.038 (R$ 0.20)
  250 min/mes (600 chunks 25s) = $23 (R$ 122)
  Com Modal $30 free tier: efetivo R$ 0-50/mes
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
    .apt_install("ffmpeg", "git", "libsm6", "libxext6", "libgl1", "wget", "libglib2.0-0",
                 "build-essential", "g++", "cmake")
    .pip_install(
        # Core
        "numpy<2",
        "opencv-python==4.9.0.80",
        "scipy",
        "tqdm",
        "Pillow",
        "requests",
        "fastapi[standard]",
        # MuseTalk dependencies — versions calibradas pra compatibilidade
        # com cached_download (removido em hf-hub 0.26+)
        "huggingface-hub==0.23.0",
        "diffusers==0.27.2",
        "transformers==4.39.1",
        "accelerate==0.28.0",
        "einops",
        "omegaconf",
        "ffmpeg-python",
        "imageio",
        "imageio-ffmpeg",
        "librosa==0.10.1",
        "openmim",
    )
    .run_commands(
        # MMLab instala via mim com versoes pre-built compatíveis
        "mim install mmengine",
        "mim install 'mmcv==2.0.1'",
        "mim install 'mmdet==3.1.0'",
        "mim install 'mmpose==1.1.0'",
    )
    .run_commands(
        # Clona MuseTalk
        "git clone https://github.com/TMElyralab/MuseTalk.git /MuseTalk",
        # Setup dirs — MuseTalk usa nomes especificos: sd-vae (nao -ft-mse)
        "mkdir -p /MuseTalk/models/musetalk /MuseTalk/models/sd-vae "
        "/MuseTalk/models/whisper /MuseTalk/models/dwpose "
        "/MuseTalk/models/face-parse-bisent",
        # 1. MuseTalk main weights (do repo oficial TMElyralab)
        "huggingface-cli download TMElyralab/MuseTalk --local-dir /MuseTalk/models",
        # 2. SD-VAE — path EXATO 'sd-vae' (sem -ft-mse) que MuseTalk espera
        "huggingface-cli download stabilityai/sd-vae-ft-mse --local-dir /MuseTalk/models/sd-vae --include 'config.json' 'diffusion_pytorch_model.bin'",
        # 3. Whisper tiny (tudo — precisa preprocessor_config.json tambem)
        "huggingface-cli download openai/whisper-tiny --local-dir /MuseTalk/models/whisper",
        # 4. DWPose (face landmark detection)
        "wget -q -O /MuseTalk/models/dwpose/dw-ll_ucoco_384.pth "
        "'https://huggingface.co/yzd-v/DWPose/resolve/main/dw-ll_ucoco_384.pth'",
        # 5. Face parse (BiSeNet pra mascarar a face) — usar mirror github
        "wget -q -O /MuseTalk/models/face-parse-bisent/79999_iter.pth "
        "'https://huggingface.co/ManyOtherFunctions/face-parse-bisent/resolve/main/79999_iter.pth' || "
        "wget -q -O /MuseTalk/models/face-parse-bisent/79999_iter.pth "
        "'https://huggingface.co/CipherImage/face_parse/resolve/main/79999_iter.pth'",
        # 6. ResNet18 (backbone do BiSeNet)
        "wget -q -O /MuseTalk/models/face-parse-bisent/resnet18-5c106cde.pth "
        "'https://download.pytorch.org/models/resnet18-5c106cde.pth'",
        # 7. Copia configs/weights do musetalkV15 → musetalk (paths antigos no inference.py)
        # MuseTalk inference.py espera ./models/musetalk/config.json (nao musetalk.json)
        "if [ -d /MuseTalk/models/musetalkV15 ]; then "
        "  cp -n /MuseTalk/models/musetalkV15/musetalk.json /MuseTalk/models/musetalk/config.json 2>/dev/null || true; "
        "  cp -n /MuseTalk/models/musetalkV15/*.pth /MuseTalk/models/musetalk/ 2>/dev/null || true; "
        "  cp -n /MuseTalk/models/musetalkV15/*.bin /MuseTalk/models/musetalk/ 2>/dev/null || true; "
        "fi",
        # Verificar estrutura final
        "echo '=== /MuseTalk/models/ ===' && ls -la /MuseTalk/models/ && "
        "echo '=== musetalk/ ===' && ls -la /MuseTalk/models/musetalk/ && "
        "echo '=== musetalkV15/ ===' && (ls -la /MuseTalk/models/musetalkV15/ 2>/dev/null || echo 'no V15') && "
        "echo '=== sd-vae/ ===' && ls -la /MuseTalk/models/sd-vae/",
    )
)

app = modal.App("casablanca-musetalk", image=image)
output_volume = modal.Volume.from_name("musetalk-outputs", create_if_missing=True)


@app.function(
    gpu="A10G",
    timeout=900,
    volumes={"/outputs": output_volume},
)
def run_musetalk(video_bytes: bytes, audio_bytes: bytes, job_id: str, bbox_shift: int = 0) -> bytes:
    """Roda MuseTalk. Retorna bytes do mp4 gerado."""
    import yaml

    work_dir = Path(f"/tmp/{job_id}")
    work_dir.mkdir(parents=True, exist_ok=True)

    video_path = work_dir / "input.mp4"
    audio_path = work_dir / "input.wav"
    config_path = work_dir / "config.yaml"

    video_path.write_bytes(video_bytes)
    audio_path.write_bytes(audio_bytes)

    # Gera YAML config dinamicamente
    config = {
        "task_0": {
            "video_path": str(video_path),
            "audio_path": str(audio_path),
            "bbox_shift": bbox_shift,
        }
    }
    config_path.write_text(yaml.dump(config))

    cmd = [
        "python", "-m", "scripts.inference",
        "--inference_config", str(config_path),
        "--result_dir", str(work_dir),
        "--fps", "25",
        "--batch_size", "8",
        "--version", "v15",  # CRUCIAL: usa modelo V1.5 (UNet em musetalkV15/)
        "--unet_config", "/MuseTalk/models/musetalk/config.json",
        "--unet_model_path", "/MuseTalk/models/musetalkV15/unet.pth",
        "--whisper_dir", "/MuseTalk/models/whisper",
        "--vae_type", "sd-vae",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd="/MuseTalk")
    if result.returncode != 0:
        raise RuntimeError(
            f"MuseTalk exit {result.returncode}\n"
            f"stdout: {result.stdout[-2000:]}\n"
            f"stderr: {result.stderr[-2000:]}"
        )

    # MuseTalk salva em result_dir/<version>/<task>/<file>.mp4
    # version eh "v15" pq usamos modelo V1.5
    all_mp4s = list(work_dir.rglob("*.mp4"))
    candidates = [p for p in all_mp4s if "input" not in p.name]
    if not candidates:
        # Debug: lista TODOS arquivos recursivamente
        all_files = list(work_dir.rglob("*"))
        raise RuntimeError(
            f"Output nao encontrado. work_dir={work_dir}. "
            f"All mp4s: {all_mp4s}. "
            f"All files: {[str(f) for f in all_files][:50]}"
        )

    # Pega o maior (provavel output completo, nao thumbnails)
    candidates.sort(key=lambda p: p.stat().st_size, reverse=True)
    return candidates[0].read_bytes()


# ---------- ASGI app ----------
@app.function(
    timeout=900,
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
        body = await request.body()
        if not body:
            raise HTTPException(400, "Body vazio")
        if ext not in ("mp4", "wav", "mp3", "m4a"):
            ext = "mp4"
        file_id = uuid.uuid4().hex[:12]
        path = Path(f"/outputs/{file_id}.{ext}")
        path.write_bytes(body)
        output_volume.commit()
        return JSONResponse({"success": True, "id": file_id, "ext": ext, "size_mb": round(len(body) / 1024 / 1024, 2)})

    @api.get("/file")
    async def serve_file(id: str = Query(...)):
        output_volume.reload()
        for ext in ("mp4", "wav", "mp3", "m4a"):
            path = Path(f"/outputs/{id}.{ext}")
            if path.exists():
                return Response(
                    content=path.read_bytes(),
                    media_type="video/mp4" if ext == "mp4" else f"audio/{ext}",
                    headers={"Cache-Control": "public, max-age=3600"},
                )
        raise HTTPException(404, "Nao encontrado")

    @api.post("/generate")
    async def generate(item: dict):
        video_url = item.get("video_url")
        audio_url = item.get("audio_url")
        bbox_shift = int(item.get("bbox_shift", 0))
        if not video_url or not audio_url:
            raise HTTPException(400, "video_url e audio_url obrigatorios")

        job_id = uuid.uuid4().hex[:12]
        try:
            req_v = urllib.request.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
            video_bytes = urllib.request.urlopen(req_v, timeout=120).read()
            req_a = urllib.request.Request(audio_url, headers={"User-Agent": "Mozilla/5.0"})
            audio_bytes = urllib.request.urlopen(req_a, timeout=120).read()

            output_bytes = run_musetalk.remote(video_bytes, audio_bytes, job_id, bbox_shift)

            output_path = Path(f"/outputs/{job_id}.mp4")
            output_path.write_bytes(output_bytes)
            output_volume.commit()

            return JSONResponse({"success": True, "id": job_id, "size_mb": round(len(output_bytes) / 1024 / 1024, 2)})
        except Exception as e:
            return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    return api
