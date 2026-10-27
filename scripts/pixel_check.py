#!/usr/bin/env python3
"""像素风格专项：省级 + 杭州市下钻 + 窄视口。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

async def main():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(120000)
        pg.on('pageerror', lambda e: errs.append("[pageerror] " + str(e)[:200]))
        pg.on('console', lambda m: errs.append("[error] " + m.text[:200]) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(6500)
        await pg.evaluate("() => window.__app.style('pixel')")
        await pg.wait_for_timeout(3200)
        await pg.screenshot(path=os.path.join(OUT, 'final_pixel.png'))

        # 下钻杭州市
        await pg.evaluate("() => window.__app.pick('330100', '杭州市')")
        await pg.wait_for_timeout(10000)
        r = await pg.evaluate("""() => {
          const v = window.__app.view;
          return { name: v.region && v.region.name, maxH: Math.round(v.u.uMaxH.value),
                   minH: Math.round(v.u.uMinH.value), stepM: Math.round(v.voxStepM),
                   exag: +(v.u.uHeightScale.value * 1000).toFixed(1),
                   verts: v.voxMesh && v.voxMesh.geometry.userData.vertexCount };
        }""")
        await pg.screenshot(path=os.path.join(OUT, 'final_pixel_city.png'))

        # 窄视口
        await pg.set_viewport_size({'width': 1080, 'height': 596})
        await pg.wait_for_timeout(1200)
        await pg.evaluate("() => window.__app.view.frameCamera()")
        await pg.wait_for_timeout(1400)
        await pg.screenshot(path=os.path.join(OUT, 'final_pixel_narrow.png'))

        await b.close()
    print(json.dumps(r, ensure_ascii=False), flush=True)
    print('errors: %d' % len(errs), flush=True)
    print('\n'.join(errs[:8]), flush=True)
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
