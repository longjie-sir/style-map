#!/usr/bin/env python3
"""正俯视出图档：拉远拍全，再按内容自动裁边（背景为素色，容易检测）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright
from PIL import Image, ImageChops

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'docs', 'screenshots')
RAW = os.path.join(OUT, '_top_raw.png')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 860}, device_scale_factor=2)
        pg.set_default_timeout(300000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=300000)
        await pg.wait_for_timeout(10000)

        await pg.evaluate("""() => { const a = window.__app;
            a.ui(true); a.layer('backdrop', false); a.layer('frameOn', true);
            a.layer('frameStyle', 'checker'); a.layer('frameW', 0.06);
            a.layer('bgMode', 'plain'); a.layer('bgColor', '#f6f4ec'); }""")
        await pg.wait_for_timeout(3200)
        await pg.evaluate("() => window.__app.view.frameCamera()")
        await pg.wait_for_timeout(2600)

        await pg.evaluate("""() => { const a = window.__app, c = a.view.controls, cam = a.view.camera;
            c.enableDamping = false; c.minPolarAngle = 0;
            const s = Math.max(a.view.region.spanX, a.view.region.spanY);
            const ty = c.target.y;
            c.target.set(0, ty, 0);
            cam.position.set(0, ty + s * 2.95, 0.001);
            cam.lookAt(c.target); c.update(); }""")
        await pg.wait_for_timeout(2000)
        await pg.screenshot(path=RAW)
        print('  · 原始帧已拍', flush=True)
        print('[errs]', errs[:5], flush=True)
        await pg.close()
        await b.close()

    # ── 按背景色裁边 ──
    im = Image.open(RAW).convert('RGB')
    bg = im.getpixel((4, 4))
    diff = ImageChops.difference(im, Image.new('RGB', im.size, bg)).convert('L')
    bbox = diff.point(lambda v: 255 if v > 8 else 0).getbbox()
    print('  · 背景', bg, '内容框', bbox, flush=True)
    pad = 34
    x0 = max(0, bbox[0] - pad); y0 = max(0, bbox[1] - pad)
    x1 = min(im.width, bbox[2] + pad); y1 = min(im.height, bbox[3] + pad)
    im.crop((x0, y0, x1, y1)).save(os.path.join(OUT, 'top-plan.png'))
    os.remove(RAW)
    print('  ✓ top-plan.png', Image.open(os.path.join(OUT, 'top-plan.png')).size, flush=True)
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
