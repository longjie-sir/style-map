#!/usr/bin/env python3
"""诊断「含离岛」取景：为什么内容没铺满。"""
import asyncio, os, json
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
        await pg.wait_for_timeout(5000)
        await pg.evaluate("() => window.__app.pick('460000','海南省')")
        await pg.wait_for_function("window.__app.state.region.id === '460000'", timeout=300000)
        await pg.wait_for_timeout(12000)

        r = await pg.evaluate("""() => {
          const v = window.__app.view, r = v.region;
          const out = { spanMain: [r.spanX|0, r.spanY|0], nFar: (r.farRings||[]).length };
          const a = v._framePoints(false), c = v._framePoints(true);
          const box = (pts) => {
            let mnx=9,mxx=-9,mnz=9,mxz=-9;
            for (const p of pts) { if(p.x<mnx)mnx=p.x; if(p.x>mxx)mxx=p.x; if(p.z<mnz)mnz=p.z; if(p.z>mxz)mxz=p.z; }
            return {n: pts.length, x:[mnx|0, mxx|0], z:[mnz|0, mxz|0]};
          };
          out.mainPts = box(a); out.allPts = box(c);
          return out;
        }""")
        print('pts:', json.dumps(r, ensure_ascii=False), flush=True)

        await pg.evaluate("() => window.__app.layer('isletView','all')")
        await pg.wait_for_timeout(3000)
        st = await pg.evaluate("""() => {
          const v = window.__app.view, c = v.controls, cam = v.camera;
          return { frameM: v._frameM, camDist: cam.position.distanceTo(c.target)|0,
                   minD: c.minDistance|0, maxD: c.maxDistance|0,
                   far: cam.far|0, near: +cam.near.toFixed(2),
                   target: [c.target.x|0, c.target.y|0, c.target.z|0] };
        }""")
        print('frame:', json.dumps(st, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p44_all.png'))
        print('[errs]', errs, flush=True)
        await b.close()


asyncio.run(main())
