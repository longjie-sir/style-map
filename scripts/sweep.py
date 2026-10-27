#!/usr/bin/env python3
"""全风格回归：12 种风格逐个截图 + 像素风格下钻 + 控制台错误统计。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
KEYS = ['hypo', 'line', 'sketch', 'realistic', 'mono', 'ice', 'magma',
        'plaster', 'ink', 'paper', 'parchment', 'pixel']

async def main():
    logs, errs = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        pg.set_default_timeout(90000)
        pg.on('pageerror', lambda e: errs.append("[pageerror] " + str(e)[:300]))
        pg.on('console', lambda m: errs.append(f"[{m.type}] {m.text[:300]}") if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(6500)

        for k in KEYS:
            n0 = len(errs)
            await pg.evaluate("k => window.__app.style(k)", k)
            await pg.wait_for_timeout(2600)
            await pg.screenshot(path=os.path.join(OUT, f'sweep_{k}.png'))
            logs.append(f"{k:10s} {'OK' if len(errs) == n0 else 'ERR+' + str(len(errs) - n0)}")

        # 像素风格下钻到杭州市：验证方块几何随区域重建
        await pg.evaluate("() => window.__app.pick('330100', '杭州市')")
        await pg.wait_for_timeout(9000)
        info = await pg.evaluate("""() => {
          const v = window.__app.view;
          return { region: v.region && v.region.name, pixelMode: v.pixelMode,
                   vox: v.voxMesh ? v.voxMesh.geometry.userData : null,
                   stepM: v.voxStepM && Math.round(v.voxStepM),
                   exag: v.u.uHeightScale.value * 1000, cx: +(v._frameM||{}).cx||0 };
        }""")
        logs.append("[city/pixel] " + json.dumps(info, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'sweep_pixel_city.png'))

        await b.close()
    print('\n'.join(logs), flush=True)
    seen, out = set(), []
    for e in errs:
        if e[:150] in seen: continue
        seen.add(e[:150]); out.append(e)
    print('--- console errors: %d kinds ---' % len(out), flush=True)
    print('\n'.join(out[:12]), flush=True)
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
