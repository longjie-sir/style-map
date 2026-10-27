#!/usr/bin/env python3
"""复测：像素配色 / 描边生效 / 画质档 / 体积云观感。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
logs = []


def emit():
    print('\n'.join(dict.fromkeys(logs)), flush=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(150000)
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}") if m.type in ('error',) else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(15000)

        # ── 像素配色：取「真正落在地块上」的顶点色，比较不同配色 ──
        await pg.evaluate("() => window.__app.style('pixel')")
        await pg.wait_for_timeout(4000)
        async def sample():
            return await pg.evaluate("""() => {
              const v = window.__app.view, g = v.voxMesh.geometry;
              const c = g.attributes.aColor.array, p = g.attributes.position.array;
              // 取内陆某点：区域内、离海最远 —— 用经纬度落在 bbox 中心附近且高度 > 100m 的顶点
              const b = v.region.bbox;
              let best = null;
              for (let i = 0; i < p.length / 3; i += 37) {
                const lon = p[i*3] / v.region.world.kmLon + (b.west + b.east) / 2;
                const lat = (b.south + b.north) / 2 - p[i*3+2] / v.region.world.kmLat;
                const h = v.heightAt(lon, lat);
                if (h > 180 && h < 600) { best = i; break; }
              }
              if (best === null) best = 40;
              const j = best * 3;
              return { pal: v.palette.name, rgb: [+c[j].toFixed(3), +c[j+1].toFixed(3), +c[j+2].toFixed(3)] };
            }""")
        a0 = await sample()
        logs.append("[像素 pal0] " + json.dumps(a0, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r6_pix_pal0.png'))
        await pg.evaluate("() => window.__app.panel.onPalette(1)")
        await pg.wait_for_timeout(3500)
        a1 = await sample()
        logs.append("[像素 pal1] " + json.dumps(a1, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r6_pix_pal1.png'))
        await pg.evaluate("() => window.__app.panel.onPalette(2)")
        await pg.wait_for_timeout(3500)
        a2 = await sample()
        logs.append("[像素 pal2] " + json.dumps(a2, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r6_pix_pal2.png'))
        logs.append("[配色差异] " + json.dumps({
            "pal0_vs_pal1": [round(a0['rgb'][k] - a1['rgb'][k], 3) for k in range(3)],
            "pal0_vs_pal2": [round(a0['rgb'][k] - a2['rgb'][k], 3) for k in range(3)]}, ensure_ascii=False))

        # 方块尺寸对比图
        await pg.evaluate("() => window.__app.panel.onPalette(0)")
        await pg.wait_for_timeout(2500)
        for cols in (64, 160):
            await pg.evaluate("c => window.__app.view.setParam('voxCols', c)", cols)
            await pg.wait_for_timeout(2600)
            await pg.screenshot(path=os.path.join(OUT, f'r6_pix_cols{cols}.png'))

        await pg.evaluate("() => window.__app.style('hypo')")
        await pg.wait_for_timeout(2500)

        # ── 描边生效：读计算样式里的 text-shadow ──
        def testOutline():
            return """() => {
              const app = window.__app;
              const it = app.labels.items[0];
              app.labels.setOptions({ outline: 1, outlineW: 6, outlColor: '#0b1c2c', outlAlpha: 0.9 });
              const s1 = getComputedStyle(it.el).textShadow;
              app.labels.setOptions({ outline: 0 });
              const s2 = getComputedStyle(it.el).textShadow;
              app.labels.setOptions({ outline: 1, outlineW: 3, outlColor: '#101010', outlAlpha: 0.92 });
              return { withOutline: s1.slice(0, 90), off: s2 };
            }"""
        ol = await pg.evaluate(testOutline())
        await pg.wait_for_timeout(600)
        logs.append("[描边] " + json.dumps(ol, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r6_label_outline.png'))

        # ── 画质档（这次不报错为准）──
        for q in ('low', 'mid', 'high'):
            await pg.evaluate("q => window.__app.quality(q)", q)
            await pg.wait_for_timeout(3200)
            d = await pg.evaluate("""() => {
              const v = window.__app.view, c = v.renderer.domElement;
              return { q: window.__app.layers.quality, tris: v.mesh.geometry.attributes.position.count,
                       shadowOn: v.u.uShadowOn.value, stepK: v.u.uStepK.value,
                       cvs: [c.width, c.height], dpr: devicePixelRatio };
            }""")
            logs.append(f"[画质 {q}] " + json.dumps(d, ensure_ascii=False))
            await pg.screenshot(path=os.path.join(OUT, f'r6_q_{q}.png'))

        # ── 体积云观感（中画质 + 云）──
        await pg.evaluate("""() => {
          window.__app.quality('mid');
          window.__app.layer('clouds', true);
        }""")
        await pg.wait_for_timeout(6000)
        await pg.screenshot(path=os.path.join(OUT, 'r6_clouds.png'))
        cc = await pg.evaluate("""() => {
          const c = window.__app.clouds;
          return { puffs: c.puffs.length, steps: c.puffs.length ? c.puffs[0].mesh.material.uniforms.uSteps.value : 0,
                   y: c.puffs.length ? +c.puffs[0].mesh.position.y.toFixed(1) : null,
                   r: c.puffs.length ? +c.puffs[0].mesh.scale.x.toFixed(1) : null };
        }""")
        logs.append("[体积云] " + json.dumps(cc, ensure_ascii=False))

        # ── 最终整体图 ──
        await pg.evaluate("""() => {
          window.__app.layer('graticule', true);
          window.__app.layer('showFps', true);
        }""")
        await pg.wait_for_timeout(3000)
        fps = await pg.evaluate("() => document.getElementById('fps').textContent")
        logs.append("[帧率] " + fps)
        await pg.screenshot(path=os.path.join(OUT, 'r6_final.png'))

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