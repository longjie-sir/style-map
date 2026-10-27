#!/usr/bin/env python3
"""第 7 轮调查：①「那块蓝色」到底是什么 ② 点省级会不会立刻切换。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))


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
        await pg.wait_for_timeout(13000)

        # ---------- ① 蓝色块 ----------
        info = await pg.evaluate("""() => {
          const v = window.__app.view;
          const s = v.sea;
          const out = { seaVisible: !!s && s.visible, bd: !!window.__app.backdrop.enabled,
                        bgMode: window.__app.layers.bgMode };
          if (s) {
            s.geometry.computeBoundingBox();
            const bb = s.geometry.boundingBox;
            out.seaSize = [+(bb.max.x-bb.min.x).toFixed(1), +(bb.max.z-bb.min.z).toFixed(1)];
            out.seaY = +(bb.max.y-bb.min.y).toFixed(2);
            out.seaColor = s.material.uniforms ? null : s.material.color.getHexString();
            out.seaUni = s.material.uniforms ? Object.keys(s.material.uniforms) : null;
          }
          return out;
        }""")
        print('[蓝色调查]', json.dumps(info, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p11_theme.png'))
        await pg.evaluate("() => { window.__app.view.sea.visible = false; }")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(OUT, 'p11_theme_nosea.png'))

        # 采样几个"地图以外"的像素，看是不是蓝
        await pg.evaluate("() => { window.__app.view.sea.visible = true; }")
        await pg.wait_for_timeout(600)
        px = await pg.evaluate("""() => {
          const c = document.querySelector('canvas');
          const g = c.getContext('webgl2') || c.getContext('webgl');
          return g ? 'gl-ok' : 'no-gl';
        }""")
        print('[gl]', px, flush=True)

        # ---------- ② 选择器：点省级 ----------
        state0 = await pg.evaluate("() => ({ code: window.__app.state.region.code, name: window.__app.state.region.name })")
        await pg.click('#regionBtn')
        await pg.wait_for_timeout(1200)
        # 记录第一条省
        first = await pg.evaluate("""() => {
          const bs = [...document.querySelectorAll('#regionGrid button[data-code]')];
          return { n: bs.length, first: bs[0] ? { code: bs[0].dataset.code, txt: bs[0].textContent } : null };
        }""")
        print('[列表]', json.dumps(first, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p11_menu1.png'))

        # 单击第一条（省），什么都不确定
        await pg.evaluate("""() => {
          const bs = [...document.querySelectorAll('#regionGrid button[data-code]')];
          bs[3].click();
        }""")
        await pg.wait_for_timeout(2200)
        state1 = await pg.evaluate("() => ({ code: window.__app.state.region.code, name: window.__app.state.region.name })")
        after = await pg.evaluate("""() => {
          const bs = [...document.querySelectorAll('#regionGrid button[data-code]')];
          return { n: bs.length, sample: bs.slice(0,4).map(x=>x.textContent),
                   level: [...document.querySelectorAll('#rmLevels button')].find(b=>b.classList.contains('on'))?.textContent,
                   crumb: document.getElementById('rmCrumb').textContent,
                   sel: document.getElementById('rmSel').textContent,
                   okDisabled: document.getElementById('rmOk').disabled,
                   open: document.getElementById('regionMenu').classList.contains('open') };
        }""")
        print('[点省前]', json.dumps(state0, ensure_ascii=False), flush=True)
        print('[点省后]', json.dumps(state1, ensure_ascii=False), '| 菜单', json.dumps(after, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p11_menu2.png'))

        print('[errs]', errs[:5], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
