#!/usr/bin/env python3
"""取景稳定性探针：加载后不手动调 frameCamera，等若干帧再量测。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'

PROBE = r"""
() => {
  const v = window.__app.view, cam = v.camera;
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
    return [px/pw, py/pw];
  };
  let mnx=9,mxx=-9,mny=9,mxy=-9,n=0;
  for (const p of v._framePoints()) {
    const r = proj(p.x,p.y,p.z); if (!r) continue; n++;
    if (r[0]<mnx)mnx=r[0]; if(r[0]>mxx)mxx=r[0];
    if (r[1]<mny)mny=r[1]; if(r[1]>mxy)mxy=r[1];
  }
  const W = v.el.clientWidth, H = v.el.clientHeight;
  const sy = (yy) => Math.round((yy*0.5+0.5)*H);
  const sx = (xx) => Math.round((xx*0.5+0.5)*W);
  return {
    n,
    ndc: { l:+mnx.toFixed(3), r:+mxx.toFixed(3), b:+mny.toFixed(3), t:+mxy.toFixed(3) },
    px: { left: sx(mnx), right: sx(mxx), top: sy(mxy), bottom: sy(mny) },
    cy: +((mny+mxy)/2).toFixed(3),
    canvas: [W,H],
    frameTy: v._frameTy,
    tgtY: +v.controls.target.y.toFixed(1),
    camY: +cam.position.y.toFixed(1),
  };
}
"""

async def main():
    logs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        for vw, vh, tag in [(1440, 900, 'w1440'), (1080, 596, 'w1080')]:
            pg = await b.new_page(viewport={'width': vw, 'height': vh}, device_scale_factor=1)
            pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
            await pg.goto(URL, wait_until='load')
            await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
            await pg.wait_for_timeout(7000)
            r = await pg.evaluate(PROBE)
            logs.append(f"[{tag}] " + json.dumps(r, ensure_ascii=False))
            await pg.screenshot(path=os.path.abspath(f'shots/probe_{tag}.png'))
            await pg.close()
        await b.close()
    print('\n'.join(logs), flush=True)
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
