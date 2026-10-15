#!/usr/bin/env python3
"""캐릭터 시트(source/otter-sheet.webp)에서 표정별 스프라이트(PNG, 투명 배경)를 잘라 낸다.
사용: python3 video/concept/character/make-sprites.py   (필요: pillow, numpy)
시트는 사용자가 제공한 이미지이며 사용 권리는 사용자가 책임진다(docs/character-otter.md).
배경(크림색)과 이어진 영역을 투명하게 만들고, 가장 큰 덩어리(캐릭터)만 남긴다."""
from pathlib import Path
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

here = Path(__file__).resolve().parent
sheet = Image.open(here / 'source' / 'otter-sheet.webp').convert('RGB')
BG = np.array([252, 246, 239])
# 표정 → 시트 안의 잘라낼 영역 (x0, y0, x1, y1)
BOXES = {
    'happy': (662, 92, 842, 268),    # 눈 감고 활짝 웃음
    'wow':   (862, 112, 1042, 268),  # 놀람
    'idle':  (1052, 92, 1232, 268),  # 웃으며 볼에 손
    'think': (862, 560, 1042, 728),  # 갸웃(?)
    'point': (1052, 548, 1232, 724), # 손 흔들기
    'cry':   (1058, 332, 1228, 492),
    'angry': (662, 548, 842, 728),
    'sleep': (662, 332, 852, 492),
}

def cutout(img, tol=22):
    a = np.asarray(img).astype(int)
    h, w, _ = a.shape
    near = (np.abs(a - BG).sum(axis=2) <= tol)
    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; q.append((ny, nx))
    fg = ~bg
    lab = np.zeros((h, w), int); best, best_n, cur = 0, 0, 0
    for y in range(h):
        for x in range(w):
            if fg[y, x] and lab[y, x] == 0:
                cur += 1; lab[y, x] = cur; n = 1; q = deque([(y, x)])
                while q:
                    cy, cx = q.popleft()
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and lab[ny, nx] == 0:
                            lab[ny, nx] = cur; n += 1; q.append((ny, nx))
                if n > best_n: best, best_n = cur, n
    mask = (lab == best)
    alpha = Image.fromarray((mask * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.9))
    out = img.convert('RGBA'); out.putalpha(alpha)
    return out.crop(out.getbbox())

for name, box in BOXES.items():
    sp = cutout(sheet.crop(box))
    sp = sp.resize((sp.width * 2, sp.height * 2), Image.LANCZOS)  # 영상에서 크게 쓰므로 2배 확대(원본 해상도 한계)
    sp.save(here / f'otter-{name}.png')
    print(name, sp.size)
