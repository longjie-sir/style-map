#!/usr/bin/env python3
"""快速诊断：页面为什么起不来。"""
import asyncio, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'shots')
os.makedirs(OUT, exist_ok=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800})
        msgs = []
        pg.on('pageerror', lambda e: msgs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: msgs.append(f'[{m.type}] {m.text}'))
        pg.on('requestfailed', lambda r: msgs.append(f'REQFAIL {r.url[:120]} {r.failure}'))
        await pg.goto(URL, wait_until='load')
        for i in range(24):
            await pg.wait_for_timeout(2500)
            ok = await pg.evaluate("!!(window.__app && window.__app.state.region)")
            stage = await pg.evaluate("(document.getElementById('loader')||{}).className || ''")
            st = await pg.evaluate("((document.getElementById('loaderStage')||{}).textContent||'')")
            print(f'{i*2.5:5.1f}s ready={ok} loader={stage!r} stage={st!r}', flush=True)
            if ok:
                break
        await pg.screenshot(path=os.path.join(OUT, 'p43_diag.png'))
        print('--- messages ---', flush=True)
        for m in msgs[-40:]:
            print(m, flush=True)
        await b.close()


asyncio.run(main())
