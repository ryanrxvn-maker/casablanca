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
_sttn_engine = None  # STTNInpaint


def _get_sttn():
    """Carrega STTN sob demanda. Retorna None se modelo nao baixado."""
    global _sttn_engine
    if _sttn_engine is None:
        try:
            from sttn_engine import STTNInpaint, find_sttn_model
            model_path = find_sttn_model()
            if not model_path:
                return None
            import torch
            dev = torch.device("cuda" if _TORCH_AVAILABLE and torch.cuda.is_available() else "cpu")
            _sttn_engine = STTNInpaint(model_path=model_path, device=dev)
        except Exception:
            return None
    return _sttn_engine


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
    """
    Carrega LaMa sob demanda no melhor device disponivel.
      - CUDA: SimpleLama(device=cuda) — GPU NVIDIA, 10-50x faster.
      - CPU:  SimpleLama() — fallback. Otimizado com torch threads
              + half-res inpaint + frame caching.

    DirectML (AMD/Intel iGPU): testado e NAO funciona com simple-lama
    (TorchScript model nao suporta .to(dml_device); LaMa.onnx via
    onnxruntime-directml falha em ops MatMul especificos do modelo).
    Pra acelerar em Vega/iGPU teria que converter LaMa pra um modelo
    DML-compativel (semanas de trabalho). Pra Vega, CPU otimizado +
    cache eh o caminho pratico.
    """
    global _lama_engine
    if _lama_engine is None:
        try:
            from simple_lama_inpainting import SimpleLama
            import torch
            dev_name = _detect_torch_device()
            if dev_name == "cuda":
                _lama_engine = SimpleLama(device=torch.device("cuda"))
            else:
                _lama_engine = SimpleLama(device=torch.device("cpu"))
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


def _detect_subtitle_box(frame: np.ndarray, text_box: TextBox) -> Optional[TextBox]:
    """
    Detecta a CAIXA DE FUNDO da legenda ao redor do texto detectado.

    PaddleOCR detecta SO o texto. Mas legendas modernas (TikTok, Reels)
    quase sempre vem com uma caixa de fundo (branca, preta, com bordas
    arredondadas). Sem detectar essa caixa, o STTN/LaMa borra a regiao
    do texto mas deixa a caixa de fundo visivel — fica horrivel.

    Estrategia:
      1. Expande o bbox do texto em todas as direcoes (50% pra cima/baixo,
         30% pros lados).
      2. Detecta pixels "uniformes" (caixa) via edge detection (Canny):
         caixa tem bordas claras + interior uniforme.
      3. Acha o maior contorno retangular que contem o texto.
      4. Retorna bbox dessa caixa.

    Se nao detectar caixa, retorna o text_box original (fallback).
    """
    H, W = frame.shape[:2]
    # Expande regiao de busca
    pad_y = int(text_box.h * 0.8)
    pad_x = int(text_box.w * 0.4)
    sx = max(0, text_box.x - pad_x)
    sy = max(0, text_box.y - pad_y)
    ex = min(W, text_box.x + text_box.w + pad_x)
    ey = min(H, text_box.y + text_box.h + pad_y)
    if ex - sx < 10 or ey - sy < 10:
        return text_box

    region = frame[sy:ey, sx:ex]
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)

    # Canny edge detection — caixa de legenda tem bordas fortes
    edges = cv2.Canny(gray, 50, 150)
    # Dilata edges pra fechar gaps
    edges = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=2)

    # Acha contornos
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return text_box

    # Acha o contorno que contem o texto (centro do text_box dentro do bbox)
    text_cx_local = (text_box.x + text_box.w // 2) - sx
    text_cy_local = (text_box.y + text_box.h // 2) - sy

    best_box = None
    best_area = 0
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        # Caixa precisa CONTER o centro do texto
        if not (x <= text_cx_local <= x + w and y <= text_cy_local <= y + h):
            continue
        # Caixa precisa ser maior que o texto (com margem)
        if w < text_box.w * 1.1 or h < text_box.h * 1.1:
            continue
        # Caixa nao deve ser absurdamente grande (>3x texto)
        if w > text_box.w * 3 or h > text_box.h * 5:
            continue
        area = w * h
        if area > best_area:
            best_area = area
            best_box = (x, y, w, h)

    if best_box is None:
        # Fallback: expande o text_box pra cobrir margem fixa
        return TextBox(
            x=max(0, text_box.x - int(text_box.w * 0.1)),
            y=max(0, text_box.y - int(text_box.h * 0.5)),
            w=min(W, text_box.w + int(text_box.w * 0.2)),
            h=min(H, text_box.h + int(text_box.h * 1.0)),
        )

    bx, by, bw, bh = best_box
    return TextBox(
        x=sx + bx,
        y=sy + by,
        w=bw,
        h=bh,
    )


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
        text_boxes = _detect_text_boxes(fr)
        # EXPANDE pra cobrir caixa de fundo da legenda (se houver)
        expanded_boxes = []
        for tb in text_boxes:
            box = _detect_subtitle_box(fr, tb) or tb
            expanded_boxes.append(box)

        for b in expanded_boxes:
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

    # Dilation MUITO agressiva — cobre glow/outline/sombra residual + halo.
    # A maioria dos artefatos visuais residuais da legenda removida vem de:
    #  - drop shadow (sombra abaixo do texto, ~5-10px)
    #  - text outline / stroke (~1-3px)
    #  - antialiasing edge (~1-2px)
    # Total a cobrir: ~12-15px alem das letras. Kernel 31x21 x4 iter = ~30px.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (31, 21))
    mask = cv2.dilate(mask, kernel, iterations=4)

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


def _setup_perf():
    """Liga todos os threads disponiveis pra paddleocr / opencv / torch."""
    try:
        cv2.setNumThreads(0)  # 0 = auto = all cores
    except Exception:
        pass
    if _TORCH_AVAILABLE:
        try:
            import torch
            n = os.cpu_count() or 4
            torch.set_num_threads(n)
            torch.set_num_interop_threads(min(n, 4))
        except Exception:
            pass


# Limite maximo da dimensao maior do crop antes de mandar pra LaMa.
# Adaptive: 384 em CPU (1.7x mais rapido), 512 em GPU (qualidade
# levemente superior). Em legenda no rodape (detalhes finos baixos),
# 384 fica visualmente identico a 512.
def _lama_max_dim() -> int:
    # CPU 512: qualidade plena (LaMa treinado em 512). 70% mais lento que
    # 384 mas resultado significativamente melhor.
    # CUDA 768: GPU comporta resolution premium.
    return 768 if _detect_torch_device() == "cuda" else 512


def _lama_inference(crop_frame: np.ndarray, crop_mask: np.ndarray, max_dim: int) -> np.ndarray:
    """Inference do LaMa num crop. Aplica downscale pra max_dim e upscale de volta."""
    from PIL import Image
    lama = _get_lama()
    ch, cw = crop_frame.shape[:2]
    scale = 1.0
    if max(ch, cw) > max_dim:
        scale = max_dim / float(max(ch, cw))
        new_w = max(8, int(round(cw * scale)))
        new_h = max(8, int(round(ch * scale)))
        crop_frame_s = cv2.resize(crop_frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
        crop_mask_s = cv2.resize(crop_mask, (new_w, new_h), interpolation=cv2.INTER_NEAREST)
    else:
        crop_frame_s = crop_frame
        crop_mask_s = crop_mask

    sh, sw = crop_frame_s.shape[:2]
    img_rgb = cv2.cvtColor(crop_frame_s, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    pil_mask = Image.fromarray(crop_mask_s)
    out = lama(pil_img, pil_mask)
    out_np = np.array(out)
    if out_np.shape[:2] != (sh, sw):
        out_np = out_np[:sh, :sw]
    if scale != 1.0:
        out_np = cv2.resize(out_np, (cw, ch), interpolation=cv2.INTER_LINEAR)
    return cv2.cvtColor(out_np, cv2.COLOR_RGB2BGR)


def _inpaint_lama(
    frame: np.ndarray,
    mask: np.ndarray,
    bbox: Optional[Tuple[int,int,int,int]] = None,
    bg_median: Optional[np.ndarray] = None,
    bg_variance: Optional[np.ndarray] = None,
) -> np.ndarray:
    """
    LaMa neural inpaint com 4 otimizacoes de qualidade e velocidade:

    Velocidade:
      - CROP: processa so o bbox da mascara + padding (5x faster)
      - DOWNSCALE: redimensiona crop pra <= max_dim antes de LaMa (3-5x faster)

    Qualidade:
      - FEATHERED MASK: alpha mask com bordas suaves (gaussian blur),
        elimina linha visivel de transicao entre regiao inpaintada e
        frame original. Dramatically mais natural.
      - 2-PASS REFINEMENT: 1a passada com mascara dilatada limpa o
        bulk; 2a passada com mascara estreita refina bordas onde
        ainda pode ter halo residual. Em geral resolve sombra/glow
        que ficou da legenda original.
    """
    if bbox is None:
        # fallback: frame inteiro
        h, w = frame.shape[:2]
        return _lama_inference(frame, mask, _lama_max_dim())

    y0, y1, x0, x1 = bbox
    crop_frame = frame[y0:y1, x0:x1].copy()
    crop_mask = mask[y0:y1, x0:x1]
    max_dim = _lama_max_dim()

    # ---- BG median preview (substituicao primaria) ----
    # Se temos median temporal, usa-lo como base nas regioes onde o texto
    # muda muito (alta variance temporal -> mediana = fundo real).
    # Em regioes onde texto e estatico (baixa variance), median ainda
    # contem a legenda — LaMa cuida disso.
    if bg_median is not None and bg_variance is not None:
        # Combina: onde variance > V_THRESHOLD usa median; senao mantém frame
        # original (LaMa vai processar). 8.0 = ~3% de variacao tipica em
        # frames com legenda mudando.
        V_THRESHOLD = 8.0
        var_mask = (bg_variance > V_THRESHOLD)[:, :, None]
        # Frame de base pro LaMa = mistura de median + original
        base_for_lama = np.where(var_mask, bg_median, crop_frame)
    else:
        base_for_lama = crop_frame

    # ---- 1a passada: LaMa com mascara cheia ----
    pass1 = _lama_inference(base_for_lama, crop_mask, max_dim)

    # ---- 2a passada (refinement) condicional ----
    # So vale o custo se a mascara cobre area significativa do crop
    # (>5%). Pra rodape com area pequena, o feathering ja resolve.
    mask_ratio = float(crop_mask.sum()) / 255.0 / float(crop_mask.size)
    if mask_ratio > 0.05:
        # Mascara dilatada pra 2a passada (cobre bordas do 1o inpaint)
        kernel_r = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask_refine = cv2.dilate(crop_mask, kernel_r, iterations=1)
        pass2 = _lama_inference(pass1, mask_refine, max_dim)
        clean = pass2
    else:
        clean = pass1

    # ---- Feathering: alpha blend suave entre inpaint e frame original ----
    # Feather = mask binaria -> gaussian blur. Pixels no centro da mascara
    # tem alpha=1.0 (so inpaint), pixels nas bordas tem alpha gradiente
    # (mistura natural com pixels originais ao redor). Sem isso, fica uma
    # linha visivel entre regiao inpaintada e regiao mantida.
    feather_radius = 5  # px de blur (3-7 e o sweet spot)
    alpha = cv2.GaussianBlur(crop_mask.astype(np.float32), (feather_radius*2+1, feather_radius*2+1), 0) / 255.0
    alpha = np.clip(alpha, 0.0, 1.0)[:, :, None]

    blended = (clean.astype(np.float32) * alpha + crop_frame.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)

    result = frame.copy()
    result[y0:y1, x0:x1] = blended
    return result


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------

ProgressCb = Callable[[float, str], None]


def _remux(silent_video: str, original_with_audio: str, out_path: str, target_size: Optional[Tuple[int,int]] = None) -> None:
    """Junta video silencioso + audio do original num MP4 H.264.
    Se target_size=(W,H), faz upscale do silent_video pra essa resolution."""
    vf = []
    if target_size is not None:
        vf.append(f"scale={target_size[0]}:{target_size[1]}:flags=lanczos")
    cmd = [
        "ffmpeg", "-y",
        "-i", silent_video,
        "-i", original_with_audio,
        "-map", "0:v:0",
        "-map", "1:a:0?",
    ]
    if vf:
        cmd.extend(["-vf", ",".join(vf)])
    cmd.extend([
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        out_path,
    ])
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        # fallback: copy audio sem reencode
        cmd_copy = [
            "ffmpeg", "-y",
            "-i", silent_video,
            "-i", original_with_audio,
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
                "ffmpeg falhou: " + (res2.stderr[-400:] if res2.stderr else "(sem stderr)")
            )


def process_video(
    in_path: str,
    out_path: str,
    mode: str = "auto",          # 'auto' = STTN se disponivel senao LaMa | 'lama' | 'telea'
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

    # ---- DOWNSCALE pra acelerar: se video maior que 1280px no lado maior,
    # processa em 1280 e upscale depois. STTN fica ~2x mais rapido em
    # vertical 720p vs 1080p sem perda visual perceptivel.
    downscale_processing = False
    proc_in_path = in_path
    proc_W, proc_H = W, H
    MAX_DIM = 1280
    if max(W, H) > MAX_DIM:
        scale = MAX_DIM / float(max(W, H))
        proc_W = int(W * scale) // 2 * 2  # par pra ffmpeg
        proc_H = int(H * scale) // 2 * 2
        emit(0.01, f"Downscale {W}x{H} -> {proc_W}x{proc_H} (acelera 2x)...")
        # Cria copia reescalada do video pro processamento
        proc_tmp = os.path.join(tempfile.gettempdir(), f"darko_downscale_{os.getpid()}.mp4")
        ds_cmd = [
            "ffmpeg", "-y", "-i", in_path,
            "-vf", f"scale={proc_W}:{proc_H}",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
            "-an", proc_tmp,
        ]
        ds_res = subprocess.run(ds_cmd, capture_output=True, text=True)
        if ds_res.returncode == 0 and os.path.exists(proc_tmp):
            proc_in_path = proc_tmp
            downscale_processing = True
        else:
            # Fallback: processa em resolution original
            proc_W, proc_H = W, H

    # ---- Modo auto: usa STTN se modelo disponivel (qualidade Vmake) ----
    # STTN olha multiplos frames simultaneamente, reconstruindo textura
    # real (pele, cabelo, fundo). Vs LaMa single-frame que fica borrado.
    sttn = None
    if mode == "auto":
        sttn = _get_sttn()
        if sttn is not None:
            mode = "sttn"
        else:
            mode = "lama"

    emit(0.04, "Sampling frames for text detection...")
    cap = cv2.VideoCapture(proc_in_path)
    if not cap.isOpened():
        raise RuntimeError("OpenCV nao conseguiu abrir o video.")
    try:
        samples = _sample_frames(cap, sample_count)
    finally:
        cap.release()

    if not samples:
        raise RuntimeError("Nao foi possivel amostrar frames do video.")

    emit(0.08, f"Running OCR on {len(samples)} sample frames...")
    mask = _persistent_mask(samples, proc_W, proc_H, min_persistence=min_persistence)
    if mask is None:
        raise RuntimeError(
            "Nenhuma legenda persistente detectada. O video pode ja estar "
            "limpo, ou as legendas mudam de posicao demais (modo Smart "
            "assume regiao consistente)."
        )

    # bbox da mascara pra acelerar LaMa (processa so a regiao + padding).
    # Padding 32: enquadra a regiao com contexto suficiente pro LaMa
    # gerar pixels coerentes, sem processar area desnecessaria.
    bbox = _mask_bbox_with_padding(mask, pad=32) if mode == "lama" else None

    # ---- TEMPORAL MEDIAN BACKGROUND ----
    # Truque chave: amostra MUITOS frames e calcula a mediana pixel-a-pixel
    # apenas na bbox da mascara. Pixels onde a legenda MUDA frame-a-frame
    # (texto que troca de palavra) terao mediana = fundo real, porque a
    # legenda some na metade das amostras.
    #
    # Quando combinado com LaMa, isso da qualidade significativamente melhor:
    #  - regioes com texto dinamico = median bg (perfeito)
    #  - regioes com texto estatico = LaMa (suficiente)
    #
    # E o que o vmake.ai faz por baixo dos panos pra ficar tao bom.
    bg_median = None
    bg_variance = None
    # Frame-level median (pro STTN). Diferente do bg_median do LaMa que
    # eh so do crop bbox, o STTN precisa do median do FRAME INTEIRO.
    bg_median_full = None
    if mode in ("lama", "sttn") and bbox is not None:
        emit(0.20, "Sampling 30 frames for temporal median background...")
        cap_tm = cv2.VideoCapture(proc_in_path)
        try:
            samples_tm = _sample_frames(cap_tm, 30)
        finally:
            cap_tm.release()
        if samples_tm:
            y0, y1, x0, x1 = bbox
            # crop pra LaMa
            crops = np.stack([f[y0:y1, x0:x1] for _, f in samples_tm], axis=0).astype(np.float32)
            bg_median = np.median(crops, axis=0).astype(np.uint8)
            bg_variance = np.mean(np.std(crops, axis=0), axis=2)
            # frame inteiro pra STTN (mediana global)
            if mode == "sttn":
                full_stack = np.stack([f for _, f in samples_tm], axis=0).astype(np.float32)
                bg_median_full = np.median(full_stack, axis=0).astype(np.uint8)
            emit(0.24, "Median background built.")

    # Liga multi-threading (torch + opencv) pra usar TODOS os cores
    _setup_perf()

    device = _detect_torch_device()
    emit(0.18, f"Mask ready. Starting {mode.upper()} inpaint pass ({device})...")

    # ---- Inpaint pass ----------------------------------------------------
    tmp_dir = tempfile.mkdtemp(prefix="darko_subrm_")
    silent_video = os.path.join(tmp_dir, "clean_silent.mp4")
    try:
        # Encoder VP via OpenCV writer (H.264 nem sempre disponivel; usamos mp4v
        # como intermediario, e depois remuxamos com ffmpeg pra h264 + audio).
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out_writer = cv2.VideoWriter(silent_video, fourcc, fps, (proc_W, proc_H))
        if not out_writer.isOpened():
            raise RuntimeError("OpenCV VideoWriter falhou ao abrir.")

        # ============================================================
        # STTN: processa em CHUNKS de N frames temporais.
        # Qualidade significativamente superior ao LaMa pq usa contexto
        # entre frames pra reconstruir textura (pele, cabelo, fundo).
        # ============================================================
        if mode == "sttn" and sttn is not None:
            # NOTA: testei multiprocessing (2 e 4 workers) e ficou MAIS
            # LENTO que single-process. Razao: torch + opencv ja paralelizam
            # internamente via OpenMP/MKL usando todos os cores. Spawnar
            # processos Python concorrentes faz N processos competirem por
            # cache + memoria + cores fisicos, com overhead de IPC que
            # mata o ganho. Single-process bem-orquestrado e mais rapido.
            #
            # Pra ir alem disso em CPU teria que mudar de modelo (E2FGVI
            # light) ou usar GPU NVIDIA (pipeline ja detecta automatic).
            # Chunks menores = feedback de progresso mais frequente.
            # 25 frames eh sweet spot pra CPU (memoria OK + janela temporal
            # suficiente pra STTN ter contexto temporal de qualidade).
            CHUNK_SIZE = 25
            cap = cv2.VideoCapture(proc_in_path)
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
            idx = 0
            try:
                while True:
                    chunk_frames = []
                    for _ in range(CHUNK_SIZE):
                        ok, frame = cap.read()
                        if not ok or frame is None:
                            break
                        chunk_frames.append(frame)
                    if not chunk_frames:
                        break

                    chunk_start = idx
                    chunk_end = idx + len(chunk_frames)
                    emit(
                        0.18 + 0.72 * (chunk_start / max(1, total)),
                        f"STTN inpaint {chunk_start}-{chunk_end}/{total}",
                    )

                    # Callback intra-chunk: emite progresso DENTRO do chunk
                    # a cada window neighbor processada. Faz a barra
                    # avancar suavemente em vez de pular de chunk em chunk.
                    _last_pct = [-1]
                    def _inner_progress(win, total_wins):
                        done_in_chunk = min(len(chunk_frames),
                                            int(win * len(chunk_frames) / max(1, total_wins)))
                        global_done = chunk_start + done_in_chunk
                        p = 0.18 + 0.72 * (global_done / max(1, total))
                        # Throttle: so emite se mudou pelo menos 1%
                        pct_now = int(p * 100)
                        if pct_now != _last_pct[0]:
                            _last_pct[0] = pct_now
                            emit(p, f"STTN inpaint {global_done}/{total}")

                    # ---- FRAME-SKIP STTN: 2x speedup ----
                    # STTN processa apenas frames PARES; impares sao
                    # interpolados como media dos vizinhos NA REGIAO da
                    # mascara. Resto do frame eh do original. Funciona
                    # bem porque:
                    #  - cena nao muda dramaticamente em 1 frame (1/30s)
                    #  - somente a regiao mascarada precisa interpolacao
                    #  - feathering 21px esconde transicao temporal
                    keys_idx = list(range(0, len(chunk_frames), 2))
                    if (len(chunk_frames) - 1) not in keys_idx:
                        # Garante que o ultimo frame eh key (evita gap no fim)
                        keys_idx.append(len(chunk_frames) - 1)
                    key_frames = [chunk_frames[i] for i in keys_idx]

                    # STTN inpaint somente nos key frames
                    cleaned_keys = sttn(key_frames, mask, on_progress=_inner_progress, bg_median=bg_median_full)

                    # Reconstroi a lista completa interpolando
                    mask_bool = (mask > 0)
                    mask_3 = mask_bool[:, :, None]
                    cleaned = [None] * len(chunk_frames)
                    for ki, fi in enumerate(keys_idx):
                        cleaned[fi] = cleaned_keys[ki]
                    # Interpola frames intermediarios
                    for fi in range(len(chunk_frames)):
                        if cleaned[fi] is not None:
                            continue
                        # Acha key anterior e posterior
                        prev_ki = max(k for k in keys_idx if k < fi)
                        next_ki = min(k for k in keys_idx if k > fi)
                        alpha = (fi - prev_ki) / float(next_ki - prev_ki)
                        prev_clean = cleaned[prev_ki]
                        next_clean = cleaned[next_ki]
                        # Resultado base = frame original
                        result = chunk_frames[fi].copy()
                        # Na regiao da mascara: media ponderada dos keys
                        blend = (prev_clean.astype(np.float32) * (1 - alpha)
                                 + next_clean.astype(np.float32) * alpha).astype(np.uint8)
                        result = np.where(mask_3, blend, result)
                        cleaned[fi] = result

                    for f in cleaned:
                        out_writer.write(f)
                    idx += len(chunk_frames)
                    if len(chunk_frames) < CHUNK_SIZE:
                        break
            finally:
                cap.release()
                out_writer.release()

            emit(0.92, "Muxing original audio + clean video...")
            # Pula direto pro remux
            _remux(silent_video, in_path, out_path, target_size=(W, H) if downscale_processing else None)
            # cleanup do downscale tmp
            if downscale_processing and proc_in_path != in_path:
                try: os.remove(proc_in_path)
                except Exception: pass
            emit(1.0, "Done.")
            return {
                "width": W, "height": H, "fps": fps,
                "frames_processed": idx, "mode": "sttn",
                "mask_area_ratio": float(mask.sum() / 255) / float(W * H),
            }

        # Frame caching: se o crop da mascara nao muda muito entre 2 frames
        # consecutivos (cena estatica + legenda na mesma posicao), reusa
        # o ultimo inpaint. Em videos VSL/TikTok com camera parada, isso
        # da 5-20x speedup porque a maioria dos frames sao quase identicos
        # na regiao da legenda.
        prev_crop_signature = None
        last_inpaint = None
        cache_hits = 0
        # CACHE DESATIVADO POR DEFAULT (threshold 0.5 ~= so frames
        # PERFEITAMENTE identicos reusam). Cache causa "fantasma piscante"
        # em videos onde a pessoa atras da legenda se mexe minimamente —
        # o inpaint anterior continha contexto que ja nao bate. Em vez de
        # cache espacial, o STTN/temporal-median garante consistencia.
        CROP_DIFF_THRESHOLD = 0.5

        cap = cv2.VideoCapture(proc_in_path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        idx = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok or frame is None:
                    break

                if mode == "lama" and bbox is not None:
                    # signature do crop atual (pra cache hit/miss)
                    y0, y1, x0, x1 = bbox
                    crop_now = frame[y0:y1, x0:x1]
                    # downscale rapido p/ calculo de signature (8x8)
                    sig = cv2.resize(crop_now, (16, 16), interpolation=cv2.INTER_AREA).astype(np.float32)
                    if prev_crop_signature is not None and last_inpaint is not None:
                        diff = float(np.mean(np.abs(sig - prev_crop_signature)))
                        if diff < CROP_DIFF_THRESHOLD:
                            # cache hit: aplica o ultimo inpaint mas
                            # com o frame atual fora da mascara (so a regiao
                            # mascarada vem do cache)
                            result = frame.copy()
                            crop_mask = mask[y0:y1, x0:x1]
                            m3 = (crop_mask > 0)[:, :, None]
                            cached_crop = last_inpaint[y0:y1, x0:x1]
                            result[y0:y1, x0:x1] = np.where(m3, cached_crop, crop_now)
                            out_writer.write(result)
                            cache_hits += 1
                            idx += 1
                            if total and (idx % max(1, total // 50) == 0):
                                p = 0.18 + 0.72 * (idx / max(1, total))
                                emit(p, f"Inpainting {idx}/{total} (cache {cache_hits})")
                            continue
                    # cache miss: roda LaMa normal (com bg median temporal)
                    clean = _inpaint_lama(frame, mask, bbox=bbox, bg_median=bg_median, bg_variance=bg_variance)
                    prev_crop_signature = sig
                    last_inpaint = clean
                elif mode == "lama":
                    clean = _inpaint_lama(frame, mask, bbox=bbox, bg_median=bg_median, bg_variance=bg_variance)
                else:
                    clean = _inpaint_telea(frame, mask)

                out_writer.write(clean)
                idx += 1
                if total and (idx % max(1, total // 50) == 0):
                    p = 0.18 + 0.72 * (idx / max(1, total))
                    emit(p, f"Inpainting {idx}/{total} (cache {cache_hits})")
        finally:
            cap.release()
            out_writer.release()

        emit(0.92, "Muxing original audio + clean video...")

        # Remux unificado (faz upscale se houve downscale)
        _remux(silent_video, in_path, out_path, target_size=(W, H) if downscale_processing else None)
        # cleanup do video temporario do downscale
        if downscale_processing and proc_in_path != in_path:
            try: os.remove(proc_in_path)
            except Exception: pass

        # Pular branch antigo
        res = type('R', (), {'returncode': 0, 'stderr': ''})()
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
    """
    Retorna o device disponivel:
      'cuda' -> GPU NVIDIA (10-50x faster vs CPU)
      'cpu'  -> fallback. Otimizado com threads + half-res + cache.
    DirectML nao eh usado: simple-lama (TorchScript) nao suporta DML,
    e LaMa.onnx via onnxruntime-directml falha em ops especificos.
    """
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
