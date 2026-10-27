#!/usr/bin/env python3
"""查明铭牌文字为何不见：统计标题行像素 + 测试系统中文渲染能力。"""
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
          a.layer('bgMode', 'plain'); a.layer('bgColor', '#ffffff');
          a.layer('frameStyle', 'plate');
        }""")
        await pg.wait_for_timeout(1400)

        res = await pg.evaluate("""() => {
          const f = window.__app.frame, c = f.canvas, g = c.getContext('2d');
          const T = c.height, S = c.width, G = f._g;
          const iy1 = (G.outer.north - G.inner.south) / (G.outer.north - G.outer.south) * T;
          const cy = iy1 + (T - iy1) * 0.42;

          const dark = (y0, h) => {
            const d = g.getImageData(0, Math.max(0, Math.round(y0)), S, h).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i] + d[i+1] + d[i+2] < 380 && d[i+3] > 40) n++;
            }
            return n;
          };
          const before = dark(cy - 60, 120);

          // 手动用最朴素的字体写一行中文 + 一行 ASCII
          g.save();
          g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillStyle = '#ff0000';
          g.font = '90px serif';
          g.fillText('浙江省中文测试', 120, cy);
          g.font = '90px monospace';
          g.fillText('ASCII-TEST-123', 120, cy + 110);
          g.restore();
          const after = dark(cy - 60, 240);

          return { T, S, iy1: Math.round(iy1), cy: Math.round(cy),
                   darkBefore: before, darkAfter: after,
                   fontCheck: (() => { g.font = '90px serif'; return g.font; })() };
        }""")
        print('[像素]', json.dumps(res, ensure_ascii=False), flush=True)

        await pg.evaluate("() => { window.__app.frame.tex.needsUpdate = true; }")
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(2600)
        await pg.screenshot(path=os.path.join(OUT, 'p21_font.png'))
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
