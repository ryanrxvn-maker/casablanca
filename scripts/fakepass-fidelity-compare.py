# Compara previa.png (Chrome) x download.png (motor real) de cada caso gerado por
# scripts/fakepass-fidelity.mjs. Uso: python scripts/fakepass-fidelity-compare.py <pasta>
# Compara em ~2px por px CSS, tolerando deslocamento de ate ~0,9px CSS
# (antialiasing/arredondamento); o que sobra esta fora do lugar de verdade.
# Nota ("hot") = celulas de ~8px CSS com divergencia forte; ~0 = identico.
# Gera <caso>/cmp.png (previa | download | divergencia em vermelho) e scores.json.
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter

root = sys.argv[1]
BG = (127, 127, 127)


def flat(p):
    im = Image.open(p).convert('RGBA')
    bg = Image.new('RGBA', im.size, BG + (255,))
    return Image.alpha_composite(bg, im).convert('RGB')


DPR = {}
try:
    for rec in json.load(open(os.path.join(root, 'summary.json'), encoding='utf-8')):
        if rec.get('dpr'):
            DPR[rec['name']] = rec['dpr']
except Exception:
    pass

rows = []
for name in sorted(os.listdir(root)):
    d = os.path.join(root, name)
    a_p, b_p = os.path.join(d, 'previa.png'), os.path.join(d, 'download.png')
    if not (os.path.isfile(a_p) and os.path.isfile(b_p)):
        continue
    A, B = flat(a_p), flat(b_p)
    w, h = min(A.width, B.width), min(A.height, B.height)
    size_note = '' if (abs(A.width - B.width) <= 2 and abs(A.height - B.height) <= 2) else f'TAM {A.size}x{B.size}'
    A, B = A.crop((0, 0, w, h)), B.crop((0, 0, w, h))
    # compara em ~2px por px CSS (rapido; deslocamento visivel continua aparecendo)
    dpr0 = DPR.get(name) or (w / 320)
    if dpr0 > 2:
        s2 = 2 / dpr0
        A = A.resize((max(1, int(w * s2)), max(1, int(h * s2))), Image.LANCZOS)
        B = B.resize(A.size, Image.LANCZOS)
        w, h = A.size
        DPR[name] = 2
    r = 1.2
    ga = np.asarray(A.convert('L').filter(ImageFilter.GaussianBlur(r)), dtype=np.int16)
    gb = np.asarray(B.convert('L').filter(ImageFilter.GaussianBlur(r)), dtype=np.int16)
    ca = np.asarray(A.filter(ImageFilter.GaussianBlur(r)), dtype=np.int16)
    cb = np.asarray(B.filter(ImageFilter.GaussianBlur(r)), dtype=np.int16)
    H0, W0 = ga.shape
    # tolerante a deslocamento SUB-px de tela (antialiasing/arredondamento do
    # html2canvas): pra cada pixel, a menor diferenca entre A e B deslocado ate
    # ~0,9px CSS. Sobra so o que esta fora do lugar de verdade (>~1px CSS).
    dpr = DPR.get(name) or (w / 320)
    k = max(1, int(round(0.9 * dpr)))
    dl = np.full(ga.shape, 999, dtype=np.int16)
    dc = np.full(ga.shape, 999, dtype=np.int16)
    pb = np.pad(gb, k, mode='edge')
    pcb = np.pad(cb, ((k, k), (k, k), (0, 0)), mode='edge')
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            sb = pb[k + dy:k + dy + H0, k + dx:k + dx + W0]
            scb = pcb[k + dy:k + dy + H0, k + dx:k + dx + W0]
            np.minimum(dl, np.abs(ga - sb), out=dl)
            np.minimum(dc, np.abs(ca - scb).max(axis=2), out=dc)
    mask = (dl > 45) | (dc > 70)
    pct = float(mask.mean() * 100)
    # hotspots: celulas de ~8px CSS com >6% de pixels fortes
    cell = max(8, int(round(8 * (DPR.get(name) or 2))))
    H, W = mask.shape
    hm = mask[: H // cell * cell, : W // cell * cell].reshape(H // cell, cell, W // cell, cell).mean(axis=(1, 3))
    hot = int((hm > 0.06).sum())
    # triptico
    over = np.asarray(B).copy()
    over = (over * 0.45 + 255 * 0.55).astype(np.uint8)
    over[mask] = [230, 20, 20]
    s = min(1.0, 700 / w)
    tw, th = int(w * s), int(h * s)
    tri = Image.new('RGB', (tw * 3 + 20, th), (255, 0, 255))
    tri.paste(A.resize((tw, th)), (0, 0))
    tri.paste(B.resize((tw, th)), (tw + 10, 0))
    tri.paste(Image.fromarray(over).resize((tw, th)), (tw * 2 + 20, 0))
    tri.save(os.path.join(d, 'cmp.png'))
    rows.append({'name': name, 'pct': round(pct, 3), 'hot': hot, 'size': size_note})

rows.sort(key=lambda x: (-x['hot'], -x['pct']))
json.dump(rows, open(os.path.join(root, 'scores.json'), 'w'), indent=1)
for x in rows:
    print(f"{x['hot']:5d} {x['pct']:7.3f}%  {x['name']} {x['size']}")
