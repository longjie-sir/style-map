#!/usr/bin/env python3
"""重拍：正俯视出图档（关阻尼 + lookAt 确保朝向）与区域选择器（避开 toast）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'docs', 'screenshots')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        pg.set_default_timeout(300000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=300000)
        await pg.wait_for_timeout(10000)

        async def ev(src, wait=1500):
            await pg.evaluate(src.replace('$R', 'window.__app'))
            await pg.wait_for_timeout(wait)

        # ── 正俯视 ──
        await ev("""() => { const a = $R;
            a.ui(true); a.layer('backdrop', false); a.layer('frameOn', true);
            a.layer('frameStyle', 'checker'); a.layer('frameW', 0.07);
            a.layer('bgMode', 'plain'); a.layer('bgColor', '#f6f4ec');
            a.view.frameCamera(); }""", 2600)
        await ev("""() => { const a = $R, c = a.view.controls, cam = a.view.camera, t = c.target;
            c.enableDamping = false; c.minPolarAngle = 0;
            const s = Math.max(a.view.region.spanX, a.view.region.spanY);
            cam.position.set(t.x + 1e-3, t.y + s * 1.95, t.z + 1e-3);
            cam.lookAt(t); c.update(); }""", 2400)
        polar = await pg.evaluate("""() => { const a = window.__app, cam = a.view.camera, c = a.view.controls;
            const off = cam.position.clone().sub(c.target), d = off.length();
            return +(Math.acos(off.y / d) * 180 / Math.PI).toFixed(2); }""")
        print('[俯视极角]', polar, flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'top-plan.png'))
        print('  ✓ top-plan.png', flush=True)

        # ── 恢复默认，等 toast 消失后拍区域选择器 ──
        await ev("""() => { const a = $R;
            a.layer('bgMode', 'theme'); a.layer('bgColor', '#ffffff');
            a.layer('backdrop', true); a.layer('frameStyle', 'mat'); a.layer('frameW', 0.06);
            a.view.controls.enableDamping = true; a.view.controls.minPolarAngle = 0.02;
            a.view.frameCamera(); a.ui(false); }""", 3500)
        await ev("() => document.querySelector('#regionBtn').click()", 2200)
        await pg.screenshot(path=os.path.join(OUT, 'region-picker.png'))
        print('  ✓ region-picker.png', flush=True)

        print('[errs]', errs[:5], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
