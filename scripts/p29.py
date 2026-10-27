#!/usr/bin/env python3
"""复验 v2：分组头开关双向同步 + 关闭后组内参数不可点 + 底图默认显示。"""
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

        init = await pg.evaluate("""() => {
            const a = window.__app;
            const sw = document.querySelector('#panel input[data-layer="backdrop"]');
            const r = a.backdrop.mesh ? a.backdrop.mesh.material.opacity : null;
            return { layer: a.layers.backdrop, checked: !!sw && sw.checked,
                     mesh: !!a.backdrop.mesh, visible: !!(a.backdrop.mesh && a.backdrop.mesh.visible),
                     railOn: document.querySelector('[data-rail="backdrop"]').classList.contains('on'),
                     opacity: r };
        }""")
        print('[默认底图]', init, flush=True)

        async def state(k):
            return await pg.evaluate(f"""() => {{
                const a = window.__app;
                const inp = document.querySelector('#panel input[data-layer="{k}"]');
                const grp = inp ? inp.closest('.lgrp') : null;
                return {{ layer: !!a.layers['{k}'], checked: inp ? inp.checked : null,
                          rail: document.querySelector('[data-rail="{k}"]').classList.contains('on'),
                          dim: grp ? grp.querySelector('.lgrp-bd').classList.contains('dim') : null }};
            }}""")

        async def swpos(k):
            return await pg.evaluate(f"""() => {{
                const sw = document.querySelector('#panel input[data-layer="{k}"]').closest('.switch');
                sw.scrollIntoView({{block:'center'}});
                const r = sw.getBoundingClientRect();
                return [r.left + r.width/2, r.top + r.height/2];
            }}""")

        # ① 右侧分组头开关（点两次回原位）
        print('[右侧开关]', flush=True)
        for k in KEYS:
            before = await state(k)
            pos = await swpos(k)
            await pg.wait_for_timeout(200)
            await pg.mouse.click(pos[0], pos[1])
            await pg.wait_for_timeout(700)
            mid = await state(k)
            await pg.mouse.click(pos[0], pos[1])
            await pg.wait_for_timeout(700)
            back = await state(k)
            ok = (before['checked'] != mid['checked']) and (mid['rail'] == mid['layer']) \
                and (mid['dim'] == (not mid['layer'])) and (back['checked'] == before['checked'])
            print(f"    {k:9s} {before['checked']}->{mid['checked']} 左栏={mid['rail']} dim={mid['dim']} 复原={back['checked']} {'OK' if ok else '!! 异常'}", flush=True)

        # ② 左栏 → 右侧
        print('[左栏→右侧]', flush=True)
        for k in ['frameOn', 'backdrop']:
            before = await state(k)
            await pg.click(f'[data-rail="{k}"]')
            await pg.wait_for_timeout(700)
            mid = await state(k)
            await pg.click(f'[data-rail="{k}"]')
            await pg.wait_for_timeout(700)
            back = await state(k)
            ok = (before['checked'] != mid['checked']) and (mid['checked'] == mid['rail']) and (back['checked'] == before['checked'])
            print(f"    {k:9s} {before['checked']}->{mid['checked']} 右侧 checked={mid['checked']} 复原={back['checked']} {'OK' if ok else '!! 异常'}", flush=True)

        # ③ 关闭画框 → 组内参数应不可点（拖框宽滑块，值不能变）
        await pg.evaluate("() => window.__app.layer('frameOn', false)")
        await pg.wait_for_timeout(900)
        w0 = await pg.evaluate("() => window.__app.layers.frameW")
        sp = await pg.evaluate("""() => {
            const el = document.querySelector('#panel input[data-lnum="frameW"]');
            el.scrollIntoView({block:'center'});
            const r = el.getBoundingClientRect();
            return [r.left + r.width*0.8, r.top + r.height/2];
        }""")
        await pg.mouse.move(sp[0], sp[1])
        await pg.mouse.down()
        await pg.mouse.move(sp[0] - 40, sp[1]); await pg.mouse.move(sp[0] - 90, sp[1])
        await pg.mouse.up()
        await pg.wait_for_timeout(600)
        w1 = await pg.evaluate("() => window.__app.layers.frameW")
        blocked = await pg.evaluate("""() => {
            const bd = document.querySelector('#panel input[data-layer="frameOn"]').closest('.lgrp').querySelector('.lgrp-bd');
            return getComputedStyle(bd).pointerEvents;
        }""")
        print(f'[关闭态] 框宽 {w0} -> {w1}  pointer-events={blocked}  {"OK 不可点" if w0 == w1 else "!! 仍可拖动"}', flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p29_frame_off.png'))

        # ④ 重开画框 → 组内恢复可点，拖滑块生效
        pos = await swpos('frameOn')
        await pg.mouse.click(pos[0], pos[1])
        await pg.wait_for_timeout(900)
        sp2 = await pg.evaluate("""() => {
            const el = document.querySelector('#panel input[data-lnum="frameW"]');
            el.scrollIntoView({block:'center'});
            const r = el.getBoundingClientRect();
            return [r.left + r.width*0.5, r.top + r.height/2];
        }""")
        await pg.mouse.move(sp2[0], sp2[1])
        await pg.mouse.down()
        await pg.mouse.move(sp2[0] + 40, sp2[1]); await pg.mouse.move(sp2[0] + 70, sp2[1])
        await pg.mouse.up()
        await pg.wait_for_timeout(600)
        w2 = await pg.evaluate("() => window.__app.layers.frameW")
        print(f'[重开] 框宽 {w1} -> {w2} {"OK 可拖" if abs(w2 - w1) > 1e-6 else "!! 仍不可拖"}', flush=True)
        await pg.evaluate("() => window.__app.layer('frameW', 0.06)")
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(OUT, 'p29_frame_on.png'))

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
