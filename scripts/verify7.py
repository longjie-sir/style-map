#!/usr/bin/env python3
"""第 5 轮总回归：12 风格 × 画质档 + 云 + 雨点关键测量。"""
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
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        pg.set_default_timeout(150000)
        errs = []
        pg.on('pageerror', lambda e: errs.append("[pageerror] " + str(e)))
        pg.on('console', lambda m: errs.append(f"[{m.type}] {m.text}") if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(15000)

        # 全风格渲染
        for k in KEYS:
            errs.clear()
            await pg.evaluate("k => window.__app.style(k)", k)
            await pg.wait_for_timeout(2600)
            d = await pg.evaluate("""() => {
              const v = window.__app.view;
              return { style: v.style.key, pixel: v.pixelMode,
                       voxVerts: v.voxMesh ? v.voxMesh.geometry.attributes.position.count : 0,
                       meshVis: v.mesh ? v.mesh.visible : null };
            }""")
            logs.append(f"[风格 {k}] " + json.dumps(d, ensure_ascii=False) + (("  ERR:" + errs[0][:120]) if errs else ""))
            await pg.screenshot(path=os.path.join(OUT, f'r7_{k}.png'))

        # 像素风格跑一遍画质档
        await pg.evaluate("() => window.__app.style('pixel')")
        await pg.wait_for_timeout(3000)
        for q in ('low', 'mid', 'high'):
            errs.clear()
            await pg.evaluate("q => window.__app.quality(q)", q)
            await pg.wait_for_timeout(3000)
            d = await pg.evaluate("""() => {
              const v = window.__app.view;
              return { q: window.__app.layers.quality, cols: v.voxMesh ? v.voxMesh.geometry.userData.cols : 0,
                       voxVerts: v.voxMesh ? v.voxMesh.geometry.attributes.position.count : 0,
                       shadowOn: v.u.uShadowOn.value, stepK: v.u.uStepK.value };
            }""")
            logs.append(f"[像素 × 画质 {q}] " + json.dumps(d, ensure_ascii=False) + (("  ERR:" + errs[0][:120]) if errs else ""))
        await pg.screenshot(path=os.path.join(OUT, 'r7_pixel_final.png'))

        # 下钻到市：像素模式重建 + 云重排
        errs.clear()
        await pg.evaluate("() => window.__app.pick(330100, '杭州市')")
        await pg.wait_for_function("() => window.__app.state.region && window.__app.state.region.id === '330100'", timeout=180000)
        await pg.wait_for_timeout(14000)
        await pg.evaluate("""() => { window.__app.quality('mid'); window.__app.layer('clouds', true); }""")
        await pg.wait_for_timeout(5000)
        d = await pg.evaluate("""() => {
          const v = window.__app.view, c = window.__app.clouds, wa = window.__app.water;
          return { region: v.region.name, span: [v.region.spanX.toFixed(0), v.region.spanY.toFixed(0)],
                   exag: v.params.exag, pixel: v.pixelMode,
                   voxCols: v.voxMesh ? v.voxMesh.geometry.userData.cols : 0,
                   cloudPuffs: c.puffs.length, cloudY: c.puffs.length ? +c.puffs[0].mesh.position.y.toFixed(1) : null,
                   waterHS: wa.mats.length ? +wa.mats[0].uniforms.uHS.value.toFixed(5) : null,
                   labels: window.__app.labels.items.filter(i => i.enabled).length };
        }""")
        logs.append("[市级] " + json.dumps(d, ensure_ascii=False) + (("  ERR:" + errs[0][:120]) if errs else ""))
        await pg.screenshot(path=os.path.join(OUT, 'r7_city_pixel.png'))

        # 经纬网 + 夸张联动的联测
        errs.clear()
        await pg.evaluate("() => { window.__app.layer('graticule', true); window.__app.view.setParam('exag', 11); }")
        await pg.wait_for_timeout(3000)
        d = await pg.evaluate("""() => {
          const g = window.__app.graticule, v = window.__app.view, wa = window.__app.water;
          return { gratVis: g.group.visible, gratVerts: g.mesh ? g.mesh.geometry.attributes.position.count : 0,
                   exag: v.params.exag, waterHS: wa.mats.length ? +wa.mats[0].uniforms.uHS.value.toFixed(5) : null,
                   labelLift: window.__app.layers.labelLift };
        }""")
        logs.append("[经纬网+夸张联动] " + json.dumps(d, ensure_ascii=False) + (("  ERR:" + errs[0][:120]) if errs else ""))
        await pg.screenshot(path=os.path.join(OUT, 'r7_city_exag11.png'))

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