#!/usr/bin/env python3
"""背景三态 + 出图联动复查（素色/关闭 要同时关掉遥感底图）。"""
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
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(14000)

        out = []
        for mode, color in (('plain', '#ffffff'), ('plain', '#dfe3e6'), ('off', None), ('theme', None)):
            await pg.evaluate("""o => { if (o.color) window.__app.layer('bgColor', o.color);
                window.__app.layer('bgMode', o.mode); }""", {'mode': mode, 'color': color})
            await pg.wait_for_timeout(1100)
            st = await pg.evaluate("""() => ({ mode: window.__app.layers.bgMode,
                bodyBg: document.body.style.background.slice(0, 46),
                bdVis: !!(window.__app.backdrop && window.__app.backdrop.enabled),
                bdMesh: !!(window.__app.backdrop && window.__app.backdrop.mesh) })""")
            await pg.screenshot(path=os.path.join(OUT, f'n9_bg_{mode}_{(color or "x").replace("#", "")}.png'))
            out.append(st)
        print('[背景]', json.dumps(out, ensure_ascii=False), flush=True)

        # 素色白 + 隐藏界面 = 出图
        await pg.evaluate("""() => { window.__app.layer('bgColor', '#ffffff'); window.__app.layer('bgMode', 'plain'); }""")
        await pg.wait_for_timeout(1200)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(3200)          # 等提示条淡出
        await pg.screenshot(path=os.path.join(OUT, 'n9_export_white.png'))
        await pg.evaluate("() => window.__app.ui(false)")
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => window.__app.layer('bgMode', 'theme')")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(OUT, 'n9_back_theme.png'))
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
