/* ============================================================
   风格定义：每种风格 = 背景 + 默认光照参数 + 若干配色
   ============================================================ */

const P = (name, stops, extra = {}) => ({ name, stops, ...extra });

export const STYLES = [
  {
    key: 'hypo', label: '分层设色', sub: '经典等高色带 + 山体阴影',
    bg: ['#f3f3ee', '#e6e8e2'], dark: false,
    palettes: [
      P('经典地形', [[0,'#4f8a5e'],[.12,'#77a866'],[.26,'#a8bf72'],[.40,'#d2cc7d'],[.54,'#e0c17e'],[.66,'#d3a06b'],[.78,'#b8825c'],[.90,'#96674f'],[1,'#efe9dd']]),
      P('青绿山野', [[0,'#2f6b4f'],[.25,'#5d9a63'],[.5,'#93bf7a'],[.7,'#c9dba0'],[.86,'#e4e6c8'],[1,'#f7f5e6']]),
      P('深藏青',   [[0,'#0d2033'],[.22,'#164264'],[.46,'#2b7596'],[.68,'#6fb0bc'],[.84,'#b9dcd9'],[1,'#eff7f4']]),
      P('大地褐',   [[0,'#4b3f31'],[.24,'#7a6247'],[.48,'#a9885f'],[.7,'#cfb287'],[.88,'#e8dcc2'],[1,'#f6f1e4']])
    ],
    params: { bands: 16, contour: 1, contourStep: 200, shadow: 0.85, ao: 0.45, paper: 0.12, glow: 0.35, fog: 0.1, sunAz: 315, sunEl: 38 }
  },
  {
    key: 'line', label: '线稿排线', sub: '墨线 + 网点 + 坡向排线',
    bg: ['#fbfaf6', '#f2f0e9'], dark: false,
    palettes: [
      P('墨线',   [[0,'#fbfaf6'],[1,'#15171b']], { ink:'#15171b', paper:'#fbfaf6' }),
      P('铅笔灰', [[0,'#f6f4ee'],[1,'#3b3d40']], { ink:'#3b3d40', paper:'#f6f4ee' }),
      P('赭石',   [[0,'#f8f1e5'],[1,'#6b3a24']], { ink:'#6b3a24', paper:'#f8f1e5' })
    ],
    params: { bands: 0, contour: 1, contourStep: 200, shadow: 0.55, ao: 0, lineDensity: 1, paper: 0.55, glow: 0, fog: 0, sunAz: 315, sunEl: 46 }
  },
  {
    key: 'sketch', label: '素描纸本', sub: '铅笔交叉排线 + 纸纹',
    bg: ['#f7f4ec', '#eeeae0'], dark: false,
    palettes: [
      P('石墨', [[0,'#f6f3ea'],[1,'#46484a']], { ink:'#46484a', paper:'#f6f3ea' }),
      P('炭笔', [[0,'#f2efe6'],[1,'#2b2c2e']], { ink:'#2b2c2e', paper:'#f2efe6' }),
      P('褐色', [[0,'#f5eee1'],[1,'#5a4231']], { ink:'#5a4231', paper:'#f5eee1' })
    ],
    params: { bands: 0, contour: 1, contourStep: 250, shadow: 0.5, ao: 0, lineDensity: 1, paper: 0.75, glow: 0, fog: 0, sunAz: 298, sunEl: 40 }
  },
  {
    key: 'realistic', label: '写实光影', sub: '植被 / 岩壁 / 雪线 + 大气雾',
    bg: ['#b9c4bd', '#eee9db'], dark: false, accent: '#ffd7a8', sea: '#2d5a6d', fogColor: '#dfe0d4',
    palettes: [
      P('晨光绿岭', [[0,'#2b4630'],[.12,'#3c5a37'],[.3,'#55703f'],[.46,'#6f854c'],[.6,'#8a9160'],[.72,'#a29a7c'],[.85,'#c2b9a8'],[1,'#eceff0']]),
      P('荒漠赭石', [[0,'#26301f'],[.14,'#5c5530'],[.34,'#8a6b36'],[.54,'#ab8642'],[.72,'#c6a86f'],[.88,'#ded0ac'],[1,'#f2ecda']]),
      P('高原暮色', [[0,'#1b2135'],[.18,'#3a3f58'],[.4,'#5e5563'],[.6,'#856d5e'],[.8,'#b0937a'],[1,'#e6d8c4']])
    ],
    params: { bands: 0, contour: 0, contourStep: 500, shadow: 1, ao: 0.6, fog: 0.16, glow: 0.6, sea: 1, sunAz: 305, sunEl: 30 }
  },
  {
    key: 'mono', label: '单色浮雕', sub: '单一色相 + 强顺光',
    bg: ['#f4f4ef', '#e9eae4'], dark: false,
    palettes: [
      P('森林绿', [[0,'#12351f'],[.22,'#2b6033'],[.45,'#4d8c3c'],[.68,'#7fb84f'],[.86,'#b6d97a'],[1,'#e2f2b4']], { accent:'#c8f07a' }),
      P('青瓷',   [[0,'#17323a'],[.25,'#2c5b64'],[.5,'#54858b'],[.72,'#88b2b0'],[.9,'#c3dbd3'],[1,'#eaf4ee']], { accent:'#d8f2ee' }),
      P('砖红',   [[0,'#3a1616'],[.25,'#6f2a20'],[.5,'#a2492f'],[.72,'#cc7c48'],[.9,'#e8bd8a'],[1,'#f8e6c8']], { accent:'#ffd9a8' })
    ],
    params: { bands: 0, contour: 0, contourStep: 300, shadow: 0.95, ao: 0.7, glow: 0.3, fog: 0, sunAz: 330, sunEl: 26 }
  },
  {
    key: 'ice', label: '冰蓝金岩', sub: '冷调岩体 + 高处金棕',
    bg: ['#f0f3f2', '#e4e9e7'], dark: false,
    palettes: [
      P('冰川', [[0,'#0b2438'],[.22,'#1f5674'],[.44,'#4c8ea4'],[.62,'#8fc0c4'],[.8,'#d3b072'],[.92,'#e8c884'],[1,'#f8ecc9']], { accent:'#e8c884' }),
      P('霜蓝', [[0,'#0a1a2b'],[.26,'#1d4462'],[.52,'#4a7f9c'],[.74,'#93bfc9'],[.9,'#cfe6e4'],[1,'#f2fbfa']], { accent:'#bfe6ee' })
    ],
    params: { bands: 0, contour: 0, contourStep: 300, shadow: 0.9, ao: 0.4, rim: 1, glow: 0.25, fog: 0, sunAz: 315, sunEl: 28 }
  },
  {
    key: 'magma', label: '霓虹熔岩', sub: '高饱和发光 + 裂隙',
    bg: ['#080510', '#150c22'], dark: true,
    palettes: [
      P('熔岩', [[0,'#160026'],[.2,'#3d0a5c'],[.42,'#8a1470'],[.62,'#d92b57'],[.8,'#f9782a'],[1,'#ffe066']], { accent:'#ff8a3d' }),
      P('极光', [[0,'#03121e'],[.24,'#063a4a'],[.48,'#0e7f74'],[.7,'#4fc79a'],[.88,'#b6f0a6'],[1,'#ecffd0']], { accent:'#6ff2c0' })
    ],
    params: { bands: 0, contour: 1, contourStep: 300, shadow: 0, ao: 0.15, glow: 1, fog: 0.2, rim: 0.6, sunAz: 275, sunEl: 24 }
  },
  {
    key: 'plaster', label: '白模石膏', sub: '无彩色模型 + 长投影',
    bg: ['#f2f1ed', '#e7e6e0'], dark: false,
    palettes: [
      P('石膏', [[0,'#9a958d'],[.35,'#b6b1a7'],[.6,'#cdc8bd'],[.82,'#e2ddd2'],[1,'#f6f3ec']], { paper:'#efece4' }),
      P('米白', [[0,'#a89f92'],[.35,'#c2b8a8'],[.62,'#d8cfc0'],[.84,'#eae3d6'],[1,'#fbf8f1']], { paper:'#f3efe5' })
    ],
    params: { bands: 0, contour: 0, contourStep: 300, shadow: 1, ao: 0.85, fog: 0.1, glow: 0.15, sunAz: 315, sunEl: 40 }
  },
  {
    key: 'ink', label: '墨色剪影', sub: '深色实体 + 边缘光',
    bg: ['#0f1116', '#1a1d24'], dark: true,
    palettes: [
      P('焦墨', [[0,'#05060a'],[.3,'#0d1014'],[.6,'#14181e'],[.85,'#1c2129'],[1,'#2a3038']], { ink:'#04050a', paper:'#232830', accent:'#9fd8e8' }),
      P('深灰', [[0,'#0f1216'],[.3,'#191d23'],[.6,'#242a31'],[.85,'#313842'],[1,'#454e5a']], { ink:'#0b0e12', paper:'#2b313a', accent:'#c9d6e2' })
    ],
    params: { bands: 0, contour: 0, contourStep: 300, shadow: 0.5, ao: 0.3, rim: 1.2, fog: 0.15, glow: 0.4, sunAz: 305, sunEl: 24 }
  },
  {
    key: 'paper', label: '纸雕分层', sub: '等高分层 + 层间切边阴影',
    bg: ['#f8f6f0', '#edeade'], dark: false,
    palettes: [
      P('暖纸', [[0,'#e7dcc6'],[.2,'#dbcbaf'],[.4,'#cbb795'],[.6,'#b89f7c'],[.8,'#a08766'],[1,'#8c7455']], { ink:'#6b5540', paper:'#f8f6f0' }),
      P('冷纸', [[0,'#dfe3e0'],[.2,'#cfd6d3'],[.4,'#bcc6c4'],[.6,'#a7b4b3'],[.8,'#93a2a2'],[1,'#80908f']], { ink:'#5c6a68', paper:'#f6f7f4' })
    ],
    params: { bands: 9, contour: 0, contourStep: 300, shadow: 0.75, ao: 0.35, glow: 0.1, fog: 0.1, sunAz: 315, sunEl: 36 }
  },
  {
    key: 'parchment', label: '历史羊皮纸', sub: '做旧纸底 + 棕褐晕渲 + 古墨等高线',
    bg: ['#e7dcc2', '#d6c6a2'], dark: false, accent: '#8a6a3c',
    fogColor: '#cbb894',
    palettes: [
      P('羊皮纸', [[0,'#efe4c8'],[.3,'#e6d7b4'],[.55,'#d8c39a'],[.75,'#c4a97c'],[1,'#a98a5e']], { ink:'#4a3520', paper:'#efe4c8', accent:'#8a6a3c' }),
      P('牛皮纸', [[0,'#e3d2b0'],[.3,'#d5bf95'],[.55,'#c2a578'],[.75,'#a98a5e'],[1,'#8d6f48']], { ink:'#3d2a17', paper:'#e3d2b0', accent:'#7a5730' }),
      P('旧墨青', [[0,'#dfe3d8'],[.3,'#cfd6c6'],[.55,'#b6c1ae'],[.75,'#98a48f'],[1,'#7a8571']], { ink:'#2f3a2c', paper:'#e8ebe2', accent:'#5c6b52' })
    ],
    params: {
      bands: 0, contour: 1, contourStep: 300, contourW: 0.7, shadow: 0.85, ao: 0.5,
      paper: 0.9, glow: 0.05, fog: 0.04, sunAz: 312, sunEl: 34,
      wallTop: '#cbb488', wallBot: '#8a7148'
    }
  },
  {
    /* 像素方块：不走高度场着色器，由 voxels.js 生成柱体几何。
       stops 只用来给每个台阶取色 —— 量化成 10 档后就是一个个色块。 */
    key: 'pixel', label: '像素方块', sub: '方块堆叠地形 + 三档块面明暗',
    bg: ['#eef4f8', '#dde8f0'], dark: false, accent: '#ffd166',
    fogColor: '#dbe7f0', sea: '#3f7a90',
    skyAmb: '#93b0d0', groundAmb: '#c0ad8c',
    palettes: [
      P('草地绿', [[0,'#3f7a48'],[.16,'#4f8f52'],[.32,'#6ba25b'],[.48,'#8cad62'],[.62,'#b5ab68'],[.76,'#a98a5e'],[.88,'#9c9084'],[1,'#dfe3cf']], { ink:'#1b2318', paper:'#e8ead8' }),
      P('沙岩橙', [[0,'#8a5d2e'],[.18,'#a9713a'],[.36,'#c08b4c'],[.54,'#d3a463'],[.70,'#c9b184'],[.84,'#b8a894'],[1,'#ddd6c8']], { ink:'#3a2412', paper:'#efe2cb' }),
      P('冰蓝雪', [[0,'#2f5d7a'],[.20,'#3f7c94'],[.40,'#69a3b4'],[.58,'#9cc4cf'],[.74,'#c6dde2'],[.88,'#e6f1f3'],[1,'#ffffff']], { ink:'#17303c', paper:'#e9f2f5' })
    ],
    params: {
      bands: 0, contour: 0, shadow: 0, ao: 0, paper: 0, glow: 0, fog: 0.10,
      sunAz: 315, sunEl: 46
    }
  }
];

STYLES.forEach((s, i) => { s.index = i; });
export const STYLE_MAP = Object.fromEntries(STYLES.map(s => [s.key, s]));

/* ---------- 色带纹理 ---------- */
export function rampCanvas(stops, w = 256) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = 1;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (const [t, c] of stops) grad.addColorStop(Math.min(1, Math.max(0, t)), c);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, 1);
  return cv;
}

export function rampCss(stops) {
  return 'linear-gradient(90deg,' + stops.map(([t, c]) => `${c} ${(t * 100).toFixed(0)}%`).join(',') + ')';
}

export const PALETTE_RAMP = (p) => rampCanvas(p.stops);
