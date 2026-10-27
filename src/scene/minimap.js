/* ============================================================
   小地图：Leaflet + 高德底图（GCJ-02，与 DataV 边界同源）
   显示当前视锥范围，点击可移动视点
   ============================================================ */
import * as THREE from 'three';

const TILES = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

export class MiniMap {
  constructor(el, { onPick } = {}) {
    this.el = el;
    this.onPick = onPick;
    this.ok = typeof L !== 'undefined';
    if (!this.ok) { el.innerHTML = '<div style="padding:10px;font-size:10px;color:#999">小地图不可用</div>'; return; }

    this.map = L.map(el, {
      zoomControl: false, attributionControl: false, minZoom: 3, maxZoom: 13,
      zoomSnap: 0.5, doubleClickZoom: false, preferCanvas: true
    }).setView([31, 108], 4);
    L.tileLayer(TILES, { subdomains: '1234', maxZoom: 18, detectRetina: false }).addTo(this.map);
    this.map.on('click', (e) => { if (this.onPick) this.onPick(e.latlng.lat, e.latlng.lng); });

    this.framePoly = null;
    this.poly = null;
    this.dot = null;
    this._last = 0;
  }

  setRegion(region) {
    if (!this.ok) return;
    if (this.poly) { this.map.removeLayer(this.poly); this.poly = null; }
    const rings = region.rings.slice().sort((a, b) => b.length - a.length).slice(0, 40);
    this.poly = L.polygon(rings.map(r => r.map(p => [p[1], p[0]])), {
      color: '#0f8f80', weight: 1.2, opacity: 0.9, fillColor: '#0f8f80', fillOpacity: 0.10
    }).addTo(this.map);
    this.map.fitBounds(this.poly.getBounds(), { padding: [14, 14], animate: true });
    if (!this.framePoly) {
      this.framePoly = L.polygon([], {
        color: '#ffffff', weight: 1.1, opacity: 0.95, fillColor: '#ffffff', fillOpacity: 0.14,
        dashArray: '3 3'
      }).addTo(this.map);
      this.dot = L.circleMarker([0, 0], { radius: 3, color: '#fff', weight: 1.4, fillColor: '#0f8f80', fillOpacity: 1 }).addTo(this.map);
    }
    const bd = document.getElementById('mmBadge');
    if (bd) bd.textContent = `${region.name} · ${Math.round(region.spanX)}km`;
  }

  /** 每帧调用（内部限流） */
  update(view, force) {
    if (!this.ok || !view.region) return;
    const now = performance.now();
    if (!force && now - this._last < 90) return;
    this._last = now;

    const cam = view.camera;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const out = [];
    for (const [nx, ny] of corners) {
      const v = new THREE.Vector3(nx, ny, 0.5).unproject(cam);
      const dir = v.sub(cam.position).normalize();
      let t = -cam.position.y / (dir.y || 1e-6);
      if (!isFinite(t) || t < 0) t = view.region.spanX * 3;
      const p = cam.position.clone().add(dir.multiplyScalar(t));
      const ll = view.worldToLonLat(p.x, p.z);
      out.push([ll.lat, ll.lon]);
    }
    this.framePoly.setLatLngs(out);
    const t = view.controls.target;
    const tl = view.worldToLonLat(t.x, t.z);
    this.dot.setLatLng([tl.lat, tl.lon]);
  }
}
