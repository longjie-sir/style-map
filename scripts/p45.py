#!/usr/bin/env python3
"""诊断全图视图为什么空白：把关键点投影到 NDC 看落在哪。"""
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

        await pg.evaluate("() => window.__app.layer('isletView','all')")
        await pg.wait_for_timeout(2500)

        r = await pg.evaluate("""() => {
          const v = window.__app.view, cam = v.camera, c = v.controls;
          const ndc = (x,y,z) => { const T = cam.position.clone().set(x,y,z).project(cam);
                                   return [+T.x.toFixed(2), +T.y.toFixed(2), +T.z.toFixed(3)]; };
          return {
            cam: [cam.position.x|0, cam.position.y|0, cam.position.z|0],
            target: [c.target.x|0, c.target.y|0, c.target.z|0],
            fov: cam.fov, aspect: +cam.aspect.toFixed(3), near: +cam.near.toFixed(1), far: cam.far|0,
            el: [v.el.clientWidth, v.el.clientHeight],
            size: [v.renderer.domElement.width, v.renderer.domElement.height],
            ndcHainan: ndc(0, 0, 0),
            ndcNorth: ndc(0, 0, -133),
            ndcSouth: ndc(800, 0, 1694),
            ndcEast: ndc(841, 0, 800),
            meshVisible: !!(v.mesh && v.mesh.visible),
            isletVisible: !!(v.isletGroup && v.isletGroup.visible),
            isletChildren: v.isletGroup ? v.isletGroup.children.map(o => [o.type, o.visible]) : [],
            worldVisible: v.world.visible,
            cameraParent: cam.parent ? cam.parent.type : null,
          };
        }""")
        print(json.dumps(r, ensure_ascii=False, indent=1), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p45_all.png'))
        print('[errs]', errs, flush=True)
        await b.close()


asyncio.run(main())
