#!/usr/bin/env python3
"""第四轮验收：取景包围盒（含裙边）+ 纸本风格可读性 + 窄视口。

用法: python scripts/verify3.py
注意：全部 print 必须 flush，结尾 os._exit(0) 会吞掉未刷新的 stdout。
"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
os.makedirs(OUT, exist_ok=True)

# 纯数组投影，不依赖页面里能拿到 THREE
MEASURE = r"""
() => {
  const v = window.__app.view;
  if (!v || !v.region) return null;
  const cam = v.camera;
  const Vm = cam.matrixWorldInverse.elements, Pm = cam.projectionMatrix.elements;
  const proj = (x, y, z) => {
    const cx = Vm[0]*x + Vm[4]*y + Vm[8]*z + Vm[12];
    const cy = Vm[1]*x + Vm[5]*y + Vm[9]*z + Vm[13];
    const cz = Vm[2]*x + Vm[6]*y + Vm[10]*z + Vm[14];
    const cw = Vm[3]*x + Vm[7]*y + Vm[11]*z + Vm[15];
    const px = Pm[0]*cx + Pm[4]*cy + Pm[8]*cz + Pm[12]*cw;
    const py = Pm[1]*cx + Pm[5]*cy + Pm[9]*cz + Pm[13]*cw;
    const pw = Pm[3]*cx + Pm[7]*cy + Pm[11]*cz + Pm[15]*cw;
    if (!isFinite(pw) || Math.abs(pw) < 1e-9) return null;
    return [px / pw, py / pw];
  };
  let mnx = 9, mxx = -9, mny = 9, mxy = -9;
  for (const p of v._framePoints()) {
    const r = proj(p.x, p.y, p.z);
    if (!r) continue;
    if (r[0] < mnx) mnx = r[0]; if (r[0] > mxx) mxx = r[0];
    if (r[1] < mny) mny = r[1]; if (r[1] > mxy) mxy = r[1];
  }
  const W = v.el.clientWidth, H = v.el.clientHeight;
  const sx = (n) => Math.round((n * 0.5 + 0.5) * W);
  const sy = (n) => Math.round((n * 0.5 + 0.5) * H);
  const pel = document.getElementById('panel');
  const panelW = (pel && !pel.classList.contains('hide')) ? Math.round(pel.getBoundingClientRect().width) : 0;
  const availCx = (-1 * 0.5 + 0.5) * W + 0;   // 占位
  return {
    ndc: { l: +mnx.toFixed(3), r: +mxx.toFixed(3), b: +mny.toFixed(3), t: +mxy.toFixed(3) },
    px: { top: sy(mxy), bottom: sy(mny), left: sx(mnx), right: sx(mxx) },
    css: { W, H, panelW },
    overflowBottomPx: sy(mny) - H,
    overflowTopPx: 0 - sy(mxy),
  };
}
"""

async def main():
    logs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--no-sandbox', '--disable-gpu-sandbox', '--enable-webgl',
        ])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}"))
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        pg.on('requestfailed', lambda r: logs.append(f"[reqfail] {r.url[:110]}"))
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(6000)

        m = await pg.evaluate(MEASURE)
        logs.append("[1440x900] " + json.dumps(m, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'v4_default.png'))

        for k, name in [('line', 'v4_line'), ('sketch', 'v4_sketch'), ('realistic', 'v4_realistic')]:
            try:
                await pg.click(f'.style-tab[data-k="{k}"]', timeout=20000)
            except Exception as e:
                logs.append(f"[clickfail] {k} {e}")
                continue
            await pg.wait_for_timeout(2800)
            await pg.screenshot(path=os.path.join(OUT, name + '.png'))

        # 窄视口复现（对应用户截图尺寸）
        await pg.click('.style-tab[data-k="hypo"]', timeout=20000)
        await pg.wait_for_timeout(700)
        await pg.set_viewport_size({'width': 1080, 'height': 596})
        await pg.wait_for_timeout(1000)
        await pg.evaluate("() => window.__app.view.frameCamera()")
        await pg.wait_for_timeout(1200)
        chk = await pg.evaluate(MEASURE)
        logs.append("[1080x596] " + json.dumps(chk, ensure_ascii=False))
        await pg.screenshot(path=os.path.join(OUT, 'v4_narrow.png'))

        # 面板底部（水面/浮云/辅助图层分组）
        await pg.set_viewport_size({'width': 1440, 'height': 900})
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => { const els = [...document.querySelectorAll('#panel div')].filter(e => e.scrollHeight > e.clientHeight + 8); els.forEach(e => e.scrollTop = 1e6); }")
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=os.path.join(OUT, 'v4_panel.png'))

        await b.close()
    print('\n'.join(logs[:140]), flush=True)
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
