#!/usr/bin/env python3
"""补拍：浙江（回归对比）+ 面板「离岛与飞地」分组特写。"""
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
        pg.set_default_timeout(300000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=300000)
        await pg.wait_for_timeout(20000)
        await pg.screenshot(path=os.path.join(OUT, 'p47_zhejiang.png'))
        print('  shot p47_zhejiang.png', flush=True)

        # 海南：展开图层分区，把「离岛与飞地」滚进视野
        await pg.evaluate("() => window.__app.pick('460000','海南省')")
        await pg.wait_for_function("window.__app.state.region.id === '460000'", timeout=300000)
        await pg.wait_for_timeout(20000)
        await pg.evaluate("""() => {
          const secs = [...document.querySelectorAll('#panel .sec')];
          secs.forEach(s => s.classList.remove('collapsed'));
          const want = secs.find(s => s.dataset.sec === '图层');
          if (want) want.scrollIntoView({ block: 'start' });
        }""")
        await pg.wait_for_timeout(1500)
        await pg.evaluate("""() => {
          const el = document.querySelector('input[data-layer="islets"]');
          const grp = el && el.closest('.lgrp');
          if (grp) grp.scrollIntoView({ block: 'center' });
        }""")
        await pg.wait_for_timeout(1200)
        box = await pg.evaluate("""() => {
          const r = document.getElementById('panel').getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        }""")
        await pg.screenshot(path=os.path.join(OUT, 'p47_panel.png'), clip=box)
        print('  shot p47_panel.png', flush=True)
        print('[errs]', errs, flush=True)
        await b.close()


asyncio.run(main())
