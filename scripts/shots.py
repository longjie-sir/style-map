import asyncio, sys, os, json
from playwright.async_api import async_playwright
URL_HQ = 'http://127.0.0.1:8901/?proxy=1'
URL_LOW = 'http://127.0.0.1:8901/?q=low&proxy=1'

OUT = os.path.join(os.path.dirname(__file__), '..', 'shots')
os.makedirs(OUT, exist_ok=True)
STYLES = sys.argv[1].split(',') if len(sys.argv) > 1 else None
REGION = sys.argv[2] if len(sys.argv) > 2 else None

async def main():
    logs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=[
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--no-sandbox', '--disable-gpu-sandbox', '--enable-webgl',
        ])
        pg = await b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text}"))
        pg.on('pageerror', lambda e: logs.append("[pageerror] " + str(e)))
        pg.on('requestfailed', lambda r: logs.append(f"[reqfail] {r.url[:110]} {r.failure}"))
        await pg.goto(URL_LOW, wait_until='load')
        try:
            await pg.wait_for_function("window.__app && window.__app.state.region", timeout=120000)
        except Exception as e:
            logs.append("[timeout] region not ready: " + str(e)[:200])
        if REGION:
            await pg.evaluate("code => window.__app.state.region && load ? null : null", REGION)
        await pg.wait_for_timeout(4000)
        await pg.screenshot(path=os.path.join(OUT, 'default.png'))

        keys = STYLES or ['hypo', 'line', 'sketch', 'realistic', 'mono', 'ice', 'magma', 'plaster', 'ink', 'paper']
        for i, k in enumerate(keys):
            try:
                await pg.click(f'.style-tab[data-k="{k}"]', timeout=25000)
            except Exception as e:
                logs.append(f"[clickfail] {k} {e}")
                continue
            await pg.wait_for_timeout(2200)
            await pg.screenshot(path=os.path.join(OUT, f'style_{k}.png'))
        info = await pg.evaluate("() => { const v = window.__app.view; return {region: v.region && v.region.name, tiles: v.dem && v.dem.zoom, min: v.dem && v.dem.min, max: v.dem && v.dem.max, err: window.__lastErr||null}; }")
        print(json.dumps(info, ensure_ascii=False))
        await b.close()
    print('\n'.join(logs[:120]))
    sys.stdout.flush()
    os._exit(0)

asyncio.run(main())
