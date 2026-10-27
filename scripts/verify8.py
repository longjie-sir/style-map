#!/usr/bin/env python3
"""第 8 轮验收：区域选择器 / 云方案 / 页面背景 / 画框与框内经纬网。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
logs = []


def emit():
    print('\n'.join(dict.fromkeys(logs)), flush=True)


FRAMES = """async (ms) => {
  const t = [];
  const t0 = performance.now();
  await new Promise((res) => {
    const step = (ts) => { t.push(ts); if (ts - t0 > ms) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  const d = [];
  for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  d.sort((a, b) => a - b);
  return { n: d.length, med: +d[d.length >> 1].toFixed(1), p90: +d[Math.min(d.length - 1, Math.floor(d.length * 0.9))].toFixed(1) };
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        errs = []
        pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(14000)
        logs.append('[加载] ' + ('OK，无报错' if not errs else 'ERR: ' + errs[0][:220]))

        # ── 1. 画框 / 经纬网 ──
        d = await pg.evaluate("""() => {
          const f = window.__app.frame, v = window.__app.view, L = window.__app.layers;
          const cv = f.canvas;
          let nonEmpty = 0;
          if (cv) {
            const g = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            for (let i = 3; i < g.length; i += 4 * 97) if (g[i] > 4) nonEmpty++;
            nonEmpty = +(nonEmpty / (g.length / (4 * 97))).toFixed(3);
          }
          return { frameOn: L.frameOn, style: L.frameStyle, grat: L.graticule,
                   mesh: !!f.mesh, visible: f.group.visible,
                   canvas: cv ? [cv.width, cv.height] : null, inkRatio: nonEmpty,
                   y: f.mesh ? +f.mesh.position.y.toFixed(2) : null,
                   size: f.mesh ? [+f.mesh.scale.x.toFixed(0), +f.mesh.scale.z.toFixed(0)] : null,
                   spanKm: [+v.region.spanX.toFixed(0), +v.region.spanY.toFixed(0)] };
        }""")
        logs.append('[画框] ' + json.dumps(d, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'v8_frame_mat.png'))

        for st in ('thin', 'double', 'bevel'):
            await pg.evaluate("s => window.__app.layer('frameStyle', s)", st)
            await pg.wait_for_timeout(500)
            await pg.screenshot(path=os.path.join(OUT, f'v8_frame_{st}.png'))
        await pg.evaluate("() => window.__app.layer('frameStyle', 'mat')")

        # 关闭画框 → 经纬网应一起消失；再开经纬网 → 画框应自动回来
        await pg.evaluate("() => window.__app.layer('frameOn', false)")
        await pg.wait_for_timeout(400)
        a = await pg.evaluate("""() => ({ vis: window.__app.frame.group.visible,
          grat: window.__app.layers.graticule, meshNull: !window.__app.frame.mesh })""")
        await pg.evaluate("() => window.__app.layer('graticule', true)")
        await pg.wait_for_timeout(700)
        c = await pg.evaluate("""() => ({ frameOn: window.__app.layers.frameOn,
          vis: window.__app.frame.group.visible, grat: window.__app.frame.grat })""")
        logs.append('[框/网格联动] 关框→ ' + json.dumps(a, ensure_ascii=False)
                    + ' | 开网格→ ' + json.dumps(c, ensure_ascii=False))

        # ── 2. 云方案 ──
        await pg.evaluate("""() => {
          window.__app.quality('high');
          window.__app.layers.cloudMode = 'volume';
          window.__app.layer('clouds', true);
        }""")
        await pg.wait_for_timeout(5000)
        volInfo = await pg.evaluate("""() => { const c = window.__app.clouds;
          return { mode: c.mode, puffs: c.puffs.length,
                   steps: c.puffs[0] ? c.puffs[0].mesh.material.uniforms.uSteps.value : 0,
                   glsl: c.puffs[0] ? c.puffs[0].mesh.material.glslVersion : null }; }""")
        await pg.screenshot(path=os.path.join(OUT, 'v8_cloud_volume.png'))

        await pg.evaluate("() => window.__app.layer('cloudMode', 'plane')")
        await pg.wait_for_timeout(2500)
        planeInfo = await pg.evaluate("""() => ({ mode: window.__app.clouds.mode,
          sheets: window.__app.clouds.sheets.length })""")
        await pg.screenshot(path=os.path.join(OUT, 'v8_cloud_plane.png'))
        await pg.evaluate("() => window.__app.layer('clouds', false)")
        await pg.wait_for_timeout(800)
        logs.append('[云方案] 体积 ' + json.dumps(volInfo, ensure_ascii=False)
                    + ' | 平面 ' + json.dumps(planeInfo, ensure_ascii=False))

        # 小视口 A/B：把地形开销压下去，云增加的耗时才测得出来（软件渲染，只看相对值）
        await pg.set_viewport_size({'width': 700, 'height': 440})
        await pg.wait_for_timeout(2600)
        rows = []
        for name, js in (
            ('无云', "() => window.__app.layer('clouds', false)"),
            ('体积云', "() => { window.__app.layers.cloudMode='volume'; window.__app.layer('clouds', true); }"),
            ('平面云', "() => { window.__app.layers.cloudMode='plane'; window.__app.layer('clouds', true); }"),
        ):
            await pg.evaluate(js)
            await pg.wait_for_timeout(2600)
            m = await pg.evaluate(FRAMES, 2200)
            rows.append((name, m))
        logs.append('[云耗时·700x440] ' + ' | '.join(f'{n} med={m["med"]}ms n={m["n"]}' for n, m in rows))
        await pg.set_viewport_size({'width': 1440, 'height': 900})
        await pg.wait_for_timeout(2500)

        # ── 3. 页面背景 ──
        bg = []
        for mode in ('plain', 'off', 'theme'):
            await pg.evaluate("m => window.__app.layer('bgMode', m)", mode)
            await pg.wait_for_timeout(750)      # body 有 .5s 过渡，读太早拿到的是旧值
            s = await pg.evaluate("() => getComputedStyle(document.body).backgroundImage + ' || ' + getComputedStyle(document.body).backgroundColor")
            bg.append(f'{mode}={s}')
        await pg.evaluate("() => window.__app.layer('bgColor', '#dfe3e6')")
        await pg.wait_for_timeout(300)
        await pg.evaluate("() => window.__app.layer('bgMode', 'plain')")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(OUT, 'v8_bg_plain.png'))
        logs.append('[页面背景] ' + ' ; '.join(bg))
        await pg.evaluate("() => window.__app.layer('bgMode', 'theme')")

        # ── 4. 区域选择器 ──
        await pg.click('#regionBtn')
        await pg.wait_for_timeout(600)
        s1 = await pg.evaluate("""() => ({ open: document.getElementById('regionMenu').classList.contains('open'),
          lv2: document.querySelector('#rmLevels button[data-lv="2"]').disabled,
          sel: document.getElementById('rmSel').textContent.trim(),
          okDisabled: document.getElementById('rmOk').disabled })""")
        # 进入市级列表 → 选杭州（只选中，不应重载）
        await pg.click('#rmLevels button[data-lv="2"]')
        await pg.wait_for_timeout(2500)
        names = await pg.evaluate("() => [...document.querySelectorAll('#regionGrid button')].map(b => b.textContent)")
        target = '杭州' if any('杭州' in n for n in names) else (names[0] if names else None)
        if target:
            await pg.click(f'#regionGrid button:has-text("{target}")')
        await pg.wait_for_timeout(1200)
        s2 = await pg.evaluate("""() => ({ region: window.__app.state.region.name,
          sel: document.getElementById('rmSel').textContent.trim(),
          okDisabled: document.getElementById('rmOk').disabled,
          lv3: document.querySelector('#rmLevels button[data-lv="3"]').disabled,
          gridN: document.querySelectorAll('#regionGrid button').length })""")
        await pg.screenshot(path=os.path.join(OUT, 'v8_picker.png'))
        # 直接确认
        await pg.click('#rmOk')
        await pg.wait_for_function("window.__app.state.region.name.includes('杭州')", timeout=180000)
        await pg.wait_for_timeout(9000)
        s3 = await pg.evaluate("""() => ({ region: window.__app.state.region.name,
          span: [+window.__app.view.region.spanX.toFixed(0), +window.__app.view.region.spanY.toFixed(0)],
          frame: !!window.__app.frame.mesh,
          frameSize: window.__app.frame.mesh ? [+window.__app.frame.mesh.scale.x.toFixed(0), +window.__app.frame.mesh.scale.z.toFixed(0)] : null,
          menuOpen: document.getElementById('regionMenu').classList.contains('open') })""")
        logs.append('[选择器] 打开 ' + json.dumps(s1, ensure_ascii=False)
                    + ' | 选中后 ' + json.dumps(s2, ensure_ascii=False)
                    + ' | 确定后 ' + json.dumps(s3, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'v8_city.png'))

        logs.append('[最终] ' + ('无报错' if not errs else 'ERR: ' + errs[0][:200]))
        await pg.close()
        await b.close()
    emit()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:500], flush=True)
    emit()
    sys.stdout.flush()
    os._exit(1)
