#!/usr/bin/env python3
"""第 8 轮：轨迹飞行四项调整 + 性能优化的验收。

验证点
1. 巡航高度：路线是水平面（pathCurve 的 y 全 0，高度只由 group.position.y 提供），
   改高度不重建几何体（曲线对象引用不变）。
2. 箭头跟随轨迹线一起隐藏（这次的重点 bug）。
3. 飞行中鼠标左键拖动可以绕飞行器旋转视角（controls 不再被禁用）。
4. 性能：draw call 数、三角形数、静止/飞行帧时间。
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
  const v = window.__app.view, i = v.renderer.info.render;
  return { calls: i.calls, tris: i.triangles, dpr: +v.renderer.getPixelRatio().toFixed(2),
           rs: v._rs ?? 1, wallTransparent: v.wallMat ? v.wallMat.transparent : null,
           outlines: v.outlineGroup ? v.outlineGroup.children.length : 0,
           quality: v.quality };
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 640, 'height': 440}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=240000)
        await pg.wait_for_timeout(11000)

        async def js(src, wait=600):
            r = await pg.evaluate(src.replace('$R', 'window.__app'))
            await pg.wait_for_timeout(wait)
            return r

        # ---------- 1. 巡航高度 ----------
        alt = await js("""() => {
            const tr = $R.track;
            tr.preset();
            const ys = [];
            for (let i = 0; i <= 10; i++) ys.push(+tr.pathCurve.getPointAt(i / 10).y.toFixed(4));
            return { ys, gy: +tr.group.position.y.toFixed(3), flyH: tr.flyH,
                     span: +Math.max($R.view.region.spanX, $R.view.region.spanY).toFixed(1) };
        }""", 800)
        print('[高度] 曲线 y 值 =', alt['ys'], f'group.y={alt["gy"]} flyH={alt["flyH"]} span={alt["span"]}', flush=True)

        # 改高度：曲线对象引用必须不变（说明没有重建几何体）
        alt2 = await js("""() => {
            const tr = $R.track, c0 = tr.pathCurve;
            $R.layers.flyH = 0.16; $R.layer('flyH', 0.16);
            return { sameCurve: tr.pathCurve === c0, gy: +tr.group.position.y.toFixed(3),
                     tubes: tr.tube.children.length };
        }""", 900)
        print('[高度] 拖到 0.16 → group.y=', alt2['gy'],
              '曲线对象复用 =', alt2['sameCurve'], '管线数 =', alt2['tubes'], flush=True)
        await js("() => { $R.layers.flyH = 0.09; $R.layer('flyH', 0.09); }", 700)

        # ---------- 2. 箭头跟随隐藏 ----------
        mk = await js("""async () => {
            const tr = $R.track;
            tr.setShowLine(false);
            tr.play();
            await new Promise(r => setTimeout(r, 700));
            return { showLine: tr.showLine, marker: tr.marker.visible, tube: tr.tube.visible };
        }""", 900)
        print('[箭头] 关轨迹线后 marker.visible =', mk['marker'], ' tube.visible =', mk['tube'], flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p24_noline.png'))
        mk2 = await js("""async () => {
            const tr = $R.track;
            tr.setShowLine(true);
            await new Promise(r => setTimeout(r, 500));
            return { marker: tr.marker.visible, tube: tr.tube.visible };
        }""", 600)
        print('[箭头] 开回来后 marker.visible =', mk2['marker'], ' tube.visible =', mk2['tube'], flush=True)

        # ---------- 3. 飞行中可调视角 ----------
        await js("""() => { const a = $R;
            a.track.preset(); document.querySelector('[data-act="follow"]').click(); }""", 1200)
        cam0 = await js("""() => { const v = $R.view;
            return { enabled: v.controls.enabled, pan: v.controls.enablePan,
                     pos: v.camera.position.toArray().map(n => +n.toFixed(2)),
                     tgt: v.controls.target.toArray().map(n => +n.toFixed(2)),
                     dist: +v.camera.position.distanceTo(v.controls.target).toFixed(2) }; }""")
        print('[飞行] 进入时 controls.enabled =', cam0['enabled'], ' enablePan =', cam0['pan'],
              ' 距离 =', cam0['dist'], flush=True)

        # 鼠标左键横向拖动 → 相机应绕 target 旋转（距离基本不变）
        box = await pg.evaluate("() => { const c = window.__app.view.renderer.domElement.getBoundingClientRect();"
                                " return {x: c.x, y: c.y, w: c.width, h: c.height}; }")
        cx, cy = box['x'] + box['w'] * 0.5, box['y'] + box['h'] * 0.5
        await pg.mouse.move(cx, cy)
        await pg.mouse.down()
        for i in range(12):
            await pg.mouse.move(cx + (i + 1) * 12, cy - (i + 1) * 2)
            await pg.wait_for_timeout(30)
        await pg.mouse.up()
        await pg.wait_for_timeout(700)
        cam1 = await js("""() => { const v = $R.view;
            return { pos: v.camera.position.toArray().map(n => +n.toFixed(2)),
                     dist: +v.camera.position.distanceTo(v.controls.target).toFixed(2),
                     playing: $R.track.playing, prog: +$R.track.progress.toFixed(3) }; }""")
        moved = max(abs(cam1['pos'][i] - cam0['pos'][i]) for i in range(3))
        print('[飞行] 拖动后机位变化 =', moved, ' 距离', cam0['dist'], '→', cam1['dist'],
              ' 仍在播放 =', cam1['playing'], ' progress', cam1['prog'], flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p24_fly_drag.png'))

        # ---------- 4. 性能 ----------
        await js("() => document.querySelector('[data-act=\"follow\"]').click()", 1500)  # 退出飞行
        await js("() => { window.__app.style('hypo'); }", 5000)
        info = await pg.evaluate(INFO)
        still = await pg.evaluate(FRAMES, 4000)
        print(f'[性能] hypo 静止: {still["med"]}ms calls={info["calls"]} tris={info["tris"]} '
              f'dpr={info["dpr"]} rs={info["rs"]} wallTransparent={info["wallTransparent"]} '
              f'outlines={info["outlines"]}', flush=True)

        await js("""() => { const a = $R;
            a.track.preset(); document.querySelector('[data-act="follow"]').click(); }""", 1200)
        fly = await pg.evaluate(FRAMES, 4000)
        info2 = await pg.evaluate(INFO)
        print(f'[性能] hypo 飞行: {fly["med"]}ms calls={info2["calls"]} tris={info2["tris"]} '
              f'dpr={info2["dpr"]} rs={info2["rs"]}', flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p24_fly.png'))

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
