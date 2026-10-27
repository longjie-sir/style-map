#!/usr/bin/env python3
"""把 README 走一遍 GitHub 的 GFM 渲染接口，落成 HTML 并截图预览。"""
import asyncio, json, os, sys, urllib.request
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TMP_HTML = os.path.join(ROOT, '_readme_preview.html')
OUT = os.path.join(ROOT, 'docs', 'screenshots')

CSS = """
<meta charset="utf-8">
<style>
  body{max-width:940px;margin:0 auto;padding:32px 24px 80px;
       font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
       color:#1f2328;background:#fff}
  h1{font-size:2em;border-bottom:1px solid #d8dee4;padding-bottom:.3em;margin-top:24px}
  h2{font-size:1.5em;border-bottom:1px solid #d8dee4;padding-bottom:.3em;margin-top:40px}
  h3{font-size:1.2em;margin-top:24px}
  hr{height:1px;border:0;background:#d8dee4;margin:32px 0}
  table{border-collapse:collapse;margin:16px 0;font-size:14px}
  th,td{border:1px solid #d0d7de;padding:6px 12px}
  th{background:#f6f8fa}
  img{max-width:100%}
  code{background:#f6f8fa;padding:.2em .4em;border-radius:4px;font-size:88%}
  pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow:auto;font-size:13px}
  blockquote{border-left:4px solid #d0d7de;color:#59636e;margin:0;padding:0 1em}
  a{color:#0969da;text-decoration:none}
</style>
"""


async def main():
    text = open(os.path.join(ROOT, 'README.md'), encoding='utf-8').read()
    req = urllib.request.Request('https://api.github.com/markdown',
                                 data=json.dumps({'text': text, 'mode': 'gfm', 'context': 'me/style-map'}).encode(),
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'readme-check'})
    html = urllib.request.urlopen(req, timeout=30).read().decode()
    open(TMP_HTML, 'w', encoding='utf-8').write(CSS + html)
    print('渲染 HTML', len(html), flush=True)

    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1000, 'height': 1200}, device_scale_factor=1)
        await pg.goto('file:///' + TMP_HTML.replace('\\', '/'), wait_until='load')
        await pg.wait_for_timeout(2500)
        h = await pg.evaluate("() => document.body.scrollHeight")
        print('页面高度', h, flush=True)
        await pg.screenshot(path=os.path.join(OUT, '_preview_full.png'), full_page=True)
        # 风格矩阵所在区块
        box = await pg.evaluate("""() => {
            const hs = [...document.querySelectorAll('h2')];
            const el = hs.find((x) => x.textContent.includes('12 种'));
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { y: r.top + window.scrollY }; }""")
        if box:
            await pg.evaluate(f"() => window.scrollTo(0, {box['y'] - 40})")
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=os.path.join(OUT, '_preview_styles.png'))
        await b.close()
    print('  ✓ 预览截图完成', flush=True)
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
