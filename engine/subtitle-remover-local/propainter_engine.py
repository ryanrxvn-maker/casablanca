"""
ProPainter engine — motor temporal de inpainting estado-da-arte (ICCV 2023).

Diferenca vs STTN:
  - RAFT computa optical flow entre frames vizinhos
  - RecurrentFlowCompleteNet completa o flow nas regioes mascaradas
  - InpaintGenerator propaga features baseado no flow + sparse transformer
  - Resultado: textura/movimento preservados perfeitamente
                (qualidade Vmake-level)

Codigo de arquitetura: adaptado de sczhou/ProPainter (S-Lab License 1.0,
uso nao-comercial).
"""
from __future__ import annotations

import os
import sys
import cv2
import numpy as np
import torch
from PIL import Image
import scipy.ndimage
from typing import List, Optional

# Garante import do package propainter local
_HERE = os.path.dirname(os.path.abspath(__file__))
_PP_DIR = os.path.join(_HERE, "propainter")
if _PP_DIR not in sys.path:
    sys.path.insert(0, _PP_DIR)

# Imports do ProPainter (path: propainter/...)
from model.modules.flow_comp_raft import RAFT_bi
from model.recurrent_flow_completion import RecurrentFlowCompleteNet
from model.propainter import InpaintGenerator
from core.utils import to_tensors


def _binary_mask(mask: np.ndarray, th: float = 0.1) -> np.ndarray:
    out = mask.copy()
    out[out > th] = 1
    out[out <= th] = 0
    return out


class ProPainterInpaint:
    """
    Wrapper de inferencia do ProPainter. API compativel com STTNInpaint:
        propainter(frames, mask) -> cleaned_frames

    Args:
      model_dir: pasta com os 3 .pth (ProPainter.pth, recurrent_flow_completion.pth,
                 raft-things.pth).
      device: torch.device (default: cuda se disponivel senao cpu).
      neighbor_length: tamanho da janela de frames vizinhos (default 10).
      ref_stride: stride pra amostragem de frames de referencia (default 10).
      subvideo_length: dividir video longo em sub-videos (default 80).
      mask_dilation: dilation extra da mask em pixels (default 4).
      raft_iter: iteracoes do RAFT (default 20).
    """

    def __init__(
        self,
        model_dir: Optional[str] = None,
        device: Optional[torch.device] = None,
        neighbor_length: int = 10,
        ref_stride: int = 10,
        subvideo_length: int = 80,
        mask_dilation: int = 4,
        raft_iter: int = 20,
        use_half: bool = False,
    ):
        if model_dir is None:
            model_dir = os.path.join(_PP_DIR, "weights")
        if device is None:
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self.device = device
        self.neighbor_length = neighbor_length
        self.ref_stride = ref_stride
        self.subvideo_length = subvideo_length
        self.mask_dilation = mask_dilation
        self.raft_iter = raft_iter
        # fp16 so funciona em CUDA
        self.use_half = use_half and (device.type == "cuda")

        # Carrega RAFT
        raft_ckpt = os.path.join(model_dir, "raft-things.pth")
        if not os.path.isfile(raft_ckpt):
            raise FileNotFoundError(f"raft-things.pth not found in {model_dir}")
        self.fix_raft = RAFT_bi(raft_ckpt, device)

        # Carrega Flow Completion
        flow_ckpt = os.path.join(model_dir, "recurrent_flow_completion.pth")
        if not os.path.isfile(flow_ckpt):
            raise FileNotFoundError(f"recurrent_flow_completion.pth not found in {model_dir}")
        self.fix_flow_complete = RecurrentFlowCompleteNet(flow_ckpt)
        for p in self.fix_flow_complete.parameters():
            p.requires_grad = False
        self.fix_flow_complete.to(device)
        self.fix_flow_complete.eval()

        # Carrega Generator
        gen_ckpt = os.path.join(model_dir, "ProPainter.pth")
        if not os.path.isfile(gen_ckpt):
            raise FileNotFoundError(f"ProPainter.pth not found in {model_dir}")
        self.model = InpaintGenerator(model_path=gen_ckpt).to(device)
        self.model.eval()

    @staticmethod
    def _get_ref_index(mid_neighbor_id, neighbor_ids, length, ref_stride=10, ref_num=-1):
        ref_index = []
        if ref_num == -1:
            for i in range(0, length, ref_stride):
                if i not in neighbor_ids:
                    ref_index.append(i)
        else:
            start_idx = max(0, mid_neighbor_id - ref_stride * (ref_num // 2))
            end_idx = min(length, mid_neighbor_id + ref_stride * (ref_num // 2))
            for i in range(start_idx, end_idx, ref_stride):
                if i not in neighbor_ids:
                    if len(ref_index) > ref_num:
                        break
                    ref_index.append(i)
        return ref_index

    def __call__(
        self,
        frames: List[np.ndarray],
        mask: np.ndarray,
        on_progress=None,
        bg_median: Optional[np.ndarray] = None,  # ignorado (ProPainter nao precisa)
    ) -> List[np.ndarray]:
        """
        Args:
          frames: lista de N frames BGR uint8 (H, W, 3).
          mask: uint8 (H, W) ou (H, W, 1). Pixels > 0 = regiao a inpaintar.
          on_progress(done, total): callback intra-processamento.
        Returns:
          Lista de N frames BGR uint8 com a regiao reconstruida.
        """
        if not frames:
            return []

        H_ori, W_ori = frames[0].shape[:2]
        # Garante mask 2D
        if mask.ndim == 3:
            mask_2d = mask[:, :, 0]
        else:
            mask_2d = mask
        mask_2d = (mask_2d > 0).astype(np.uint8)

        # ProPainter exige dimensoes multiplas de 8
        new_W = W_ori - W_ori % 8
        new_H = H_ori - H_ori % 8
        if (new_W, new_H) != (W_ori, H_ori):
            frames_proc = [
                cv2.resize(f, (new_W, new_H), interpolation=cv2.INTER_AREA)
                for f in frames
            ]
            mask_proc = cv2.resize(
                mask_2d, (new_W, new_H), interpolation=cv2.INTER_NEAREST
            )
        else:
            frames_proc = frames
            mask_proc = mask_2d

        # Converte BGR -> RGB PIL (ProPainter espera RGB)
        frames_pil = [
            Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
            for f in frames_proc
        ]
        frames_np = [np.array(f) for f in frames_pil]

        # Cria mask_dilated e flow_mask (ambos dilatados)
        flow_mask_dilated = scipy.ndimage.binary_dilation(
            mask_proc, iterations=max(1, self.mask_dilation + 4)
        ).astype(np.uint8)
        mask_dilated = scipy.ndimage.binary_dilation(
            mask_proc, iterations=self.mask_dilation
        ).astype(np.uint8)

        T = len(frames_pil)
        flow_masks_pil = [Image.fromarray(flow_mask_dilated * 255).convert("L")] * T
        masks_dilated_pil = [Image.fromarray(mask_dilated * 255).convert("L")] * T

        # Converte pra tensors
        frames_t = to_tensors()(frames_pil).unsqueeze(0) * 2 - 1
        flow_masks_t = to_tensors()(flow_masks_pil).unsqueeze(0)
        masks_dilated_t = to_tensors()(masks_dilated_pil).unsqueeze(0)
        frames_t = frames_t.to(self.device)
        flow_masks_t = flow_masks_t.to(self.device)
        masks_dilated_t = masks_dilated_t.to(self.device)

        video_length = frames_t.size(1)
        if on_progress:
            on_progress(0, 4)  # 4 fases: flow, completion, propagation, transformer

        with torch.no_grad():
            # ---- FASE 1: optical flow via RAFT ----
            w = new_W
            if w <= 640:
                short_clip_len = 12
            elif w <= 720:
                short_clip_len = 8
            elif w <= 1280:
                short_clip_len = 4
            else:
                short_clip_len = 2

            if T > short_clip_len:
                gt_flows_f_list, gt_flows_b_list = [], []
                for f in range(0, video_length, short_clip_len):
                    end_f = min(video_length, f + short_clip_len)
                    if f == 0:
                        flows_f, flows_b = self.fix_raft(
                            frames_t[:, f:end_f], iters=self.raft_iter
                        )
                    else:
                        flows_f, flows_b = self.fix_raft(
                            frames_t[:, f - 1:end_f], iters=self.raft_iter
                        )
                    gt_flows_f_list.append(flows_f)
                    gt_flows_b_list.append(flows_b)
                gt_flows_f = torch.cat(gt_flows_f_list, dim=1)
                gt_flows_b = torch.cat(gt_flows_b_list, dim=1)
                gt_flows_bi = (gt_flows_f, gt_flows_b)
            else:
                gt_flows_bi = self.fix_raft(frames_t, iters=self.raft_iter)

            if on_progress:
                on_progress(1, 4)

            if self.use_half:
                frames_t = frames_t.half()
                flow_masks_t = flow_masks_t.half()
                masks_dilated_t = masks_dilated_t.half()
                gt_flows_bi = (gt_flows_bi[0].half(), gt_flows_bi[1].half())
                self.fix_flow_complete = self.fix_flow_complete.half()
                self.model = self.model.half()

            # ---- FASE 2: flow completion ----
            flow_length = gt_flows_bi[0].size(1)
            if flow_length > self.subvideo_length:
                pred_flows_f, pred_flows_b = [], []
                pad_len = 5
                for f in range(0, flow_length, self.subvideo_length):
                    s_f = max(0, f - pad_len)
                    e_f = min(flow_length, f + self.subvideo_length + pad_len)
                    pad_len_s = max(0, f) - s_f
                    pad_len_e = e_f - min(flow_length, f + self.subvideo_length)
                    pred_flows_bi_sub, _ = self.fix_flow_complete.forward_bidirect_flow(
                        (gt_flows_bi[0][:, s_f:e_f], gt_flows_bi[1][:, s_f:e_f]),
                        flow_masks_t[:, s_f:e_f + 1],
                    )
                    pred_flows_bi_sub = self.fix_flow_complete.combine_flow(
                        (gt_flows_bi[0][:, s_f:e_f], gt_flows_bi[1][:, s_f:e_f]),
                        pred_flows_bi_sub,
                        flow_masks_t[:, s_f:e_f + 1],
                    )
                    pred_flows_f.append(pred_flows_bi_sub[0][:, pad_len_s:e_f - s_f - pad_len_e])
                    pred_flows_b.append(pred_flows_bi_sub[1][:, pad_len_s:e_f - s_f - pad_len_e])
                pred_flows_f = torch.cat(pred_flows_f, dim=1)
                pred_flows_b = torch.cat(pred_flows_b, dim=1)
                pred_flows_bi = (pred_flows_f, pred_flows_b)
            else:
                pred_flows_bi, _ = self.fix_flow_complete.forward_bidirect_flow(
                    gt_flows_bi, flow_masks_t
                )
                pred_flows_bi = self.fix_flow_complete.combine_flow(
                    gt_flows_bi, pred_flows_bi, flow_masks_t
                )

            if on_progress:
                on_progress(2, 4)

            # ---- FASE 3: image propagation ----
            masked_frames = frames_t * (1 - masks_dilated_t)
            subvideo_length_img_prop = min(100, self.subvideo_length)
            if video_length > subvideo_length_img_prop:
                updated_frames, updated_masks = [], []
                pad_len = 10
                for f in range(0, video_length, subvideo_length_img_prop):
                    s_f = max(0, f - pad_len)
                    e_f = min(video_length, f + subvideo_length_img_prop + pad_len)
                    pad_len_s = max(0, f) - s_f
                    pad_len_e = e_f - min(video_length, f + subvideo_length_img_prop)
                    b, t, _, _, _ = masks_dilated_t[:, s_f:e_f].size()
                    pred_flows_bi_sub = (
                        pred_flows_bi[0][:, s_f:e_f - 1],
                        pred_flows_bi[1][:, s_f:e_f - 1],
                    )
                    prop_imgs_sub, updated_local_masks_sub = self.model.img_propagation(
                        masked_frames[:, s_f:e_f],
                        pred_flows_bi_sub,
                        masks_dilated_t[:, s_f:e_f],
                        "nearest",
                    )
                    updated_frames_sub = (
                        frames_t[:, s_f:e_f] * (1 - masks_dilated_t[:, s_f:e_f])
                        + prop_imgs_sub.view(b, t, 3, new_H, new_W)
                        * masks_dilated_t[:, s_f:e_f]
                    )
                    updated_masks_sub = updated_local_masks_sub.view(b, t, 1, new_H, new_W)
                    updated_frames.append(
                        updated_frames_sub[:, pad_len_s:e_f - s_f - pad_len_e]
                    )
                    updated_masks.append(
                        updated_masks_sub[:, pad_len_s:e_f - s_f - pad_len_e]
                    )
                updated_frames = torch.cat(updated_frames, dim=1)
                updated_masks = torch.cat(updated_masks, dim=1)
            else:
                b, t, _, _, _ = masks_dilated_t.size()
                prop_imgs, updated_local_masks = self.model.img_propagation(
                    masked_frames, pred_flows_bi, masks_dilated_t, "nearest"
                )
                updated_frames = (
                    frames_t * (1 - masks_dilated_t)
                    + prop_imgs.view(b, t, 3, new_H, new_W) * masks_dilated_t
                )
                updated_masks = updated_local_masks.view(b, t, 1, new_H, new_W)

            if on_progress:
                on_progress(3, 4)

            # ---- FASE 4: feature propagation + transformer ----
            ori_frames = frames_np
            comp_frames = [None] * video_length
            neighbor_stride = self.neighbor_length // 2
            if video_length > self.subvideo_length:
                ref_num = self.subvideo_length // self.ref_stride
            else:
                ref_num = -1

            total_iter = max(1, (video_length + neighbor_stride - 1) // neighbor_stride)
            cur_iter = 0

            for f in range(0, video_length, neighbor_stride):
                neighbor_ids = [
                    i for i in range(max(0, f - neighbor_stride),
                                     min(video_length, f + neighbor_stride + 1))
                ]
                ref_ids = self._get_ref_index(
                    f, neighbor_ids, video_length, self.ref_stride, ref_num
                )
                selected_imgs = updated_frames[:, neighbor_ids + ref_ids, :, :, :]
                selected_masks = masks_dilated_t[:, neighbor_ids + ref_ids, :, :, :]
                selected_update_masks = updated_masks[:, neighbor_ids + ref_ids, :, :, :]
                selected_pred_flows_bi = (
                    pred_flows_bi[0][:, neighbor_ids[:-1], :, :, :],
                    pred_flows_bi[1][:, neighbor_ids[:-1], :, :, :],
                )

                l_t = len(neighbor_ids)
                pred_img = self.model(
                    selected_imgs, selected_pred_flows_bi,
                    selected_masks, selected_update_masks, l_t,
                )
                pred_img = pred_img.view(-1, 3, new_H, new_W)
                pred_img = (pred_img + 1) / 2
                pred_img_np = pred_img.cpu().permute(0, 2, 3, 1).numpy() * 255
                binary_masks = (
                    masks_dilated_t[0, neighbor_ids, :, :, :]
                    .cpu()
                    .permute(0, 2, 3, 1)
                    .numpy()
                    .astype(np.uint8)
                )
                for i in range(len(neighbor_ids)):
                    idx = neighbor_ids[i]
                    img = (
                        np.array(pred_img_np[i]).astype(np.uint8) * binary_masks[i]
                        + ori_frames[idx] * (1 - binary_masks[i])
                    )
                    if comp_frames[idx] is None:
                        comp_frames[idx] = img
                    else:
                        comp_frames[idx] = (
                            comp_frames[idx].astype(np.float32) * 0.5
                            + img.astype(np.float32) * 0.5
                        )
                    comp_frames[idx] = comp_frames[idx].astype(np.uint8)

                cur_iter += 1
                if on_progress:
                    on_progress(3 + cur_iter / total_iter, 4)

        # Converte de volta pra BGR e resize pro tamanho original
        result = []
        for fr in comp_frames:
            if fr is None:
                fr = np.zeros((new_H, new_W, 3), dtype=np.uint8)
            bgr = cv2.cvtColor(fr.astype(np.uint8), cv2.COLOR_RGB2BGR)
            if (new_W, new_H) != (W_ori, H_ori):
                bgr = cv2.resize(bgr, (W_ori, H_ori), interpolation=cv2.INTER_LINEAR)
            result.append(bgr)
        return result


def find_propainter_models() -> Optional[str]:
    """Procura a pasta com os 3 .pth do ProPainter."""
    candidates = [
        os.path.join(_HERE, "propainter", "weights"),
        os.path.join(os.path.expanduser("~"), ".cache", "darko", "propainter"),
    ]
    for d in candidates:
        if (
            os.path.isfile(os.path.join(d, "ProPainter.pth"))
            and os.path.isfile(os.path.join(d, "recurrent_flow_completion.pth"))
            and os.path.isfile(os.path.join(d, "raft-things.pth"))
        ):
            return d
    return None
