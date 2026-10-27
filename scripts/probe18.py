#!/usr/bin/env python3
"""第 7 轮总验收：无海面背景 + 三列选择器 + 画框成品（出图）。"""
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

        # 1) 主题背景（正常 UI）—— 确认那块蓝没了
        st = await pg.evaluate("""() => ({
          sea: window.__app.view.sea,
          bd: !!window.__app.backdrop.enabled,
          bg: window.__app.layers.bgMode,
          frame: window.__app.layers.frameStyle })""")
        print('[默认]', json.dumps(st, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p18_theme.png'))

        # 2) 侧栏画框控件是否渲染
        ui = await pg.evaluate("""() => {
          const t = document.getElementById('panel') || document.body;
          const segs = [...t.querySelectorAll('[data-seg="frameStyle"]')].map(b => b.textContent);
          const tones = [...t.querySelectorAll('[data-seg="frameTone"]')].map(b => b.textContent);
          const corners = [...t.querySelectorAll('[data-seg="frameCorner"]')].map(b => b.textContent);
          const steps = [...t.querySelectorAll('[data-seg="gratStep"]')].map(b => b.textContent);
          return { segs, tones, corners, steps,
                   sliders: [...t.querySelectorAll('input[data-lnum]')].map(i => i.dataset.lnum) };
        }""")
        print('[控件]', json.dumps(ui, ensure_ascii=False), flush=True)

        # 3) 出图：铭牌框 + 平云关，纯白底
        await pg.evaluate("""() => {
          const a = window.__app;
          a.layer('bgColor', '#ffffff'); a.layer('bgMode', 'plain'); a.layer('backdrop', false);
          a.layer('frameStyle', 'plate'); a.layer('frameTone', 'paper'); a.layer('frameCorner', 'bracket');
        }""")
        await pg.wait_for_timeout(1400)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(3600)
        await pg.screenshot(path=os.path.join(OUT, 'p18_plate_export.png'))

        # 4) 木框出图
        await pg.evaluate("""() => {
          const a = window.__app;
          a.layer('frameStyle', 'wood'); a.layer('frameCorner', 'block'); a.layer('frameTone', 'auto');
        }""")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(OUT, 'p18_wood_export.png'))

        # 5) 分格带出图
        await pg.evaluate("""() => {
          const a = window.__app;
          a.layer('frameStyle', 'checker'); a.layer('frameCorner', 'none');
        }""")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(OUT, 'p18_checker_export.png'))

        # 6) 回到 UI，验三列选择器最终态
        await pg.evaluate("() => window.__app.ui(false)")
        await pg.wait_for_timeout(1400)
        await pg.click('#regionBtn')
        await pg.wait_for_timeout(1500)
        cols = await pg.evaluate("""() => ({
          prov: document.querySelectorAll('#rmProv button').length,
          city: document.querySelectorAll('#rmCity button').length,
          menuW: document.getElementById('regionMenu').getBoundingClientRect().width })""")
        print('[三列]', json.dumps(cols, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p18_menu.png'))

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
