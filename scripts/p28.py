#!/usr/bin/env python3
"""复验：① 右侧分组头开关可点且与左栏互相同步 ② 背景底图默认显示。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
KEYS = ['labels', 'backdrop', 'water', 'clouds', 'frameOn']


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=240000)
        await pg.wait_for_timeout(8000)

        # ① 默认状态
        init = await pg.evaluate("""() => {
            const a = window.__app;
            const sw = (k) => document.querySelector(`#panel input[data-layer="${k}"]`);
            return {
                backdropLayer: a.layers.backdrop,
                backdropChecked: sw('backdrop') ? sw('backdrop').checked : null,
                backdropMesh: !!a.backdrop.mesh,
                backdropVisible: !!(a.backdrop.mesh && a.backdrop.mesh.visible),
                railOn: document.querySelector('[data-rail="backdrop"]').classList.contains('on'),
                opaque: a.layers.backdropOpacity
            };
        }""")
        print('[默认]', init, flush=True)

        async def state(k):
            return await pg.evaluate(f"""() => {{
                const a = window.__app;
                const inp = document.querySelector('#panel input[data-layer="{k}"]');
                const grp = inp ? inp.closest('.lgrp') : null;
                return {{
                    layer: !!a.layers['{k}'],
                    checked: inp ? inp.checked : null,
                    rail: document.querySelector('[data-rail="{k}"]').classList.contains('on'),
                    dim: grp ? grp.querySelector('.lgrp-bd').classList.contains('dim') : null
                }};
            }}""")

        # ② 右侧分组头开关：点两次（关 → 恢复），验证翻转 + 左栏同步
        print('[右侧开关]', flush=True)
        for k in KEYS:
            before = await state(k)
            pos = await pg.evaluate(f"""() => {{
                const sw = document.querySelector('#panel input[data-layer="{k}"]').closest('.switch');
                sw.scrollIntoView({{block:'center'}});
                const r = sw.getBoundingClientRect();
                return [r.left + r.width/2, r.top + r.height/2];
            }}""")
            await pg.wait_for_timeout(200)
            await pg.mouse.click(pos[0], pos[1])
            await pg.wait_for_timeout(700)
            mid = await state(k)
            await pg.mouse.click(pos[0], pos[1])       # 点回来
            await pg.wait_for_timeout(700)
            back = await state(k)
            ok = (before['checked'] != mid['checked']) and (mid['rail'] == mid['layer']) and (back['checked'] == before['checked'])
            print(f"    {k:9s} 点一次 {before['checked']}->{mid['checked']} 左栏={mid['rail']} 再点={back['checked']} {'OK' if ok else '!! 异常'}", flush=True)

        # ③ 反向：左栏 → 右侧面板
        print('[左栏→右侧]', flush=True)
        for k in ['frameOn', 'backdrop']:
            before = await state(k)
            await pg.click(f'[data-rail="{k}"]')
            await pg.wait_for_timeout(700)
            mid = await state(k)
            await pg.click(f'[data-rail="{k}"]')
            await pg.wait_for_timeout(700)
            back = await state(k)
            ok = (before['checked'] != mid['checked']) and (mid['rail'] == mid['layer']) and (back['checked'] == before['checked'])
            print(f"    {k:9s} {before['checked']}->{mid['checked']} 面板 checked={mid['checked']} 再点={back['checked']} {'OK' if ok else '!! 异常'}", flush=True)

        # ④ 关掉画框 → 组内参数应变灰；再点参数应自动重开画框
        await pg.evaluate("() => window.__app.layer('frameOn', false)")
        await pg.wait_for_timeout(800)
        d1 = await state('frameOn')
        await pg.evaluate("() => window.__app.layer('frameW', 0.075)")
        await pg.wait_for_timeout(800)
        d2 = await state('frameOn')
        print('[画框联动] 关闭后 dim=', d1['dim'], '点参数后 自动重开=', d2['layer'], 'dim=', d2['dim'], flush=True)

        # ⑤ 素色背景下点底图开关 → 应自动切回主题并提示
        await pg.evaluate("() => window.__app.layer('backdrop', false)")
        await pg.wait_for_timeout(400)
        await pg.evaluate("() => window.__app.layer('bgMode', 'plain')")
        await pg.wait_for_timeout(900)
        pos = await pg.evaluate("""() => {
            const sw = document.querySelector('#panel input[data-layer="backdrop"]').closest('.switch');
            sw.scrollIntoView({block:'center'});
            const r = sw.getBoundingClientRect();
            return [r.left + r.width/2, r.top + r.height/2];
        }""")
        await pg.mouse.click(pos[0], pos[1])
        await pg.wait_for_timeout(1200)
        bg = await pg.evaluate("""() => ({ bgMode: window.__app.layers.bgMode,
            on: window.__app.layers.backdrop, toast: (document.querySelector('#toast')||{}).textContent || '' })""")
        print('[素色→主题]', bg, flush=True)

        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=os.path.join(OUT, 'p28_default.png'))
        ui = await pg.evaluate("""() => {
            const sw = document.querySelector('#panel input[data-layer="frameOn"]').closest('.switch');
            const b = sw.getBoundingClientRect();
            return { hit: (document.elementFromPoint(b.left + b.width/2, b.top + b.height/2) || {}).tagName };
        }""")
        print('[命中]', ui, flush=True)

        print('[errs]', errs[:5], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
