"""Atlas dos hologramas do herói do Pilot.

Fonte: public/cards/criar-avatar.mp4 — 6 pessoas falando, mesmo estúdio,
cortes secos. Cada pessoa vira uma célula (cor | máscara u2net) e o trecho
dela toca IDA E VOLTA (emenda sem pulo). Grade 3x2 num mp4 só.

uso: python prep_atlas.py <saida.mp4>
"""
import os, sys, subprocess, shutil, tempfile
import cv2, numpy as np, onnxruntime as ort

SRC = 'D:/_pilot-design/public/cards/criar-avatar.mp4'
SEGS = [(1, 28), (32, 61), (65, 94), (98, 127), (131, 162), (166, 191)]  # frames (sem as bordas do corte)
CW, CH = 256, 320
FPS = 24
LOOP = 60

sess = ort.InferenceSession(os.path.expanduser('~/.u2net/u2net_human_seg.onnx'), providers=['CPUExecutionProvider'])
inp = sess.get_inputs()[0].name
face = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)


def matte(bgr):
    rgb = cv2.cvtColor(cv2.resize(bgr, (320, 320), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32)
    rgb = (rgb / max(rgb.max(), 1e-6) - MEAN) / STD
    d = sess.run(None, {inp: rgb.transpose(2, 0, 1)[None]})[0][0, 0]
    d = (d - d.min()) / max(d.max() - d.min(), 1e-6)
    return cv2.resize(d, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_LINEAR)


cap = cv2.VideoCapture(SRC)
frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
Hh, Ww = frames[0].shape[:2]
cw_src = int(Hh * CW / CH)

cells = []  # por pessoa: lista de quadros empacotados (cor|máscara)
for a, b in SEGS:
    mid = frames[(a + b) // 2]
    fs = face.detectMultiScale(cv2.cvtColor(mid, cv2.COLOR_BGR2GRAY), 1.1, 6, minSize=(200, 200))
    cx = (fs[0][0] + fs[0][2] // 2) if len(fs) else Ww // 2
    x0 = max(0, min(Ww - cw_src, cx - cw_src // 2))
    seq = []; prev = None
    for i in range(a, b + 1):
        c = cv2.resize(frames[i][:, x0:x0 + cw_src], (CW, CH), interpolation=cv2.INTER_AREA)
        m = matte(c)
        m = m if prev is None else 0.6 * m + 0.4 * prev
        prev = m
        seq.append(np.hstack([c, cv2.cvtColor((np.clip(m, 0, 1) * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)]))
    seq = seq + seq[-2:0:-1]   # ida e volta
    seq = [seq[int(i * len(seq) / LOOP)] for i in range(LOOP)]  # todo mundo com o mesmo ciclo: emenda sem pulo
    cells.append(seq)
    print('pessoa', len(cells), 'x0', x0, len(seq), 'quadros')

n = max(len(s) for s in cells)
tmp = tempfile.mkdtemp()
for k in range(n):
    rows = []
    for r in range(2):
        rows.append(np.hstack([cells[r * 3 + c][k % len(cells[r * 3 + c])] for c in range(3)]))
    cv2.imwrite(os.path.join(tmp, f'{k:04d}.png'), np.vstack(rows))
out = sys.argv[1]
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(tmp, '%04d.png'),
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '25', '-preset', 'slow', '-g', str(n), '-movflags', '+faststart',
                '-an', out], check=True)
cv2.imwrite(out.replace('.mp4', '.jpg'), cv2.imread(os.path.join(tmp, '0000.png')), [cv2.IMWRITE_JPEG_QUALITY, 80])
shutil.rmtree(tmp, ignore_errors=True)
print('atlas', n, 'quadros', os.path.getsize(out) // 1024, 'KB')
