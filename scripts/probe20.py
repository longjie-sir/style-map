#!/usr/bin/env python3
"""铭牌标题：同时导出 2D 贴图与 3D 截图，并在贴图上标出标题框位置。"""
import asyncio, sys, os, json, base64
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(12000)

        await pg.evaluate("""() => {
          const a = window.__app;
          a.layer('bgColor', '#ffffff'); a.layer('bgMode', 'plain'); a.layer('backdrop', false);
          a.layer('frameStyle', 'plate');
        }""")
        await pg.wait_for_timeout(1300)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(3200)

        st = await pg.evaluate("""() => {
          const f = window.__app.frame, g = f._g, c = f.canvas;
          const T = c.height, o = g.outer, i = g.inner;
          const iy1 = (o.north - i.south) / (o.north - o.south) * T;
          return { T, iy1: +iy1.toFixed(0), band: +(T - iy1).toFixed(0),
                   titleY: +(iy1 + (T - iy1) * 0.42).toFixed(0),
                   pct: +((iy1 + (T - iy1) * 0.42) / T * 100).toFixed(1),
                   title: f.title, name: f.region.name };
        }""")
        print('[几何]', json.dumps(st, ensure_ascii=False), flush=True)

        url = await pg.evaluate("() => window.__app.frame.canvas.toDataURL('image/png')")
        with open(os.path.join(OUT, 'canvas_plate_cur.png'), 'wb') as fh:
            fh.write(base64.b64decode(url.split(',', 1)[1]))
        await pg.screenshot(path=os.path.join(OUT, 'p20_plate.png'))

        # 直接把标题涂成高亮红，确认位置是否可见
        await pg.evaluate("""y => {
          const f = window.__app.frame, c = f.canvas, g = c.getContext('2d');
          g.fillStyle = '#ff0000';
          g.fillRect(0, y - 6, c.width, 12);
          f.tex.needsUpdate = true;
        }""", st['titleY'])
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=os.path.join(OUT, 'p20_plate_mark.png'))

        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
