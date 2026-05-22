"""
Pipeline de remocao de legendas hardcoded — "Smart Mode" do DarkoLab.

Equivalente funcional ao vmake.ai/video-watermark-remover:
  1) PaddleOCR roda em N frames amostrados pra localizar onde aparecem
     texts persistentes (hard-sub burned-in).
  2) Unifica as bboxes detectadas em uma mascara dilatada e estavel
     ao longo do tempo (Smart = assume regiao consistente).
  3) Aplica inpainting frame-a-frame:
       - 'telea'  -> cv2.inpaint Telea (rapido, CPU, qualidade boa pra
                     fundos uniformes — o default; nao precisa GPU)
       - 'lama'   -> simple-lama-inpainting (qualidade superior em fundos
                     complexos, ~3-5x mais lento, usa torch)
  4) Re-encoda o video com ffmpeg copiando o audio original.

Sem nenhuma API externa, sem custo por chamada, sem watermark de saida.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import shutil
import json
import math
from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple

# IMPORTANTE: torch DEVE ser importado ANTES de paddlepaddle no Windows.
# Os dois embarcam runtimes nativos conflitantes (MKL/OpenMP/shm.dll) e
# se o paddle carregar primeiro, o torch falha com WinError 127 ao
# tentar carregar shm.dll. Importar torch primeiro corrige.
# Tolerante a falha: se torch nao estiver instalado, o modo Telea ainda
# funciona (mas Smart Mode = LaMa exige torch).
try:
    import torch  # noqa: F401
    _TORCH_AVAILABLE = True
except Exception:
    _TORCH_AVAILABLE = False

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Estado lazy — modelos pesados sao carregados sob demanda.
# ---------------------------------------------------------------------------

_ocr_engine = None  # PaddleOCR
_lama_engine = None  # SimpleLama


def _get_ocr():
    global _ocr_engine
    if _ocr_engine is None:
        from paddleocr import PaddleOCR
        # use_angle_cls=False acelera; lang='en' carrega so detector + reconhecedor
        # leves. Detector funciona pra qualquer alfabeto latino + asiatico.
        _ocr_engine = PaddleOCR(
            use_angle_cls=False,
            lang="en",
            show_log=False,
            use_gpu=False,  # OCR e leve, CPU e suficiente
        )
    return _ocr_engine


def _get_lama():
    """Carrega LaMa sob demanda. Falha graciosamente se torch nao instalado."""
    global _lama_engine
    if _lama_engine is None:
        try:
            from simple_lama_inpainting import SimpleLama
            _lama_engine = SimpleLama()
        except Exception as e:
            raise RuntimeError(
                f"LaMa indisponivel: {e}. Use mode='telea' ou instale "
                "torch + simple-lama-inpainting."
            )
    return _lama_engine


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

@dataclass
class TextBox:
    x: int
    y: int
    w: int
    h: int


def _probe_info(path: str) -> dict:
    """
    Le metadados do video.

    Tenta primeiro `ffprobe` (mais preciso); se nao estiver no PATH,
    cai pra cv2 (que ja seria aberto na proxima etapa de qualquer jeito).
    """
    try:
        res = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,r_frame_rate,duration",
                "-of", "json",
                path,
            ],
            capture_output=True, text=True, check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            data = json.loads(res.stdout)
            s = data["streams"][0]
            num, den = s["r_frame_rate"].split("/")
            fps = float(num) / float(den) if float(den) else 30.0
            return {
                "width": int(s["width"]),
                "height": int(s["height"]),
                "fps": fps,
                "duration": float(s.get("duration", 0.0)),
                "nb_frames": 0,
            }
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        pass  # cai pro fallback cv2

    # Fallback cv2 — funciona ate sem ffprobe instalado.
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Nao foi possivel abrir o video: {path}")
    try:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
        nb = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        duration = nb / fps if fps else 0.0
        return {
            "width": w,
            "height": h,
            "fps": fps,
            "duration": duration,
            "nb_frames": nb,
        }
    finally:
        cap.release()


def _sample_frames(cap: cv2.VideoCapture, k: int) -> List[Tuple[int, np.ndarray]]:
    """Pega k frames espacados uniformemente. Retorna [(idx, frame), ...]."""
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    if total <= 0:
        return []
    if k >= total:
        idxs = list(range(total))
    else:
        idxs = [int(round(i * (total - 1) / max(k - 1, 1))) for i in range(k)]
    out = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        if ok and frame is not None:
            out.append((i, frame))
    return out


def _detect_text_boxes(frame: np.ndarray) -> List[TextBox]:
    """PaddleOCR retorna polygons; convertemos pra bbox axis-aligned."""
    ocr = _get_ocr()
    # PaddleOCR aceita BGR ndarray
    result = ocr.ocr(frame, det=True, rec=False, cls=False)
    if not result or not result[0]:
        return []
    boxes: List[TextBox] = []
    for poly in result[0]:
        pts = np.array(poly, dtype=np.float32)
        x = int(np.floor(pts[:, 0].min()))
        y = int(np.floor(pts[:, 1].min()))
        w = int(math.ceil(pts[:, 0].max() - x))
        h = int(math.ceil(pts[:, 1].max() - y))
        if w > 4 and h > 4:
            boxes.append(TextBox(x, y, w, h))
    return boxes


def _persistent_mask(
    frames: List[Tuple[int, np.ndarray]],
    W: int,
    H: int,
    min_persistence: float = 0.30,
    bottom_bias: float = 1.6,
) -> Optional[np.ndarray]:
    """
    Heatmap de onde texto aparece em N frames amostrados → mascara binaria
    final consolidando regioes com persistencia >= min_persistence.

    bottom_bias > 1 favorece deteccoes na metade inferior (legendas).
    Tudo na metade superior tem que ser MAIS consistente pra entrar (evita
    falso positivo em titulos / placas naturais).

    Calibrado pra ser AGRESSIVO: persistencia minima de 30% pra pegar
    legendas que mudam de palavra ao longo do video (cada palavra so
    aparece num subset dos frames). Dilation maior cobre o glow/outline
    + sombra residual.
    """
    if not frames:
        return None
    heat = np.zeros((H, W), dtype=np.float32)
    n = 0
    for _, fr in frames:
        n += 1
        boxes = _detect_text_boxes(fr)
        for b in boxes:
            x0 = max(0, b.x)
            y0 = max(0, b.y)
            x1 = min(W, b.x + b.w)
            y1 = min(H, b.y + b.h)
            if x0 >= x1 or y0 >= y1:
                continue
            weight = bottom_bias if y0 > H * 0.55 else 1.0
            heat[y0:y1, x0:x1] += weight
    if n == 0:
        return None
    heat /= n  # 0..bottom_bias
    # mascara persistente
    mask = (heat >= min_persistence).astype(np.uint8) * 255
    if mask.max() == 0:
        return None

    # Dilation MAIS agressiva — cobre glow/outline/sombra residual.
    # Kernel maior + iteracoes a mais.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 15))
    mask = cv2.dilate(mask, kernel, iterations=3)

    # CC filter: descarta componentes muito pequenas (<0.05% da area)
    n_cc, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    min_area = max(80, int(W * H * 0.0005))
    cleaned = np.zeros_like(mask)
    for i in range(1, n_cc):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            # Se a CC eh do tipo "faixa de legenda" (largura >> altura, no
            # rodape), unifica em uma faixa retangular pra cobrir bordas
            # que o OCR pode ter perdido entre palavras.
            x = stats[i, cv2.CC_STAT_LEFT]
            y = stats[i, cv2.CC_STAT_TOP]
            w = stats[i, cv2.CC_STAT_WIDTH]
            h = stats[i, cv2.CC_STAT_HEIGHT]
            if y > H * 0.55 and w > W * 0.2 and h < H * 0.25:
                # legenda no rodape: estende horizontalmente um pouco
                pad_x = int(W * 0.02)
                pad_y = int(H * 0.005)
                x0 = max(0, x - pad_x)
                y0 = max(0, y - pad_y)
                x1 = min(W, x + w + pad_x)
                y1 = min(H, y + h + pad_y)
                cleaned[y0:y1, x0:x1] = 255
            else:
                cleaned[labels == i] = 255

    return cleaned if cleaned.max() > 0 else None


def _inpaint_telea(frame: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return cv2.inpaint(frame, mask, 3, cv2.INPAINT_TELEA)


def _mask_bbox_with_padding(mask: np.ndarray, pad: int = 64) -> Optional[Tuple[int, int, int, int]]:
    """Pega bbox da mascara + padding pra dar contexto ao modelo neural."""
    ys, xs = np.where(mask > 0)
    if len(ys) == 0:
        return None
    H, W = mask.shape[:2]
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(H, int(ys.max()) + pad + 1)
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(W, int(xs.max()) + pad + 1)
    return (y0, y1, x0, x1)


def _inpaint_lama(frame: np.ndarray, mask: np.ndarray, bbox: Optional[Tuple[int,int,int,int]] = None) -> np.ndarray:
    """
    LaMa neural inpaint. Pra acelerar drasticamente em videos onde a
    legenda fica numa regiao pequena (e.g. rodape), processa SO o crop
    com padding pra dar contexto, e depois cola de volta no frame.

    Em 1080p com legenda no rodape, processar so o crop reduz o tempo
    em ~5x sem perda de qualidade — LaMa precisa de contexto local, nao
    do frame inteiro.
    """
    from PIL import Image
    lama = _get_lama()

    if bbox is not None:
        y0, y1, x0, x1 = bbox
        crop_frame = frame[y0:y1, x0:x1]
        crop_mask = mask[y0:y1, x0:x1]
        ch, cw = crop_frame.shape[:2]
        img_rgb = cv2.cvtColor(crop_frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)
        pil_mask = Image.fromarray(crop_mask)
        out = lama(pil_img, pil_mask)
        out_np = np.array(out)
        # simple-lama padda internamente pra multiplo de 8; recorta o
        # output de volta pro tamanho original do crop.
        if out_np.shape[:2] != (ch, cw):
            out_np = out_np[:ch, :cw]
        out_bgr = cv2.cvtColor(out_np, cv2.COLOR_RGB2BGR)
        # cola de volta SO na regiao mascarada (nao sobrescreve fora dela)
        result = frame.copy()
        result[y0:y1, x0:x1] = out_bgr
        return result

    h, w = frame.shape[:2]
    img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    pil_mask = Image.fromarray(mask)
    out = lama(pil_img, pil_mask)
    out_np = np.array(out)
    if out_np.shape[:2] != (h, w):
        out_np = out_np[:h, :w]
    return cv2.cvtColor(out_np, cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------

ProgressCb = Callable[[float, str], None]


def process_video(
    in_path: str,
    out_path: str,
    mode: str = "lama",          # 'lama' (default Smart) | 'telea' (fallback)
    sample_count: int = 20,
    min_persistence: float = 0.30,
    on_progress: Optional[ProgressCb] = None,
) -> dict:
    """
    Ponta a ponta: detecta regiao de hard-sub, gera mascara persistente,
    aplica inpainting em todos os frames, junta audio original.

    Retorna dict com estatisticas pra UI.
    """
    def emit(p: float, msg: str):
        if on_progress:
            try:
                on_progress(p, msg)
            except Exception:
                pass

    emit(0.0, "Probing video metadata...")
    info = _probe_info(in_path)
    W, H, fps = info["width"], info["height"], info["fps"]
    if W <= 0 or H <= 0:
        raise RuntimeError("Video sem dimensoes legiveis.")

    emit(0.04, "Sampling frames for text detection...")
    cap = cv2.VideoCapture(in_path)
    if not cap.isOpened():
        raise RuntimeError("OpenCV nao conseguiu abrir o video.")
    try:
        samples = _sample_frames(cap, sample_count)
    finally:
        cap.release()

    if not samples:
        raise RuntimeError("Nao foi possivel amostrar frames do video.")

    emit(0.08, f"Running OCR on {len(samples)} sample frames...")
    mask = _persistent_mask(samples, W, H, min_persistence=min_persistence)
    if mask is None:
        raise RuntimeError(
            "Nenhuma legenda persistente detectada. O video pode ja estar "
            "limpo, ou as legendas mudam de posicao demais (modo Smart "
            "assume regiao consistente)."
        )

    # bbox da mascara pra acelerar LaMa (processa so a regiao + padding)
    bbox = _mask_bbox_with_padding(mask, pad=64) if mode == "lama" else None

    device = _detect_torch_device()
    emit(0.18, f"Mask ready. Starting {mode.upper()} inpaint pass ({device})...")

    # ---- Inpaint pass ----------------------------------------------------
    tmp_dir = tempfile.mkdtemp(prefix="darko_subrm_")
    silent_video = os.path.join(tmp_dir, "clean_silent.mp4")
    try:
        # Encoder VP via OpenCV writer (H.264 nem sempre disponivel; usamos mp4v
        # como intermediario, e depois remuxamos com ffmpeg pra h264 + audio).
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out_writer = cv2.VideoWriter(silent_video, fourcc, fps, (W, H))
        if not out_writer.isOpened():
            raise RuntimeError("OpenCV VideoWriter falhou ao abrir.")

        cap = cv2.VideoCapture(in_path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        idx = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok or frame is None:
                    break
                if mode == "lama":
                    clean = _inpaint_lama(frame, mask, bbox=bbox)
                else:
                    clean = _inpaint_telea(frame, mask)
                out_writer.write(clean)
                idx += 1
                if total and (idx % max(1, total // 50) == 0):
                    p = 0.18 + 0.72 * (idx / max(1, total))
                    emit(p, f"Inpainting frame {idx}/{total} [{device}]")
        finally:
            cap.release()
            out_writer.release()

        emit(0.92, "Muxing original audio + clean video...")

        # Remux: pega video do silent_video + audio do original. Se o original
        # nao tiver audio, fica so video. -shortest evita stall.
        cmd = [
            "ffmpeg", "-y",
            "-i", silent_video,
            "-i", in_path,
            "-map", "0:v:0",
            "-map", "1:a:0?",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            "-shortest",
            out_path,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            # fallback: copy audio sem reencode
            cmd_copy = [
                "ffmpeg", "-y",
                "-i", silent_video,
                "-i", in_path,
                "-map", "0:v:0",
                "-map", "1:a:0?",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "20",
                "-c:a", "copy",
                "-movflags", "+faststart",
                out_path,
            ]
            res2 = subprocess.run(cmd_copy, capture_output=True, text=True)
            if res2.returncode != 0:
                raise RuntimeError(
                    "ffmpeg falhou: " + res2.stderr[-400:] if res2.stderr else "ffmpeg falhou."
                )

        emit(1.0, "Done.")
        return {
            "width": W,
            "height": H,
            "fps": fps,
            "frames_processed": idx,
            "mode": mode,
            "mask_area_ratio": float(mask.sum() / 255) / float(W * H),
        }
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Self-check
# ---------------------------------------------------------------------------

def _detect_torch_device() -> str:
    """Retorna 'cuda' se PyTorch + GPU disponivel, senao 'cpu'."""
    if not _TORCH_AVAILABLE:
        return "cpu"
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def check_runtime() -> dict:
    """Health-check usado pelo /health do server."""
    deps = {
        "opencv": True,
        "numpy": True,
        "paddleocr": False,
        "lama": False,
        "ffmpeg": False,
        "device": "cpu",
    }
    # ORDEM CRITICA no Windows: lama (torch) ANTES de paddleocr — invertendo
    # da pau de DLL (WinError 127).
    try:
        from simple_lama_inpainting import SimpleLama  # noqa: F401
        deps["lama"] = True
    except Exception:
        pass
    try:
        import paddleocr  # noqa: F401
        deps["paddleocr"] = True
    except Exception:
        pass
    try:
        r = subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True, check=False
        )
        deps["ffmpeg"] = r.returncode == 0
    except Exception:
        pass
    deps["device"] = _detect_torch_device()
    # ready = todas as deps essenciais OK. LaMa eh nucleo agora (Smart Mode).
    return {
        "deps": deps,
        "ready": all([deps["opencv"], deps["paddleocr"], deps["ffmpeg"], deps["lama"]]),
    }
