#!/usr/bin/env python3
"""诊断：把相机放到正上方后，极角是否被改回去。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
READ = """() => { const a = window.__app, cam = a.view.camera, c = a.view.controls;
  const off = cam.position.clone().sub(c.target);
  const d = off.length();
  const polar = Math.acos(Math.max(-1, Math.min(1, off.y / d))) * 180 / Math.PI;
  return { polar: +polar.toFixed(2), dist: +d.toFixed(1),
           pos: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)],
           tgt: [+c.target.x.toFixed(1), +c.target.y.toFixed(1), +c.target.z.toFixed(1)],
           span: +Math.max(a.view.region.spanX, a.view.region.spanY).toFixed(1),
           minD: +c.minDistance.toFixed(1), maxD: +c.maxDistance.toFixed(1),
           minP: +(c.minPolarAngle * 180 / Math.PI).toFixed(1),
           maxP: +(c.maxPolarAngle * 180 / Math.PI).toFixed(1),
           damping: c.enableDamping }; }"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 900, 'height': 600}, device_scale_factor=1)
        pg.set_default_timeout(300000)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=300000)
        await pg.wait_for_timeout(9000)

        print('[初始]', await pg.evaluate(READ), flush=True)

        await pg.evaluate("() => window.__app.view.frameCamera()")
        await pg.wait_for_timeout(1200)
        print('[取景后]', await pg.evaluate(READ), flush=True)

        await pg.evaluate("""() => { const a = window.__app, c = a.view.controls, cam = a.view.camera;
            const s = Math.max(a.view.region.spanX, a.view.region.spanY);
            const t = c.target;
            cam.position.set(t.x + 1e-3, t.y + s * 1.95, t.z + 1e-3);
            cam.lookAt(t); c.update(); }""")
        print('[设垂直·立即]', await pg.evaluate(READ), flush=True)

        await pg.wait_for_timeout(1600)
        print('[设垂直·1.6s]', await pg.evaluate(READ), flush=True)

        # 对照：直接改极角（临时放开限制 + 关阻尼）
        await pg.evaluate("""() => { const a = window.__app, c = a.view.controls, cam = a.view.camera;
            c.enableDamping = false; c.minPolarAngle = 0;
            const s = Math.max(a.view.region.spanX, a.view.region.spanY);
            const t = c.target;
            cam.position.set(t.x + 1e-3, t.y + s * 1.95, t.z + 1e-3);
            cam.lookAt(t); c.update(); }""")
        print('[关阻尼后·立即]', await pg.evaluate(READ), flush=True)
        await pg.wait_for_timeout(1600)
        print('[关阻尼后·1.6s]', await pg.evaluate(READ), flush=True)

        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
