"""
Utilities minimas pra STTN — extraidas do video-subtitle-remover
(YaoFANGUK/video-subtitle-remover, Apache 2.0). Removidas dependencias
nao necessarias pra inferencia (matplotlib, zipfile).
"""
import numpy as np
import cv2
import torch
from PIL import Image


class Stack(object):
    """
    Recebe lista de N frames numpy BGR ou PIL.
    Retorna numpy (H, W, N*3) — formato RGB intercalado.
    """

    def __init__(self, roll=False):
        self.roll = roll

    def __call__(self, img_group):
        # Normaliza pra PIL RGB
        pil_group = []
        for img in img_group:
            if isinstance(img, np.ndarray):
                if img.ndim == 3:
                    pil_group.append(Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
                elif img.ndim == 2:
                    pil_group.append(Image.fromarray(img))
            else:
                pil_group.append(img)
        mode = pil_group[0].mode
        if mode == 'L':
            return np.concatenate([np.expand_dims(np.array(x), 2) for x in pil_group], axis=2)
        elif mode == 'RGB':
            if self.roll:
                return np.concatenate([np.array(x)[:, :, ::-1] for x in pil_group], axis=2)
            else:
                return np.concatenate([np.array(x) for x in pil_group], axis=2)
        else:
            raise NotImplementedError(f"Image mode {mode}")


class ToTorchFormatTensor(object):
    """
    Recebe numpy (H, W, N*3) RGB.
    Retorna tensor (N*3, H, W) float [0, 1].
    """

    def __init__(self, div=True):
        self.div = div

    def __call__(self, pic):
        img = torch.from_numpy(pic.copy()).permute(2, 0, 1).contiguous()
        return img.float().div(255) if self.div else img.float()
