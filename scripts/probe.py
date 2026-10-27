import asyncio, os, sys, json
from playwright.async_api import async_playwright
URL_HQ = 'http://127.0.0.1:8901/?proxy=1'
URL_LOW = 'http://127.0.0.1:8901/?q=low&proxy=1'

async def main():
    logs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=1)
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        await pg.goto(URL_HQ, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=120000)
        await pg.wait_for_timeout(2500)
        info = await pg.evaluate("""() => {
          const v = window.__app.view, c = v.camera, THREE = v.u.uSunDir.value.constructor;
          const b = v.region.bbox;
          const pts = [];
          for (const lon of [b.west, b.east]) for (const lat of [b.south, b.north]) {
            const w = v.lonLatToWorld(lon, lat);
            const p = new THREE(w.x, 0, w.z).project(c);
            pts.push([+p.x.toFixed(2), +p.y.toFixed(2)]);
          }
          return {
            span: [v.region.spanX.toFixed(0), v.region.spanY.toFixed(0)],
            cam: c.position.toArray().map(n => +n.toFixed(1)),
            dist: +c.position.length().toFixed(1),
            target: v.controls.target.toArray().map(n => +n.toFixed(1)),
            ndc: pts,
            fov: c.fov, aspect: +c.aspect.toFixed(2),
            exag: v.params.exag, depth: v.params.depth
          };
        }""")
        print(json.dumps(info, ensure_ascii=False))
        await b.close()
    print('\n'.join(logs))
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
