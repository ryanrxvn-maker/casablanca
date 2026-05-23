"""
STTN (Spatial-Temporal Transformer Network) engine pra remocao temporal
de legenda em video. Eh o motor "Smart" do vmake.ai por baixo dos panos.

Diferenca vs LaMa single-frame:
  - LaMa olha 1 frame de cada vez. Sem contexto temporal => fica borrado
    em regioes com textura humana (pele, cabelo).
  - STTN olha 15 frames vizinhos. Usa pixels disponíveis em frames sem
    legenda pra reconstruir o frame atual. Textura real, sem borrao.

Modelo: arquitetura InpaintGenerator (auto_sttn.InpaintGenerator).
Peso treinado: ~80MB, vem do release oficial do video-subtitle-remover.

Codigo de arquitetura: adaptado de YaoFANGUK/video-subtitle-remover
(Apache 2.0).
"""
from __future__ import annotations

import os
import sys
import cv2
import numpy as np
import torch
from torchvision import transforms
from typing import List, Optional

# Garante que o pacote sttn local seja importavel
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from sttn.auto_sttn import InpaintGenerator
from sttn.sttn_utils import Stack, ToTorchFormatTensor


# Resolution do modelo — TEM que ser 640x120 (arquitetura tem patch sizes
# hardcoded que so casam com esse shape; mudar quebra o forward pass).
STTN_MODEL_WIDTH = 640
STTN_MODEL_HEIGHT = 120

# Stride entre janelas neighbor. 7 (vs 5 default) = ~25% mais rapido
# porque processa menos windows com mesmo numero de frames. Cada
# janela cobre 15 frames (-7 a +7) em vez de 11 (-5 a +5), entao
# o overlap entre janelas adjacentes ainda eh suficiente pra
# consistencia temporal.
DEFAULT_NEIGHBOR_STRIDE = 7
# STEP entre frames de referencia globais. Maior step = MENOS refs =
# mais rapido. 12 (vs 10 default) da ~15% speedup com qualidade quase
# identica em legendas. Nao subir muito (perde contexto temporal).
DEFAULT_REFERENCE_LENGTH = 12


_to_tensors = transforms.Compose([
    Stack(),
    ToTorchFormatTensor(),
])


class STTNInpaint:
    """
    Wrapper de inferencia do STTN, pronto pra ser plugado num pipeline
    de video. Processa um chunk de frames de uma vez (memoria intensiva).
    """

    def __init__(
        self,
        model_path: str,
        device: Optional[torch.device] = None,
        neighbor_stride: int = DEFAULT_NEIGHBOR_STRIDE,
        reference_length: int = DEFAULT_REFERENCE_LENGTH,
    ):
        if device is None:
            if torch.cuda.is_available():
                device = torch.device("cuda")
            else:
                device = torch.device("cpu")
        self.device = device
        self.neighbor_stride = neighbor_stride
        self.ref_length = reference_length

        # Cria a arquitetura e carrega os pesos
        self.model = InpaintGenerator().to(device)
        ckpt = torch.load(model_path, map_location="cpu")
        # checkpoint do video-subtitle-remover usa key 'netG'
        if isinstance(ckpt, dict) and "netG" in ckpt:
            self.model.load_state_dict(ckpt["netG"])
        else:
            self.model.load_state_dict(ckpt)
        self.model.eval()

    def _get_ref_index(self, neighbor_ids: List[int], length: int) -> List[int]:
        """Amostra frames de referencia globais (1 a cada `ref_length`),
        excluindo os que ja sao vizinhos."""
        return [i for i in range(0, length, self.ref_length) if i not in neighbor_ids]

    def __call__(
        self,
        frames: List[np.ndarray],
        mask: np.ndarray,
        on_progress: Optional[callable] = None,
        bg_median: Optional[np.ndarray] = None,
    ) -> List[np.ndarray]:
        """
        Args:
            frames: lista de N frames BGR uint8 (H, W, 3).
            mask: uint8 (H, W) ou (H, W, 1). Pixels >0 sao a regiao a
                  inpaintar.
        Returns:
            Lista de N frames BGR uint8 com a regiao da mascara reconstruida.
        """
        if not frames:
            return []

        H_ori, W_ori = frames[0].shape[:2]
        # Garante mask binaria (0/1), 2D
        if mask.ndim == 3:
            mask = mask[:, :, 0]
        _, mask_bin = cv2.threshold(mask, 127, 1, cv2.THRESH_BINARY)
        mask_3d = mask_bin[:, :, None]  # (H, W, 1)

        # Determina a faixa vertical a processar (rodape onde mask >0)
        ys = np.where(mask_bin > 0)[0]
        if len(ys) == 0:
            return [f.copy() for f in frames]
        y_min, y_max = int(ys.min()), int(ys.max())
        # Expande a faixa pra altura proporcional do modelo (640x120 = 16:3)
        strip_h_target = max(60, int(W_ori * 3 / 16))
        strip_h_actual = y_max - y_min + 1
        if strip_h_actual < strip_h_target:
            extra = strip_h_target - strip_h_actual
            y_min = max(0, y_min - extra // 2)
            y_max = min(H_ori, y_max + extra - extra // 2)

        # ---- PRE-PASS: substitui regiao da mascara pelo bg median ----
        # Se temos median temporal computado em todo o video, usa ELE como
        # input pro STTN no lugar dos pixels da legenda. STTN vai REFINAR
        # essa versao ja meio-limpa em vez de tentar inventar do zero.
        # Resultado: significativamente mais natural.
        if bg_median is not None and bg_median.shape[:2] == (H_ori, W_ori):
            mask_3ch = np.repeat(mask_3d, 3, axis=2).astype(bool)
            frames_prepped = []
            for f in frames:
                fp = f.copy()
                # Onde mascara > 0, usa median; senao, usa o frame original
                fp[mask_3ch] = bg_median[mask_3ch]
                frames_prepped.append(fp)
            frames = frames_prepped

        # Crop vertical da regiao da legenda em todos os frames
        strips = [f[y_min:y_max + 1, :, :] for f in frames]
        strip_mask = mask_3d[y_min:y_max + 1, :, :]

        # Resize de cada strip pro tamanho do modelo
        scaled = [
            cv2.resize(s, (STTN_MODEL_WIDTH, STTN_MODEL_HEIGHT))
            for s in strips
        ]

        # Inference temporal (com callback de progresso intra-chunk)
        comp_frames = self._inpaint_chunk(scaled, on_progress=on_progress)

        # Resize de volta + feathering pra blend INVISIVEL
        h_strip = strips[0].shape[0]
        # Mascara feathered: gaussian blur 21px na mascara binaria.
        # Resultado: pixels do centro da legenda usam 100% STTN; pixels
        # nas bordas tem alpha gradiente (transicao suave invisivel).
        strip_mask_2d = strip_mask[:h_strip, :, 0].astype(np.float32) * 255
        feather_radius = 21
        feathered = cv2.GaussianBlur(
            strip_mask_2d, (feather_radius * 2 + 1, feather_radius * 2 + 1), 0
        ) / 255.0
        feathered = np.clip(feathered, 0.0, 1.0)[:, :, None]

        result = []
        for i, frame in enumerate(frames):
            out = frame.copy()
            comp_resized = cv2.resize(comp_frames[i], (W_ori, h_strip))
            comp_bgr = cv2.cvtColor(comp_resized.astype(np.uint8), cv2.COLOR_RGB2BGR)
            orig_strip = frame[y_min:y_min + h_strip, :, :]
            blended = (
                feathered * comp_bgr.astype(np.float32)
                + (1.0 - feathered) * orig_strip.astype(np.float32)
            ).astype(np.uint8)
            out[y_min:y_min + h_strip, :, :] = blended
            result.append(out)
        return result

    @torch.inference_mode()
    def _inpaint_chunk(
        self, scaled_frames: List[np.ndarray],
        on_progress: Optional[callable] = None,
    ) -> List[np.ndarray]:
        """Inference temporal do STTN num chunk de frames ja escalados.
        on_progress(done, total) eh chamado depois de cada janela neighbor."""
        frame_length = len(scaled_frames)
        feats = _to_tensors(scaled_frames).unsqueeze(0) * 2 - 1
        feats = feats.view(frame_length, 3, STTN_MODEL_HEIGHT, STTN_MODEL_WIDTH)
        feats = feats.to(self.device)

        feats_enc = self.model.encoder(feats)
        _, c, fh, fw = feats_enc.size()
        feats_enc = feats_enc.view(1, frame_length, c, fh, fw)

        comp = [None] * frame_length
        total_windows = (frame_length + self.neighbor_stride - 1) // self.neighbor_stride
        win = 0

        for f in range(0, frame_length, self.neighbor_stride):
            neighbor_ids = list(range(
                max(0, f - self.neighbor_stride),
                min(frame_length, f + self.neighbor_stride + 1)
            ))
            ref_ids = self._get_ref_index(neighbor_ids, frame_length)

            pred_feat = self.model.infer(feats_enc[0, neighbor_ids + ref_ids, :, :, :])
            pred_img = torch.tanh(self.model.decoder(pred_feat[:len(neighbor_ids), :, :, :]))
            pred_img = (pred_img + 1) / 2
            pred_np = pred_img.cpu().permute(0, 2, 3, 1).numpy() * 255

            for i, idx in enumerate(neighbor_ids):
                img = pred_np[i].astype(np.uint8)
                if comp[idx] is None:
                    comp[idx] = img
                else:
                    comp[idx] = (comp[idx].astype(np.float32) * 0.5
                                 + img.astype(np.float32) * 0.5).astype(np.uint8)

            win += 1
            if on_progress is not None:
                try:
                    on_progress(win, total_windows)
                except Exception:
                    pass

        return comp


def find_sttn_model() -> Optional[str]:
    """Procura o checkpoint do STTN nos lugares conhecidos."""
    candidates = [
        os.path.join(_HERE, "sttn", "infer_model.pth"),
        os.path.join(_HERE, "models", "sttn-auto", "infer_model.pth"),
        os.path.join(os.path.expanduser("~"), ".cache", "darko", "sttn", "infer_model.pth"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None
