#!/usr/bin/env python3
"""定位「只有像素方块风格顺畅」的根因。

软件渲染下绝对帧率无意义，但**相对差值**能定位瓶颈落在哪一项：
逐项关掉（阴影 raymarch / 地形网格 / 侧壁 / 水面 / 云 / 分辨率），
看帧时间掉在哪一步 —— 掉得最多的那步就是主犯。
"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

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
  const v = window.__app.view;
  const i = v.renderer.info.render;
  return { calls: i.calls, tris: i.triangles };
}"""


async def sample(pg, label, rows, ms=3500):
    m = await pg.evaluate(FRAMES, ms)
    info = await pg.evaluate(INFO)
    rows.append((label, m, info))
    print(f'[样本] {label}: {m["med"]}ms  n={m["n"]}  calls={info["calls"]} tris={info["tris"]}', flush=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 560, 'height': 380}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL + '&q=low', wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(9000)

        rows = []
        R = "window.__app"

        async def js(src, wait=1500):
            await pg.evaluate(src.replace("$R", R))
            await pg.wait_for_timeout(wait)

        # 0. 像素风格基准
        await js("() => $R.style('pixel')", 5000)
        await sample(pg, '像素方块(基准)', rows)

        # 1. 换成 hypo（普通风格）
        await js("() => $R.style('hypo')", 5000)
        await sample(pg, 'hypo 默认', rows)

        # 2. 关高度场自阴影 raymarch
        await js("() => { const v = $R.view; v.u.uShadowOn.value = 0; }")
        await sample(pg, 'hypo − 自阴影raymarch', rows)

        # 3. 恢复阴影，隐藏地形网格
        await js("() => { const v = $R.view; v.u.uShadowOn.value = 1; v.mesh.visible = false; }")
        await sample(pg, 'hypo − 地形网格', rows)

        # 4. 再隐藏侧壁
        await js("() => { const v = $R.view; v.wall.visible = false; }", 1200)
        await sample(pg, 'hypo − 网格 − 侧壁', rows)

        # 5. 恢复网格/侧壁，关水面
        await js("""() => { const v = $R.view;
            v.mesh.visible = true; v.wall.visible = true;
            const w = $R.water;
            if (w && w.setVisible) w.setVisible(false);
            else if (w && w.mesh) w.mesh.visible = false; }""")
        await sample(pg, 'hypo − 水面', rows)

        # 6. 关云
        await js("() => $R.layer('clouds', false)")
        await sample(pg, 'hypo − 水面 − 云', rows)

        # 7. 降分辨率到一半（判定 fillrate vs 顶点瓶颈）
        await js("() => { const v = $R.view; v.renderer.setPixelRatio(0.5); }", 1200)
        await sample(pg, 'hypo − 水面 − 云 · dpr0.5', rows)

        # 8. 还原分辨率，恢复云，测飞行中 vs 静止
        await js("""() => { const v = $R.view;
            v.renderer.setPixelRatio(1);
            const w = $R.water;
            if (w && w.setVisible) w.setVisible(true);
            $R.layer('clouds', true); }""", 3000)
        await sample(pg, 'hypo 静止(还原)', rows)

        # 9. 开沿线飞行
        await pg.evaluate("() => $R.track.preset()".replace("$R", "window.__app"))
        await pg.wait_for_timeout(1000)
        await pg.evaluate("() => document.querySelector('[data-act=\"follow\"]')?.click()")
        await pg.wait_for_timeout(600)
        follow = await pg.evaluate("() => !!window.__app.track.follow")
        await sample(pg, 'hypo 飞行中', rows)
        await pg.screenshot(path=os.path.join(OUT, 'p22_fly.png'))

        print('[follow]', follow, flush=True)
        print('[errs]', errs[:4], flush=True)
        print('[汇总]', ' | '.join(f'{n}: {m["med"]}ms' for n, m, _ in rows), flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
