#!/usr/bin/env python3
"""验证框贴图在 3D 里的 UV 朝向：在 canvas 四角涂色，看它们落到画面哪个角。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        errs = []
        pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(12000)

        await pg.evaluate("""() => {
          const a = window.__app;
          a.layer('bgColor', '#ffffff'); a.layer('bgMode', 'plain'); a.layer('backdrop', false);
          a.layer('frameStyle', 'thin');
        }""")
        await pg.wait_for_timeout(1200)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(3000)

        # 四角涂色：左上红、右上绿、左下蓝、右下黄
        await pg.evaluate("""() => {
          const f = window.__app.frame, c = f.canvas, g = c.getContext('2d');
          const S = c.width, T = c.height, K = Math.round(S * 0.09);
          const box = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, K, K); };
          box(0, 0, '#ff0000');          // 左上
          box(S - K, 0, '#00c000');      // 右上
          box(0, T - K, '#0000ff');      // 左下
          box(S - K, T - K, '#ffd400');  // 右下
          f.tex.needsUpdate = true;
        }""")
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=os.path.join(OUT, 'p17_uv.png'))

        # 顺便看地形周围：canvas 底部的标题区在世界哪一侧
        info = await pg.evaluate("""() => {
          const f = window.__app.frame, g = f._g, v = window.__app.view, r = v.region;
          return { span: [r.spanX, r.spanY], bbox: [r.bbox.west, r.bbox.south, r.bbox.east, r.bbox.north],
                   outer: [g.outer.west, g.outer.south, g.outer.east, g.outer.north],
                   zOff: f.mesh.position.z, meshY: f.mesh.position.y };
        }""")
        print('[几何]', json.dumps(info, ensure_ascii=False), flush=True)
        print('[errs]', errs[:4], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
