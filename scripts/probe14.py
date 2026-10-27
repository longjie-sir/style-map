#!/usr/bin/env python3
"""第 7 轮验收 B2：配色/层次修正后的画框。3 种主推框体 + 参数组合。"""
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
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(13000)

        await pg.evaluate("""() => {
          window.__app.layer('bgColor', '#ffffff');
          window.__app.layer('bgMode', 'plain');
          window.__app.layer('backdrop', false);
        }""")
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(3400)

        cases = [
            ('mat',     {'frameTone': 'auto', 'frameCorner': 'bracket'}),
            ('checker', {'frameTone': 'auto', 'frameCorner': 'none'}),
            ('plate',   {'frameTone': 'paper', 'frameCorner': 'bracket', 'frameTitle': True}),
            ('wood',    {'frameTone': 'auto', 'frameCorner': 'block'}),
            ('neat',    {'frameTone': 'auto', 'frameCorner': 'dot'}),
            ('bevel',   {'frameTone': 'sand', 'frameCorner': 'block'}),
        ]
        rows = []
        for key, extra in cases:
            await pg.evaluate("""o => {
              const a = window.__app;
              a.layer('frameStyle', o.style);
              for (const k of Object.keys(o.extra)) a.layer(k, o.extra[k]);
            }""", {'style': key, 'extra': extra})
            await pg.wait_for_timeout(1200)
            st = await pg.evaluate("""() => {
              const f = window.__app.frame;
              return { style: f.styleKey, tone: f.tone, corner: f.corner, title: f.title,
                       w: f.canvas.width, h: f.canvas.height,
                       zOff: +f.mesh.position.z.toFixed(2) };
            }""")
            await pg.screenshot(path=os.path.join(OUT, f'p14_{key}.png'))
            rows.append(st)
            print('[框]', json.dumps(st, ensure_ascii=False), flush=True)

        print('[errs]', errs[:6], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
