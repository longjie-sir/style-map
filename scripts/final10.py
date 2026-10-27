#!/usr/bin/env python3
"""收尾验收：出图模式重新取景 + 背景三态 + 云两方案（体积云缩小后）。"""
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
        await pg.wait_for_timeout(14000)

        # 体积云（缩小云团后）
        await pg.evaluate("() => { window.__app.layers.cloudMode='volume'; window.__app.layer('clouds', true); }")
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path=os.path.join(OUT, 'n9b_cloud_volume.png'))
        await pg.evaluate("() => window.__app.layer('clouds', false)")
        await pg.wait_for_timeout(700)

        # 出图：素色白 + 隐藏界面（应重新取景）
        before = await pg.evaluate("() => { const v = window.__app.view; return [+v.camera.position.x.toFixed(0), +v.camera.position.y.toFixed(0), +v.camera.position.z.toFixed(0)]; }")
        await pg.evaluate("""() => { window.__app.layer('bgColor', '#ffffff'); window.__app.layer('bgMode', 'plain'); }""")
        await pg.wait_for_timeout(1100)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(3600)
        after = await pg.evaluate("() => { const v = window.__app.view; return [+v.camera.position.x.toFixed(0), +v.camera.position.y.toFixed(0), +v.camera.position.z.toFixed(0)]; }")
        await pg.screenshot(path=os.path.join(OUT, 'n9b_export.png'))
        await pg.evaluate("() => window.__app.ui(false)")
        await pg.wait_for_timeout(1200)
        back = await pg.evaluate("() => { const v = window.__app.view; return [+v.camera.position.x.toFixed(0), +v.camera.position.y.toFixed(0), +v.camera.position.z.toFixed(0)]; }")
        print('[机位] 隐藏前', before, '→ 出图', after, '→ 恢复', back, flush=True)

        # 背景三态（看海面/底图是否联动）
        rows = []
        for mode, color in (('plain', '#f6f4ec'), ('off', None), ('theme', None)):
            await pg.evaluate("""o => { if (o.color) window.__app.layer('bgColor', o.color);
                window.__app.layer('bgMode', o.mode); }""", {'mode': mode, 'color': color})
            await pg.wait_for_timeout(1000)
            st = await pg.evaluate("""() => ({ mode: window.__app.layers.bgMode,
                body: document.body.style.background.slice(0, 34),
                sea: !!window.__app.view.sea && window.__app.view.sea.visible,
                bd: !!window.__app.backdrop.enabled })""")
            await pg.screenshot(path=os.path.join(OUT, f'n9b_bg_{mode}.png'))
            rows.append(st)
        print('[背景]', json.dumps(rows, ensure_ascii=False), flush=True)
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
