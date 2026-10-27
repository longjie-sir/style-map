#!/usr/bin/env python3
"""找出「地图以外那片蓝」到底是谁画的：逐个隐藏 world 子节点并采样像素。"""
import asyncio, sys, os, json
from PIL import Image
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))


def px(path, pt):
    im = Image.open(path).convert('RGB')
    return im.getpixel(pt)


async def shot(pg, name):
    p = os.path.join(OUT, f'probe_{name}.png')
    await pg.screenshot(path=p)
    return p


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1000, 'height': 640}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(13000)
        await pg.evaluate("() => window.__app.layer('bgMode', 'plain')")
        await pg.wait_for_timeout(1000)

        # world 各子节点的可读标识
        kids = await pg.evaluate("""() => window.__app.view.world.children.map((o, i) =>
            ({ i, type: o.type, vis: o.visible, name: o.name || '',
               mat: o.material ? (o.material.type + ':' + (o.material.color ? '#' + o.material.color.getHexString() : '')) : '',
               kids: o.children ? o.children.length : 0 }))""")
        print('[world]', json.dumps(kids, ensure_ascii=False), flush=True)

        pt = (820, 300)     # 地图右侧空白处
        base = await shot(pg, 'all')
        print('[baseline]', px(base, pt), flush=True)

        for k in kids:
            await pg.evaluate("i => { const w = window.__app.view.world; w.children.forEach((o, j) => { if (j === i) o.visible = false; }); }", k['i'])
            await pg.wait_for_timeout(400)
            pth = await shot(pg, f'hide{k["i"]}')
            print(f"  隐藏 #{k['i']} {k['type']} {k['mat']} -> {px(pth, pt)}", flush=True)
            await pg.evaluate("i => { const w = window.__app.view.world; w.children.forEach((o, j) => { if (j === i) o.visible = true; }); }", k['i'])
            await pg.wait_for_timeout(150)

        # 全隐
        await pg.evaluate("() => { window.__app.view.world.visible = false; }")
        await pg.wait_for_timeout(500)
        p2 = await shot(pg, 'none')
        print('[world 全隐]', px(p2, pt), '| bodyBg=', await pg.evaluate("() => document.body.style.background"), flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
