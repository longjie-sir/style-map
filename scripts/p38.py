#!/usr/bin/env python3
"""正俯视出图档：方位角归零 + 以区域中心为目标，保证画面不歪、整框入画。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'docs', 'screenshots')

READ = """() => { const a = window.__app, cam = a.view.camera, c = a.view.controls;
  const off = cam.position.clone().sub(c.target), d = off.length();
  const polar = Math.acos(Math.max(-1, Math.min(1, off.y / d))) * 180 / Math.PI;
  const theta = Math.atan2(off.x, off.z) * 180 / Math.PI;
  return { polar: +polar.toFixed(2), theta: +theta.toFixed(2), d: +d.toFixed(1) }; }"""


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

        await pg.evaluate("""() => { const a = window.__app;
            a.ui(true); a.layer('backdrop', false); a.layer('frameOn', true);
            a.layer('frameStyle', 'checker'); a.layer('frameW', 0.07);
            a.layer('bgMode', 'plain'); a.layer('bgColor', '#f6f4ec'); }""")
        await pg.wait_for_timeout(3200)
        await pg.evaluate("() => window.__app.view.frameCamera()")
        await pg.wait_for_timeout(2600)

        await pg.evaluate("""() => { const a = window.__app, c = a.view.controls, cam = a.view.camera;
            c.enableDamping = false; c.minPolarAngle = 0;
            const s = Math.max(a.view.region.spanX, a.view.region.spanY);
            const ty = c.target.y;
            c.target.set(0, ty, 0);
            cam.position.set(0, ty + s * 2.05, 0.001);
            cam.lookAt(c.target); c.update(); }""")
        await pg.wait_for_timeout(1600)
        print('[视角]', await pg.evaluate(READ), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'top-plan.png'))
        print('  ✓ top-plan.png', flush=True)
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
