#!/usr/bin/env python3
"""定位：把相机放到正上方后被谁改回去（给 frameCamera 插桩 + 连续采样极角）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
READ = """() => { const a = window.__app, cam = a.view.camera, c = a.view.controls;
  const off = cam.position.clone().sub(c.target), d = off.length();
  return +(Math.acos(off.y / d) * 180 / Math.PI).toFixed(2); }"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 900, 'height': 600}, device_scale_factor=1)
        pg.set_default_timeout(300000)
        logs = []
        pg.on('console', lambda m: logs.append(m.text) if 'FRAME' in m.text else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=300000)
        await pg.wait_for_timeout(9000)

        # 插桩
        await pg.evaluate("""() => { const a = window.__app;
            if (!a.view.__patched) {
              const o1 = a.view.frameCamera.bind(a.view);
              a.view.frameCamera = (...args) => { console.log('FRAME frameCamera ' + Math.round(performance.now())); return o1(...args); };
              const o2 = a.view.setViewPreset.bind(a.view);
              a.view.setViewPreset = (k, ...r) => { console.log('FRAME setViewPreset ' + k + ' ' + Math.round(performance.now())); return o2(k, ...r); };
              a.view.__patched = 1;
            } }""")

        # 复现 p35 的前置：隐藏界面 + 素色背景 + 分格框
        await pg.evaluate("""() => { const a = window.__app;
            a.ui(true); a.layer('backdrop', false); a.layer('frameOn', true);
            a.layer('frameStyle', 'checker'); a.layer('frameW', 0.07);
            a.layer('bgMode', 'plain'); a.layer('bgColor', '#f6f4ec');
            a.view.frameCamera(); }""")
        print('[前置后]', await pg.evaluate(READ), flush=True)
        for i in range(6):
            await pg.wait_for_timeout(400)
            print(f'  t+{0.4*(i+1):.1f}s polar=', await pg.evaluate(READ), flush=True)

        # 设垂直
        await pg.evaluate("""() => { const a = window.__app, c = a.view.controls, cam = a.view.camera, t = c.target;
            c.enableDamping = false; c.minPolarAngle = 0;
            const s = Math.max(a.view.region.spanX, a.view.region.spanY);
            cam.position.set(t.x + 1e-3, t.y + s * 1.95, t.z + 1e-3);
            cam.lookAt(t); c.update(); }""")
        print('[设垂直·即时]', await pg.evaluate(READ), flush=True)
        for i in range(10):
            await pg.wait_for_timeout(300)
            print(f'  t+{0.3*(i+1):.1f}s polar=', await pg.evaluate(READ), flush=True)

        print('[FRAME 调用]', logs[:10], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
