#!/usr/bin/env python3
"""把展示图压成 WebP（README 用），控制仓库体积。"""
import os, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIR = os.path.join(ROOT, 'docs', 'screenshots')

# 前缀 -> 目标宽度（None = 保持原尺寸）
SPEC = [
    ('hero', 1240),
    ('ui-overview', 1240),
    ('top-plan', 1240),
    ('flight', 1100),
    ('pixel-close', 1100),
    ('frame-', 800),
    ('style-', 620),
    ('region-picker', 1000),
    ('top-plan', 1045),
]


def target_w(name):
    for pre, w in SPEC:
        if name.startswith(pre):
            return w
    return None


def main():
    total = 0
    for f in sorted(os.listdir(DIR)):
        if not f.lower().endswith('.png'):
            continue
        src = os.path.join(DIR, f)
        im = Image.open(src).convert('RGB')
        w = target_w(f)
        if w and im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        dst = os.path.join(DIR, f[:-4] + '.webp')
        im.save(dst, 'WEBP', quality=86, method=6)
        os.remove(src)
        sz = os.path.getsize(dst) / 1024
        total += sz
        print(f'  {f[:-4]:22s} {im.width}x{im.height}  {sz:6.0f} KB', flush=True)
    print(f'[合计] {total/1024:.2f} MB', flush=True)
    sys.stdout.flush()
    os._exit(0)


try:
    main()
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
