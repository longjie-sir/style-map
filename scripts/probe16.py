#!/usr/bin/env python3
"""第 7 轮验收 C：8 种框体在出图模式下的成品图 + 贴图自检。"""
import asyncio, sys, os, json, base64
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

CASES = [
    ('mat',     {'frameTone': 'auto',  'frameCorner': 'bracket', 'frameStyle': 'mat'}),
    ('checker', {'frameTone': 'auto',  'frameCorner': 'none',    'frameStyle': 'checker'}),
    ('plate',   {'frameTone': 'paper', 'frameCorner': 'bracket', 'frameStyle': 'plate'}),
    ('wood',    {'frameTone': 'auto',  'frameCorner': 'block',   'frameStyle': 'wood'}),
    ('neat',    {'frameTone': 'auto',  'frameCorner': 'dot',     'frameStyle': 'neat'}),
    ('bevel',   {'frameTone': 'sand',  'frameCorner': 'block',   'frameStyle': 'bevel'}),
    ('double',  {'frameTone': 'auto',  'frameCorner': 'bracket', 'frameStyle': 'double'}),
    ('thin',    {'frameTone': 'auto',  'frameCorner': 'none',    'frameStyle': 'thin'}),
]


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

        for key, extra in CASES:
            await pg.evaluate("""o => {
              const a = window.__app;
              for (const k of Object.keys(o)) if (k !== 'frameStyle') a.layer(k, o[k]);
              a.layer('frameStyle', o.frameStyle);
            }""", extra)
            await pg.wait_for_timeout(1400)
            st = await pg.evaluate("""() => {
              const f = window.__app.frame;
              const g = f._g, c = f.canvas;
              const gx = c.getContext('2d');
              const d = gx.getImageData(0, 0, c.width, c.height).data;
              let ink = 0;
              for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
              return { style: f.styleKey, tone: f.tone, corner: f.corner,
                       w: c.width, h: c.height,
                       ink: +(ink / (c.width * c.height)).toFixed(3),
                       zOff: +f.mesh.position.z.toFixed(2) };
            }""")
            await pg.screenshot(path=os.path.join(OUT, f'p16_{key}.png'))
            print('[框]', json.dumps(st, ensure_ascii=False), flush=True)

        # 铭牌 + 木框贴图各导一张，确认文字不重叠
        for key in ('plate', 'wood', 'checker'):
            await pg.evaluate("""k => window.__app.layer('frameStyle', k)""", key)
            await pg.wait_for_timeout(1400)
            url = await pg.evaluate("() => window.__app.frame.canvas.toDataURL('image/png')")
            with open(os.path.join(OUT, f'canvas2_{key}.png'), 'wb') as fh:
                fh.write(base64.b64decode(url.split(',', 1)[1]))

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
