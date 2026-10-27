#!/usr/bin/env python3
"""重拍正俯视出图档：设置后断言极角，必要时重设，保证截图确实是正上方视角。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'docs', 'screenshots')

READ = """() => { const a = window.__app, cam = a.view.camera, c = a.view.controls;
  const off = cam.position.clone().sub(c.target), d = off.length();
  return +(Math.acos(Math.max(-1, Math.min(1, off.y / d))) * 180 / Math.PI).toFixed(2); }"""

SET_TOP = """() => { const a = window.__app, c = a.view.controls, cam = a.view.camera, t = c.target;
  c.enableDamping = false; c.minPolarAngle = 0;
  const s = Math.max(a.view.region.spanX, a.view.region.spanY);
  cam.position.set(t.x + 1e-3, t.y + s * 1.95, t.z + 1e-3);
  cam.lookAt(t); c.update(); }"""


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
        await pg.wait_for_timeout(3200)          # 等 ui 隐藏后的自动取景跑完
        await pg.evaluate("() => window.__app.view.frameCamera()")
        await pg.wait_for_timeout(2600)

        for i in range(3):
            await pg.evaluate(SET_TOP)
            await pg.wait_for_timeout(700)
            polar = await pg.evaluate(READ)
            print(f'[第{i+1}次] 设完极角 =', polar, flush=True)
            if polar < 3:
                break

        await pg.wait_for_timeout(1500)
        polar = await pg.evaluate(READ)
        print('[截图前极角]', polar, flush=True)
        if polar > 3:
            await pg.evaluate(SET_TOP)
            await pg.wait_for_timeout(500)
            print('[再补一次]', await pg.evaluate(READ), flush=True)

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
