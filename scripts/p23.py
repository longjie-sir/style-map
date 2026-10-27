#!/usr/bin/env python3
"""精细分解：hypo 风格下 383ms 到底花在哪。

上一次用 q=low 跑，而 low 档 shadow=0，所以"关阴影无变化"是假结论。
这次用默认画质，小窗口控制绝对开销，逐项换材质/隐藏并记录 draw call 数
—— 162 个 call 与像素风格的 5 个是最大的结构性差异。
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
  return { calls: i.calls, tris: i.triangles,
           wallTris: v.wall ? v.wall.geometry.attributes.position.count / 3 : 0,
           borders: v.borderGroup ? v.borderGroup.children.length : 0,
           outlines: v.outlineGroup ? v.outlineGroup.children.length : 0,
           quality: v.quality };
}"""

FLAT = r"""
void main(){
  gl_FragColor = vec4(0.62, 0.62, 0.62, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
"""


async def sample(pg, label, rows, ms=4000):
    m = await pg.evaluate(FRAMES, ms)
    info = await pg.evaluate(INFO)
    rows.append((label, m, info))
    print(f'[样本] {label}: {m["med"]}ms n={m["n"]} calls={info["calls"]} '
          f'tris={info["tris"]} wall={info["wallTris"]} borders={info["borders"]} '
          f'outlines={info["outlines"]} q={info["quality"]}', flush=True)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 420, 'height': 300}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL, wait_until='load')          # 默认画质（不传 q）
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=240000)
        await pg.wait_for_timeout(10000)

        async def js(src, wait=2500):
            await pg.evaluate(src.replace('$R', 'window.__app'))
            await pg.wait_for_timeout(wait)

        rows = []

        await js("() => $R.style('pixel')", 6000)
        await sample(pg, '像素方块(基准)', rows)

        await js("() => $R.style('hypo')", 6000)
        await sample(pg, 'hypo 默认', rows)

        # A. 侧壁：不透明 + 单面（排除混合与双面光栅化）
        await js("() => { const v = $R.view, m = v.wall.material.clone();"
                 " m.transparent = false; m.side = 0; m.needsUpdate = true;"
                 " v._wallMat0 = v.wall.material; v.wall.material = m; }")
        await sample(pg, 'hypo · 侧壁不透明单面', rows)

        # B. 侧壁换极简 fragment（排除其片元工作）
        await js("() => { const v = $R.view, m = v._wallMat0.clone();"
                 " m.fragmentShader = FLAT_SRC; m.transparent = false; m.needsUpdate = true;"
                 " v.wall.material = m; }".replace('FLAT_SRC', repr(FLAT).replace("'", '"')))
        await sample(pg, 'hypo · 侧壁极简fragment', rows)

        # C. 隐藏侧壁
        await js("() => { $R.view.wall.visible = false; }")
        await sample(pg, 'hypo − 侧壁', rows)

        # D. 恢复侧壁，隐藏行政界线
        await js("() => { const v = $R.view; v.wall.visible = true;"
                 " v.wall.material = v._wallMat0;"
                 " if (v.borderGroup) v.borderGroup.visible = false; }")
        await sample(pg, 'hypo − 行政界线', rows)

        # E. 恢复界线，隐藏轮廓线组
        await js("() => { const v = $R.view;"
                 " if (v.borderGroup) v.borderGroup.visible = true;"
                 " if (v.outlineGroup) v.outlineGroup.visible = false; }")
        await sample(pg, 'hypo − 轮廓线', rows)

        # F. 恢复，地形网格换极简 fragment（排除地形像素着色）
        await js("() => { const v = $R.view;"
                 " if (v.outlineGroup) v.outlineGroup.visible = true;"
                 " v._meshMat0 = v.mesh.material;"
                 " const m = v.mesh.material.clone();"
                 " m.fragmentShader = FLAT_SRC; m.needsUpdate = true;"
                 " v.mesh.material = m; }".replace('FLAT_SRC', repr(FLAT).replace("'", '"')), 3000)
        await sample(pg, 'hypo · 地形极简fragment', rows)

        # G. 恢复地形，关云
        await js("() => { const v = $R.view;"
                 " v.mesh.material = v._meshMat0;"
                 " $R.layer('clouds', false); }")
        await sample(pg, 'hypo − 云', rows)

        print('[errs]', errs[:5], flush=True)
        print('[汇总] ' + ' | '.join(f'{n}: {m["med"]}ms' for n, m, _ in rows), flush=True)
        await pg.screenshot(path=os.path.join(OUT, 'p23.png'))
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
