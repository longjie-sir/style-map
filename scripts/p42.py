#!/usr/bin/env python3
"""验证：远岛 / 飞地（三沙）在没有 DEM 的情况下也要显示边界。"""
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
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        pg.set_default_timeout(300000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=300000)
        await pg.wait_for_timeout(6000)

        async def ev(src, wait=1200):
            await pg.evaluate(src.replace('$R', 'window.__app'))
            if wait:
                await pg.wait_for_timeout(wait)

        async def shot(name):
            await pg.screenshot(path=os.path.join(OUT, name))
            print('  shot', name, flush=True)

        # ── 切到海南省 ──
        await ev("() => $R.pick('460000', '海南省')", 0)
        await pg.wait_for_function("window.__app.state.region.id === '460000'", timeout=300000)
        await pg.wait_for_timeout(14000)

        st = await pg.evaluate("""() => {
          const r = window.__app.state.region, v = window.__app.view;
          const cnt = (o) => { let n = 0; o && o.traverse(x => { if (x.geometry && x.geometry.attributes.position) n += x.geometry.attributes.position.count; }); return n; };
          return {
            name: r.name,
            polys: r.polys.length,
            far: (r.farPolys || []).length,
            farRings: (r.farRings || []).length,
            borders: (r.borders || []).length,
            bbox: r.bbox, allBBox: r.allBBox,
            isletCount: v.isletCount,
            isletVisible: !!(v.isletGroup && v.isletGroup.visible),
            isletVerts: cnt(v.isletGroup),
            borderVerts: cnt(v.borderGroup),
            outlineVerts: cnt(v.outlineGroup),
            panelHasGroup: !!document.querySelector('input[data-layer="islets"]'),
          };
        }""")
        print(json.dumps(st, ensure_ascii=False, indent=2), flush=True)

        # 主图取景
        await ev("() => { window.__app.layer('isletView','main'); window.__app.view.frameCamera(); }", 2600)
        await shot('p42_main.png')

        # 含离岛取景
        await ev("() => { window.__app.layer('isletView','all'); }", 2600)
        await shot('p42_all.png')

        # 关掉离岛图层，应看不到
        await ev("() => { window.__app.layer('islets', false); }", 1200)
        await shot('p42_off.png')
        await ev("() => { window.__app.layer('islets', true); }", 800)

        # 三沙市本身
        await ev("() => $R.pick('460300', '三沙市')", 0)
        try:
            await pg.wait_for_function("window.__app.state.region.id === '460300'", timeout=180000)
            await pg.wait_for_timeout(14000)
            st2 = await pg.evaluate("""() => {
              const r = window.__app.state.region, v = window.__app.view;
              return { name: r.name, polys: r.polys.length, far: (r.farPolys||[]).length,
                       borders: (r.borders||[]).length, span: [r.spanX|0, r.spanY|0],
                       bbox: r.bbox, all: r.allBBox, isletCount: v.isletCount };
            }""")
            print('三沙:', json.dumps(st2, ensure_ascii=False), flush=True)
            await shot('p42_sansha.png')
            await ev("() => { window.__app.layer('isletView','all'); }", 2600)
            await shot('p42_sansha_all.png')
        except Exception as e:
            print('三沙载入失败:', e, flush=True)

        print('[errs]', errs, flush=True)
        await b.close()


asyncio.run(main())
