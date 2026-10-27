#!/usr/bin/env python3
"""定位铭牌标题在 3D 里的落点：在 canvas 的标题位置横涂一条红带。"""
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

        info = await pg.evaluate("""() => {
          const f = window.__app.frame;
          return { title: f.title, style: f.styleKey, w: f.canvas.width, h: f.canvas.height };
        }""")
        print('[状态]', json.dumps(info, ensure_ascii=False), flush=True)

        # 在标题所在的 y 位置涂一条红带（横贯），看它落在画面哪里
        pos = await pg.evaluate("""() => {
          const f = window.__app.frame, c = f.canvas, g = c.getContext('2d');
          const T = c.height, S = c.width;
          // 复算 iy1：下框带高度未知，用整幅 0.9~0.98 区间涂三条不同色的横带
          const bands = [
            [0.86, '#ff0000'], [0.92, '#00b000'], [0.97, '#0000ff']
          ];
          for (const [p, col] of bands) {
            g.fillStyle = col;
            g.fillRect(0, T * p, S, Math.max(8, T * 0.012));
          }
          f.tex.needsUpdate = true;
          return { h: T, w: S };
        }""")
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=os.path.join(OUT, 'p19_bands.png'))
        print('[band]', json.dumps(pos, ensure_ascii=False), flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
