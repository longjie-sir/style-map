#!/usr/bin/env python3
"""为 README 拍一组干净的展示图（隐藏界面、按视口取景、1280×800）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'docs', 'screenshots')
os.makedirs(OUT, exist_ok=True)

STYLES = ['hypo', 'line', 'sketch', 'realistic', 'mono', 'ice',
          'magma', 'plaster', 'ink', 'paper', 'parchment', 'pixel']

# 按视口重新取景后，再按倍率拉远（正俯视要留出框带）
ZOOM_OUT = """() => {
  const a = $R, cam = a.view.camera, c = a.view.controls;
  const d = cam.position.clone().sub(c.target).multiplyScalar(%f);
  cam.position.copy(c.target).add(d); c.update();
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        pg.set_default_timeout(300000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=300000)
        await pg.wait_for_timeout(10000)

        async def ev(src, wait=1500):
            await pg.evaluate(src.replace('$R', 'window.__app'))
            if wait:
                await pg.wait_for_timeout(wait)

        async def shot(name, wait=0):
            if wait:
                await pg.wait_for_timeout(wait)
            await pg.screenshot(path=os.path.join(OUT, name))
            print('  ✓', name, flush=True)

        # ── 界面速览（全 UI + 底图 + 画框）──
        await ev("() => $R.view.frameCamera()", 2200)
        await shot('ui-overview.png')

        # ── 12 风格：隐藏界面、关框关底图，按视口取景 ──
        await ev("() => { const a = $R; a.ui(true); a.layer('backdrop', false);"
                 " a.layer('frameOn', false); a.view.frameCamera(); }", 2200)
        for k in STYLES:
            await ev(f"() => {{ const a = $R; a.style('{k}'); a.view.frameCamera(); }}",
                     4800 if k == 'pixel' else 1700)
            await shot(f'style-{k}.png')

        # ── 画框：分格 / 木框 / 铭牌 / 卡纸（斜俯视看全框）──
        await ev("() => { const a = $R; a.style('hypo'); a.layer('frameOn', true);"
                 " a.view.frameCamera(); }", 2200)
        for fs, name, w in [('checker', 'frame-checker', 0.085),
                            ('wood', 'frame-wood', 0.075),
                            ('plate', 'frame-plate', 0.07),
                            ('mat', 'frame-mat', 0.06),
                            ('bevel', 'frame-bevel', 0.08)]:
            await ev("() => { const a = $R;"
                     f" a.layer('frameOn', true); a.layer('frameStyle', '{fs}');"
                     f" a.layer('frameW', {w}); a.view.frameCamera(); }}", 1600)
            await shot(f'{name}.png')

        # ── 正俯视出图档（分格框 + 经纬网 + 素色背景）──
        await ev("() => { const a = $R; a.layer('frameStyle', 'checker');"
                 " a.layer('frameW', 0.07); a.layer('bgMode', 'plain');"
                 " a.layer('bgColor', '#f6f4ec'); a.view.frameCamera(); }", 1800)
        await ev("() => { const a = $R; a.view.setViewPreset('top'); }", 1400)
        await ev(ZOOM_OUT % 1.10, 1400)
        await shot('top-plan.png')

        # ── 轨迹飞行 ──
        await ev("() => { const a = $R; a.layer('bgMode', 'theme');"
                 " a.layer('frameOn', false); a.view.frameCamera(); }", 1800)
        await ev("() => { $R.track.preset(); }", 2200)
        await ev("() => document.querySelector('[data-act=\"follow\"]').click()", 2600)
        await ev("() => { $R.track.progress = 0.42; }", 2000)
        await shot('flight.png')
        await ev("() => document.querySelector('[data-act=\"follow\"]').click()", 1500)

        # ── 像素方块特写 ──
        await ev("() => { const a = $R; a.style('pixel'); a.view.frameCamera(); }", 5200)
        await shot('pixel-close.png')

        # ── 首图（无界面 + 底图 + 卡纸框）与界面速览 ──
        await ev("() => { const a = $R; a.style('hypo'); a.layer('backdrop', true);"
                 " a.layer('frameOn', true); a.layer('frameStyle', 'mat');"
                 " a.layer('frameW', 0.06); a.view.frameCamera(); }", 2800)
        await shot('hero.png')
        await ev("() => $R.ui(false)", 1400)
        await ev("() => document.querySelector('#regionBtn').click()", 1800)
        await shot('region-picker.png')
        await ev("() => document.querySelector('#regionBtn').click()", 900)

        el = await pg.query_selector('#panel')
        if el:
            await el.screenshot(path=os.path.join(OUT, 'panel.png'))
            print('  ✓ panel.png', flush=True)

        print('[errs]', errs[:5], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
