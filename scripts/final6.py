#!/usr/bin/env python3
"""最终验收：dpr 标注对齐 + 全风格无报错 + 云影/云 + 终稿图。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))
KEYS = ['hypo', 'line', 'sketch', 'realistic', 'mono', 'ice', 'magma',
        'plaster', 'ink', 'paper', 'parchment', 'pixel']
logs = []


def emit():
    print('\n'.join(dict.fromkeys(logs)), flush=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])

        # ── 1. dpr=1 / 2 标注对齐 ──
        for dpr in (1, 2):
            pg = await b.new_page(viewport={'width': 1080, 'height': 596}, device_scale_factor=dpr)
            pg.set_default_timeout(150000)
            err = []
            pg.on('pageerror', lambda e: err.append(str(e)))
            await pg.goto(URL, wait_until='load')
            await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
            await pg.wait_for_timeout(15000)
            d = await pg.evaluate(r"""() => {
              const v = window.__app.view, c = v.renderer.domElement;
              const cr = c.getBoundingClientRect();
              const W = v.el.clientWidth, H = v.el.clientHeight;
              let worst = 0, n = 0;
              for (const it of window.__app.labels.items) {
                if (!it.enabled || it.el.style.display === 'none') continue;
                const r = it.el.getBoundingClientRect();
                const nx = ((r.left + r.width/2) / W) * 2 - 1;
                const ny = -((r.top + r.height/2) / H) * 2 + 1;
                const hit = v.pick(nx, ny);
                if (!hit) continue;
                worst = Math.max(worst, Math.abs(hit.lon - it.lon), Math.abs(hit.lat - it.lat));
                n++;
              }
              return { dpr: devicePixelRatio, canvasCss: [Math.round(cr.width), Math.round(cr.height)],
                       attr: [c.width, c.height], checked: n, worstDeg: +worst.toFixed(3),
                       frame: v._frameM ? { cx: +v._frameM.cx.toFixed(3), cy: +v._frameM.cy.toFixed(3) } : null };
            }""")
            logs.append(f"[dpr={dpr}] " + json.dumps(d, ensure_ascii=False) + (f" ERR:{err[0][:100]}" if err else ""))
            await pg.screenshot(path=os.path.join(OUT, f'f6_dpr{dpr}.png'))
            await pg.close()

        # ── 2. 全风格 + 云 + 终稿 ──
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(150000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(f"[console] {m.text}") if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(16000)
        bad = []
        for k in KEYS:
            errs.clear()
            await pg.evaluate("k => window.__app.style(k)", k)
            await pg.wait_for_timeout(2400)
            if errs:
                bad.append(f"{k}: {errs[0][:110]}")
        logs.append("[风格回归] " + ("全部通过，0 报错" if not bad else " || ".join(bad)))

        # 云 + 云影
        errs.clear()
        await pg.evaluate("""() => {
          window.__app.quality('mid');
          window.__app.layer('clouds', true);
        }""")
        await pg.wait_for_timeout(6000)
        d = await pg.evaluate("""() => {
          const v = window.__app.view, c = window.__app.clouds;
          return { puffs: c.puffs.length, cloudN: v.u.uCloudN.value, amt: +v.u.uCloudAmt.value.toFixed(2),
                   baseY: +v.u.uCloudBaseY.value.toFixed(1),
                   shadowAmt: v.u.uCloudAmt.value > 0.01, steps: c.puffs[0].mesh.material.uniforms.uSteps.value };
        }""")
        logs.append("[云+云影] " + json.dumps(d, ensure_ascii=False) + (f" ERR:{errs[0][:100]}" if errs else ""))
        await pg.screenshot(path=os.path.join(OUT, 'f6_clouds.png'))

        # 终稿：默认视图 + 纯净
        await pg.evaluate("() => { window.__app.layer('clouds', false); window.__app.style('hypo'); }")
        await pg.wait_for_timeout(3000)
        await pg.screenshot(path=os.path.join(OUT, 'f6_default.png'))
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(1400)
        await pg.screenshot(path=os.path.join(OUT, 'f6_clean.png'))
        await pg.evaluate("() => window.__app.ui(false)")
        await pg.wait_for_timeout(800)

        # 像素 + 大字号标注
        await pg.evaluate("""() => {
          window.__app.style('pixel');
          window.__app.labels.setOptions({ scale: 1.3, outlineW: 5, outlColor: '#0b1c2c', maxCount: 14 });
        }""")
        await pg.wait_for_timeout(4200)
        await pg.screenshot(path=os.path.join(OUT, 'f6_pixel.png'))

        # 窄视口
        await pg.close()
        pg = await b.new_page(viewport={'width': 1080, 'height': 596}, device_scale_factor=1)
        pg.set_default_timeout(150000)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(16000)
        await pg.screenshot(path=os.path.join(OUT, 'f6_narrow.png'))
        await pg.evaluate("() => { const p = document.getElementById('panel'); p.scrollTop = p.scrollHeight; }")
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=os.path.join(OUT, 'f6_narrow_panel.png'))

        await pg.close()
        await b.close()
    emit()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    emit()
    sys.stdout.flush()
    os._exit(1)