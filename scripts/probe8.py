#!/usr/bin/env python3
"""针对性探针：体积云是否真的画出来了 + 页面背景为何不生效。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 780}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        errs = []
        pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type in ('error', 'warning') else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(12000)

        # 背景
        bg = await pg.evaluate("""() => {
          const v = window.__app.view;
          const out = [];
          window.__app.layer('bgMode', 'plain');
          out.push(['plain 立即', document.body.style.background, getComputedStyle(document.body).backgroundColor]);
          window.__app.layer('bgColor', '#dfe3e6');
          out.push(['bgColor 后', document.body.style.background, getComputedStyle(document.body).backgroundColor]);
          window.__app.layer('bgMode', 'off');
          out.push(['off', document.body.style.background, getComputedStyle(document.body).backgroundColor]);
          window.__app.layer('bgMode', 'theme');
          out.push(['theme', document.body.style.background.slice(0, 40), getComputedStyle(document.body).backgroundColor]);
          window.__app.layer('bgMode', 'plain');
          return { bgMode: v.bgMode, bgColor: v.bgColor, out };
        }""")
        print('[bg]', json.dumps(bg, ensure_ascii=False), flush=True)

        # 云
        await pg.evaluate("() => window.__app.layer('bgMode', 'theme')")
        info = await pg.evaluate("""() => {
          const A = window.__app, v = A.view, c = A.clouds;
          A.layers.cloudMode = 'volume';
          A.layer('clouds', true);
          const cam = v.camera;
          return { n: c.puffs.length, groupVisible: c.group.visible, enabled: c.enabled,
                   base: +c.baseHeight().toFixed(1), cam: [cam.position.x, cam.position.y, cam.position.z].map(x => +x.toFixed(0)),
                   camY: +cam.position.y.toFixed(0), region: v.region.name };
        }""")
        print('[cloud-init]', json.dumps(info, ensure_ascii=False), flush=True)
        await pg.wait_for_timeout(2500)

        proj = await pg.evaluate("""() => {
          const A = window.__app, v = A.view, c = A.clouds;
          const THREE_V = v.camera;
          const out = [];
          for (const p of c.puffs) {
            const m = p.mesh;
            const vec = m.position.clone().project(v.camera);
            out.push({ pos: [m.position.x, m.position.y, m.position.z].map(x => +x.toFixed(0)),
                       ndc: [+vec.x.toFixed(2), +vec.y.toFixed(2), +vec.z.toFixed(3)],
                       vis: m.visible, r: +p.radius.toFixed(0),
                       u: { cover: p.mesh.material.uniforms.uCover.value, density: +p.mesh.material.uniforms.uDensity.value.toFixed(2),
                            opacity: +p.mesh.material.uniforms.uOpacity.value.toFixed(2),
                            steps: p.mesh.material.uniforms.uSteps.value,
                            noise: !!p.mesh.material.uniforms.uNoise.value,
                            scale: p.mesh.material.uniforms.uScale.value } });
          }
          return { out, calls: v.renderer.info.render.calls, tris: v.renderer.info.render.triangles };
        }""")
        print('[cloud-proj]', json.dumps(proj, ensure_ascii=False), flush=True)

        # 把云放到相机正前方低位，看看是否根本不渲染
        await pg.evaluate("""() => {
          const A = window.__app, c = A.clouds, v = A.view;
          c.clear();
          const p = c.place(v.region.bbox.west + (v.region.bbox.east - v.region.bbox.west) * 0.5,
                            v.region.bbox.south + (v.region.bbox.north - v.region.bbox.south) * 0.5);
          p.mesh.position.y = 400;
          p.mesh.scale.set(200, 120, 200);
          p.syncBox();
        }""")
        await pg.wait_for_timeout(2000)
        await pg.screenshot(path=os.path.join(OUT, 'probe_cloud.png'))
        d2 = await pg.evaluate("""() => {
          const gl = window.__app.view.renderer.getContext();
          return { err: gl.getError(), lost: gl.isContextLost() };
        }""")
        print('[gl]', json.dumps(d2), flush=True)
        print('[errs]', errs[:6], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
