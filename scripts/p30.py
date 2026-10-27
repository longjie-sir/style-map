#!/usr/bin/env python3
"""全量命中扫描：面板内每个可交互控件，点击落点是否真的命中它自己（排除故意 dim 的组）。"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=240000)
        await pg.wait_for_timeout(8000)

        # 展开全部折叠分区，保证控件都在 DOM 且可滚动到
        await pg.evaluate("""() => {
            document.querySelectorAll('#panel .sec.collapsed').forEach((s) => s.classList.remove('collapsed'));
            document.querySelectorAll('.lgrp').forEach((g) => {
                const inp = g.querySelector('.lgrp-hd input[data-layer]');
                if (inp && !inp.checked) inp.click();      // 全开，保证组内参数参与扫描
            });
            document.querySelector('#regionBtn').click();   // 打开区域菜单一起扫
        }""")
        await pg.wait_for_timeout(2500)

        res = await pg.evaluate("""() => {
            const bad = [], total = { n: 0 };
            const sels = ['body input', 'body button', 'body select'];
            document.querySelectorAll(sels.join(',')).forEach((el) => {
                if (el.type === 'hidden' || el.disabled) return;
                const dim = el.closest('.lgrp-bd.dim');
                if (dim) return;                       // 故意置灰不可点，跳过
                if (el.offsetParent === null) return;  // 不可见
                total.n++;
                el.scrollIntoView({ block: 'center' });
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                const hit = document.elementFromPoint(cx, cy);
                if (!hit) { bad.push({ el: el.outerHTML.slice(0, 90), why: '视口外' }); return; }
                const ok = hit === el || el.contains(hit) || (el.closest('label') && el.closest('label').contains(hit));
                if (!ok) bad.push({ el: el.outerHTML.slice(0, 90), hit: hit.tagName.toLowerCase() + '.' + String(hit.className).replace(/\\s+/g, '.'), why: '被遮挡' });
            });
            return { total: total.n, bad };
        }""")
        print('[扫描] 可点控件', res['total'], '异常', len(res['bad']), flush=True)
        for b in res['bad']:
            print('   ', b, flush=True)

        print('[errs]', errs[:3], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
