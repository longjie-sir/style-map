#!/usr/bin/env python3
"""复现高 DPI（devicePixelRatio>1）下的画布与标注层错位。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        for dpr in (1, 1.5):
            pg = await b.new_page(viewport={'width': 1080, 'height': 596}, device_scale_factor=dpr)
            pg.set_default_timeout(120000)
            await pg.goto(URL, wait_until='load')
            await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
            await pg.wait_for_timeout(12000)
            info = await pg.evaluate("""() => {
              const v = window.__app.view;
              const c = v.renderer.domElement, r = c.getBoundingClientRect();
              return { dpr: devicePixelRatio, win: [innerWidth, innerHeight],
                       attr: [c.width, c.height],
                       rect: [+r.width.toFixed(0), +r.height.toFixed(0), +r.left.toFixed(0), +r.top.toFixed(0)],
                       style: c.getAttribute('style') };
            }""")
            print(f"dpr={dpr}", info, flush=True)
            await pg.screenshot(path=os.path.join(OUT, f'dpr{dpr}.png'))
            await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
