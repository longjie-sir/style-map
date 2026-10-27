#!/usr/bin/env python3
"""第 7 轮：直接导出框贴图，排查铭牌标题、木框卡纸、分格带。"""
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
        errs = []
        pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(12000)

        for key, extra in (('plate', {'frameTitle': True, 'frameTone': 'paper'}),
                           ('wood', {}),
                           ('checker', {})):
            await pg.evaluate("""o => {
              const a = window.__app;
              a.layer('frameStyle', o.style);
              for (const k of Object.keys(o.extra)) a.layer(k, o.extra[k]);
            }""", {'style': key, 'extra': extra})
            await pg.wait_for_timeout(1300)
            data = await pg.evaluate("""() => {
              const f = window.__app.frame;
              const g = f._g, c = f.canvas;
              return { url: c.toDataURL('image/png'), w: c.width, h: c.height,
                       title: f.title, style: f.styleKey,
                       name: f.region && f.region.name,
                       bbox: f.region ? [f.region.bbox.west, f.region.bbox.south, f.region.bbox.east, f.region.bbox.north] : null };
            }""")
            raw = data['url'].split(',', 1)[1]
            fp = os.path.join(OUT, f'canvas_{key}.png')
            with open(fp, 'wb') as fh:
                fh.write(base64.b64decode(raw))
            print('[canvas]', key, data['w'], data['h'], 'title=', data['title'],
                  'name=', data['name'], flush=True)
            del data

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
