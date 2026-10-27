#!/usr/bin/env python3
"""诊断：标注位置 / 经纬网 / 水面随夸张 / 像素配色 四处硬问题。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
W, H = 1440, 900

JS_LABELS = r"""
() => {
  const app = window.__app, v = app.view;
  const hs = v.u.uHeightScale.value;
  const out = [];
  for (const it of app.labels.items) {
    if (!it.enabled) continue;
    const w = v.lonLatToWorld(it.lon, it.lat);
    const ySurf = v.surfaceYVisual(it.lon, it.lat);
    const mLon = it.el.style.transform;
    const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(mLon);
    const sx = m ? parseFloat(m[1]) : null, sy = m ? parseFloat(m[2]) : null;
    const nx = sx == null ? null : (sx / v.el.clientWidth) * 2 - 1;
    const ny = sy == null ? null : -(sy / v.el.clientHeight) * 2 + 1;
    const hit = (nx == null) ? null : v.pick(nx, ny);
    out.push({
      name: it.text, level: it.level,
      lon: +it.lon.toFixed(3), lat: +it.lat.toFixed(3),
      hM: +v.heightAt(it.lon, it.lat).toFixed(0),
      ySurf: +ySurf.toFixed(2),
      sx: sx && +sx.toFixed(0), sy: sy && +sy.toFixed(0),
      hitLon: hit ? +hit.lon.toFixed(3) : null,
      hitLat: hit ? +hit.lat.toFixed(3) : null
    });
  }
  return { hs, growth: v.growth, exag: v.params.exag, H: v.el.clientHeight, items: out };
}
"""

JS_GRAT = r"""
() => {
  const g = window.__app.graticule;
  window.__app.layer('graticule', true);
  const m = g.mesh;
  return {
    enabled: g.enabled, hasLines: !!g.hasLines,
    groupVisible: g.group.visible, inWorld: !!g.group.parent,
    verts: m ? m.geometry.attributes.position.count : 0,
    mat: !!g.mat, matOpacity: g.mat ? g.mat.opacity : null,
    bbox: m ? (m.geometry.computeBoundingBox(), m.geometry.boundingBox.min.y.toFixed(1) + '~' + m.geometry.boundingBox.max.y.toFixed(1)) : null,
    step: g.step
  };
}
"""

JS_WATER = r"""
() => {
  const app = window.__app, v = app.view, wa = app.water;
  const before = wa.meshRivers ? wa.meshRivers.geometry.attributes.position.array.slice(0, 90) : null;
  const mats = wa.mats.map(m => ({ hs: m.uniforms.uHS ? m.uniforms.uHS.value : null }));
  const probe = (lon, lat) => {
    const w = v.lonLatToWorld(lon, lat);
    return { surf: +v.surfaceY(w.x, w.z).toFixed(2) };
  };
  return {
    exag: v.params.exag, hs: v.u.uHeightScale.value,
    lakeVerts: wa.meshLakes ? wa.meshLakes.geometry.attributes.position.count : 0,
    riverVerts: wa.meshRivers ? wa.meshRivers.geometry.attributes.position.count : 0,
    firstRiverY: before ? [before[1], before[4]] : null,
    mats,
    stats: wa.stats
  };
}
"""

JS_PIX = r"""
() => {
  const app = window.__app, v = app.view;
  const key = window.__pixKey || '';
  return {
    pixelMode: v.pixelMode,
    voxVerts: v.voxMesh ? v.voxMesh.geometry.attributes.position.count : 0,
    paletteIdx: app.state.palIndex,
    palName: v.palette && v.palette.name,
    colorAttr: v.voxMesh ? !!v.voxMesh.geometry.attributes.color : false,
    firstColors: v.voxMesh && v.voxMesh.geometry.attributes.color
      ? Array.from(v.voxMesh.geometry.attributes.color.array.slice(0, 12)).map(x => +x.toFixed(3)) : null
  };
}
"""


async def main():
    logs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        pg.set_default_timeout(120000)
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}") if m.type in ('error', 'warning') else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(7000)

        print("=== 标注位置 ===", flush=True)
        print(json.dumps(await pg.evaluate(JS_LABELS), ensure_ascii=False, indent=1), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'diag_labels.png'))

        print("=== 经纬网 ===", flush=True)
        print(json.dumps(await pg.evaluate(JS_GRAT), ensure_ascii=False), flush=True)
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(OUT, 'diag_grat.png'))

        print("=== 水面 ===", flush=True)
        print(json.dumps(await pg.evaluate(JS_WATER), ensure_ascii=False), flush=True)
        await pg.evaluate("() => window.__app.view.setParam('exag', 12)")
        await pg.wait_for_timeout(1200)
        print("exag=12 ->", json.dumps(await pg.evaluate(JS_WATER), ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'diag_water_exag12.png'))

        print("=== 像素 ===", flush=True)
        await pg.evaluate("() => window.__app.view.setParam('exag', 5.5)")
        await pg.evaluate("() => window.__app.style('pixel')")
        await pg.wait_for_timeout(3500)
        print("pal0", json.dumps(await pg.evaluate(JS_PIX), ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'diag_pix0.png'))
        await pg.evaluate("""() => {
          const app = window.__app;
          app.state.palIndex = 1;
          const st = app.view.style;
          app.view.setStyle(st, st.palettes[1], false);
        }""")
        await pg.wait_for_timeout(2500)
        print("pal1", json.dumps(await pg.evaluate(JS_PIX), ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'diag_pix1.png'))

        await b.close()
    seen, out = set(), []
    for l in logs:
        k = l[:160]
        if k in seen: continue
        seen.add(k); out.append(l)
    print('--- log ---', flush=True)
    print('\n'.join(out[:40]), flush=True)
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
