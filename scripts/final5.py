#!/usr/bin/env python3
"""终稿截图：默认视图 / 窄视口 / 像素 / 体积云 / 标注定制。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
logs = []


def emit():
    print('\n'.join(dict.fromkeys(logs)), flush=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        for (W, H, tag) in [(1440, 900, 'wide'), (1080, 596, 'narrow')]:
            pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
            pg.set_default_timeout(150000)
            pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
            pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}") if m.type == 'error' else None)
            await pg.goto(URL, wait_until='load')
            await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
            await pg.wait_for_timeout(16000)

            # 取景：地块是否完整入画、留白是否均衡
            d = await pg.evaluate("""() => {
              const v = window.__app.view;
              return { W: v.el.clientWidth, H: v.el.clientHeight,
                       frame: v._frameM ? { cx: +v._frameM.cx.toFixed(3), cy: +v._frameM.cy.toFixed(3),
                                            w: +v._frameM.w.toFixed(3), h: +v._frameM.h.toFixed(3) } : null,
                       panelHide: document.getElementById('panel').classList.contains('hide'),
                       panelW: Math.round(document.getElementById('panel').getBoundingClientRect().width) };
            }""")
            logs.append(f"[取景 {tag}] " + json.dumps(d, ensure_ascii=False))
            await pg.screenshot(path=os.path.join(OUT, f'final5_{tag}_default.png'))

            # 纯净版（隐藏界面）
            await pg.evaluate("() => window.__app.ui(true)")
            await pg.wait_for_timeout(1300)
            await pg.screenshot(path=os.path.join(OUT, f'final5_{tag}_clean.png'))
            await pg.evaluate("() => window.__app.ui(false)")
            await pg.wait_for_timeout(900)

            # 标注定制：大字号 + 贴地 + 粗描边
            await pg.evaluate("""() => {
              const app = window.__app;
              app.labels.setOptions({ scale: 1.35, weight: 800, spacing: 0.3,
                color: '#fff6e0', outlineW: 5, outlColor: '#0b1c2c', outlAlpha: 0.95,
                lift: 0.6, maxCount: 14, align: 'center' });
            }""")
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=os.path.join(OUT, f'final5_{tag}_labels.png'))
            await pg.evaluate("""() => window.__app.labels.setOptions({ scale: 1, weight: 700, spacing: 0.16,
              color: '#ffffff', outlineW: 3, outlColor: '#101010', outlAlpha: 0.92,
              lift: 0.4, maxCount: 26 })""")
            await pg.wait_for_timeout(700)

            # 像素 + 体积云 + 经纬网（中画质）
            await pg.evaluate("""() => {
              window.__app.quality('mid');
              window.__app.style('pixel');
            }""")
            await pg.wait_for_timeout(4000)
            await pg.screenshot(path=os.path.join(OUT, f'final5_{tag}_pixel.png'))
            await pg.evaluate("() => window.__app.layer('clouds', true)")
            await pg.wait_for_timeout(5500)
            await pg.screenshot(path=os.path.join(OUT, f'final5_{tag}_pixel_cloud.png'))
            cc = await pg.evaluate("""() => ({ n: window.__app.clouds.puffs.length,
                y: window.__app.clouds.puffs.length ? +window.__app.clouds.puffs[0].mesh.position.y.toFixed(1) : null })""")
            logs.append(f"[云 {tag}] " + json.dumps(cc, ensure_ascii=False))

            # 面板展开：图层分组可见性
            pn = await pg.evaluate("""() => {
              const grps = [...document.querySelectorAll('.lgrp')].map(g => ({
                t: g.querySelector('.lgrp-t').textContent.trim(),
                open: !g.querySelector('.lgrp-bd').classList.contains('dim')
              }));
              const secs = [...document.querySelectorAll('.sec')].map(s => ({
                t: s.dataset.sec, collapsed: s.classList.contains('collapsed') }));
              return { grps, secs };
            }""")
            logs.append(f"[面板 {tag}] " + json.dumps(pn, ensure_ascii=False))
            await pg.evaluate("() => { window.__app.style('hypo'); }")
            await pg.wait_for_timeout(2500)
            await pg.evaluate("() => { const p = document.getElementById('panel'); p.scrollTop = p.scrollHeight; }")
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=os.path.join(OUT, f'final5_{tag}_panel.png'))
            await pg.close()
        await b.close()
    emit()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    emit()
    sys.stdout.flush()
    os._exit(1)