#!/usr/bin/env python3
"""云性能 A/B：新版预烘焙密度场 vs 旧版逐片元 fbm（同一个页面里热替换 fragmentShader 来比）。

软件渲染下绝对帧率没有参考价值，看的是「云这一趟相对地形多花了多少」——
地形开销在 A/B 里是常量，差值就是云的成本。
"""
import asyncio, sys, os, json
from playwright.async_api import async_playwright

URL = 'http://127.0.0.1:8901/?proxy=1'
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'shots'))

# 旧版着色器（贴地 fbm 密度，逐片元算噪声）
LEGACY = r"""
precision highp float;
varying vec3 vLocal;
layout(location = 0) out highp vec4 outColor;
#define gl_FragColor outColor
uniform vec3  uOrigin; uniform vec3 uHalf; uniform float uTime; uniform float uSeed;
uniform float uCover; uniform float uDensity; uniform float uOpacity;
uniform vec3  uLit; uniform vec3 uShade; uniform vec3 uSunDir; uniform float uSteps; uniform float uScale;

float hash31(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a = mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
                mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z);
  return a; }
float fbm3(vec3 p){ float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++){ s += a*vnoise3(p); p = p*2.11 + 11.3; a *= 0.5; } return s; }

bool boxHit(vec3 ro, vec3 rd, out float tN, out float tF){
  vec3 inv = 1.0/rd; vec3 a = (-1.0-ro)*inv; vec3 b = (1.0-ro)*inv;
  vec3 lo = min(a,b), hi = max(a,b);
  lo = mix(lo, vec3(-1e6), isnan(lo)); hi = mix(hi, vec3(1e6), isnan(hi));
  tN = max(max(lo.x,lo.y),lo.z); tF = min(min(hi.x,hi.y),hi.z);
  return tF > max(tN, 0.0);
}
float density(vec3 p, vec3 flow){
  vec3 q = p*1.7 + flow*0.6;
  vec3 wp = vec3(vnoise3(q+3.1), vnoise3(q+11.7), vnoise3(q+27.3)) - 0.5;
  vec3 pw = p + wp*0.62;
  float r2 = dot(pw,pw); if (r2 > 1.0) return 0.0;
  float shape = 1.0 - smoothstep(0.34, 1.0, sqrt(r2));
  shape *= smoothstep(-1.0,-0.30,pw.y) * (1.0 - 0.32*smoothstep(0.35,1.0,pw.y));
  if (shape < 0.012) return 0.0;
  float n = fbm3(pw*uScale + flow + uSeed*0.137);
  n = n*0.78 + fbm3(pw*uScale*2.1 - flow*1.7)*0.22;
  return max(0.0, (n - uCover)/max(1e-3, 1.0-uCover))*shape;
}
void main(){
  vec3 surfW = uOrigin + vLocal*uHalf;
  vec3 rdW = normalize(surfW - cameraPosition);
  vec3 ro = (cameraPosition - uOrigin)/uHalf;
  vec3 rd = normalize(rdW/uHalf);
  float tN, tF;
  if (!boxHit(ro, rd, tN, tF)) discard;
  tN = max(tN, 0.0); if (tF - tN < 1e-4) discard;
  vec3 flow = vec3(uTime*0.026, 0.0, uTime*0.011);
  vec3 sunL = normalize(uSunDir/uHalf);
  float steps = clamp(uSteps, 6.0, 64.0);
  float dt = (tF - tN)/steps;
  float t = tN + dt*0.5;
  vec3 acc = vec3(0.0); float trans = 1.0;
  for (int i = 0; i < 64; i++){
    if (float(i) >= steps || trans < 0.025) break;
    vec3 p = ro + rd*t;
    float d = density(p, flow);
    if (d > 0.002){
      float sh = max(density(p + sunL*0.17, flow), density(p + sunL*0.34, flow)*0.8);
      vec3 c = mix(uShade, uLit, clamp(1.0 - sh*1.7, 0.0, 1.0));
      float a = clamp(d*uDensity*dt*5.0, 0.0, 1.0)*trans;
      acc += c*a; trans *= (1.0-a);
    }
    t += dt;
  }
  float alpha = (1.0-trans)*uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(acc/max(1.0-trans,1e-4), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
"""

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


async def sample(pg, label, ms=4000):
    m = await pg.evaluate(FRAMES, ms)
    return label, m


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                                          '--no-sandbox', '--disable-gpu-sandbox'])
        pg = await b.new_page(viewport={'width': 560, 'height': 380}, device_scale_factor=1)
        pg.set_default_timeout(180000)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('[console] ' + m.text) if m.type == 'error' else None)
        await pg.goto(URL + '&q=low', wait_until='load')
        await pg.wait_for_function("window.__app && window.__app.state.region", timeout=180000)
        await pg.wait_for_timeout(9000)

        rows = []
        # 1. 无云
        await pg.evaluate("() => window.__app.layer('clouds', false)")
        await pg.wait_for_timeout(1200)
        rows.append(await sample(pg, '无云'))

        # 2. 新版体积云
        await pg.evaluate("() => { window.__app.layers.cloudMode='volume'; window.__app.layer('clouds', true); }")
        await pg.wait_for_timeout(3500)
        rows.append(await sample(pg, '体积云(新)'))

        # 3. 热替换成旧版 fbm 着色器
        ok = await pg.evaluate("""src => { const c = window.__app.clouds; if (!c.puffs.length) return 'no puffs';
            c._newSrc = c.puffs[0].mesh.material.fragmentShader;
            for (const p of c.puffs) { p.mesh.material.fragmentShader = src; p.mesh.material.needsUpdate = true; }
            return 'ok'; }""", LEGACY)
        await pg.wait_for_timeout(3500)
        rows.append(await sample(pg, '体积云(旧fbm)'))
        await pg.screenshot(path=os.path.join(OUT, 'perf_legacy.png'))

        # 4. 换回新版
        await pg.evaluate("""() => { const c = window.__app.clouds; const s = c._newSrc;
            for (const p of c.puffs) { p.mesh.material.fragmentShader = s; p.mesh.material.needsUpdate = true; } }""")
        await pg.wait_for_timeout(3000)
        rows.append(await sample(pg, '体积云(新·回切)'))

        # 5. 平面云
        await pg.evaluate("() => window.__app.layer('cloudMode', 'plane')")
        await pg.wait_for_timeout(2500)
        rows.append(await sample(pg, '平面云'))

        print('[swap]', ok, flush=True)
        print('[结果]', ' | '.join(f'{n}: {m["med"]}ms (n={m["n"]})' for n, m in rows), flush=True)
        print('[errs]', errs[:4], flush=True)
        await pg.close()
        await b.close()
    sys.stdout.flush()
    os._exit(0)

try:
    asyncio.run(main())
except Exception as e:
    print('!!! EXCEPTION:', type(e).__name__, str(e)[:400], flush=True)
    os._exit(1)
