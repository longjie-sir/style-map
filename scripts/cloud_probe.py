#!/usr/bin/env python3
"""体积云客观判定：同一相机姿态下 开云/关云 两图求差，
若云真的渲染出来，差分图会出现大片连续区域（而不是零星噪声）。"""
import asyncio, sys, os, json
import numpy as np
from PIL import Image
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
logs = []


def emit():
    print('\n'.join(dict.fromkeys(logs)), flush=True)


async def shot(pg, name):
    p = os.path.join(OUT, name)
    await pg.screenshot(path=p)
    return p


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1000, 'height': 640}, device_scale_factor=1)
        pg.set_default_timeout(150000)
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(15000)
        # 视角压低一点，好看清云的厚度
        await pg.evaluate("""() => {
          const v = window.__app.view, t = v.controls.target;
          v.camera.position.set(t.x - 320, t.y + 190, t.z + 430);
          v.controls.update();
        }""")
        await pg.wait_for_timeout(1200)
        await pg.evaluate("() => window.__app.layer('clouds', false)")
        await pg.wait_for_timeout(1800)
        a = await shot(pg, 'cloud_off.png')
        # 放云
        info = await pg.evaluate("""() => {
          const c = window.__app.clouds, v = window.__app.view, r = v.region;
          c.clear();
          const b = r.bbox;
          const pts = [[0.5,0.5],[0.32,0.62],[0.68,0.58],[0.5,0.30]];
          const made = pts.map(([u,w]) => c.place(b.west + (b.east-b.west)*u, b.south + (b.north-b.south)*w, { size: 0.30, scale: 3.0 }));
          window.__app.layers.clouds = true; c.setVisible(true);
          return { n: c.puffs.length, y: +made[0].mesh.position.y.toFixed(1),
                   half: [+made[0].mesh.material.uniforms.uHalf.value.x.toFixed(1),
                          +made[0].mesh.material.uniforms.uHalf.value.y.toFixed(1)],
                   steps: made[0].mesh.material.uniforms.uSteps.value,
                   camY: +v.camera.position.y.toFixed(1),
                   dist: +v.camera.position.distanceTo(v.controls.target).toFixed(1),
                   span: [r.spanX.toFixed(0), r.spanY.toFixed(0)],
                   maxYkm: +((v.u.uMaxH.value || 1000) * v.u.uHeightScale.value).toFixed(2) };
        }""")
        logs.append("[放置] " + json.dumps(info, ensure_ascii=False))
        await pg.wait_for_timeout(4000)
        cimg = await shot(pg, 'cloud_on.png')
        await pg.close()
        await b.close()

    d = np.abs(np.array(Image.open(a).convert('RGB'), dtype=int)
               - np.array(Image.open(cimg).convert('RGB'), dtype=int)).max(axis=2)
    changed = d > 8
    logs.append(f"[差分] 变化像素 {changed.mean()*100:.1f}% · 最大差 {int(d.max())}")
    # 找最大连通块（粗略：按行统计连续段）
    ys, xs = np.nonzero(changed)
    if len(xs):
        logs.append(f"[差分 bbox] x {xs.min()}~{xs.max()} y {ys.min()}~{ys.max()} · 视口 1000x640")
        # 行分布：看云是否成片
        rows = changed.sum(axis=1)
        band = [int(rows[i:i+40].mean()) for i in range(0, 640, 40)]
        logs.append("[每 40 行变化像素] " + str(band))
    # 云的明暗结构：云区内亮度标准差（有体积感的云会有明显的明暗过渡）
    ca = np.array(Image.open(cimg).convert('L'), dtype=int)
    oa = np.array(Image.open(a).convert('L'), dtype=int)
    mask = changed
    if mask.sum() > 500:
        logs.append(f"[云区亮度] 均值 {ca[mask].mean():.0f} · 标准差 {ca[mask].std():.0f} · 背景均值 {oa[mask].mean():.0f}")
    emit()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    emit()
    sys.stdout.flush()
    os._exit(1)