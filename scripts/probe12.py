#!/usr/bin/env python3
"""第 7 轮验收 A：三列级联选择器 + 蓝色块已移除。"""
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
        await pg.wait_for_timeout(12000)

        st = await pg.evaluate("""() => ({ sea: window.__app.view.sea, region: window.__app.state.region.id })""")
        print('[初始]', json.dumps(st, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p12_nosea.png'))

        # 打开菜单
        await pg.click('#regionBtn')
        await pg.wait_for_timeout(1500)
        cols = await pg.evaluate("""() => ({
          prov: document.querySelectorAll('#rmProv button').length,
          city: document.querySelectorAll('#rmCity button').length,
          cnty: document.querySelectorAll('#rmCnty button').length,
          provCur: [...document.querySelectorAll('#rmProv button.cur')].map(x=>x.textContent),
          w: document.getElementById('regionMenu').getBoundingClientRect().width
        })""")
        print('[打开]', json.dumps(cols, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p12_menu_open.png'))

        # 点第 4 个省（山西），只选不切
        await pg.evaluate("() => document.querySelectorAll('#rmProv button')[3].click()")
        await pg.wait_for_timeout(1800)
        a = await pg.evaluate("""() => ({
          rid: window.__app.state.region.id,
          city: document.querySelectorAll('#rmCity button').length,
          citySample: [...document.querySelectorAll('#rmCity button')].slice(0,3).map(x=>x.textContent),
          cnty: document.querySelectorAll('#rmCnty button').length,
          sel: document.getElementById('rmSel').textContent,
          ok: !document.getElementById('rmOk').disabled,
          open: document.getElementById('regionMenu').classList.contains('open')
        })""")
        print('[点省]', json.dumps(a, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p12_menu_prov.png'))

        # 点第 2 个市
        await pg.evaluate("() => document.querySelectorAll('#rmCity button')[1].click()")
        await pg.wait_for_timeout(1800)
        b2 = await pg.evaluate("""() => ({
          rid: window.__app.state.region.id,
          cnty: document.querySelectorAll('#rmCnty button').length,
          cntySample: [...document.querySelectorAll('#rmCnty button')].slice(0,3).map(x=>x.textContent),
          sel: document.getElementById('rmSel').textContent
        })""")
        print('[点市]', json.dumps(b2, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p12_menu_city.png'))

        # 点第 3 个县 → 再点确定
        picked = await pg.evaluate("""() => {
          const bs = [...document.querySelectorAll('#rmCnty button')];
          const t = bs[2]; t.click();
          return { name: t.textContent, code: t.dataset.code };
        }""")
        await pg.wait_for_timeout(900)
        c = await pg.evaluate("""() => ({ sel: document.getElementById('rmSel').textContent,
            ok: !document.getElementById('rmOk').disabled })""")
        print('[点县]', json.dumps(picked, ensure_ascii=False), json.dumps(c, ensure_ascii=False), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p12_menu_cnty.png'))

        await pg.click('#rmOk')
        await pg.wait_for_timeout(1200)
        await pg.wait_for_function("() => window.__app.state.region.id === '" + str(picked['code']) + "'", timeout=170000)
        d = await pg.evaluate("""() => ({ rid: window.__app.state.region.id, name: window.__app.state.region.name,
            span: [+window.__app.state.region.spanX.toFixed(0), +window.__app.state.region.spanY.toFixed(0)],
            open: document.getElementById('regionMenu').classList.contains('open') })""")
        print('[确定后]', json.dumps(d, ensure_ascii=False), flush=True)
        await pg.wait_for_timeout(9000)
        await pg.screenshot(path=os.path.join(OUT, 'p12_after_pick.png'))

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
