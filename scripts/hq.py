import asyncio, os, sys
from playwright.async_api import async_playwright
URL_HQ = 'http://127.0.0.1:8901/?proxy=1'
URL_LOW = 'http://127.0.0.1:8901/?q=low&proxy=1'
OUT = os.path.join(os.path.dirname(__file__), '..', 'shots')
key = sys.argv[1] if len(sys.argv) > 1 else 'realistic'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800})
        logs=[]
        pg.on('pageerror', lambda e: logs.append('[pageerror] '+str(e)))
        await pg.goto(URL_HQ, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=150000)
        await pg.wait_for_timeout(6000)
        await pg.evaluate("k => document.querySelector(`.style-tab[data-k='${k}']`).click()", key)
        await pg.wait_for_timeout(14000)
        await pg.screenshot(path=os.path.join(OUT, f'hq_{key}.png'))
        print('\n'.join(logs))
        await b.close()
    sys.stdout.flush(); os._exit(0)
asyncio.run(main())
