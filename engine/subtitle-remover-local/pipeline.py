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


def _remux(silent_video: str, original_with_audio: str, out_path: str) -> None:
    """Junta video silencioso + audio do original num MP4 H.264."""
    cmd = [
        "ffmpeg", "-y",
        "-i", silent_video,
        "-i", original_with_audio,
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
    if mode == "lama" and bbox is not None:
        emit(0.20, "Sampling 30 frames for temporal median background...")
        cap_tm = cv2.VideoCapture(in_path)
        try:
            samples_tm = _sample_frames(cap_tm, 30)
        finally:
            cap_tm.release()
        if samples_tm:
            y0, y1, x0, x1 = bbox
            # Stack so o crop pra economizar memoria (crop pode ser 1080x300px)
            crops = np.stack([f[y0:y1, x0:x1] for _, f in samples_tm], axis=0).astype(np.float32)
            bg_median = np.median(crops, axis=0).astype(np.uint8)
            # Variance temporal por pixel: alto = texto muda ali; baixo = estatico
            bg_variance = np.mean(np.std(crops, axis=0), axis=2)  # (H, W) escalar
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
        out_writer = cv2.VideoWriter(silent_video, fourcc, fps, (W, H))
        if not out_writer.isOpened():
            raise RuntimeError("OpenCV VideoWriter falhou ao abrir.")

        # ============================================================
        # STTN: processa em CHUNKS de N frames temporais.
        # Qualidade significativamente superior ao LaMa pq usa contexto
        # entre frames pra reconstruir textura (pele, cabelo, fundo).
        # ============================================================
        if mode == "sttn" and sttn is not None:
            CHUNK_SIZE = 50  # frames por chunk (memoria-limitado em CPU)
            cap = cv2.VideoCapture(in_path)
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
            idx = 0
            try:
                while True:
                    # Le um chunk de frames
                    chunk_frames = []
                    for _ in range(CHUNK_SIZE):
                        ok, frame = cap.read()
                        if not ok or frame is None:
                            break
                        chunk_frames.append(frame)
                    if not chunk_frames:
                        break

                    emit(
                        0.18 + 0.72 * (idx / max(1, total)),
                        f"STTN inpaint chunk {idx}-{idx+len(chunk_frames)}/{total}",
                    )
                    # STTN processa o chunk inteiro temporalmente
                    cleaned = sttn(chunk_frames, mask)
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
            _remux(silent_video, in_path, out_path)
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

        cap = cv2.VideoCapture(in_path)
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
