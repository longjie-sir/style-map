#!/usr/bin/env python3
"""第 7 轮验收 B：8 种画框模板 + 参数（色调/角饰/内留白/线宽），出图模式截图。"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

STYLES = ['thin', 'double', 'neat', 'checker', 'mat', 'bevel', 'plate', 'wood']


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        errs = []
        pg.on('pageerror', lambda e: errs.append('[pageerror] ' + str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(13000)

        # 出图态：素白底 + 隐藏界面，单独看画框
        await pg.evaluate("""() => {
          window.__app.layer('bgColor', '#ffffff');
          window.__app.layer('bgMode', 'plain');
          window.__app.layer('backdrop', false);
        }""")
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => window.__app.ui(true)")
        await pg.wait_for_timeout(3200)

        info = []
        for k in STYLES:
            await pg.evaluate("""k => window.__app.layer('frameStyle', k)""", k)
            await pg.wait_for_timeout(1100)
            st = await pg.evaluate("""() => {
              const f = window.__app.frame;
              const c = f.canvas;
              // 统计非透明像素比例（框带墨量），确认画框真的画出来了
              const g = c.getContext('2d');
              const d = g.getImageData(0, 0, c.width, c.height).data;
              let ink = 0;
              for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
              return { style: f.styleKey, w: c.width, h: c.height,
                       inkRatio: +(ink / (c.width * c.height)).toFixed(3),
                       y: +f.mesh.position.y.toFixed(2) };
            }""")
            await pg.screenshot(path=os.path.join(OUT, f'p13_{k}.png'))
            info.append(st)
            print('[框]', json.dumps(st, ensure_ascii=False), flush=True)

        # 参数联动：色调 + 角饰 + 内留白 + 线宽 + 间隔
        await pg.evaluate("""() => {
          const a = window.__app;
          a.layer('frameStyle', 'mat');
          a.layer('frameTone', 'sand');
          a.layer('frameCorner', 'block');
          a.layer('framePad', 0.03);
          a.layer('frameLW', 1.8);
          a.layer('gratStep', '1');
        }""")
        await pg.wait_for_timeout(1400)
        await pg.screenshot(path=os.path.join(OUT, 'p13_tuned.png'))
        st2 = await pg.evaluate("""() => {
          const f = window.__app.frame;
          return { style: f.styleKey, tone: f.tone, corner: f.corner,
                   pad: f.pad, lw: f.lw, step: f.step, mKm: +f._g.mKm.toFixed(2) };
        }""")
        print('[参数]', json.dumps(st2, ensure_ascii=False), flush=True)

        await pg.evaluate("() => window.__app.ui(false)")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(OUT, 'p13_ui.png'))

        print('[errs]', errs[:6], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
