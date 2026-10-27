/* ============================================================
   地形着色器：10 种制图风格 + 高度场自阴影（raymarch）
   ============================================================ */

export const VERT = /* glsl */`
uniform sampler2D uHeight;
uniform float uHeightScale;
uniform float uGrowth;

varying vec2 vUv;
varying vec3 vWorld;
varying float vH;

void main(){
  vUv = uv;
  float h = texture2D(uHeight, uv).r;
  vH = h;

  // 生长动画：由中心向外的波
  float delay = length(uv - vec2(0.5)) * 0.95;
  float g = clamp((uGrowth * 1.55 - delay) / 0.75, 0.0, 1.0);
  g = g * g * (3.0 - 2.0 * g);

  vec3 p = position;
  p.y = h * uHeightScale * g;

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FRAG = /* glsl */`
precision highp float;

varying vec2 vUv;
varying vec3 vWorld;
varying float vH;

uniform sampler2D uHeight;
uniform sampler2D uMask;
uniform sampler2D uRamp;

uniform vec2  uTexel;
uniform vec2  uSpan;
uniform float uPix;      // 距离 1 处一个屏幕像素的世界尺寸
uniform float uPx;       // 当前取景下「一个屏幕像素」对应的世界尺寸（逐帧、全帧恒定）
uniform float uHeightScale;
uniform float uMinH;
uniform float uMaxH;
uniform float uTime;
uniform float uGrowth;

uniform vec3  uSunDir;
uniform vec3  uPaper;
uniform vec3  uInk;
uniform vec3  uAccent;
uniform vec3  uFogColor;
uniform vec3  uSeaCol;

uniform int   uStyle;
uniform float uShadowOn;
uniform float uShadowStr;
uniform float uShadowLen;
uniform float uAOAmt;
uniform float uContourOn;
uniform float uContourStep;
uniform float uContourW;
uniform float uLineDensity;
uniform float uPaperAmt;
uniform float uFog;
uniform float uGlow;
uniform float uBands;
uniform float uSnowLine;
uniform float uRim;
uniform float uCloudAmt;
uniform float uStepK;     // 画质档：步数系数（低配机把体素/阴影步进砍半）
/* 云影：最多 6 团体积云的真实投影参数（xz 中心、r 半径、a 强度，世界 km）。
   旧实现用固定 fbm 撒一片斑点，云挪走了影子还在原地 —— 一眼假。 */
uniform int   uCloudN;
uniform vec4  uCloudP[6];
uniform float uCloudBaseY;

/* ---------- 噪声 ---------- */
float hash21(vec2 p){
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.567);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

/* ---------- 高度与法线 ---------- */
float Hm(vec2 uv){ return texture2D(uHeight, clamp(uv, vec2(0.0012), vec2(0.9988))).r; }

vec3 normalAt(vec2 uv, out vec2 grad){
  float hs = uHeightScale;
  float k = 3.0;
  float gx = (Hm(uv + vec2(uTexel.x * k, 0.0)) - Hm(uv - vec2(uTexel.x * k, 0.0))) * hs / (uSpan.x * uTexel.x * 2.0 * k);
  float gz = (Hm(uv + vec2(0.0, uTexel.y * k)) - Hm(uv - vec2(0.0, uTexel.y * k))) * hs / (uSpan.y * uTexel.y * 2.0 * k);
  grad = vec2(gx, gz);
  return normalize(vec3(-gx, 1.0, gz));
}

/* ---------- 高度场自阴影 ---------- */
float sampleHkm(vec3 p){
  vec2 uv = vec2((p.x + uSpan.x * 0.5) / uSpan.x, 0.5 - p.z / uSpan.y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return -300.0;
  return texture2D(uHeight, uv).r * uHeightScale;
}
float sunShadow(){
  if (uShadowOn < 0.5) return 1.0;
  // 步数按画质档缩放：这是满屏最贵的一处，每像素 20 次纹理采样。
  // 实测（420×300 / 真实画质）关掉它只省 ~0，因为整个地形是 fill-bound；
  // 但真 GPU 上它是逐像素的主要成本，所以仍降到 12 步 + 早退。
  int ns = int(clamp(12.0 * uStepK, 4.0, 12.0));
  // 步长按步数重算：射线总长仍是 uShadowLen，步数少则每步跨度大（阴影更糙但不脱节）
  float stepLen = uShadowLen / float(ns);
  vec3 p = vWorld + uSunDir * (stepLen * 1.5);
  float occ = 0.0;
  for (int i = 1; i <= 20; i++){
    if (i > ns) break;
    p += uSunDir * stepLen;
    float hh = sampleHkm(p);
    float d = p.y - hh;
    occ = max(occ, 1.0 - clamp(d / (stepLen * 1.4), 0.0, 1.0));
    // 已经完全遮蔽：继续采样不会改变结果（山影区几乎第一步就饱和）
    if (occ > 0.995) break;
  }
  return 1.0 - occ * uShadowStr;
}

/* ---------- 云影 ---------- */
/* 真实投影：把地面点沿太阳方向抬升到云底高度，看它落在哪几团云的正下方。
   旧实现用固定 fbm 撒一片斑点，云挪走了影子还留在原地 —— 一眼假。
   uCloudP[i] = (中心x, 中心z, 半径km, 强度)，uCloudBaseY = 云底世界高度 km。 */
float cloudShadow(){
  if (uCloudAmt < 0.01 || uCloudN <= 0) return 1.0;
  float dy = max(uCloudBaseY - vWorld.y, 0.5);
  float k = dy / max(0.15, abs(uSunDir.y));          // 太阳越低，影子拉得越长
  vec2 base = vWorld.xz - uSunDir.xz * k;
  float occ = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= uCloudN) break;
    vec4 p = uCloudP[i];
    float d = length(base - p.xy) / max(1e-3, p.z);
    // 圆盘内近乎全遮、外缘 35% 过渡，模拟云团软边
    occ = max(occ, (1.0 - smoothstep(0.62, 1.15, d)) * p.w);
  }
  return 1.0 - clamp(occ, 0.0, 1.0) * uCloudAmt * 0.72;
}

/* ---------- 等高线 / 排线 ---------- */
float contourAt(float h, float step, float w){
  if (step < 1.0) return 0.0;
  float f = h / step;
  float fw = fwidth(f);                       // 一个像素跨过几根等值线
  // 一根线摊不到约 2 像素时，继续画只会得到亚像素摩尔纹：
  // 屏幕上表现为「整片糊成均匀灰」，这才是纸本风格缩放变小后发灰的真凶。
  // 密到画不动就淡出，把表达山形的活交给排线和色阶。
  // 一根线要占住约 7 像素才看得清：密到这个程度以下就淡出，
  // 否则屏幕上是一片细密蜿蜒纹，把排线整片盖住（省级全览糊成「蚯蚓图」就是这个）。
  float dens = 1.0 - smoothstep(0.055, 0.135, fw);
  if (dens < 0.002) return 0.0;
  float aa = fw * 1.15 + 1e-5;
  float d = abs(fract(f + 0.5) - 0.5);
  return (1.0 - smoothstep(0.0, aa * max(w, 0.35), d)) * dens;
}
float hatchLine(vec2 p, float ang, float freq, float aa){
  float s = sin((p.x * cos(ang) + p.y * sin(ang)) * freq);
  return smoothstep(-aa, aa, s);
}
/* 细线：在正弦过零点附近取很窄的一段。
   ⚠ 两个坑都踩过：
   1) 相位扰动幅度必须远小于线宽（0.05 vs 0.19），否则线被自己推离过零点；
   2) 线宽必须按「像素」给再反算相位半宽 —— 直接写相位值时，
      sp=26px 笔距下 0.09 rad 只折合 0.8 像素，不足一个像素就必然采样成点。
      这一条才是「线稿排线」长期糊成一片细砂的根因。 */
float stripePx(vec2 p, float ang, float pitchPx, float widthPx){
  float freq = 6.2831 / max(pitchPx, 2.5);
  float w = max(widthPx * 0.5 * freq, 1e-4);
  float s = sin((p.x * cos(ang) + p.y * sin(ang)) * freq + 0.05 * sin(dot(p, vec2(0.011, 0.014)) * 6.0));
  return 1.0 - smoothstep(0.0, w, abs(s));
}
/* 流线排线（方向混合版）
   直接用「局部坡向」做相位 dot(p, perp(theta)) 是不可行的：方向场逐像素微转，
   相位就逐像素漂移，一条线会被撕成一串碎点（试过连续方向场、量化档位、
   fwidth 线宽下限，都只是把碎点换一种碎法）。
   可靠做法来自铜版排线的老办法：预置 8 个固定方向的排线场，每个场的相位只依赖
   固定方向（因此绝对连续），再按该方向与坡向的接近程度做权重混合。
   混合权重连续变化 → 笔迹在方向之间「渐变」，永远不会断开。 */
float hachureOct(vec2 p, float theta, float freq, float w, float sharp){
  float acc = 0.0, wsum = 0.0;
  for (int i = 0; i < 4; i++){
    float a = float(i) * 0.7853982;         // 45° 一档：档位少 → 笔迹能连得更长
    vec2 n = vec2(-sin(a), cos(a));         // 场方向 a 的法线 → 排线沿 a 走
    float s = abs(sin(dot(p, n) * freq + float(i) * 2.3));
    float ln = 1.0 - smoothstep(0.0, w, s);
    float wt = pow(max(0.0, cos(2.0 * (a - theta))), sharp);
    acc += ln * wt;
    wsum += wt;
  }
  return acc / max(wsum, 1e-4);
}
float hachure(vec2 xz, vec2 grad, float freq, float w){
  float l = length(grad);
  if (l < 1e-5) return 0.0;
  vec2 g = grad / l;
  // 角度量化：相邻像元的排线方向一致，才像刻线而不是噪点
  float ang = atan(g.y, g.x);
  ang = floor(ang / 0.3927 + 0.5) * 0.3927;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 perp = vec2(-dir.y, dir.x);
  float t = dot(xz, perp) * freq;
  float fw = fwidth(t);
  // 笔距不足约 2 像素时同样淡出（理由同 contourAt）：糊成灰不如不画
  float dens = 1.0 - smoothstep(0.22, 0.55, fw);
  return (1.0 - smoothstep(0.0, max(w, fw * 0.9), abs(sin(t)))) * dens;
}

void main(){
  /* ⚠ 蒙版早退必须放在第一行。
     地形网格是「区域包围盒」的矩形，轮廓以外那圈像素原本也要跑完整套着色
     （法线 4 次纹理 + 自阴影 12 步 + 云影 + fbm + 等高线 + 排线 + 色带），
     一直算到函数末尾才被 discard —— 省级是异形轮廓，这片空白常占屏幕 30%~50%。
     在入口就采样 mask 剔除，省掉的是纯白费的全套 ALU。 */
  if (texture2D(uMask, vUv).r < 0.42) discard;

  vec2 uv = vUv;
  float h = vH;
  float hn = clamp((h - uMinH) / max(1.0, uMaxH - uMinH), 0.0, 1.0);

  vec2 grad;
  vec3 N = normalAt(uv, grad);
  float slope = length(grad);
  // slope 是「垂直夸张之后」的量，各风格的阈值都是按真实坡度写的，
  // 这里还原一次，改夸张倍数时阈值才不会整体失效
  float slopeR = slope * 0.001 / max(uHeightScale, 1e-5);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndl = dot(N, uSunDir);
  float lit = clamp(ndl, 0.0, 1.0);
  float sh = sunShadow() * cloudShadow();
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  // 纸纹用世界空间低频：uv*780 在屏幕上已退化成每像素一点，会把排线糊成噪点
  float grain = fbm(vWorld.xz * 0.28);
  float grain2 = vnoise(gl_FragCoord.xy * 0.75);
  vec3 rampC = texture2D(uRamp, vec2(hn, 0.5)).rgb;
  float fogF = 1.0 - exp(-distance(cameraPosition, vWorld) * uFog * 0.0009);

  /* 平滑法线 / 坡度 —— 纸本风格的「调子」只能用它。
     逐像元梯度是噪声：调子跟着逐像素抖动，排线沿自身方向忽亮忽灭，
     屏幕上就是一串断点（看着像虚线，其实是亮度在跳）。
     窗口 18 个像元（≈8km）：够抹掉噪声，又不会把山丘一起抹平；
     用 110（≈50km）实测会把整省拍成一片缓坡，调子全落进最浅档，画面发白。 */
  const float KS = 8.0;
  float hE = Hm(uv + vec2(uTexel.x * KS, 0.0)), hW = Hm(uv - vec2(uTexel.x * KS, 0.0));
  float hN = Hm(uv + vec2(0.0, uTexel.y * KS)), hS = Hm(uv - vec2(0.0, uTexel.y * KS));
  vec2 gs = vec2(hE - hW, hN - hS) * uHeightScale / (2.0 * KS * uTexel.xy * uSpan.xy);
  vec3 Ns = normalize(vec3(-gs.x, 1.0, gs.y));
  float slopeSm = length(gs) * 0.001 / max(uHeightScale, 1e-5);
  float litSm = clamp(dot(Ns, uSunDir), 0.0, 1.0);
  /* 局部起伏：当前点相对 ~4km 均值的偏离，归一化到 0~1。
     省级全览下「坡度」会被大范围平均掉（整省看上去都是缓坡），
     只看坡度的话调子全挤在最浅一档、画面发白。起伏量才分得出山脊和谷地，
     而且山脊、谷底都有值 —— 这正好是排线地图该加深的地方。 */
  float reliefSm = abs(h - (hE + hW + hN + hS) * 0.25) / max(1.0, uMaxH - uMinH);

  vec3 col = rampC;
  vec3 paper = uPaper;
  float ink = 0.0;

  if (uStyle == 0) {
    /* ── 分层设色 ── */
    vec3 c = rampC;
    if (uBands > 1.5) {
      float q = floor(hn * uBands) / uBands + 0.5 / uBands;
      c = texture2D(uRamp, vec2(clamp(q, 0.0, 1.0), 0.5)).rgb;
    }
    float lam = clamp(ndl, 0.0, 1.0);
    float ao = 1.0 - uAOAmt * 0.30 * smoothstep(0.25, 1.05, slopeR);
    c *= (0.32 + 0.90 * lam) * mix(0.50, 1.0, sh) * ao;
    c *= mix(vec3(0.74, 0.82, 1.00), vec3(1.07, 1.02, 0.93), smoothstep(0.25, 0.95, lam));
    c = mix(c, c * vec3(0.80, 0.86, 1.00), (1.0 - sh) * 0.40);
    if (uBands > 1.5) {
      float bf = fract(hn * uBands);
      c *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.05, bf));
    }
    c = mix(c, c * 1.14 + 0.02, smoothstep(0.70, 1.0, hn) * 0.5);
    c += uAccent * 0.10 * pow(lam, 4.0) * uGlow;
    if (uContourOn > 0.5) c = mix(c, uInk, contourAt(h, uContourStep, uContourW) * 0.30);
    c = mix(c, uFogColor, clamp(fogF, 0.0, 1.0) * 0.4);
    col = c;

  } else if (uStyle == 1) {
    /* ── 线稿排线 ──
       要点：
       1) 底子必须是「纸白」，不能铺一层灰调 —— 旧版 ink 起始值 0.07
          等于全画面蒙一层灰，这就是「灰糊」的一半原因；
       2) 屏幕空间三档排线笔距以像素计，缩放时线宽恒定，不会退化成噪点；
       3) 坡向刻线用世界空间 hachure，但笔距不足两像素时由它自己淡出。 */
    // 调子 = 背光 + 坡度。只靠背光不行：顺光时整片留白、换个光源方位整片翻黑。
    // ⚠ 这里必须用「大窗口平滑梯度」而不是逐像元梯度：
    //   逐像元梯度是噪声，调子会跟着逐像素抖动，排线沿自身方向忽亮忽灭，
    //   屏幕上就是一串断点（看着像虚线，其实是亮度在跳）。
    //   铅笔风格早就做了这层平滑，线稿风格一直没做 —— 这才是断线的根因。
    // 窗口 18 个像元（≈8km）：足够抹掉逐像元噪声，又不会把山丘一起抹平。
    // 用 110（≈50km）实测会把整省拍成一片缓坡，调子全部落进最浅一档，画面发白。

    // 坡度项的斜率要压得陡（0.05→0.55）：省级全览里山丘的真实坡度多在 0.3 上下，
    // 阈值放宽到 0.68 会让平原和山地一起顶到最高档，整张图变成一张均匀格网。
    float shade = 1.0 - litSm;
    float rel = smoothstep(0.015, 0.16, reliefSm);
    float tone = clamp(0.06 + 0.62 * shade + 0.80 * rel + 0.30 * smoothstep(0.05, 0.55, slopeSm), 0.0, 1.0);

    vec2 fp = gl_FragCoord.xy;
    float sp = 26.0 / max(uLineDensity, 0.35);      // 笔距（像素）
    float b1 = stripePx(fp, 0.98, sp, 1.75);
    float b2 = stripePx(fp, -0.46, sp * 1.30, 1.70);
    float b3 = stripePx(fp, 0.24, sp * 0.88, 1.60);
    float ha = hachure(vWorld.xz, grad, 1.10 * uLineDensity, 0.34);

    // 三档线彼此交叉：深色区才是真「排线」，浅色区只有单向细线。
    // 档位要拉开（0.30/0.55/0.78），否则三档同时命中，整片变成格网。
    ink = 0.0;
    ink = max(ink, smoothstep(0.26, 0.48, tone) * 0.52 * b1);
    ink = max(ink, smoothstep(0.50, 0.70, tone) * 0.72 * b2);
    ink = max(ink, smoothstep(0.72, 0.92, tone) * 0.95 * b3);
    ink = max(ink, smoothstep(0.20, 0.85, slopeSm) * 0.26 * ha);
    ink = max(ink, contourAt(h, uContourStep, uContourW) * 0.88);
    ink = clamp(ink, 0.0, 0.96);
    col = mix(paper, uInk, ink);

  } else if (uStyle == 2) {
    /* ── 手绘铅笔（流线排线） ──
       参考《A New Take on an Old Style》：细铅笔线沿坡面下泄方向流动，
       山脊近乎留白、沟谷处线密且交叉。
       要点：
       1) 排线用「8 个固定方向场 + 按坡向加权混合」（hachureOct），
          相位只依赖固定方向 → 天然连续，不会因坡向微转而碎成麻点；
       2) 梯度要在很大窗口上平滑，逐像元的 DEM 梯度是噪声；
       3) 线宽必须有「至少 1 像素」的下限（由 uPix 换算），否则被采样成麻点；
       4) 疏密只靠宽度与门限调，不能改频率 —— 频率一变相位就变，同样断线。 */
    // 调子必须用平滑后的法线/坡度：逐像元梯度是噪声，排线会沿自身方向忽亮忽灭
    float shadeTerm = smoothstep(0.18, 0.92, 1.0 - litSm);
    float slopeTerm = smoothstep(0.02, 0.20, reliefSm) * 0.75 + smoothstep(0.06, 0.60, slopeSm) * 0.25;
    float tone = clamp(0.10 + 0.90 * shadeTerm + 0.26 * slopeTerm, 0.0, 1.0);
    tone *= mix(0.52, 1.06, sh);
    tone = clamp(tone, 0.0, 1.0);

    // 两级平滑梯度加权：近尺度保局部沟壑，远尺度保整体坡向，避免方向场抖
    float k1 = 90.0, k2 = 240.0;
    vec2 g1 = vec2(
      Hm(uv + vec2(uTexel.x * k1, 0.0)) - Hm(uv - vec2(uTexel.x * k1, 0.0)),
      Hm(uv + vec2(0.0, uTexel.y * k1)) - Hm(uv - vec2(0.0, uTexel.y * k1))
    );
    vec2 g2 = vec2(
      Hm(uv + vec2(uTexel.x * k2, 0.0)) - Hm(uv - vec2(uTexel.x * k2, 0.0)),
      Hm(uv + vec2(0.0, uTexel.y * k2)) - Hm(uv - vec2(0.0, uTexel.y * k2))
    );
    vec2 sgrad = g1 * 0.70 + g2 * (0.30 * k1 / k2);

    // 笔距 ≈ span/34；密度滑块只影响宽度与门限，不改相位
    float fqBase = 6.2832 * 88.0 / max(uSpan.x, uSpan.y) * max(uLineDensity, 0.35);
    // 但「笔距」在屏幕上不能小于约 13 像素：线宽有 ~1.3 像素的物理下限，
    // 笔距再小，线就吃掉一半以上的间隙，排线退化成一块均匀灰面 ——
    // 省级全览（一张图铺 470km）糊成灰白噪点就是这个原因。
    // uPx 是「相机到目标点」的像素尺度（逐帧、全帧同一个值），
    // 用它而不是逐像素景深来夹频率，才不会因深度不同把相位撕断。
    float fq = min(fqBase, 6.2832 / max(12.0 * uPx, 1e-9));

    // 平地上古版画是留白的，只有坡面才有笔迹
    float gate = smoothstep(0.02, 0.18, tone) * smoothstep(0.03, 0.16, slopeR);

    /* 主排线改用「屏幕空间四级调子阶梯」。
       之前让坡向排线当主角，它在省级尺度必须每段换一次方向，
       于是整张图被切成一根根短须（像没画完的草图）。
       老铜版的做法是：排线方向由光位决定、整幅统一，浓淡靠加档；
       坡向只留薄薄一层做皮质。这样笔迹才能拉得长、看得出是「线」。 */
    vec2 fp = gl_FragCoord.xy;
    float sp = 22.0 / max(uLineDensity, 0.35);       // 笔距（像素）
    float e1 = stripePx(fp, 1.05, sp, 1.45);
    float e2 = stripePx(fp, -0.58, sp * 1.18, 1.40);
    float e3 = stripePx(fp, 0.38, sp * 0.92, 1.30);

    float inkV = 0.0;
    inkV = max(inkV, smoothstep(0.14, 0.40, tone) * 0.48 * e1);
    inkV = max(inkV, smoothstep(0.40, 0.62, tone) * 0.64 * e2);
    inkV = max(inkV, smoothstep(0.62, 0.84, tone) * 0.82 * e3);
    // 坡向刻线：只当薄皮质（0.20），别让它主导
    inkV = max(inkV, hachure(vWorld.xz, sgrad, fq * 0.85, 0.30) * gate * 0.20);

    // 等高线：老图里排线总配一道细等高线，缩放变小以后靠它撑住山形可读性
    inkV = max(inkV, contourAt(h, uContourStep, uContourW * 0.85) * 0.48);

    // 最暗处补一点铅笔灰，压住纸白；再用低频噪声做笔压起伏
    inkV = max(inkV, smoothstep(0.88, 1.0, tone) * 0.12);
    inkV *= 0.86 + 0.20 * fbm(vWorld.xz * 0.045 + 11.0);

    vec3 pap = mix(paper, vec3(0.995, 0.993, 0.985), 0.70) * (0.990 + 0.010 * grain);
    vec3 inkCol = mix(uInk * 0.92, uInk, 0.50);
    // 先铺一层极淡的铅笔调子，稀疏处也能读出山形
    vec3 base = mix(pap, inkCol, clamp(tone * 0.09, 0.0, 0.12));
    col = mix(base, inkCol, clamp(inkV, 0.0, 0.90));

  } else if (uStyle == 3) {
    /* ── 写实光影 ──
       不做"白色石膏"：以材质（草/土/岩/雪）为反照率，用暖色直射光 +
       冷色天光 + 地面反弹合成，细节法线扰动让表面不再是光滑塑料。 */
    // 细节法线：让山体表面有碎屑感，而不是一层光滑的模
    float bumpA = fbm(vWorld.xz * 2.1);
    float bumpB = fbm(vWorld.xz * 7.4);
    vec3 Nb = normalize(N + vec3((bumpA - 0.5) * 0.30, 0.0, (bumpB - 0.5) * 0.20));

    // 材质：低地田畴 / 山坡林地 / 陡崖裸岩 / 山脊枯草 / 高处积雪
    float pA = fbm(vWorld.xz * 0.42);
    float pB = fbm(vWorld.xz * 1.15);
    float field = smoothstep(0.52, 0.14, hn) * smoothstep(0.30, 0.86, pB);
    vec3 farm  = mix(vec3(0.150, 0.198, 0.078), vec3(0.268, 0.283, 0.108), pB);
    vec3 grass = mix(vec3(0.062, 0.138, 0.046), vec3(0.158, 0.238, 0.078), pA);
    vec3 wood  = mix(vec3(0.030, 0.068, 0.034), vec3(0.072, 0.118, 0.052), pB);
    vec3 soil  = mix(vec3(0.222, 0.170, 0.108), vec3(0.318, 0.250, 0.162), pB);
    vec3 stone = mix(vec3(0.222, 0.212, 0.198), vec3(0.352, 0.338, 0.322), pB);

    vec3 alb = mix(grass, farm, field * 0.85);
    // 沟谷阴湿处压成深林地，这是"光与阴"能读出来的一半原因
    alb = mix(alb, wood, smoothstep(0.45, 0.10, hn) * smoothstep(0.25, 1.10, slopeR) * 0.62);
    // 中高海拔转干：越往上草越枯、土石越多，避免整座山一个绿色（"绿蘑菇"感）
    alb = mix(alb, soil, smoothstep(0.26, 0.78, hn) * 0.38);
    float rock = smoothstep(0.72, 1.45, slopeR);
    alb = mix(alb, stone, rock * 0.92);
    // 山脊枯草
    alb = mix(alb, vec3(0.222, 0.208, 0.124), smoothstep(0.66, 0.96, hn) * (1.0 - rock) * 0.26);

    // 雪：按雪线，坡度太陡挂不住
    float snowMask = smoothstep(uSnowLine - 0.03, uSnowLine + 0.10, hn);
    snowMask *= 1.0 - smoothstep(0.80, 1.50, slopeR) * 0.7;
    alb = mix(alb, vec3(0.930, 0.945, 0.965), snowMask * 0.94);

    // 所选配色只做很轻的色偏，不能把材质本身洗掉
    float lum = dot(rampC, vec3(0.299, 0.587, 0.114));
    vec3 tint = rampC / max(lum, 0.08);
    alb = mix(alb, alb * clamp(tint, 0.5, 1.9), 0.20);
    alb *= 0.82 + 0.34 * hn;              // 高处更亮更干

    // 光照：直射（暖）+ 天光（冷）+ 地面反弹。
    // 直射用半兰伯特混合，背光面留一点形体，而不是死黑一片。
    float nl = dot(Nb, uSunDir);
    float wrap = clamp(nl * 0.5 + 0.5, 0.0, 1.0);
    float direct = mix(wrap, max(nl, 0.0), 0.86) * sh;
    vec3 sunCol = vec3(1.62, 1.50, 1.22);
    vec3 skyCol = vec3(0.092, 0.132, 0.215) * (0.50 + 0.50 * Nb.y);
    vec3 bounce = vec3(0.062, 0.055, 0.040) * (1.0 - Nb.y) * 0.85;

    vec3 c = alb * (sunCol * direct + skyCol + bounce);
    // 受光偏暖、背光偏冷：这是肉眼判断"这是太阳照的"最主要的线索
    c *= mix(vec3(0.82, 0.88, 1.08), vec3(1.07, 1.02, 0.93), smoothstep(0.18, 0.80, direct));

    // 湿岩 / 雪的微弱高光，让受光面"有质感"
    vec3 Hv = normalize(uSunDir + V);
    float spec = pow(max(dot(Nb, Hv), 0.0), 42.0);
    c += vec3(0.55, 0.60, 0.66) * spec * (snowMask * 0.55 + rock * 0.10) * sh;

    // 沟谷环境遮蔽
    c *= 1.0 - uAOAmt * 0.42 * smoothstep(0.30, 1.25, slopeR) * (1.0 - 0.4 * direct);

    // 大气透视（只在远处轻推，数值刻意做小）
    float dist = distance(cameraPosition, vWorld);
    float haze = 1.0 - exp(-dist * 0.00022 * (0.35 + uFog * 2.2));
    vec3 hazeCol = mix(uFogColor, vec3(0.72, 0.78, 0.85), 0.35);
    c = mix(c, hazeCol, clamp(haze, 0.0, 0.58));

    col = c;

  } else if (uStyle == 4) {
    /* ── 单色浮雕 ── */
    vec3 c = rampC;
    float lam = max(ndl, 0.0) * sh;
    float ao = 1.0 - uAOAmt * 0.55 * smoothstep(0.15, 0.90, slopeR);
    c *= (0.62 + 0.62 * lam) * mix(0.76, 1.0, sh) * ao;
    c += uAccent * 0.10 * pow(lit, 6.0) * uGlow;
    c = mix(c, c * 0.72 + uAccent * 0.18, smoothstep(0.84, 1.0, hn) * 0.4);
    col = c;

  } else if (uStyle == 5) {
    /* ── 冰蓝金岩 ── */
    vec3 c = rampC;
    float lam = max(ndl, 0.0) * sh;
    c *= (0.32 + 0.95 * lam);
    float gold = smoothstep(0.46, 0.86, hn + (grain - 0.5) * 0.09);
    c = mix(c, uAccent * (0.40 + 0.85 * lam), gold * 0.72);
    c += uAccent * pow(fres, 3.0) * 0.22 * uRim;
    c += vec3(0.04, 0.06, 0.07) * pow(1.0 - lit, 3.0);
    col = c;

  } else if (uStyle == 6) {
    /* ── 霓虹熔岩 ── */
    vec3 c = rampC;
    c *= 0.55 + 0.95 * pow(clamp(hn, 0.0, 1.0), 1.5);
    c += uAccent * pow(lit, 5.0) * 0.55 * uGlow;
    c += uAccent * smoothstep(0.28, 1.05, slopeR) * 0.22 * uGlow;
    if (uContourOn > 0.5) c += uAccent * contourAt(h, uContourStep, uContourW) * 0.5;
    c += uAccent * pow(fres, 2.0) * 0.25 * uRim;
    col = c;

  } else if (uStyle == 7) {
    /* ── 白模石膏 ── */
    float lam = max(ndl, 0.0) * sh;
    float ao = 1.0 - uAOAmt * 0.30 * smoothstep(0.20, 1.10, slopeR);
    vec3 c = paper * (0.80 + 0.34 * lam) * mix(0.66, 1.0, sh) * ao;
    c = mix(c, paper * 0.50, (1.0 - sh) * 0.62);
    c += vec3(0.018, 0.019, 0.02) * fres;
    c = mix(c, uFogColor, clamp(fogF, 0.0, 1.0) * 0.35);
    col = c;

  } else if (uStyle == 8) {
    /* ── 墨色剪影 ── */
    vec3 c = mix(uInk, paper, smoothstep(0.0, 1.0, hn) * 0.55 + 0.12);
    c *= 0.55 + 0.75 * max(ndl, 0.0) * max(sh, 0.35);
    c += uAccent * pow(fres, 2.4) * 0.55 * uRim;
    c += uAccent * 0.10 * pow(max(ndl, 0.0), 3.0);
    col = c;

  } else if (uStyle == 9) {
    /* ── 纸雕分层 ── */
    float bands = max(6.0, uBands);
    float q = floor(hn * bands) / bands;
    float f = fract(hn * bands);
    vec3 c = texture2D(uRamp, vec2(clamp(q + 0.5 / bands, 0.0, 1.0), 0.5)).rgb;
    float lam = max(ndl, 0.0) * sh;
    c *= 0.70 + 0.48 * lam;
    c *= 0.80 + 0.20 * smoothstep(0.0, 0.10, f);
    c = mix(c, uInk, (1.0 - smoothstep(0.0, 0.03, f)) * 0.32);
    c += vec3(0.03) * pow(fres, 2.0);
    col = c;

  } else {
    /* ── 历史地图（羊皮纸） ──
       做旧纸底 + 古典晕渲（暗部堆棕墨，亮部留白）+ 古墨等高线 + 边缘焦痕 */
    float stain = fbm(vWorld.xz * 0.42);
    float fiber = fbm(vec2(vWorld.x * 9.0, vWorld.z * 2.6));
    float spot = fbm(vWorld.xz * 0.16 + 31.0);

    vec3 pap = uPaper;
    pap = mix(pap, pap * vec3(0.90, 0.84, 0.72), smoothstep(0.40, 0.86, stain) * 0.75);
    pap = mix(pap, pap * vec3(0.82, 0.76, 0.68), smoothstep(0.62, 0.95, spot) * 0.55);
    pap *= 0.965 + 0.06 * fiber;

    // 古典晕渲：暗部用棕墨堆积
    float shade = clamp(1.0 - (lit * 0.94 + 0.06), 0.0, 1.0);
    shade *= mix(0.50, 1.0, sh);
    shade = pow(shade, 0.88);
    vec3 brown = uInk;
    vec3 c = mix(pap, brown, smoothstep(0.06, 0.96, shade) * 0.74);

    // 陡坡加一道更深的褐，像铅笔勾过山脊
    c = mix(c, brown * 0.82, smoothstep(0.85, 1.90, slopeR) * 0.22);

    // 等高线：古墨细线
    float cl = contourAt(h, uContourStep, uContourW * 0.9);
    c = mix(c, brown * 0.86, cl * 0.55);

    // 纸张边缘做旧
    float edge = smoothstep(0.0, 0.085, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    c *= mix(0.70, 1.0, edge);

    // 纸面颗粒
    c *= 1.0 - 0.055 * (grain - 0.5);
    col = c;
  }

  // 纸面颗粒（浅色风格）
  col *= 1.0 - uPaperAmt * 0.09 * (grain - 0.5);

  /* 行政边界包含大面积海域（如浙江的舟山海域），海底 DEM 是负值，
     按色带渲染会被「分层设色」切成一块块蓝色水洼。这里统一压成连续海面：
     只有真正高于海平面的陆地才保留风格化着色。 */
  // 阈值必须贴着 0m：浙北平原只有 2~4m，用 9m 做上限会把整个杭嘉湖平原刷成海
  float landK = smoothstep(-1.0, 2.0, h);
  vec3 seaC = uSeaCol * (0.76 + 0.34 * lit) * mix(0.74, 1.0, sh);
  col = mix(seaC, col, landK);

  float maskV = texture2D(uMask, uv).r;
  float alpha = smoothstep(0.40, 0.60, maskV);
  if (alpha < 0.02) discard;

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* 供独立着色器复用的值噪声（FRAG 内部自带一份，这里单独导出） */
export const NOISE = /* glsl */`
float hash21(vec2 p){
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.567);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

/* 侧壁（地块厚度） */
export const WALL_VERT = /* glsl */`
attribute float aT;      // 0=顶 1=底
attribute float aH;      // 顶点处的顶面高度（km）
varying float vT;
varying vec3 vN;
varying vec3 vW;
varying float vHh;
void main(){
  vT = aT; vHh = aH;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WALL_FRAG = /* glsl */`
precision highp float;
varying float vT;
varying vec3 vN;
varying vec3 vW;
varying float vHh;
uniform vec3 uTop;
uniform vec3 uBot;
uniform vec3 uSunDir;
uniform float uRim;
uniform float uFade;
void main(){
  vec3 n = normalize(vN);
  // 侧壁受光做柔化：锯齿边界容易让 abs(dot) 产生竖向条纹，压低对比即可熨平
  float lam = 0.70 + 0.30 * abs(dot(n, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))));
  vec3 c = mix(uTop, uBot, smoothstep(0.0, 1.0, pow(vT, 0.85)));
  c *= lam;
  // 顶部一条极窄的高光棱线，读感更像被切开的实心块体
  c += uTop * 0.14 * (1.0 - smoothstep(0.0, 0.035, vT));
  // 底部渐渐收暗，压住整块地形
  c *= 1.0 - 0.18 * smoothstep(0.55, 1.0, vT);
  gl_FragColor = vec4(c, uFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* 海面：向外淡出，避免出现生硬的矩形边界 */
export const SEA_VERT = /* glsl */`
varying vec2 vUv2;
void main(){
  vUv2 = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const SEA_FRAG = NOISE + /* glsl */`
precision highp float;
varying vec2 vUv2;
uniform vec3 uColor;
uniform float uTime;
void main(){
  float d = length(vUv2 - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.42, 0.96, d);
  float w = 0.006 * (vnoise(vUv2 * 26.0 + uTime * 0.05) - 0.5)
          + 0.004 * (vnoise(vUv2 * 70.0 - uTime * 0.08) - 0.5);
  vec3 c = uColor + w;
  gl_FragColor = vec4(c, a * 0.94);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
