#!/usr/bin/env python3
"""给展示图加 1px 细边框（白底上浅色图才有边界），再重出 README 预览截图。"""
import asyncio, json, os, sys, urllib.request
from PIL import Image, ImageOps
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIR = os.path.join(ROOT, 'docs', 'screenshots')
HTML_PATH = os.path.join(ROOT, '_readme_preview.html')
BORDER = (226, 226, 219)

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


def add_border():
    n = 0
    for f in sorted(os.listdir(DIR)):
        if not (f.startswith('style-') or f.startswith('frame-')) or not f.endswith('.webp'):
            continue
        p = os.path.join(DIR, f)
        im = Image.open(p).convert('RGB')
        im = ImageOps.expand(im, border=1, fill=BORDER)
        im.save(p, 'WEBP', quality=92, method=6)
        n += 1
    print(f'  加边框 {n} 张', flush=True)


async def shoot():
    text = open(os.path.join(ROOT, 'README.md'), encoding='utf-8').read()
    req = urllib.request.Request('https://api.github.com/markdown',
                                 data=json.dumps({'text': text, 'mode': 'gfm', 'context': 'me/style-map'}).encode(),
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'readme-check'})
    html = urllib.request.urlopen(req, timeout=30).read().decode()
    open(HTML_PATH, 'w', encoding='utf-8').write(CSS + html)

    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1000, 'height': 1100}, device_scale_factor=1)
        await pg.goto('file:///' + HTML_PATH.replace('\\', '/'), wait_until='load')
        await pg.wait_for_timeout(3000)
        await pg.screenshot(path=os.path.join(DIR, '_preview_top.png'))
        for key, name in [('12 种', '_preview_styles.png'), ('画框：', '_preview_frame.png')]:
            y = await pg.evaluate("""(k) => { const hs = [...document.querySelectorAll('h2')];
                const el = hs.find((x) => x.textContent.includes(k));
                return el ? el.getBoundingClientRect().top + window.scrollY : null; }""", key)
            if y is None:
                continue
            await pg.evaluate(f"() => window.scrollTo(0, {y - 30})")
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=os.path.join(DIR, name))
        await b.close()
    print('  预览截图完成', flush=True)


async def main():
    add_border()
    await shoot()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:300], flush=True)
    os._exit(1)
