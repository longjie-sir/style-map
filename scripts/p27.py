#!/usr/bin/env python3
"""诊断：右侧面板分组标题栏的开关为何点不动（点击命中元素 / 状态是否变化）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))


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
        await pg.wait_for_timeout(7000)

        # 每个分组头开关：滚动到可见 → 记录命中元素
        hits = await pg.evaluate("""() => {
            const out = [];
            document.querySelectorAll('#panel .lgrp-hd .switch').forEach((sw) => {
                const inp = sw.querySelector('input[data-layer]');
                if (!inp) return;
                sw.scrollIntoView({block: 'center'});
                const r = sw.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                const el = document.elementFromPoint(cx, cy);
                out.push({
                    k: inp.dataset.layer,
                    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                    hit: el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).replace(/\\s+/g, '.') : '') : null,
                    hitIsInput: el === inp,
                    hitInSwitch: sw.contains(el)
                });
            });
            return out;
        }""")
        print('[命中]', flush=True)
        for h in hits:
            print('   ', h, flush=True)

        # 真实鼠标点击每个分组头开关，看 layers 是否翻转
        print('[点击]', flush=True)
        for h in hits:
            k = h['k']
            before = await pg.evaluate(f"() => !!window.__app.layers['{k}']")
            box = await pg.evaluate(f"""() => {{
                const sw = document.querySelector('#panel input[data-layer="{k}"]').closest('.switch');
                sw.scrollIntoView({{block:'center'}});
                const r = sw.getBoundingClientRect();
                return [r.left + r.width/2, r.top + r.height/2];
            }}""")
            await pg.wait_for_timeout(150)
            await pg.mouse.click(box[0], box[1])
            await pg.wait_for_timeout(600)
            after = await pg.evaluate(f"() => !!window.__app.layers['{k}']")
            print(f"    {k:10s} {before} -> {after}  {'OK' if before != after else '!! 无反应'}", flush=True)

        # 复原
        await pg.evaluate("() => { window.__app.layer('frameOn', true); window.__app.layer('backdrop', false); }")
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(OUT, 'p27_panel.png'))

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
