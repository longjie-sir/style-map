#!/usr/bin/env python3
"""离岛/飞地边界：完整验收（海南 · 三沙 · 浙江对照）。"""
import asyncio, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'shots')
os.makedirs(OUT, exist_ok=True)

STAT = """() => {
  const r = window.__app.state.region, v = window.__app.view;
  const cnt = (o) => { let n = 0; o && o.traverse(x => { if (x.geometry && x.geometry.attributes.position) n += x.geometry.attributes.position.count; }); return n; };
  return {
    id: r.id, name: r.name,
    polys: r.polys.length, far: (r.farPolys || []).length,
    borders: (r.borders || []).length,
    bboxKm: [Math.round(r.spanX), Math.round(r.spanY)],
    allKm: r.allBBox ? [Math.round((r.allBBox.east - r.allBBox.west) * r.world.kmLon),
                        Math.round((r.allBBox.north - r.allBBox.south) * r.world.kmLat)] : null,
    isletCount: v.isletCount,
    isletVis: !!(v.isletGroup && v.isletGroup.visible),
    isletVerts: cnt(v.isletGroup),
    borderVerts: cnt(v.borderGroup),
    target: [Math.round(v.controls.target.x), Math.round(v.controls.target.z)],
    camY: Math.round(v.camera.position.y),
  };
}"""


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
        await pg.wait_for_timeout(6000)

        async def pick(code, name, wait=14000):
            await pg.evaluate(f"() => window.__app.pick('{code}', '{name}')")
            await pg.wait_for_function(f"window.__app.state.region.id === '{code}'", timeout=300000)
            await pg.wait_for_timeout(wait)

        async def ev(src, wait=2200):
            await pg.evaluate(src.replace('$R', 'window.__app'))
            await pg.wait_for_timeout(wait)

        async def shot(name):
            await pg.screenshot(path=os.path.join(OUT, name))
            print('  shot', name, flush=True)

        async def stat(tag):
            st = await pg.evaluate(STAT)
            print(tag, json.dumps(st, ensure_ascii=False), flush=True)
            return st

        # ── 海南 ──
        await pick('460000', '海南省')
        await ev("() => { $R.layer('isletView','main'); $R.view.frameCamera(); }", 3200)
        await stat('海南/主图')
        await shot('p46_hainan_main.png')

        await ev("() => $R.layer('isletView','all')", 3600)
        await stat('海南/全图')
        await shot('p46_hainan_all.png')

        await ev("() => $R.layer('islets', false)", 1600)
        st = await stat('海南/关离岛')
        assert st['isletVis'] is False, '关闭后离岛仍可见'
        await shot('p46_hainan_off.png')
        await ev("() => $R.layer('islets', true)", 1400)
        st = await stat('海南/再开')
        assert st['isletVis'] is True, '重新开启失败'

        # ── 三沙市 ──
        await pick('460300', '三沙市', 16000)
        await ev("() => { $R.layer('isletView','main'); $R.view.frameCamera(); }", 3200)
        await stat('三沙/主图')
        await shot('p46_sansha_main.png')
        await ev("() => $R.layer('isletView','all')", 3600)
        await stat('三沙/全图')
        await shot('p46_sansha_all.png')

        # ── 浙江对照（不应被改动影响）──
        await pick('330000', '浙江省', 16000)
        await ev("() => { $R.layer('isletView','main'); $R.view.frameCamera(); }", 3200)
        await stat('浙江/主图')
        await shot('p46_zhejiang.png')

        print('[errs]', errs, flush=True)
        assert not errs, '控制台有错误'
        print('ALL OK', flush=True)
        await b.close()


asyncio.run(main())
