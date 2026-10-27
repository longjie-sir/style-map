#!/usr/bin/env python3
"""第 8 轮最终验收：功能 + 性能 + 视觉。

性能对比口径：都在 dpr 倍率 1.0（满分辨率）下取，才和优化前的 1650ms 可比；
另外单独测「飞行中」—— 那时动态倍率生效，是用户真实感受到的数字。
"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
W, H = 640, 440

FRAMES = """async (ms) => {
  const t = [];
  const t0 = performance.now();
  await new Promise((res) => {
    const step = (ts) => { t.push(ts); if (ts - t0 > ms) res(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  const d = [];
  for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
  d.sort((a, b) => a - b);
  return { n: d.length, med: d.length ? +d[d.length >> 1].toFixed(1) : -1 };
}"""

INFO = """() => {
  const v = window.__app.view, i = v.renderer.info.render;
  return { calls: i.calls, tris: i.triangles, dpr: +v.renderer.getPixelRatio().toFixed(2),
           rs: v._rs ?? 1, wallT: v.wallMat ? v.wallMat.transparent : null,
           outlines: v.outlineGroup ? v.outlineGroup.children.length : 0, q: v.quality };
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=240000)
        await pg.wait_for_timeout(11000)

        async def js(src, wait=700):
            r = await pg.evaluate(src.replace('$R', 'window.__app'))
            await pg.wait_for_timeout(wait)
            return r

        await js("() => $R.style('hypo')", 6000)
        # 冻结动态倍率，保证与优化前同口径
        await js("() => { const v = $R.view; v.setRenderScale(1); v._rsFreeze = true;"
                 " v.setRenderScale = function(){ }; }", 800)
        info = await pg.evaluate(INFO)
        still = await pg.evaluate(FRAMES, 5000)
        print(f'[性能] hypo 静止(满倍率): {still["med"]}ms calls={info["calls"]} '
              f'tris={info["tris"]} dpr={info["dpr"]} wallTransparent={info["wallT"]} '
              f'outlines={info["outlines"]}', flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p25_hypo.png'))

        # 恢复动态倍率，测飞行
        await js("() => { location.reload(); }", 9000)
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=240000)
        await pg.wait_for_timeout(10000)
        await js("""() => { const a = $R;
            a.track.preset(); document.querySelector('[data-act="follow"]').click(); }""", 2500)
        info2 = await pg.evaluate(INFO)
        fly = await pg.evaluate(FRAMES, 5000)
        info3 = await pg.evaluate(INFO)
        print(f'[性能] hypo 飞行(动态倍率): {fly["med"]}ms calls={info2["calls"]}/'
              f'{info3["calls"]} tris={info3["tris"]} dpr={info3["dpr"]} rs={info3["rs"]}', flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p25_fly.png'))

        # 停飞 → 应自动回到满倍率
        await js("() => document.querySelector('[data-act=\"follow\"]').click()", 2500)
        back = await pg.evaluate(INFO)
        print(f'[倍率] 退出飞行后 dpr={back["dpr"]} rs={back["rs"]}', flush=True)

        # 各风格 0 报错 + 巡航高度一致性抽查
        for s in ['hypo', 'line', 'sketch', 'realistic', 'ink', 'paper', 'pixel']:
            await js(f"() => $R.style('{s}')", 2200)
        print('[风格] 7 种切换完成', flush=True)

        await js("() => $R.style('pixel')", 3000)
        await pg.screenshot(path=os.path.join(OUT, 'p25_pixel.png'))
        await js("() => $R.style('hypo')", 3000)

        # 低画质 → 云应自动切平面
        await js("() => { $R.layers.cloudMode = 'volume'; $R.layer('quality', 'low'); }", 3500)
        cm = await pg.evaluate("() => ({ mode: window.__app.clouds.mode, "
                               "sheets: window.__app.clouds.sheets.length })")
        print('[低画质] 云模式 =', cm['mode'], ' 平面云张数 =', cm['sheets'], flush=True)

        print('[errs]', errs[:6], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
