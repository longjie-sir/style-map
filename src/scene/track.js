/* ============================================================
   轨迹动画：在地形上绘制路径 / 播放 / 镜头跟随
   ============================================================ */
import * as THREE from 'three';

const TUBE_VERT = /* glsl */`
varying float vT;
void main(){
  vT = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const TUBE_FRAG = /* glsl */`
precision highp float;
varying float vT;
uniform float uProg;
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uHeadCol;
uniform float uAlpha;
uniform float uHead;
uniform float uDash;
void main(){
  if (vT > uProg + 0.002) discard;
  // 行进头部的高光
  float h = exp(-pow((vT - uProg) * 30.0, 2.0)) * uHead;
  // 沿线流动的虚线节奏
  float dash = 1.0 - uDash * step(0.5, fract(vT * 54.0 - uTime * 0.35));
  vec3 c = mix(uA, uB, vT) * dash + uHeadCol * h;
  gl_FragColor = vec4(c, uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Track {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.world.add(this.group);
    this.pts = [];          // {lon, lat}
    this.mats = [];
    this.progress = 0;
    this.playing = false;
    this.speed = 0.16;
    this.follow = false;       // 沿线飞行（镜头跟随）
    this.showLine = true;      // 轨迹线是否显示
    this.loop = true;          // 循环播放
    this.flyH = 0.10;          // 巡航高度 = span * flyH（统一水平面，不逐点贴地）
    this.dirty = false;
    this._camInit = false;
    this._smooth = new THREE.Vector3();
  }

  clear() {
    this.pts = [];
    this.progress = 0;
    this.playing = false;
    this.build();
  }

  add(lon, lat) {
    this.pts.push({ lon, lat });
    this.build();
  }

  preset() {
    const v = this.view;
    if (!v.region) return;
    const ring = v.region.rings[0];
    if (!ring) return;
    let cx = 0, cz = 0;
    const world = ring.map(p => v.lonLatToWorld(p[0], p[1]));
    world.forEach(w => { cx += w.x; cz += w.z; });
    cx /= world.length; cz /= world.length;
    const n = 7;
    this.pts = [];
    for (let i = 0; i < n; i++) {
      const k = Math.floor(ring.length * (i / n)) % ring.length;
      const w = world[k];
      const x = w.x + (cx - w.x) * 0.3;
      const z = w.z + (cz - w.z) * 0.3;
      const ll = v.worldToLonLat(x, z);
      this.pts.push(ll);
    }
    this.build();
  }

  /* ---------- 高度：统一水平面 ----------
     以前每个节点各自取「该点的地面高程 + 抬升」，于是航线跟着山脊起伏，
     相机也一路颠簸。现在航线是一条水平线，高度只由一个参数控制：
     group.position.y 整体抬升。改高度时不需要重建任何几何体 ——
     拖滑块只是改一个数，这才是「动态调整」该有的代价。 */
  terrainTop() {
    const v = this.view, b = v.region && v.region.bbox;
    if (!b) return 0;
    if (this._topY != null && this._topB === b.west + b.east + b.south + b.north) return this._topY;
    let m = 0;
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 16; j++) {
        const lon = b.west + (b.east - b.west) * i / 16;
        const lat = b.south + (b.north - b.south) * j / 16;
        const h = v.heightAt(lon, lat);
        if (h > m) m = h;
      }
    }
    this._topY = m * v.u.uHeightScale.value;
    this._topB = b.west + b.east + b.south + b.north;
    return this._topY;
  }

  /** 航线/相机的统一高度（世界 y）：不低于地形最高处，否则低档会钻进山里 */
  cruiseY() {
    const v = this.view;
    if (!v.region) return 1;
    const span = Math.max(v.region.spanX, v.region.spanY);
    const want = span * this.flyH + 0.25;
    return Math.max(want, this.terrainTop() + span * 0.012);
  }

  build() {
    this.group.clear();
    this.curve = null;
    this.mats = [];
    this.tube = null;
    this._topY = null;            // 区域/夸张变了，最高点缓存作废
    if (this.pts.length < 2) { this.group.position.y = 0; return; }
    const v = this.view;
    const span = Math.max(v.region.spanX, v.region.spanY);

    // 所有节点 y=0：几何体永远建在水平基准面上
    const pts3 = this.pts.map(p => {
      const w = v.lonLatToWorld(p.lon, p.lat);
      return new THREE.Vector3(w.x, 0, w.z);
    });
    const curve = new THREE.CatmullRomCurve3(pts3, false, 'catmullrom', 0.4);
    this.curve = curve;

    const segs = 420;
    const sampled = curve.getSpacedPoints(segs).map(p => new THREE.Vector3(p.x, 0, p.z));
    const smooth = new THREE.CatmullRomCurve3(sampled, false, 'catmullrom', 0.2);
    this.pathCurve = smooth;

    // 三件套：深色描边壳 + 主线 + 外侧辉光，保证在浅色地形上也足够醒目
    // 管径：远景要够细（否则像一条公路），近景又不能消失，0.0013 折中
    const radius = span * 0.0013;
    const mkMat = (a, b, alpha, head, dash, additive, hc) => {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uProg: { value: this.progress }, uTime: { value: 0 },
          uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) },
          uHeadCol: { value: new THREE.Color(hc || b) },
          uAlpha: { value: alpha }, uHead: { value: head }, uDash: { value: dash }
        },
        vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG,
        transparent: true, depthWrite: false, side: THREE.FrontSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      this.mats.push(m);
      return m;
    };
    this.tube = new THREE.Group();

    const casing = new THREE.Mesh(
      new THREE.TubeGeometry(smooth, 520, radius * 2.0, 6, false),
      mkMat('#0c161d', '#0c161d', 0.42, 0, 0, false)
    );
    casing.renderOrder = 6;
    this.tube.add(casing);

    /* 外晕：不能用 additive —— 叠在黄绿/米白的浅色地形上会直接泛成灰白，
       整条轨迹看着像一条水泥带。改成普通混合的青色，浅底深底都能保持「蓝」。 */
    const glow = new THREE.Mesh(
      new THREE.TubeGeometry(smooth, 520, radius * 2.0, 6, false),
      mkMat('#0f9fc4', '#2ac6e2', 0.34, 0.9, 0, false, '#ffc44f')
    );
    glow.renderOrder = 7;
    this.tube.add(glow);

    const main = new THREE.Mesh(
      new THREE.TubeGeometry(smooth, 520, radius, 7, false),
      mkMat('#0794b4', '#1cc0de', 1.0, 0.50, 0.20, false, '#ffbf45')
    );
    main.renderOrder = 8;
    this.tube.add(main);

    this.mat = main.material;
    this.tube.traverse(o => { o.frustumCulled = false; });
    this.group.add(this.tube);

    // 顶点标记
    const dotGeo = new THREE.SphereGeometry(radius * 3.2, 12, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffcf5c });
    for (const p of pts3) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.copy(p);
      d.renderOrder = 9;
      this.group.add(d);
    }

    // 行进箭头
    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 3.4, radius * 9.5, 4),
      new THREE.MeshBasicMaterial({ color: 0xffb238 })
    );
    this.marker.renderOrder = 10;
    this.group.add(this.marker);
    this.marker.visible = false;
    this.tube.visible = this.showLine;
    this.group.children.forEach((o) => {
      if (o.isMesh && o !== this.marker) o.visible = this.showLine;
    });

    this.group.position.y = this.cruiseY();
    this.placeMarker(this.progress);
  }

  setShowLine(on) {
    this.showLine = !!on;
    if (this.tube) this.tube.visible = this.showLine;
    for (const o of this.group.children) {
      if (o.isMesh && o !== this.marker) o.visible = this.showLine;
    }
    // ⚠ 箭头也要跟着一起隐藏。以前这里只写了 marker.visible = true，
    // 且 placeMarker() 每帧又无条件把它打开一次，于是「隐藏轨迹线」之后
    // 橙色箭头仍然在前面飞 —— 两处都要拦。
    if (this.marker) this.marker.visible = this.showLine && this.pts.length > 1;
  }

  /** 巡航高度（相对 span）：改高度只动 group.position.y，不重建几何体 */
  setFlyHeight(k) {
    this.flyH = k;
    if (this.group) this.group.position.y = this.cruiseY();
  }

  placeMarker(t) {
    if (!this.pathCurve || !this.marker) return;
    const tt = THREE.MathUtils.clamp(t, 0, 0.9999);
    const p = this.pathCurve.getPointAt(tt);
    const tan = this.pathCurve.getTangentAt(tt);
    const hh = (this.marker.geometry.parameters.height || 1) * 0.5;
    this.marker.position.copy(p).add(new THREE.Vector3(0, hh, 0));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().normalize());
    this.marker.quaternion.copy(q);
    this.marker.visible = this.showLine && this.pts.length > 1;
    this._pos = p;
  }

  play() {
    if (this.pts.length < 2) return false;
    if (this.progress >= 0.999) this.progress = 0;
    this.playing = true;
    return true;
  }
  pause() { this.playing = false; }

  /** 进入飞行时给一次合理的初始机位：从飞行器后上方俯视 */
  initFollowCam() {
    const v = this.view;
    if (!v.region || !this.pathCurve) return;
    const span = Math.max(v.region.spanX, v.region.spanY);
    const t = THREE.MathUtils.clamp(this.progress, 0, 0.9995);
    const p = this.pathCurve.getPointAt(t).clone();
    p.y += this.group.position.y;
    const tan = this.pathCurve.getTangentAt(t);
    /* 水平后退方向（切线反向）+ 抬高。俯角要给到 ~46°：
       轨迹只画「已走过」的部分（uProg），朝前平视的话前方还没有线，
       画面里会看不到轨迹 —— 抬高俯角才能把脚下这一段收进视野。 */
    const dir = new THREE.Vector3(-tan.x, 0, -tan.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(1.0);
    dir.y = 1.05;
    dir.normalize();
    const dist = span * 0.21;
    const ha0 = Math.hypot(tan.x, tan.z) || 1;
    p.x += (tan.x / ha0) * span * 0.022;
    p.z += (tan.z / ha0) * span * 0.022;
    v.controls.target.copy(p);
    v.camera.position.copy(p).add(dir.multiplyScalar(dist));
    this._smooth.copy(p);
    this._camInit = true;
    v.controls.update();
  }

  /** 沿线飞行：相机跟着飞行器走，但朝向 / 俯角 / 距离交还给鼠标 ——
      每帧只给 controls.target 与相机同步一个平移量，旋转和缩放仍走 OrbitControls。
      这样飞行中也能随时换视角，而不是被一个固定机位锁死。 */
  flyAlong(dt) {
    const v = this.view, cam = v.camera, c = v.controls;
    const t = THREE.MathUtils.clamp(this.progress, 0, 0.9995);
    const p = this.pathCurve.getPointAt(t).clone();
    p.y += this.group.position.y;

    if (!this._camInit) { this.initFollowCam(); return; }

    // 看向点比飞行器略靠前一点（画面中心给前方地形，飞行器落在下方 1/4 处）
    const tan = this.pathCurve.getTangentAt(t);
    const span = Math.max(v.region.spanX, v.region.spanY);
    const ha = Math.hypot(tan.x, tan.z) || 1;
    p.x += (tan.x / ha) * span * 0.022;
    p.z += (tan.z / ha) * span * 0.022;

    // 目标点平滑追随，时间常数 0.12s → 帧率无关
    this._smooth.lerp(p, 1 - Math.exp(-dt / 0.12));
    // 相机与 target 同步平移：用户的球坐标（方向/距离）保持不变
    const d = this._smooth.clone().sub(c.target);
    c.target.add(d);
    cam.position.add(d);
    c.update();
  }

  update(dt, t) {
    if (this.mats) {
      for (const m of this.mats) {
        m.uniforms.uTime.value = t;
        m.uniforms.uProg.value = this.progress;
      }
    }
    if (this.playing) {
      this.progress = this.progress + dt * this.speed;
      if (this.progress >= 1) {
        if (this.loop && this.follow) this.progress = 0;
        else { this.progress = 1; this.playing = false; }
      }
    }
    this.placeMarker(this.progress);

    if (this.follow && this.playing && this.pathCurve) {
      this.flyAlong(dt);
    }
  }
}
