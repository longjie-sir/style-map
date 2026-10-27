#!/usr/bin/env python3
"""补拍：正俯视出图档（取景够远）与飞行视角（相机拉远看出轨迹）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'docs', 'screenshots')


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

        async def ev(src, wait=1600):
            await pg.evaluate(src.replace('$R', 'window.__app'))
            await pg.wait_for_timeout(wait)

        # ── 正俯视：距离按 fov 算，保证整张框进画面 ──
        await ev("""() => { const a = $R;
            a.ui(true); a.layer('backdrop', false); a.layer('frameOn', true);
            a.layer('frameStyle', 'checker'); a.layer('frameW', 0.07);
            a.layer('bgMode', 'plain'); a.layer('bgColor', '#f6f4ec');
            a.view.frameCamera(); }""", 2400)
        await ev("""() => { const a = $R, c = a.view.controls, cam = a.view.camera, t = c.target;
            const s = Math.max(a.view.region.spanX, a.view.region.spanY);
            cam.position.set(t.x + 1e-3, t.y + s * 1.95, t.z + 1e-3);
            cam.updateProjectionMatrix(); c.update(); }""", 2000)
        await pg.screenshot(path=os.path.join(OUT, 'top-plan.png'))
        print('  ✓ top-plan.png', flush=True)

        # ── 飞行：固定进度后把相机整体拉远，让轨迹进画面 ──
        await ev("""() => { const a = $R;
            a.layer('bgMode', 'theme'); a.layer('frameOn', false);
            a.view.frameCamera(); }""", 2000)
        await ev("() => $R.track.preset()", 2400)
        await ev("() => document.querySelector('[data-act=\"follow\"]').click()", 2800)
        await ev("() => { $R.track.playing = false; $R.track.progress = 0.42; }", 1800)
        await ev("""() => { const a = $R, c = a.view.controls, cam = a.view.camera;
            const rel = cam.position.clone().sub(c.target).multiplyScalar(2.6);
            cam.position.copy(c.target).add(rel); c.update(); }""", 2000)
        await pg.screenshot(path=os.path.join(OUT, 'flight.png'))
        print('  ✓ flight.png', flush=True)

        st = await pg.evaluate("""() => { const a = $R, c = a.view.controls, cam = a.view.camera;
            return { dist: +cam.position.distanceTo(c.target).toFixed(1),
                     prog: +a.track.progress.toFixed(2), playing: a.track.playing }; }""")
        print('[飞行状态]', st, flush=True)

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
