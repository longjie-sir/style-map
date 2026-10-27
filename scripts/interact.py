import asyncio, os, sys
from playwright.async_api import async_playwright
URL_HQ = 'http://127.0.0.1:8901/?proxy=1'
URL_LOW = 'http://127.0.0.1:8901/?q=low&proxy=1'
OUT = os.path.join(os.path.dirname(__file__), '..', 'shots')
async def main():
    logs=[]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: logs.append('[pageerror] '+str(e)))
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type=='error' else None)
        await pg.goto(URL_LOW, wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=150000)
        await pg.wait_for_timeout(3500)
        await pg.screenshot(path=os.path.join(OUT, 'ui_default.png'))
        # 示例轨迹 + 播放
        await pg.click('[data-act="preset"]')
        await pg.wait_for_timeout(600)
        # 无头软渲染帧率极低，动画推进很慢，直接定格到 62% 便于审图
        await pg.evaluate("() => { window.__app.track.pause(); window.__app.track.progress = 0.62; }")
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=os.path.join(OUT, 'ui_track.png'))
        # 切换风格到线稿
        await pg.click('.style-tab[data-k="line"]')
        await pg.wait_for_timeout(2000)
        await pg.screenshot(path=os.path.join(OUT, 'ui_line_track.png'))
        # 生长动画
        await pg.click('[data-act="grow"]')
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=os.path.join(OUT, 'ui_growth.png'))
        await pg.wait_for_timeout(2500)
        st = await pg.evaluate("() => ({pts: window.__app.track.pts.length, prog: +window.__app.track.progress.toFixed(2), style: window.__app.state.styleKey})")
        print(st)
        # 换省份（四川）
        await pg.click('#regionBtn')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.path.join(OUT, 'ui_region_menu.png'))
        await pg.click('.rm-grid button[data-code="510000"]')
        await pg.wait_for_timeout(1000)
        try:
            await pg.wait_for_function("window.__app.state.region && window.__app.state.region.id === '510000'", timeout=120000)
        except Exception as e:
            logs.append('[timeout sc]')
        await pg.wait_for_timeout(4000)
        await pg.screenshot(path=os.path.join(OUT, 'ui_sichuan.png'))
        info = await pg.evaluate("() => ({name: window.__app.state.region.name, span: Math.round(window.__app.state.region.spanX), max: Math.round(window.__app.state.dem.max)})")
        print(info)
        await b.close()
    print('\n'.join(logs[:40]))
    sys.stdout.flush(); os._exit(0)
asyncio.run(main())
