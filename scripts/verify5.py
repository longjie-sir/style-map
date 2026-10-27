#!/usr/bin/env python3
"""第 5 轮验收：7 项问题逐条测量。

1 标注错位（含高 DPI）  2 像素：尺寸/配色  3 经纬网开关  4 水面随夸张
5 体积云（raymesh）      6 标注参数          7 性能/画质档
"""
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
        # ── A. 高 DPI：画布 CSS 尺寸必须等于视口 ──
        for dpr in (1, 2):
            pg = await b.new_page(viewport={'width': 1080, 'height': 596}, device_scale_factor=dpr)
            pg.set_default_timeout(150000)
            pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
            pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}") if m.type in ('error',) else None)
            await pg.goto(URL, wait_until='load')
            await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
            await pg.wait_for_timeout(15000)
            d = await pg.evaluate(r"""() => {
              const v = window.__app.view, c = v.renderer.domElement;
              const r = c.getBoundingClientRect();
              const lab = window.__app.labels.items.find(i => i.text === '浙江省');
              const lb = lab.el.getBoundingClientRect();
              const el = v.el.getBoundingClientRect();
              // 标注屏幕位置与射线命中点是否同一个经纬度
              const W = v.el.clientWidth, H = v.el.clientHeight;
              const nx = ((lb.left + lb.width/2) / W) * 2 - 1;
              const ny = -((lb.top + lb.height/2) / H) * 2 + 1;
              const hit = v.pick(nx, ny);
              return {
                dpr: devicePixelRatio,
                canvasCss: [Math.round(r.width), Math.round(r.height)],
                canvasAttr: [c.width, c.height],
                stage: [Math.round(el.width)],
                labelScreen: [Math.round(lb.left + lb.width/2), Math.round(lb.top + lb.height/2)],
                labelLL: [+lab.lon.toFixed(3), +lab.lat.toFixed(3)],
                hitLL: hit ? [+hit.lon.toFixed(3), +hit.lat.toFixed(3)] : null,
                dLon: hit ? +(hit.lon - lab.lon).toFixed(3) : null,
                dLat: hit ? +(hit.lat - lab.lat).toFixed(3) : null
              };
            }""")
            logs.append(f"[A dpr={dpr}] " + json.dumps(d, ensure_ascii=False))
            await pg.screenshot(path=os.path.join(OUT, f'r5_dpr{dpr}.png'))
            await pg.close()

        # ── B. 主流程（dpr=1）：像素 / 经纬网 / 水面 / 云 / 标注参数 / 画质 ──
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(150000)
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}") if m.type in ('error',) else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(15000)

        # 2. 像素：颜色 + 尺寸
        await pg.evaluate("() => window.__app.style('pixel')")
        await pg.wait_for_timeout(4000)
        pix0 = await pg.evaluate("""() => {
          const v = window.__app.view, g = v.voxMesh.geometry;
          const c = g.attributes.aColor.array;
          return { cols: g.userData.cols, verts: g.attributes.position.count,
                   color0: [+c[0].toFixed(3), +c[1].toFixed(3), +c[2].toFixed(3)],
                   pal: v.palette.name, hasColorAttr: !!g.attributes.aColor };
        }""")
        logs.append("[B2 像素 pal0] " + json.dumps(pix0, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r5_pixel_pal0.png'))
        # 换配色
        await pg.evaluate("""() => {
          const app = window.__app, st = app.view.style;
          app.panel.onPalette(2);
        }""")
        await pg.wait_for_timeout(3500)
        pix1 = await pg.evaluate("""() => {
          const v = window.__app.view, g = v.voxMesh.geometry;
          const c = g.attributes.aColor.array;
          return { pal: v.palette.name, color0: [+c[0].toFixed(3), +c[1].toFixed(3), +c[2].toFixed(3)] };
        }""")
        logs.append("[B2 像素 pal2] " + json.dumps(pix1, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r5_pixel_pal2.png'))
        # 方块尺寸
        await pg.evaluate("() => window.__app.view.setParam('voxCols', 200)")
        await pg.wait_for_timeout(2500)
        pix2 = await pg.evaluate("() => ({ cols: window.__app.view.voxMesh.geometry.userData.cols, verts: window.__app.view.voxMesh.geometry.attributes.position.count })")
        logs.append("[B2 方块尺寸 200] " + json.dumps(pix2, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r5_pixel_cols200.png'))
        await pg.evaluate("() => window.__app.view.setParam('voxCols', 104)")
        await pg.wait_for_timeout(2000)
        await pg.evaluate("() => window.__app.style('hypo')")
        await pg.wait_for_timeout(2500)

        # 3. 经纬网开关：模拟点击面板里的 checkbox
        grat = await pg.evaluate("""() => {
          const el = document.querySelector('input[data-layer="graticule"]');
          if (!el) return { found: false };
          el.click();
          const g = window.__app.graticule;
          return { found: true, checked: el.checked, layer: window.__app.layers.graticule,
                   visible: g.group.visible, verts: g.mesh ? g.mesh.geometry.attributes.position.count : 0 };
        }""")
        await pg.wait_for_timeout(1200)
        logs.append("[B3 经纬网开] " + json.dumps(grat, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r5_grat_on.png'))
        grat2 = await pg.evaluate("""() => {
          const el = document.querySelector('input[data-layer="graticule"]');
          el.click();
          return { checked: el.checked, layer: window.__app.layers.graticule, visible: window.__app.graticule.group.visible };
        }""")
        logs.append("[B3 经纬网关] " + json.dumps(grat2, ensure_ascii=False))

        # 4. 水面随夸张
        w0 = await pg.evaluate("""() => {
          const wa = window.__app.water, v = window.__app.view;
          const a = wa.meshRivers ? wa.meshRivers.geometry.attributes.position.array : null;
          return { exag: v.params.exag, hs: +v.u.uHeightScale.value.toFixed(5),
                   uHS: a ? +wa.mats[0].uniforms.uHS.value.toFixed(5) : null,
                   y0: a ? +a[1].toFixed(1) : null };
        }""")
        await pg.evaluate("() => window.__app.view.setParam('exag', 13)")
        await pg.wait_for_timeout(1500)
        w1 = await pg.evaluate("""() => {
          const wa = window.__app.water, v = window.__app.view;
          const a = wa.meshRivers.geometry.attributes.position.array;
          return { exag: v.params.exag, hs: +v.u.uHeightScale.value.toFixed(5),
                   uHS: +wa.mats[0].uniforms.uHS.value.toFixed(5),
                   y0: +a[1].toFixed(1) };
        }""")
        logs.append("[B4 水面 exag前] " + json.dumps(w0, ensure_ascii=False))
        logs.append("[B4 水面 exag后] " + json.dumps(w1, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r5_water_exag13.png'))
        await pg.evaluate("() => window.__app.view.setParam('exag', 5.5)")
        await pg.wait_for_timeout(1200)

        # 5. 体积云
        cl = await pg.evaluate("""() => {
          const c = window.__app.clouds;
          window.__app.layer('clouds', true);
          return { on: c.enabled, puffs: c.puffs.length, vis: c.group.visible,
                   steps: c.puffs.length ? c.puffs[0].mesh.material.uniforms.uSteps.value : 0 };
        }""")
        await pg.wait_for_timeout(4000)
        cl2 = await pg.evaluate("() => ({ puffs: window.__app.clouds.puffs.length, vis: window.__app.clouds.group.visible })")
        logs.append("[B5 体积云] " + json.dumps({**cl, **cl2}, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'r5_clouds.png'))
        # 手动放置
        placed = await pg.evaluate("""() => {
          const app = window.__app, r = app.view.region, b = r.bbox;
          app.place((b.west + b.east) / 2, (b.south + b.north) / 2);
          return app.cloudN();
        }""")
        await pg.wait_for_timeout(2500)
        logs.append(f"[B5 手动放置后] {placed}")
        await pg.screenshot(path=os.path.join(OUT, 'r5_clouds_place.png'))

        # 6. 标注参数
        lb = await pg.evaluate("""() => {
          const app = window.__app;
          app.labels.setOptions({ scale: 1.6, weight: 300, spacing: 0.4, color: '#fff6e0',
            outlineW: 6, outlColor: '#0b1c2c', maxCount: 8, align: 'bottom' });
          const it = app.labels.items[0], cs = getComputedStyle(it.el);
          return { families: cs.fontWeight, color: cs.color, shadow: cs.textShadow.slice(0, 40),
                   cls: app.labels.root.className };
        }""")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(OUT, 'r5_labels_custom.png'))
        logs.append("[B6 标注参数] " + json.dumps(lb, ensure_ascii=False))
        await pg.evaluate("""() => window.__app.labels.setOptions({ scale: 1, weight: 700, spacing: 0.16,
          color: '#ffffff', outlineW: 3, outlColor: '#101010', maxCount: 26, align: 'center' })""")
        await pg.wait_for_timeout(700)

        # 7. 画质档 + 帧率
        for q in ('mid', 'low', 'high'):
            await pg.evaluate("q => window.__app.quality(q)", q)
            await pg.wait_for_timeout(3500)
            d = await pg.evaluate("""() => {
              const v = window.__app.view, c = v.renderer.domElement;
              return { q: window.__app.layers.quality, seg: window.__app.view.mesh.geometry.attributes.position.count,
                       shadowOn: v.u.uShadowOn.value, stepK: v.u.uStepK.value,
                       cloudSteps: window.__app.clouds.puffs.length ? window.__app.clouds.puffs[0].mesh.material.uniforms.uSteps.value : null,
                       cvs: [c.width, c.height] };
            }""")
            logs.append(f"[B7 画质 {q}] " + json.dumps(d, ensure_ascii=False))
            await pg.screenshot(path=os.path.join(OUT, f'r5_q_{q}.png'))

        # 帧率显示
        await pg.evaluate("() => window.__app.layer('showFps', true)")
        await pg.wait_for_timeout(1500)
        fps = await pg.evaluate("() => document.getElementById('fps').textContent")
        logs.append(f"[B7 帧率显示] {fps}")

        # 低画质 + 垂直夸张下的整体观感图
        await pg.evaluate("() => { window.__app.quality('mid'); window.__app.layer('graticule', true); }")
        await pg.wait_for_timeout(3500)
        await pg.screenshot(path=os.path.join(OUT, 'r5_final.png'))

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