#!/usr/bin/env python3
"""按 key 直接切风格并截图（绕过点击时序，避免 busy 时 click 超时）。

用法: python scripts/style_shots.py line,sketch [prefix] [w] [h]
"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

async def main():
    keys = (sys.argv[1] if len(sys.argv) > 1 else 'line,sketch').split(',')
    prefix = sys.argv[2] if len(sys.argv) > 2 else 'v5'
    W = int(sys.argv[3]) if len(sys.argv) > 3 else 1440
    H = int(sys.argv[4]) if len(sys.argv) > 4 else 900
    logs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        pg.set_default_timeout(90000)
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}") if m.type in ('error', 'warning') else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(6500)
        for k in keys:
            await pg.evaluate("k => window.__app.style(k)", k)
            await pg.wait_for_timeout(2800)
            await pg.screenshot(path=os.path.join(OUT, f'{prefix}_{k}.png'))
            logs.append(f"[ok] {k}")
        await b.close()
    # 去重但保留首次出现的顺序：着色器报错会被重复刷屏，淹掉关键信息
    seen, out = set(), []
    for l in logs:
        k = l[:160]
        if k in seen: continue
        seen.add(k); out.append(l)
    print('\n'.join(out[:60]), flush=True)
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
