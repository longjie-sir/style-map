#!/usr/bin/env python3
"""飞行视角与云的降级路径复验（只看视觉，不重复测性能）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 900, 'height': 620}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=240000)
        await pg.wait_for_timeout(11000)

        async def js(src, wait=700):
            r = await pg.evaluate(src.replace('$R', 'window.__app'))
            await pg.wait_for_timeout(wait)
            return r

        await js("() => { $R.ui(true); }", 1500)          # 隐藏界面，看清画面
        await js("""() => { const a = $R;
            a.track.preset(); a.layers.flyH = 0.1; a.layer('flyH', 0.1); }""", 900)
        await js("() => document.querySelector('[data-act=\"follow\"]').click()", 2500)

        for k, prog in enumerate([0.12, 0.35, 0.62]):
            await js(f"() => {{ $R.track.progress = {prog}; }}", 1400)
            await pg.screenshot(path=os.path.join(OUT, f'p26_fly{k}.png'))

        st = await js("""() => { const tr = $R.track, v = $R.view;
            return { follow: tr.follow, playing: tr.playing, marker: tr.marker.visible,
                     tube: tr.tube.visible, gy: +tr.group.position.y.toFixed(2),
                     dpr: +v.renderer.getPixelRatio().toFixed(2),
                     dist: +v.camera.position.distanceTo(v.controls.target).toFixed(1) }; }""")
        print('[飞行]', st, flush=True)

        # 低画质 + 云开着 → 应自动换成平面云
        await js("() => document.querySelector('[data-act=\"follow\"]').click()", 1200)
        await js("() => { $R.layer('clouds', true); }", 3000)
        before = await js("() => ({ mode: $R.clouds.mode, puff: $R.clouds.puffs.length, sheet: $R.clouds.sheets.length })")
        await js("() => $R.layer('quality', 'low')", 4000)
        after = await js("() => ({ mode: $R.clouds.mode, puff: $R.clouds.puffs.length, sheet: $R.clouds.sheets.length })")
        print('[云] 低画质前', before, '→ 后', after, flush=True)
        await js("() => $R.layer('quality', 'high')", 5000)
        await js("() => $R.ui(false)", 800)
        await pg.screenshot(path=os.path.join(OUT, 'p26_ui.png'))

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
