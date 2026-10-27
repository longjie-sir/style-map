#!/usr/bin/env python3
"""标注错位专项：在同一帧里对照 JS 高度 / GPU uniform / 射线命中点。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

JS = r"""
() => {
  const app = window.__app, v = app.view, cam = v.camera;
  const W = v.el.clientWidth, H = v.el.clientHeight;
  const hs = v.u.uHeightScale.value;
  const out = [];
  for (const it of app.labels.items) {
    if (!it.enabled) continue;
    const r = it.el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const nx = (cx / W) * 2 - 1, ny = -(cy / H) * 2 + 1;
    const hit = v.pick(nx, ny);
    const w = v.lonLatToWorld(it.lon, it.lat);
    out.push({
      n: it.text, lv: it.level,
      disp: it.el.style.display || 'inline',
      sx: +cx.toFixed(0), sy: +cy.toFixed(0),
      surf: +v.surfaceYVisual(it.lon, it.lat).toFixed(2),
      hM: +v.heightAt(it.lon, it.lat).toFixed(0),
      hit: hit ? `${hit.lon.toFixed(2)},${hit.lat.toFixed(2)}` : null,
      dLon: hit ? +(hit.lon - it.lon).toFixed(2) : null,
      dLat: hit ? +(hit.lat - it.lat).toFixed(2) : null
    });
  }
  return {
    W, H, jsGrowth: +v.growth.toFixed(3), uGrowth: +v.u.uGrowth.value.toFixed(3),
    hs, exag: v.params.exag, camY: +cam.position.y.toFixed(1),
    target: [ +v.controls.target.x.toFixed(1), +v.controls.target.y.toFixed(1), +v.controls.target.z.toFixed(1) ],
    dist: +cam.position.distanceTo(v.controls.target).toFixed(1),
    span: [v.region.spanX.toFixed(0), v.region.spanY.toFixed(0)],
    kmLon: v.region.world.kmLon, labels: out
  };
}
"""

async def one(pg, tag, W, H):
    d = await pg.evaluate(JS)
    print(f"--- {tag} ---", flush=True)
    print(json.dumps(d, ensure_ascii=False, indent=1)[:4000], flush=True)
    await pg.screenshot(path=os.path.join(OUT, f'diagL_{tag}.png'))

async def main():
    logs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        for (W, H) in [(1080, 596), (1440, 900)]:
            pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
            pg.set_default_timeout(120000)
            pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
            await pg.goto(URL, wait_until='load')
            await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
            await pg.wait_for_timeout(15000)
            await one(pg, f'{W}_live', W, H)
            # 强制长满
            await pg.evaluate("() => { const v = window.__app.view; v.growth = 1; v.u.uGrowth.value = 1; window.__app.labels.update(); }")
            await pg.wait_for_timeout(600)
            await pg.evaluate("() => window.__app.labels.update()")
            await one(pg, f'{W}_full', W, H)
            # 拉远视角（模拟用户滚轮缩小）
            await pg.evaluate("""() => { const v = window.__app.view;
                const t = v.controls.target;
                const d = v.camera.position.clone().sub(t);
                d.multiplyScalar(2.2);
                v.camera.position.copy(t).add(d); v.controls.update(); }""")
            await pg.wait_for_timeout(600)
            await pg.evaluate("() => window.__app.labels.update()")
            await one(pg, f'{W}_far', W, H)
            await pg.close()
        await b.close()
    print('--- log ---', flush=True)
    print('\n'.join(dict.fromkeys(logs)), flush=True)
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
