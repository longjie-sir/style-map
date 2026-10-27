#!/usr/bin/env python3
"""离线烘焙「中国」背景底图资源（只需跑一次，产物提交进 assets/）。

产物：
  assets/china_sat.jpg     1600x975 的遥感底图（等距圆柱投影 / Plate Carrée）
  assets/china_border.png  同范围、同投影的省界 + 省名（白色，alpha 透明，运行时按主题着色）

关键点：
  1. 瓦片是 Web Mercator，直接贴到经纬度平面上会在高纬拉伸 —— 必须逐行重投影；
  2. 高德瓦片是 GCJ-02，与 DataV 行政区划同源，边界能严丝合缝对上；
  3. 只做一次性烘焙，运行时零网络请求（断网也能出图）。

用法：python scripts/bake_backdrop.py
"""
import io
import json
import math
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets')
os.makedirs(OUT, exist_ok=True)

# 中国主体范围（含海南，南海诸岛另作插图，不在此框内）
WEST, SOUTH, EAST, NORTH = 72.0, 16.0, 136.5, 55.0
Z = 5
W_OUT = None          # 由瓦片拼接宽度决定（1:1，不放大）
H_OUT = None

UA = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.amap.com/'}


def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * (2 ** z)


def lat2y(lat, z):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * (2 ** z)


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


def build_satellite():
    x0, x1 = int(math.floor(lon2x(WEST, Z))), int(math.floor(lon2x(EAST, Z)))
    y0, y1 = int(math.floor(lat2y(NORTH, Z))), int(math.floor(lat2y(SOUTH, Z)))
    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    global W_OUT, H_OUT
    W_OUT = W_OUT or cols * 256
    H_OUT = int(round(W_OUT * (NORTH - SOUTH) / (EAST - WEST)))
    print(f'tiles {cols}x{rows} = {cols * rows} @ z{Z}')
    mosaic = Image.new('RGB', (cols * 256, rows * 256), (10, 12, 14))
    for ty in range(rows):
        for tx in range(cols):
            gx, gy = x0 + tx, y0 + ty
            url = f'https://webst0{Z % 4 + 1}.is.autonavi.com/appmaptile?style=6&x={gx}&y={gy}&z={Z}'
            try:
                im = Image.open(io.BytesIO(fetch(url))).convert('RGB')
            except Exception as e:                      # 单块失败不影响整体
                print('  tile fail', gx, gy, e)
                im = Image.new('RGB', (256, 256), (16, 18, 20))
            mosaic.paste(im, (tx * 256, ty * 256))
    if cols * rows > 8:
        print('  mosaic ok')

    # 逐行重投影：Mercator y → 纬度 → 输出行（列向是线性的，只需竖向重采样）
    import numpy as np
    MW, MH = mosaic.size
    arr = np.asarray(mosaic, dtype=np.float32)
    ys = []
    for py in range(H_OUT):
        lat = NORTH - (NORTH - SOUTH) * (py + 0.5) / H_OUT
        my = (lat2y(lat, Z) - y0) * 256
        ys.append(min(max(my, 0.0), MH - 1.001))
    ys = np.array(ys, dtype=np.float32)
    y0i = np.floor(ys).astype(np.int32)
    fy = (ys - y0i)[:, None, None]

    # 横向：输出列中心对应的 mosaic 列（线性，一次线性插值即可）
    xs = np.array([(lon2x(WEST + (EAST - WEST) * (px + 0.5) / W_OUT, Z) - x0) * 256
                   for px in range(W_OUT)], dtype=np.float32)
    xs = np.clip(xs, 0.0, MW - 1.001)
    x0i = np.floor(xs).astype(np.int32)
    fx = (xs - x0i)[None, :, None]

    base = arr[y0i]                                    # H_OUT × MW × 3
    up = arr[y0i + 1]
    rowm = base * (1 - fy) + up * fy                    # 竖向插值
    rgb = rowm[:, x0i] * (1 - fx) + rowm[:, x0i + 1] * fx
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')
    print('  reproject done')
    p = os.path.join(OUT, 'china_sat.jpg')
    out.save(p, quality=82, optimize=True, progressive=True)
    print('sat ->', p, os.path.getsize(p) // 1024, 'KB', out.size)
    return out


def build_border(sat):
    """省界 + 省名，白色绘制在透明底上，运行时用材质 color 着色"""
    url = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'
    try:
        gj = json.loads(fetch(url, 40).decode('utf-8'))
    except Exception as e:
        print('province geojson fail', e)
        return
    W, H = sat.size
    cv = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(cv)
    X = lambda lon: (lon - WEST) / (EAST - WEST) * W
    Y = lambda lat: (NORTH - lat) / (NORTH - SOUTH) * H
    for f in gj.get('features', []):
        g = f.get('geometry') or {}
        polys = [g.get('coordinates')] if g.get('type') == 'Polygon' else (g.get('coordinates') or [])
        for rings in polys:
            for ring in rings[:1]:
                if len(ring) < 3:
                    continue
                pts = [(X(p[0]), Y(p[1])) for p in ring]
                d.line(pts + [pts[0]], fill=(255, 255, 255, 210), width=2, joint='curve')
    # 省名
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 26)
    except Exception:
        font = ImageFont.load_default()
    for f in gj.get('features', []):
        c = (f.get('properties') or {}).get('center')
        nm = (f.get('properties') or {}).get('name') or ''
        if not c or not nm:
            continue
        nm = nm.replace('维吾尔自治区', '').replace('壮族自治区', '').replace('回族自治区', '')
        nm = nm.replace('自治区', '').replace('特别行政区', '').replace('省', '').replace('市', '')
        d.text((X(c[0]), Y(c[1])), nm, font=font, fill=(255, 255, 255, 150), anchor='mm')
    p = os.path.join(OUT, 'china_border.png')
    cv.save(p, optimize=True)
    print('border ->', p, os.path.getsize(p) // 1024, 'KB')


if __name__ == '__main__':
    build_satellite()
