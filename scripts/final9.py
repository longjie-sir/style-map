#!/usr/bin/env python3
"""第 9 轮终稿：画框 4 种框体 / 云两方案 / 素色出图 / 全风格回归 / dpr 标注回归。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
KEYS = ['hypo', 'line', 'sketch', 'realistic', 'mono', 'ice', 'magma',
        'plaster', 'ink', 'paper', 'parchment', 'pixel']
logs = []


def emit():
    print('\n'.join(dict.fromkeys(logs)), flush=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])

        # ① dpr=2 标注对齐回归
        pg = await b.new_page(viewport={'width': 1080, 'height': 596}, device_scale_factor=2)
        pg.set_default_timeout(180000)
        err = []
        pg.on('pageerror', lambda e: err.append(str(e)))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(15000)
        d = await pg.evaluate("""() => {
          const v = window.__app.view, c = v.renderer.domElement, cr = c.getBoundingClientRect();
          const W = v.el.clientWidth, H = v.el.clientHeight;
          let worst = 0, n = 0;
          for (const it of window.__app.labels.items) {
            if (!it.enabled || it.el.style.display === 'none') continue;
            const r = it.el.getBoundingClientRect();
            const hit = v.pick(((r.left + r.width/2)/W)*2 - 1, -((r.top + r.height/2)/H)*2 + 1);
            if (!hit) continue;
            worst = Math.max(worst, Math.abs(hit.lon - it.lon), Math.abs(hit.lat - it.lat));
            n++;
          }
          return { dpr: devicePixelRatio, css: [Math.round(cr.width), Math.round(cr.height)],
                   attr: [c.width, c.height], checked: n, worstDeg: +worst.toFixed(3),
                   frame: v._frameM ? { cx: +v._frameM.cx.toFixed(3), cy: +v._frameM.cy.toFixed(3) } : null };
        }""")
        logs.append('[dpr=2] ' + json.dumps(d, ensure_ascii=False) + (f' ERR:{err[0][:120]}' if err else ''))
        await pg.close()

        # ② 主视图：画框 4 种 + 云 + 素色
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        errs = []
        pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(15000)
        logs.append('[加载] ' + ('OK' if not errs else 'ERR ' + errs[0][:200]))

        await pg.screenshot(path=os.path.join(OUT, 'n9_default_mat.png'))
        for st in ('thin', 'double', 'bevel'):
            await pg.evaluate("s => window.__app.layer('frameStyle', s)", st)
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=os.path.join(OUT, f'n9_frame_{st}.png'))
        # 无框
        await pg.evaluate("() => window.__app.layer('frameOn', false)")
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=os.path.join(OUT, 'n9_frame_off.png'))
        await pg.evaluate("() => { window.__app.layer('frameStyle','mat'); }")
        await pg.wait_for_timeout(700)

        # 云：体积 / 平面
        await pg.evaluate("() => { window.__app.layers.cloudMode='volume'; window.__app.layer('clouds', true); }")
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path=os.path.join(OUT, 'n9_cloud_volume.png'))
        await pg.evaluate("() => window.__app.layer('cloudMode', 'plane')")
        await pg.wait_for_timeout(3000)
        await pg.screenshot(path=os.path.join(OUT, 'n9_cloud_plane.png'))
        await pg.evaluate("() => window.__app.layer('clouds', false)")
        await pg.wait_for_timeout(600)

        # 素色出图 + 隐藏界面
        await pg.evaluate("""() => { window.__app.layer('bgColor', '#ffffff'); window.__app.layer('bgMode', 'plain'); }""")
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=os.path.join(OUT, 'n9_bg_white.png'))
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(OUT, 'n9_export.png'))
        await pg.evaluate("() => window.__app.ui(false)")
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => window.__app.layer('bgMode', 'theme')")
        await pg.wait_for_timeout(900)

        # 全风格回归
        bad = []
        for k in KEYS:
            errs.clear()
            await pg.evaluate("k => window.__app.style(k)", k)
            await pg.wait_for_timeout(2200)
            if errs:
                bad.append(f'{k}: {errs[0][:110]}')
        logs.append('[12 风格] ' + ('全过 0 报错' if not bad else ' || '.join(bad)))
        await pg.evaluate("() => window.__app.style('pixel')")
        await pg.wait_for_timeout(3500)
        await pg.screenshot(path=os.path.join(OUT, 'n9_pixel.png'))
        await pg.evaluate("() => window.__app.style('hypo')")
        await pg.wait_for_timeout(2500)

        # 面板底部（画框 / 背景控件）
        await pg.evaluate("""() => { const p = document.getElementById('panel'); p.scrollTop = p.scrollHeight; }""")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(OUT, 'n9_panel_bottom.png'))
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
