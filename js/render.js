// Drawing the scene on the canvas: the black sky and Earth, far hills, the ground lit by a low Sun with
// long shadows, boulders, the lander and its shadow, and the dust the engine blasts out sideways below
// about 100 feet. The camera zooms in as you come down, so near the ground a foot is several pixels
// and a six-foot boulder is easy to see.

import { groundAt, surfaceAt, boulderTop, nearBoulders, STEP, spotAt, litAt } from './terrain.js';
import { toWorld, altitude, G_MOON } from './sim.js';
import { drawLM, drawLLTV, drawAscentPlume, OUTLINE, setMinLine } from './craft.js';
import { rng } from './rng.js';
import { groundRank, one, shown, LIMITS } from './judge.js';
import { tooFastAlong } from './calls.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const DEG = Math.PI / 180;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  return { canvas, ctx, W: 1, H: 1, dpr: 1, cam: null, key: null, dust: [], puffs: [], debris: [], bg: null, shake: 0, dustI: 0, last: {} };
}

export function resizeRenderer(r, W, H) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  r.canvas.width = Math.round(W * dpr);
  r.canvas.height = Math.round(H * dpr);
  r.canvas.style.width = W + 'px';
  r.canvas.style.height = H + 'px';
  Object.assign(r, { W, H, dpr });
}

// sc: { key, site, g, f, view: { top, bottom }, dt, marks }
export function renderFrame(r, sc) {
  const { ctx, dpr } = r;
  if (r.key !== sc.key) {
    r.key = sc.key;
    r.cam = null;
    r.dust = [];
    r.puffs = [];
    r.debris = [];
    r.dustI = 0;
    r.dustX = null;
    r.lastW = null;
    r.jetWait = 0;
    r.bg = buildBackdrop(sc.site);
    r.last = {};
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera(r, sc);
  const cam = r.cam;
  if (r.shake > 0.05) {
    ctx.translate((Math.random() - 0.5) * r.shake, (Math.random() - 0.5) * r.shake);
    r.shake *= Math.exp(-sc.dt * 5);
  }
  sky(r, sc);
  backdrop(r, sc);
  earth(r, sc);
  terrain(r, sc);
  boulders(r, sc);
  if (sc.marks !== false) marks(r, sc);
  dust(r, sc);
  lmShadow(r, sc);
  craft(r, sc);
  particles(r, sc);
  if (sc.marks !== false) footprint(r, sc);
  if (sc.marks !== false) offscreen(r, sc);
  return cam;
}

// ---------- camera ----------

function camera(r, sc) {
  const { f, g, view } = sc;
  const sceneH = Math.max(160, view.bottom - view.top);
  const followAsc = f.phase === 'abort' && f.asc && f.asc.t > 1.2;
  const fx = followAsc ? f.asc.x : f.x;
  const fy = followAsc ? f.asc.y : f.y;
  const alt = Math.max(0, fy - f.veh.cg - groundAt(g, fx));
  // Higher up it takes in more sky as well, so a climb (or the ascent stage leaving after an abort)
  // stays in view below the numbers instead of rising behind them.
  const viewFt = Math.max(100, alt * 1.38 + 74 + Math.max(0, alt - 600) * 0.3);
  let s = Math.min(sceneH / viewFt, r.W / 96);
  const lead = clamp((f.phase === 'flying' ? f.vx : 0) / 50, -1, 1) * 0.26 * (view.lead ?? 1);
  // Low down, sit the LM a little left of centre: its shadow falls ahead, to the right.
  const low = clamp((90 - alt) / 60, 0, 1) * (1 - clamp(Math.abs(f.vx) / 12, 0, 1)) * 0.2;
  const cx = fx + ((lead + low) * r.W) / s;
  // (view.shift moves the whole picture sideways, for the title card on a wide screen.)
  // The ground the camera keeps its eye on, averaged so a crater rim doesn't jerk the view.
  let gref = 0;
  for (let k = -2; k <= 2; k++) gref += groundAt(g, fx + k * 12);
  gref /= 5;
  const dt = Math.min(0.1, sc.dt || 0.016);
  if (!r.cam) r.cam = { s, cx, gref };
  else {
    const c = r.cam, k1 = 1 - Math.exp(-dt * 2.6), k2 = 1 - Math.exp(-dt * 4);
    c.s *= Math.exp(Math.log(s / c.s) * k1);
    c.cx += (cx - c.cx) * k2;
    c.gref += (gref - c.gref) * k1;
  }
  r.cam.gy = view.bottom - sceneH * 0.17;
  r.cam.view = view;
  r.ox = r.W / 2 + (view.shift || 0); // where the camera's centre falls on screen
  r.X = x => r.ox + (x - r.cam.cx) * r.cam.s;
  r.Y = y => r.cam.gy - (y - r.cam.gref) * r.cam.s;
  r.band = clamp(r.cam.s * 3.2, 6, 22);
}

// ---------- sky, Earth and the far hills ----------

function sky(r, sc) {
  const { ctx, W, H } = r;
  if (sc.site.world === 'earth') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3f78b5');
    g.addColorStop(0.55, '#8dbbe0');
    g.addColorStop(1, '#d9e7ee');
    ctx.fillStyle = g;
  } else ctx.fillStyle = '#030304';
  ctx.fillRect(-10, -10, W + 20, H + 20);
}

function earth(r, sc) {
  const e = sc.site.earth;
  r.earthBox = null;
  if (!e) return;
  const { ctx, W } = r;
  const v = sc.view;
  const R = clamp(Math.min(W, r.H) * 0.03, 10, 22);
  const top = v.top + 70; // clear of the radio lines
  const x = W * e.x, y = top + (v.bottom - top) * e.y + R;
  r.earthBox = [x - R, y - R, x + R, y + R]; // so the landing's caption can keep clear of it
  ctx.save();
  ctx.fillStyle = '#0a1220';
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  // The lit part faces the Sun, which is low behind you on the left.
  const lit = e.lit, rx = R * Math.abs(2 * lit - 1);
  ctx.beginPath();
  ctx.arc(x, y, R, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.ellipse(x, y, rx, R, 0, -Math.PI / 2, Math.PI / 2, lit < 0.5);
  ctx.closePath();
  ctx.clip();
  const g = ctx.createRadialGradient(x - R * 0.4, y - R * 0.3, R * 0.1, x, y, R * 1.1);
  g.addColorStop(0, '#9cc4f2');
  g.addColorStop(0.5, '#3f78c6');
  g.addColorStop(1, '#1c3c78');
  ctx.fillStyle = g;
  ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (const [dx, dy, w] of [[-0.5, -0.45, 0.5], [-0.15, 0.1, 0.6], [-0.6, 0.45, 0.4], [0.05, -0.7, 0.35]]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * R, y + dy * R, w * R, 0.1 * R, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(120, 160, 90, .55)';
  ctx.beginPath();
  ctx.ellipse(x - 0.35 * R, y + 0.05 * R, 0.25 * R, 0.35 * R, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Far hills, and for some sites the mountains: Hadley's Apennine front, the Descartes highlands,
// the massifs walling in Taurus–Littrow. They move slower than the ground, so they look far off.
function buildBackdrop(site) {
  const R = rng(site.ground.seed * 7 + 3);
  const layers = [];
  // A ridge is a sum of waves, so it can be drawn for whatever stretch is on screen, however far you fly.
  const ridge = (n, span, amp, wl, base, p, col, lit) => {
    const ph = [R() * 6, R() * 6, R() * 6];
    const height = x => Math.max(0, base + amp * (0.55 * Math.sin(x / wl + ph[0]) + 0.3 * Math.sin(x / (wl * 0.37) + ph[1]) + 0.15 * Math.sin(x / (wl * 0.13) + ph[2])));
    let top = 0;
    for (let k = 0; k <= n; k++) top = Math.max(top, height(-span + (2 * span * k) / n));
    layers.push({ ridge: true, height, gap: (2 * span) / n, top, p, col, lit });
  };
  if (site.world === 'earth') {
    layers.push({ earth: true });
    return layers;
  }
  // The mountains: Hadley's Apennine front, the rolling Descartes highlands, the massifs walling in
  // Taurus–Littrow. Heights are in the same units as the far hills; the middle of each is what a
  // phone shows, the rest is there for wider screens.
  const big = MOUNTAINS[site.backdrop];
  if (big) layers.push({ massif: true, p: 0.05, knots: big, pts: massif(big), key: site.backdrop, sun: site.sun || 10 });
  ridge(160, 2400, 26, 160, 18, 0.16, [42, 41, 39], [104, 99, 91]);
  ridge(200, 2600, 14, 90, 6, 0.28, [34, 33, 31], [92, 87, 80]);
  return layers;
}

// A smooth mountain from a few points.
function massif(knots) {
  const pts = [];
  for (let k = 0; k < knots.length - 1; k++) {
    const [x0, y0] = knots[k], [x1, y1] = knots[k + 1];
    for (let j = 0; j < 12; j++) {
      const t = j / 12, s = t * t * (3 - 2 * t);
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * s]);
    }
  }
  pts.push(knots[knots.length - 1]);
  return pts;
}

function backdrop(r, sc) {
  const { ctx, W, cam } = r;
  const site = sc.site;
  // The far layers zoom far less than the ground does.
  const bs = 0.62 * Math.pow(cam.s / 0.6, 0.2);
  // The far layers stand on the ground near you, and fade out below that, so wherever the near
  // ground dips lower they never show as a wall.
  let datum = 0;
  for (let k = -2; k <= 2; k++) datum += groundAt(sc.g, cam.cx + k * 60);
  const base = r.Y(datum / 5) + 2;
  for (const L of r.bg) {
    if (L.earth) { earthBackdrop(r, base, bs); continue; }
    if (L.massif) {
      // Squeezed along the track, so a phone's width takes in whole mountains.
      const bx = bs * MASSIF_SQUEEZE;
      massifLayer(r, L, x => r.ox + (x - cam.cx * L.p) * bx, base, bx, bs);
      continue;
    }
    const X = x => r.ox + (x - cam.cx * L.p) * bs;
    // The points on screen, on the ridge's own spacing so they don't shimmer as it slides.
    const u0 = Math.floor((cam.cx * L.p - r.ox / bs) / L.gap) - 1, u1 = Math.ceil((cam.cx * L.p + (W - r.ox) / bs) / L.gap) + 1;
    const pts = [];
    for (let u = u0; u <= u1; u++) pts.push([u * L.gap, L.height(u * L.gap)]);
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), base + 400);
    for (const [x, h] of pts) ctx.lineTo(X(x), base - h * bs);
    ctx.lineTo(X(pts[pts.length - 1][0]), base + 400);
    ctx.closePath();
    const top = L.top;
    const gr = ctx.createLinearGradient(0, base - top * bs, 0, base + 40);
    const f = Math.min(0.98, (top * bs) / (top * bs + 40));
    gr.addColorStop(0, rgb(L.lit, 0.82));
    gr.addColorStop(f * 0.5, rgb(L.col, 1.1));
    gr.addColorStop(f, rgb(L.col, 0.75));
    gr.addColorStop(1, rgb(L.col, 0.75, 0));
    ctx.fillStyle = gr;
    ctx.fill();
    // Faces turned toward the low Sun on the left catch the light.
    ctx.lineWidth = Math.max(1, bs * 1.6);
    ctx.strokeStyle = rgb(L.lit, 1.1);
    ctx.beginPath();
    for (let k = 1; k < pts.length; k++) {
      const [x0, h0] = pts[k - 1], [x1, h1] = pts[k];
      if (h1 > h0 + 0.4) { ctx.moveTo(X(x0), base - h0 * bs); ctx.lineTo(X(x1), base - h1 * bs); }
    }
    ctx.stroke();
  }
}

const MOUNTAINS = {
  apennines: [[-1500, 0], [-1150, 48], [-850, 92], [-640, 84], [-420, 54], [-300, 58], [-160, 86], [20, 122], [170, 136], [330, 128], [520, 92], [800, 62], [1050, 74], [1300, 36], [1600, 0]],
  massifs: [[-1500, 0], [-1150, 52], [-900, 80], [-720, 74], [-560, 50], [-380, 90], [-180, 120], [60, 128], [260, 116], [430, 80], [560, 54], [760, 66], [980, 86], [1200, 60], [1500, 0]],
  highlands: [[-1500, 0], [-1150, 30], [-800, 50], [-520, 40], [-260, 58], [40, 68], [300, 52], [560, 46], [820, 64], [1100, 40], [1500, 0]],
};

// A mountain range lit by the low Sun on the left, worked out a pixel at a time once per site and kept.
// It's a ridge under its skyline: at a height v below a crest of height h the slope comes toward you,
// so the surface there faces partly along the track (the crest's slope, exaggerated, since the real
// massifs are far steeper than a skyline this flat suggests) and partly toward you. Faint gullies run
// down the faces. Lit flanks face left, toward the Sun; the far flanks fall into shade.
const MASSIF_RES = 0.5; // pixels per unit: the faces are smooth, and the skyline is clipped crisply
const MASSIF_SQUEEZE = 0.6;
const massifs = new Map();
function massifImage(L) {
  const id = `${L.key}:${L.sun}`;
  if (massifs.has(id)) return massifs.get(id);
  const pts = L.pts, res = MASSIF_RES;
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const hmax = Math.max(...pts.map(q => q[1]));
  const W = Math.ceil((x1 - x0) * res) + 1, H = Math.ceil((hmax + 4) * res);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const cx = canvas.getContext('2d');
  const img = cx.createImageData(W, H);
  const D = img.data;
  const hs = new Float32Array(W), hp = new Float32Array(W);
  let k = 0;
  for (let i = 0; i < W; i++) {
    const u = x0 + i / res;
    while (k < pts.length - 2 && pts[k + 1][0] < u) k++;
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    hs[i] = ay + ((by - ay) * clamp((u - ax) / (bx - ax), 0, 1));
  }
  const sw = Math.max(1, Math.round(18 * res));
  for (let i = 0; i < W; i++) {
    const a = Math.max(0, i - sw), b = Math.min(W - 1, i + sw);
    hp[i] = (hs[b] - hs[a]) / ((b - a) / res);
  }
  const R = rng(L.key.length * 7 + 3);
  const waves = Array.from({ length: 4 }, () => {
    const wl = 26 + R() * 50;
    return { f: (2 * Math.PI) / wl, g: (2 * Math.PI) / (wl * (4 + R() * 4)), ph: R() * 6.283, a: ((0.1 + 0.08 * R()) * wl) / 60 };
  });
  const e = L.sun * DEG, depth = 2.6 * hmax, RELIEF = 2.6;
  let lx = -Math.cos(e), ly = 0.26, lz = Math.sin(e) + 0.08;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll; ly /= ll; lz /= ll;
  const lit = [150, 144, 133], dark = [30, 29, 28];
  for (let i = 0; i < W; i++) {
    const u = x0 + i / res, top = hs[i];
    if (top <= 0.2) continue;
    for (let j = 0; j < H; j++) {
      const v = (H - 1 - j) / res;
      if (v > top + 3 / res) continue; // a little above the crest too, for the clip's edge to fall on
      const q = clamp(v / top, 0, 1), yy = Math.sqrt(1 - q);
      let dn = 0;
      for (const w of waves) dn += w.a * w.f * Math.cos(w.f * u + w.g * yy * depth + w.ph);
      const gx = hp[i] * q * RELIEF + dn * 1.6 * Math.min(1, yy * 2.2);
      const gy = (-2 * top * yy) / depth;
      const nl = Math.hypot(gx, gy, 1);
      const L2 = Math.max(0, (-gx * lx - gy * ly + lz) / nl);
      const t = 0.07 + 0.93 * Math.pow(L2, 1.05);
      const o = (j * W + i) * 4;
      D[o] = dark[0] + (lit[0] - dark[0]) * t;
      D[o + 1] = dark[1] + (lit[1] - dark[1]) * t;
      D[o + 2] = dark[2] + (lit[2] - dark[2]) * t;
      D[o + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const m = { canvas, x0, res, H };
  massifs.set(id, m);
  return m;
}

function massifLayer(r, L, X, base, bx, bs) {
  const { ctx, W } = r;
  const m = massifImage(L);
  // Only the part on screen.
  const ua = Math.max(m.x0, L.pts[0][0] + (0 - X(L.pts[0][0])) / bx - 4);
  const ub = Math.min(L.pts[L.pts.length - 1][0], L.pts[0][0] + (W - X(L.pts[0][0])) / bx + 4);
  if (ub <= ua) return;
  ctx.save();
  const sky = new Path2D();
  sky.moveTo(X(ua), base + 2);
  for (const [x, h] of L.pts) if (x >= ua - 30 && x <= ub + 30) sky.lineTo(X(x), base - h * bs);
  sky.lineTo(X(ub), base + 2);
  sky.closePath();
  ctx.clip(sky);
  const sx = (ua - m.x0) * m.res, sw = (ub - ua) * m.res;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(m.canvas, sx, 0, sw, m.H, X(ua), base - (m.H / m.res) * bs, (ub - ua) * bx, (m.H / m.res) * bs);
  ctx.restore();
}

// Ellington: a tree line, the hangars and a water tower across the field.
function earthBackdrop(r, base, bs) {
  const { ctx, W, cam } = r;
  const X = x => r.ox + (x - cam.cx * 0.2) * bs;
  ctx.fillStyle = '#6f8a6a';
  ctx.beginPath();
  ctx.moveTo(-10, base + 50);
  const t0 = Math.floor((cam.cx * 0.2 - r.ox / bs) / 18) * 18 - 18, t1 = cam.cx * 0.2 + (W - r.ox) / bs + 18;
  for (let x = t0; x <= t1; x += 18) ctx.lineTo(X(x), base - (10 + 5 * Math.sin(x * 0.07) + 3 * Math.sin(x * 0.23)) * bs);
  ctx.lineTo(W + 10, base + 50);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a7aeb0';
  for (const [x, w, h] of [[-420, 120, 34], [-270, 90, 28], [380, 150, 38], [560, 70, 22]]) {
    ctx.beginPath();
    ctx.moveTo(X(x), base);
    ctx.lineTo(X(x), base - h * 0.7 * bs);
    ctx.quadraticCurveTo(X(x + w / 2), base - h * 1.1 * bs, X(x + w), base - h * 0.7 * bs);
    ctx.lineTo(X(x + w), base);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#8d9496';
  ctx.fillRect(X(160), base - 70 * bs, 2 * bs, 70 * bs);
  ctx.fillRect(X(176), base - 70 * bs, 2 * bs, 70 * bs);
  ctx.beginPath();
  ctx.ellipse(X(169), base - 76 * bs, 18 * bs, 10 * bs, 0, 0, Math.PI * 2);
  ctx.fill();
}

const rgb = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

// ---------- the ground ----------

function visibleRange(r) {
  const c = r.cam;
  return [c.cx - r.ox / c.s - 6, c.cx + (r.W - r.ox) / c.s + 6];
}

function shadeAt(g, i, sinSun, cosSun) {
  if (!g.lit[i]) return 0.15;
  const a = g.h[Math.min(g.n - 1, i + 2)], b = g.h[Math.max(0, i - 2)];
  const t = (a - b) / (4 * STEP);
  const c = 1 / Math.sqrt(1 + t * t), s = t * c;
  const inc = s * cosSun + c * sinSun; // sin(slope + sun angle)
  return clamp(0.42 + 1.45 * inc, 0.22, 1.32) * g.alb[i];
}

function terrain(r, sc) {
  const { ctx, H, cam, X, Y } = r;
  const { g, site } = sc;
  const [xa, xb] = visibleRange(r);
  const stride = Math.max(1, Math.ceil(1.5 / (cam.s * STEP)));
  // Indices can run past the ends of the ground (thousands of feet beyond a site): there it goes on
  // level at the height it ended, rather than stopping.
  const i0 = Math.floor((xa - g.x0) / STEP), i1 = Math.max(i0 + 1, Math.ceil((xb - g.x0) / STEP));
  const idx = [];
  for (let i = i0; i <= i1; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== i1) idx.push(i1);
  const at = i => clamp(i, 0, g.n - 1);
  const sx = i => X(g.x0 + i * STEP), sy = i => Y(g.h[at(i)]);
  const pal = site.palette;
  const band = r.band;

  // Below the surface: the ground between you and the line you're flying, sunlit and pocked.
  ctx.beginPath();
  ctx.moveTo(sx(idx[0]), H + 20);
  for (const i of idx) ctx.lineTo(sx(i), sy(i));
  ctx.lineTo(sx(idx[idx.length - 1]), H + 20);
  ctx.closePath();
  const top = Math.min(...idx.map(sy));
  const plane = ctx.createLinearGradient(0, top, 0, H);
  plane.addColorStop(0, rgb(pal.soil, 0.66));
  plane.addColorStop(0.35, rgb(pal.soil, 0.8));
  plane.addColorStop(1, rgb(pal.soil, 0.92));
  ctx.fillStyle = plane;
  ctx.fill();
  groundPlane(r, sc);

  // The surface, lit by the low Sun: faces toward it bright, faces away dark, shadows near black.
  // The shade of each stretch goes into a strip one pixel high, drawn stretched under the band, so
  // neighbouring stretches blend instead of standing side by side as blocks. Zoomed out, it's also
  // averaged over a few pixels: a single pit is too small to show as more than a darker patch.
  const sun = g.sun * DEG, sinS = Math.sin(sun), cosS = Math.cos(sun);
  const cols = idx.length - 1;
  let shades = new Float32Array(cols);
  for (let k = 0; k < cols; k++) {
    const i = idx[k], j = idx[k + 1];
    let sh = 0;
    for (let q = i; q < Math.max(i + 1, j); q++) sh += shadeAt(g, at(q), sinS, cosS);
    shades[k] = sh / Math.max(1, j - i);
  }
  const segPx = cols > 0 ? (sx(idx[cols]) - sx(idx[0])) / cols : 1;
  const blur = Math.min(4, Math.round(2.2 / Math.max(0.5, segPx)));
  if (blur > 0) {
    const out = new Float32Array(cols);
    for (let k = 0; k < cols; k++) {
      let sum = 0, n = 0;
      for (let q = Math.max(0, k - blur); q <= Math.min(cols - 1, k + blur); q++) { sum += shades[q]; n++; }
      out[k] = sum / n;
    }
    shades = out;
  }
  const warm = site.world === 'earth' ? [0, 0, 0] : [8, 4, -2];
  const strip = r.bandStrip || (r.bandStrip = document.createElement('canvas'));
  if (strip.width !== cols + 2) strip.width = cols + 2;
  strip.height = 3;
  const sctx = strip.getContext('2d');
  const img = sctx.createImageData(cols + 2, 3);
  for (let k = -1; k <= cols; k++) {
    const sh = shades[clamp(k, 0, cols - 1)], w = sh > 0.5 ? warm : [-3, -1, 4];
    for (let row = 0; row < 3; row++) {
      const o = (row * (cols + 2) + k + 1) * 4;
      img.data[o] = clamp(pal.soil[0] * sh + w[0], 0, 255);
      img.data[o + 1] = clamp(pal.soil[1] * sh + w[1], 0, 255);
      img.data[o + 2] = clamp(pal.soil[2] * sh + w[2], 0, 255);
      img.data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  // One shape for the band, from the ground line down by its depth, filled with the strip: each of
  // its pixels spans one stretch, and smoothing blends them. The lower part of the band then fades
  // into the ground below it, so a shadow is a darker patch along the top rather than a dark brick.
  const strap = (a, b) => {
    const p = new Path2D();
    p.moveTo(sx(idx[0]), sy(idx[0]) + band * a);
    for (let k = 1; k <= cols; k++) p.lineTo(sx(idx[k]), sy(idx[k]) + band * a);
    for (let k = cols; k >= 0; k--) p.lineTo(sx(idx[k]), sy(idx[k]) + band * b);
    p.closePath();
    return p;
  };
  if (cols > 0) {
    const pat = ctx.createPattern(strip, 'repeat-y');
    pat.setTransform(new DOMMatrix([segPx, 0, 0, 1, sx(idx[0]) - segPx, 0])); // strip pixel k + 1 is stretch k
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = pat;
    ctx.fill(strap(0, 1));
    [[0.3, 0.55, 0.22], [0.55, 0.8, 0.42], [0.8, 1.04, 0.62]].forEach(([a, b, al]) => { ctx.fillStyle = rgb(pal.soil, 0.7, al); ctx.fill(strap(a, b)); });
  }

  // Pebbles and small pits on the surface band, fixed to the ground so they slide past.
  if (cam.s > 1.2) {
    const R = rng(7);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    const step = 3;
    const start = Math.floor(xa / step) * step;
    for (let x = start; x < xb; x += step) {
      const hsh = Math.sin(x * 12.9898) * 43758.5453;
      const u = hsh - Math.floor(hsh);
      if (u > 0.55) continue;
      const v = Math.sin(x * 78.233) * 12345.678;
      const w = v - Math.floor(v);
      const px = X(x + u * 2), py = Y(groundAt(g, x + u * 2)) + band * (0.2 + 0.7 * w);
      const rad = (0.12 + u * 0.35) * cam.s;
      if (rad < 0.6) continue;
      ctx.beginPath();
      ctx.ellipse(px, py, rad, rad * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    void R;
  }

  // A painted pad at Ellington.
  if (site.pad) {
    const x = site.pad.x, w = site.pad.w / 2;
    const y0 = Y(groundAt(g, x));
    ctx.fillStyle = '#b9b6ad';
    ctx.beginPath();
    ctx.moveTo(X(x - w), y0);
    ctx.lineTo(X(x + w), y0);
    ctx.lineTo(X(x + w) + band * 0.5, y0 + band);
    ctx.lineTo(X(x - w) - band * 0.5, y0 + band);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f4f1e6';
    ctx.lineWidth = Math.max(1, cam.s * 0.5);
    ctx.beginPath();
    ctx.ellipse(X(x), y0 + band * 0.5, (w - 8) * cam.s, band * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(x) - 6 * cam.s, y0 + band * 0.5);
    ctx.lineTo(X(x) + 6 * cam.s, y0 + band * 0.5);
    ctx.stroke();
  }
}

// The ground in front of the line you fly, in rows: small craters and stones, nearer rows bigger and
// sliding past faster, so you can feel your speed over the ground. The Sun is low on the left, so each
// crater's left wall is in shadow and its right wall catches the light, and every stone throws a long
// shadow to the right. Purely for looks: only the line itself has rocks you can hit.
const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
// Adds an ellipse to a path as its own shape (without the line joining it to the last one).
function oval(p, x, y, rx, ry, a0 = 0, a1 = Math.PI * 2) {
  p.moveTo(x + rx * Math.cos(a0), y + ry * Math.sin(a0));
  p.ellipse(x, y, rx, ry, 0, a0, a1);
}

function groundPlane(r, sc) {
  const { ctx, W, H, cam } = r;
  const { g, site } = sc;
  const pal = site.palette;
  const earthy = site.world === 'earth';
  const deep = Math.max(40, H - cam.gy);
  const tanSun = Math.tan(Math.max(4, g.sun) * DEG);
  const dark = new Path2D(), floor = new Path2D(), rim = new Path2D(), stones = new Path2D(), shade = new Path2D(), lit = new Path2D();
  const ROWS = 9;
  for (let k = 0; k < ROWS; k++) {
    const d = (k + 0.5) / ROWS; // 0 far .. 1 near
    const dy = r.band * 0.9 + Math.pow(d, 1.35) * deep * 0.98;
    const p = 1 + d * 0.7;
    const zs = cam.s * (1 + d * 1.6);
    const flat = 0.22 + d * 0.22;
    const spacing = 22 / (1 + d * 0.8);
    // World positions in this row's own coordinates, so it slides at its own speed.
    const left = cam.cx * p - r.ox / (cam.s * p) - 40, right = cam.cx * p + (W - r.ox) / (cam.s * p) + 40;
    const i0 = Math.floor(left / spacing), i1 = Math.ceil(right / spacing);
    for (let i = i0; i <= i1; i++) {
      const u = hash(i, k + 1), v = hash(i + 7.3, k + 3), w = hash(i - 2.1, k + 11);
      const xr = (i + v) * spacing;
      const X = r.ox + (xr - cam.cx * p) * cam.s * p;
      if (X < -80 || X > W + 80) continue;
      const xt = cam.cx + (X - r.ox) / cam.s;
      const Yt = r.Y(groundAt(g, xt));
      const Yp = Yt + dy + (w - 0.5) * deep * 0.08;
      if (Yp > H + 30) continue;
      if (u > 0.9) {
        // A pit too small to show a shadow, just a speck.
        const rr = (0.35 + w * 0.6) * zs;
        if (rr >= 0.8) oval(dark, X, Yp, rr, rr * flat);
        continue;
      }
      if (earthy) {
        // Ellington's grass: tufts and the odd bare patch.
        const rr = (0.6 + u * 2.4) * zs;
        if (rr < 1) continue;
        oval(dark, X, Yp, rr, rr * flat);
        continue;
      }
      if (u < 0.5) {
        // A small crater.
        const rad = (1.2 + Math.pow(w, 3) * 9) * zs;
        if (rad < 1.2) continue;
        const ry = rad * flat;
        oval(dark, X, Yp, rad, ry);
        oval(floor, X + rad * 0.24, Yp + ry * 0.06, rad * 0.8, ry * 0.86);
        oval(rim, X, Yp, rad, ry, -Math.PI * 0.42, Math.PI * 0.42);
      } else {
        // A stone and its long shadow.
        const h = (0.25 + Math.pow(w, 2.5) * 1.6) * zs;
        if (h < 0.9) continue;
        const len = Math.min(60, (h / tanSun) * flat * 3.2);
        oval(shade, X + h * 0.6 + len * 0.5, Yp + h * 0.12, len * 0.55 + h * 0.4, Math.max(0.6, h * 0.32));
        oval(stones, X, Yp - h * 0.35, h * 0.95, h * 0.62);
        oval(lit, X - h * 0.32, Yp - h * 0.52, h * 0.45, h * 0.3);
      }
    }
  }
  if (earthy) {
    ctx.fillStyle = 'rgba(70, 86, 46, .35)';
    ctx.fill(dark);
    return;
  }
  ctx.fillStyle = rgb(pal.soil, 0.28);
  ctx.fill(shade);
  ctx.fillStyle = rgb(pal.soil, 0.24);
  ctx.fill(dark);
  ctx.fillStyle = rgb(pal.soil, 0.74);
  ctx.fill(floor);
  ctx.strokeStyle = rgb(pal.soil, 1.22);
  ctx.lineWidth = Math.max(1, cam.s * 0.5);
  ctx.stroke(rim);
  ctx.fillStyle = rgb(pal.soil, 0.42);
  ctx.fill(stones);
  ctx.fillStyle = rgb(pal.soil, 1.2);
  ctx.fill(lit);
}

// ---------- boulders ----------

function boulders(r, sc) {
  const { ctx, cam, X, Y } = r;
  const { g, site } = sc;
  const [xa, xb] = visibleRange(r);
  const pal = site.palette;
  const lightC = rgb(pal.soil, 1.38), midC = rgb(pal.soil, 0.92), darkC = rgb(pal.soil, 0.26);
  for (const b of nearBoulders(g, xa, xb)) {
    if (b.kind === 'surveyor') { surveyor(r, sc, b); continue; }
    const w = 2 * b.r * cam.s;
    if (w < 2.4) {
      // Far off they're specks with a glint on the sunny side.
      const px = X(b.x), py = Y(b.base + b.h * 0.6);
      const d = Math.max(1.3, Math.min(2.4, b.h * cam.s));
      ctx.fillStyle = darkC;
      ctx.fillRect(px - d / 2, py - d / 2, d, d);
      ctx.fillStyle = lightC;
      ctx.fillRect(px - d / 2, py - d / 2, d / 2, d / 2);
      continue;
    }
    const N = 10;
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const u = -1 + (2 * k) / N;
      const x = b.x + u * b.r;
      const fct = b.facets[k % b.facets.length];
      const y = b.base + b.h * Math.pow(Math.max(0, 1 - u * u), 0.42) * (k === 0 || k === N ? 0 : fct);
      const px = X(x), py = Y(y);
      if (k === 0) ctx.moveTo(px, Y(groundAt(g, x)) + 1);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(X(b.x + b.r), Y(groundAt(g, b.x + b.r)) + 1);
    ctx.closePath();
    const x0 = X(b.x - b.r), x1 = X(b.x + b.r);
    const gr = ctx.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, lightC);
    gr.addColorStop(0.42, midC);
    gr.addColorStop(0.6, darkC);
    gr.addColorStop(1, darkC);
    ctx.fillStyle = gr;
    ctx.fill();
  }
}

// Surveyor 3, the robot lander Apollo 12 was sent to visit: three legs, a mast and its panels.
function surveyor(r, sc, b) {
  const { ctx, cam, X, Y } = r;
  const s = cam.s;
  const gy = groundAt(sc.g, b.x);
  const slope = Math.atan2(groundAt(sc.g, b.x + 5) - groundAt(sc.g, b.x - 5), 10);
  ctx.save();
  ctx.translate(X(b.x), Y(gy));
  ctx.rotate(-slope);
  ctx.scale(s, -s);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d8d7d0';
  ctx.lineWidth = Math.max(0.25, 1 / s);
  ctx.beginPath();
  ctx.moveTo(-6, 0.4); ctx.lineTo(-1.2, 4.2);
  ctx.moveTo(6, 0.4); ctx.lineTo(1.2, 4.2);
  ctx.moveTo(0, 0.6); ctx.lineTo(0, 4.0);
  ctx.moveTo(0, 4.0); ctx.lineTo(0, 9.6);
  ctx.stroke();
  ctx.fillStyle = '#e6e4dc';
  for (const x of [-6, 0, 6]) ctx.fillRect(x - 0.8, 0, 1.6, 0.5);
  ctx.fillStyle = '#c9c7bf';
  ctx.fillRect(-1.6, 3.6, 3.2, 1.8);
  ctx.fillStyle = '#28354a';
  ctx.save();
  ctx.translate(0, 9.6);
  ctx.rotate(0.5);
  ctx.fillRect(-2.6, -0.1, 5.2, 0.4);
  ctx.restore();
  ctx.fillStyle = '#f0eee6';
  ctx.fillRect(-0.3, 8.2, 2.8, 1.6);
  ctx.restore();
}

// ---------- marks: the target, crater names ----------

function marks(r, sc) {
  const { ctx, cam, X, Y, W } = r;
  const { g, site, f } = sc;
  const alt = altitude(f);
  const [xa, xb] = visibleRange(r);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  r.labels = []; // what was written where, for the tests
  // Crater names, while you're high enough for them to help.
  const la = clamp((alt - 35) / 60, 0, 1) * (site.world === 'earth' ? 0 : 1);
  if (la > 0) {
    ctx.font = '600 10px Jost, system-ui, sans-serif';
    ctx.letterSpacing = '0.12em';
    for (const l of g.labels) {
      if (l.x < xa - 200 || l.x > xb + 200) continue;
      let hi = -Infinity;
      for (let k = -1; k <= 1; k++) hi = Math.max(hi, groundAt(g, l.x + k * (l.r || 40)));
      const y = Math.min(Y(hi) - 16, Y(groundAt(g, l.x)) - 16);
      // Names fade out at the edges of the screen rather than being cut off there, and as they
      // come near the numbers or the controls rather than running under them.
      const text = l.name.toUpperCase(), hw = ctx.measureText(text).width / 2, x = X(l.x);
      const edge = clamp((Math.min(x - hw, W - x - hw) + 4) / 24, 0, 1) * clearOf(sc.view, x - hw, y - 9, x + hw, y + 3);
      if (edge <= 0) continue;
      ctx.fillStyle = `rgba(232, 226, 214, ${0.62 * la * edge})`;
      ctx.fillText(text, x, y);
      r.labels.push({ text, box: [x - hw, y - 9, x + hw, y + 3], alpha: la * edge });
    }
  }
  // The target.
  const tx = site.target.x;
  if (X(tx) > 0 && X(tx) < W) {
    const gy = Y(surfaceAt(g, tx));
    const top = gy - clamp(cam.s * 26, 26, 54);
    ctx.strokeStyle = 'rgba(140, 220, 255, .75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(tx), gy);
    ctx.lineTo(X(tx), top);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(140, 220, 255, .9)';
    ctx.beginPath();
    ctx.moveTo(X(tx), top - 6);
    ctx.lineTo(X(tx) + 4, top);
    ctx.lineTo(X(tx), top + 6);
    ctx.lineTo(X(tx) - 4, top);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 10px "B612 Mono", ui-monospace, monospace';
    ctx.letterSpacing = '0.06em';
    const lx = clamp(X(tx), 46, W - 46), hw = ctx.measureText(site.target.label).width / 2;
    ctx.globalAlpha = clearOf(sc.view, lx - hw, top - 19, lx + hw, top - 7);
    ctx.fillText(site.target.label, lx, top - 10);
  }
  ctx.restore();
}

// 1 where a box on screen is well clear of the numbers and the controls (view.keepOut), fading to 0
// as it comes within a dozen pixels of them.
function clearOf(view, x0, y0, x1, y1) {
  let k = 1;
  for (const [a, b, c, d] of view.keepOut || []) k = Math.min(k, clamp(Math.max(a - x1, x0 - c, b - y1, y0 - d) / 12, 0, 1));
  return k;
}

// Off the edge of the screen? A pointer to the target with its distance.
function offscreen(r, sc) {
  const { ctx, X, W } = r;
  const tx = sc.site.target.x;
  const px = X(tx);
  if (px > 0 && px < W) return;
  if (sc.f.phase !== 'flying') return;
  const d = Math.abs(tx - sc.f.x);
  const right = px >= W;
  const v = sc.view;
  const text = `${sc.site.target.label} ${Math.round(d).toLocaleString('en-US')} ft`;
  ctx.save();
  ctx.font = '700 10px "B612 Mono", ui-monospace, monospace';
  const w = monoWidth(ctx, text) + 26;
  const x = right ? W - w - 8 : 8;
  // Halfway down the view, unless the LM is there: then high up, or just above the ground.
  const b = r.lmBox;
  const clear = y => !b || x > b[2] + 6 || x + w < b[0] - 6 || y - 11 > b[3] + 6 || y + 11 < b[1] - 6;
  const ys = [v.top + (v.bottom - v.top) * 0.5, v.top + 64, r.cam.gy - 34];
  const y = ys.find(clear) ?? ys[0];
  ctx.fillStyle = 'rgba(8, 14, 20, .72)';
  ctx.strokeStyle = 'rgba(140, 220, 255, .55)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y - 11, w, 22, 11);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(160, 228, 255, .95)';
  ctx.textBaseline = 'middle';
  if (right) {
    monoText(ctx, text, x + 9, y + 0.5, 'left');
    tri(ctx, x + w - 9, y, 1);
  } else {
    monoText(ctx, text, x + w - 9, y + 0.5, 'right');
    tri(ctx, x + 9, y, -1);
  }
  ctx.restore();
}

// B612 Mono gives a comma, colon or point a whole cell with its ink at the left, so "1,288" drew as
// "1, 288". Drawn a character at a time, what follows one is pulled in, as the numbers at the top are.
const PUNCT = /[',:;.]/;
function monoWidth(ctx, text) {
  const cell = ctx.measureText('0').width;
  let w = 0;
  for (const ch of text) w += PUNCT.test(ch) ? cell * 0.45 : cell;
  return w;
}
function monoText(ctx, text, x, y, align = 'left', outline = false) {
  const cell = ctx.measureText('0').width, w = monoWidth(ctx, text);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const keep = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const pass of outline ? ['stroke', 'fill'] : ['fill']) {
    let cx = x0;
    for (const ch of text) {
      const tight = PUNCT.test(ch);
      if (pass === 'stroke') ctx.strokeText(ch, cx - (tight ? cell * 0.06 : 0), y);
      else ctx.fillText(ch, cx - (tight ? cell * 0.06 : 0), y);
      cx += tight ? cell * 0.45 : cell;
    }
  }
  ctx.textAlign = keep;
}

function tri(ctx, x, y, d) {
  ctx.beginPath();
  ctx.moveTo(x + d * 4, y);
  ctx.lineTo(x - d * 2, y - 4.5);
  ctx.lineTo(x - d * 2, y + 4.5);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, rr) {
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------- the LM's shadow, sliding in to meet the footpads ----------

// The Sun is low behind you, so the LM's shadow lies along the ground ahead of it, a long way ahead
// when you're high, and slides back to meet the footpads as you come down. It's the lander's own
// parts carried along the Sun's rays to the ground: four footpads, the legs and the two stages
// stretched out long. z is across the track, toward you; the near ground below the surface line is
// toward you, so the near-side footpad's shadow falls a little lower on screen than the far one's.
const SHADOW = {
  lm: {
    pads: [[-15.5, 0.4, 0], [15.5, 0.4, 0], [0, 0.4, 15.5], [0, 0.4, -15.5]],
    legs: [[-15.1, 1, 0, -6.2, 9, 0], [15.1, 1, 0, 6.2, 9, 0], [0, 1, 15.1, 0, 9, 6.2], [0, 1, -15.1, 0, 9, -6.2]],
    boxes: [[-6.9, 6.9, 4.7, 10.1, 6.9], [-7.5, 6.2, 10.1, 17.4, 6], [-1.6, 1.6, 17.4, 18.8, 1.6]],
    pad: 1.5,
  },
  lltv: {
    pads: [[-7.5, 0.3, 0], [7.5, 0.3, 0], [0, 0.3, 7.5], [0, 0.3, -7.5]],
    legs: [[-7.3, 0.7, 0, -4, 6.2, 0], [7.3, 0.7, 0, 4, 6.2, 0], [0, 0.7, 7.3, 0, 6.2, 4], [0, 0.7, -7.3, 0, 6.2, -4]],
    boxes: [[-4.2, 4.2, 4.4, 8.6, 4.2], [-1.3, 1.3, 2.6, 11.4, 1.3], [4.2, 7.4, 6.6, 11.4, 1.6]],
    pad: 1.1,
  },
};

function lmShadow(r, sc) {
  const { ctx, X, Y, band, cam, W } = r;
  const { g, f } = sc;
  r.shadowSeen = false;
  if (f.phase === 'abort' || f.phase === 'tipping' || f.phase === 'crashed') return;
  const parts = SHADOW[f.veh.id];
  const tan = Math.tan(Math.max(3, g.sun) * DEG);
  // Where a point on the lander throws its shadow, along the track.
  const proj = (bx, by) => {
    const [wx, wy] = toWorld(f, bx, by);
    let gx = wx;
    for (let k = 0; k < 4; k++) gx = wx + Math.max(0, wy - groundAt(g, gx)) / tan;
    return gx;
  };
  const dz = z => band * (0.5 + z / 32);
  const at = (gx, z) => [X(gx), Y(groundAt(g, gx)) + dz(z)];
  const near = proj(parts.pads[0][0] - parts.pad, 0); // the aft footpad's
  const far = proj(parts.boxes[1][1], parts.boxes[1][3]);
  r.shadowSeen = X(near) < W && X(far) > 0;
  if (!r.shadowSeen) return;
  const shade = new Path2D();
  // The stages: each a block swept along the Sun's rays, from its lower back corner to its upper front one.
  for (const [x0, x1, y0, y1, zh] of parts.boxes) {
    const ga = Math.min(proj(x0, y0), proj(x0, y1)), gb = Math.max(proj(x1, y0), proj(x1, y1));
    const step = Math.max(1, 3 / cam.s);
    let first = true;
    for (let x = ga; x <= gb + 1e-6; x += step) { const [px, py] = at(Math.min(x, gb), -zh); first ? shade.moveTo(px, py) : shade.lineTo(px, py); first = false; }
    for (let x = gb; x >= ga - 1e-6; x -= step) { const [px, py] = at(Math.max(x, ga), zh); shade.lineTo(px, py); }
    shade.closePath();
  }
  // The footpads.
  for (const [bx, by, z] of parts.pads) {
    const [px, py] = at(proj(bx, by), z);
    const rx = Math.max(1.6, parts.pad * cam.s * 1.15), ry = Math.max(1.2, Math.min(rx * 0.5, band * 0.22));
    shade.moveTo(px + rx, py);
    shade.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  }
  const a = sc.site.world === 'earth' ? 0.3 : 0.72; // grass under a high Texas Sun casts a softer shadow
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.fill(shade);
  // The legs, from each footpad's shadow up to the stage's.
  ctx.strokeStyle = `rgba(0,0,0,${a})`;
  ctx.lineWidth = Math.max(1.4, 0.55 * cam.s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [ax, ay, az, bx, by, bz] of parts.legs) {
    const [x0, y0] = at(proj(ax, ay), az), [x1, y1] = at(proj(bx, by), bz);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

// ---------- dust ----------

// Inside about 100 feet the engine blasts the surface out sideways: grains race off in every
// direction on nearly flat paths and keep going, since there's no air to slow them. Seen from the
// side that's a bright sheet hugging the ground, streaks along the track and fanning out across the
// near ground toward you, and close in a haze that hides the surface. When the engine stops it all
// clears at once: nothing hangs in a vacuum.
const DUST_MAX = 900;
const DUST_C = '228,222,210';

function dust(r, sc) {
  const { ctx, X, Y, band, cam, H } = r;
  const { g, f, site } = sc;
  const d = site.dust;
  const dt = Math.min(0.05, sc.dt || 0.016);
  let want = 0, gx = r.dustX ?? f.x;
  if (f.phase === 'flying' && f.thr > 0.04) {
    const [nx, ny] = toWorld(f, 0, f.veh.bellClear);
    const h = ny - groundAt(g, nx);
    gx = nx - Math.tan(f.th) * h; // where the exhaust meets the ground
    want = d.dense * Math.pow(clamp((d.top - h) / (d.top - 4), 0, 1), 1.3) * Math.min(1, f.thr / 0.22);
  }
  // It builds as the engine makes it and clears as fast as the grains fly off.
  r.dustI = want >= r.dustI ? want : r.dustI * Math.exp(-dt / 0.22);
  if (r.dustI < 0.004) r.dustI = 0;
  r.dustX = gx;
  const I = r.dustI;
  if (want > 0.01) {
    const n = Math.min(DUST_MAX - r.dust.length, want * 2400 * dt);
    for (let k = 0; k < n; k++) {
      // From a ring round where the plume strikes, not a single point.
      const a = Math.random() * Math.PI * 2, r0 = 2 + Math.random() * 7;
      const sp = (90 + Math.random() * 170) * (0.6 + 0.4 * want);
      r.dust.push({
        x: gx + Math.cos(a) * r0, z: Math.sin(a) * r0, y: Math.random() * 0.6,
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: sp * (0.006 + Math.random() * 0.03),
        a: 0.3 + Math.random() * 0.55, tail: 0.02 + Math.random() * 0.035, x0: gx,
      });
    }
  }
  // Every grain on its own ballistic path, until it lands or leaves.
  const [xa, xb] = visibleRange(r);
  const keep = [];
  for (const p of r.dust) {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.vy -= G_MOON * dt;
    p.y += p.vy * dt;
    if (p.y < 0 || p.x < xa - 200 || p.x > xb + 200 || Math.abs(p.z) > 160) continue;
    keep.push(p);
  }
  r.dust = keep;
  if (I <= 0.01) return;

  const deep = Math.max(40, H - (Y(groundAt(g, gx)) + band));
  const R = 26 + Math.max(0, d.top - Math.max(0, altitude(f))) * 1.3;
  const C = site.world === 'earth' ? '196,188,150' : DUST_C; // Ellington's is grass and Texas dirt
  const a = Math.min(0.9, d.dense * 1.05 * I + 0.06);
  // The haze over the near ground: thick close in, thinning out toward you and to the sides.
  const cy = Y(groundAt(g, gx)) + band * 0.5;
  const rx = Math.max(60, R * cam.s * 1.15), ry = deep * (0.3 + 0.75 * I);
  ctx.save();
  ctx.translate(X(gx), cy);
  ctx.scale(1, ry / rx);
  const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  haze.addColorStop(0, `rgba(${C},${a})`);
  haze.addColorStop(0.45, `rgba(${C},${a * 0.62})`);
  haze.addColorStop(1, `rgba(${C},0)`);
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI);
  ctx.fill();
  ctx.restore();
  // The sheet along the surface, standing a few feet high and brightest right under the engine.
  const T = d.thick * (0.4 + 0.6 * I);
  const sheet = ctx.createLinearGradient(X(gx - R), 0, X(gx + R), 0);
  sheet.addColorStop(0, `rgba(${C},0)`);
  sheet.addColorStop(0.3, `rgba(${C},${a * 0.55})`);
  sheet.addColorStop(0.5, `rgba(${C},${a * 0.85})`);
  sheet.addColorStop(0.7, `rgba(${C},${a * 0.55})`);
  sheet.addColorStop(1, `rgba(${C},0)`);
  ctx.fillStyle = sheet;
  const step = Math.max(1, 2 / cam.s);
  for (const k of [1, 0.5]) {
    ctx.beginPath();
    for (let x = gx - R; x <= gx + R; x += step) {
      const u = (x - gx) / R;
      ctx.lineTo(X(x), Y(groundAt(g, x) + T * k * (1 - u * u)) - 1);
    }
    for (let x = gx + R; x >= gx - R; x -= step) ctx.lineTo(X(x), Y(groundAt(g, x)) + band + 1);
    ctx.closePath();
    ctx.fill();
  }
}

// Where a grain is on screen: along the track it sits on the ground line; heading toward you it
// drops down across the near ground and spreads out, heading away it sinks into the far edge.
function grainAt(r, sc, x, z, y, deep) {
  const gy = r.Y(groundAt(sc.g, x) + y);
  if (z <= 0) return [r.X(x), gy + r.band * 0.45 * Math.max(0, 1 + z / 30)];
  const q = 1 - Math.exp(-z / 45);
  const cx = r.X(r.dustX);
  return [cx + (r.X(x) - cx) * (1 + 1.1 * q), gy + r.band * 0.45 + (deep - r.band * 0.45) * q];
}

function particles(r, sc) {
  const { ctx, X, Y } = r;
  const { f, g } = sc;
  const dt = Math.min(0.05, sc.dt || 0.016);
  // Dust streaks: each grain drawn back along its path for a few hundredths of a second.
  if (r.dust.length) {
    const deep = Math.max(40, r.H - (Y(groundAt(g, r.dustX)) + r.band));
    const groups = [[new Path2D(), new Path2D(), new Path2D()], [new Path2D(), new Path2D(), new Path2D()]];
    for (const p of r.dust) {
      const fade = clamp(1 - Math.hypot(p.x - p.x0, p.z) / 150, 0, 1) * p.a;
      if (fade < 0.06) continue;
      const [x1, y1] = grainAt(r, sc, p.x, p.z, p.y, deep);
      const [x0, y0] = grainAt(r, sc, p.x - p.vx * p.tail, p.z - p.vz * p.tail, Math.max(0, p.y - p.vy * p.tail), deep);
      const path = groups[p.z > 18 ? 1 : 0][fade < 0.25 ? 0 : fade < 0.45 ? 1 : 2];
      path.moveTo(x0, y0);
      path.lineTo(x1, y1);
    }
    groups.forEach((set, w) => {
      ctx.lineWidth = w ? 1.6 : 1.1;
      (w ? [0.1, 0.2, 0.34] : [0.2, 0.38, 0.6]).forEach((a, k) => {
        ctx.strokeStyle = `rgba(${sc.site.world === 'earth' ? '170,168,130' : DUST_C},${a})`;
        ctx.stroke(set[k]);
      });
    });
  }
  // The attitude jets: a brief bright jet from each thruster quad as they fire, gone in a tenth of a
  // second. Nothing hangs about in a vacuum, so there's no smoke.
  const dw = f.w - (r.lastW ?? f.w);
  r.lastW = f.w;
  r.jetWait = (r.jetWait ?? 0) - dt;
  if (f.phase === 'flying' && f.veh.id === 'lm' && f.jets > 0.3 && Math.abs(dw) > 1e-5 && r.jetWait <= 0) {
    r.jetWait = 0.07 + Math.random() * 0.07;
    // Tipping the top forward, the aft quad fires down and the forward quad up; the other way round, the other way.
    const s = Math.sign(dw), k = Math.min(1, f.jets);
    r.puffs.push({ bx: -7.0, by: 15.6, up: -s, t: 0, k }, { bx: 6.5, by: 15.7, up: s, t: 0, k });
  }
  const keep = [];
  if (f.phase === 'flying') {
    const sc2 = r.craftScale || r.cam.s, c = Math.cos(f.th), sn = Math.sin(f.th);
    // A point on the LM as it's drawn (a little larger than true when far off).
    const at = (bx, by) => { const dy = by - f.veh.cg; return [X(f.x) + (bx * c + dy * sn) * sc2, Y(f.y) - (-bx * sn + dy * c) * sc2]; };
    for (const p of r.puffs) {
      p.t += dt;
      if (p.t > 0.1) continue;
      keep.push(p);
      const a = 1 - p.t / 0.1, len = 1.2 + 2.6 * p.k;
      const [x0, y0] = at(p.bx, p.by + p.up * 1.15), [x1, y1] = at(p.bx, p.by + p.up * len);
      const w0 = Math.max(0.6, 0.25 * sc2), w1 = Math.max(1.2, 0.85 * sc2);
      const l = Math.hypot(x1 - x0, y1 - y0) || 1, nx = (y0 - y1) / l, ny = (x1 - x0) / l;
      const gr = ctx.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, `rgba(255, 255, 255, ${0.9 * a})`);
      gr.addColorStop(1, 'rgba(200, 225, 255, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
      ctx.lineTo(x1 + nx * w1, y1 + ny * w1);
      ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
      ctx.lineTo(x0 - nx * w0, y0 - ny * w0);
      ctx.closePath();
      ctx.fill();
    }
  }
  r.puffs = keep;
  // Debris after a crash.
  if (r.debris.length) {
    for (const p of r.debris) {
      if (!p.rest) {
        p.vy -= G_MOON * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y <= groundAt(g, p.x)) { p.y = groundAt(g, p.x); p.rest = true; }
      }
      // Shards of foil and panel, tumbling until they land.
      if (!p.rest) p.rot += p.spin * dt;
      const z = Math.max(1.6, p.s * r.cam.s);
      ctx.save();
      ctx.translate(X(p.x), Y(p.y) - z * 0.3);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      if (p.tri) { ctx.moveTo(-z * 0.6, z * 0.4); ctx.lineTo(z * 0.6, z * 0.3); ctx.lineTo(-z * 0.1, -z * 0.5); }
      else ctx.rect(-z * 0.5, -z * 0.3, z, z * 0.6);
      ctx.fill();
      ctx.restore();
    }
  }
}

// Bits of foil and metal when it all goes wrong.
export function burst(r, f, n = 40) {
  const cols = f.veh.id === 'lltv' ? ['#e9eae5', '#9a9e98', '#d0582c', '#c7c9c4'] : ['#d8b058', '#1c1a17', '#c9ccc9', '#a97d2f', '#f3d98a'];
  for (let k = 0; k < n; k++) {
    // Thrown gently: in Moon gravity anything faster stays up for many seconds.
    const a = 0.25 + Math.random() * (Math.PI - 0.5), sp = 4 + Math.random() * 14;
    r.debris.push({
      x: f.x + (Math.random() - 0.5) * 12, y: f.y - f.veh.cg + 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      c: cols[k % cols.length], s: 0.3 + Math.pow(Math.random(), 2) * 1.4, rot: Math.random() * 6.3, spin: (Math.random() - 0.5) * 16, tri: Math.random() < 0.55,
    });
  }
  kick(r, f, 320, 1);
  if (!still()) r.shake = 10;
}

// Soil thrown up where something hits the ground: it arcs out and falls back, with no air to hold it.
function kick(r, f, n, k) {
  r.dustX = f.x;
  r.dustI = Math.max(r.dustI || 0, 0.45 * k);
  for (let i = 0; i < n && r.dust.length < DUST_MAX; i++) {
    const a = Math.random() * Math.PI * 2, sp = (18 + Math.random() * 70) * k;
    r.dust.push({
      x: f.x + Math.cos(a) * 6, z: Math.sin(a) * 6, y: 0.2,
      vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: sp * (0.12 + Math.random() * 0.3),
      a: 0.3 + Math.random() * 0.5, tail: 0.03 + Math.random() * 0.03, x0: f.x,
    });
  }
}

export function bump(r, k = 3, f = null) {
  if (f && k > 4) kick(r, f, 90, 0.5); // a hard landing kicks up a little soil
  if (!still()) r.shake = Math.max(r.shake, k);
}
// People who've asked their phone for less motion get no camera shake.
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- the lander ----------

function craft(r, sc) {
  const { ctx, cam, X, Y } = r;
  const { f } = sc;
  const span = 2 * f.veh.half;
  // Far off, draw it a little bigger than true so it never shrinks to a speck.
  const k = Math.max(1, 30 / (span * cam.s));
  const sc2 = cam.s * k;
  r.craftScale = sc2;
  // Where it is on screen, roughly, so the target pointer can keep out of its way.
  const half = (f.veh.half + 2) * sc2;
  r.lmBox = [X(f.x) - half, Y(f.y) - (f.veh.height - f.veh.cg + 1) * sc2, X(f.x) + half, Y(f.y) + (f.veh.cg + f.veh.probe + 1) * sc2];
  const detail = clamp((span * sc2 - 24) / 70, 0, 1);
  setMinLine(1 / sc2);
  const probes = f.phase === 'flying' || f.phase === 'abort' ? 'hang' : 'bent';
  const pose = (x, y, th) => {
    ctx.save();
    ctx.translate(X(x), Y(y));
    ctx.rotate(th);
    ctx.scale(sc2, -sc2);
    ctx.translate(0, -f.veh.cg);
  };
  if (f.veh.id === 'lltv') {
    pose(f.x, f.y, f.th);
    drawLLTV(ctx, { engine: f.phase === 'flying' ? f.thr : 0 });
    ctx.restore();
    return;
  }
  if (f.phase === 'abort' && f.asc) {
    pose(f.x, f.y, f.th);
    drawLM(ctx, { stage: 'descent', probes: 'hang', detail, engine: 0 });
    ctx.restore();
    const a = f.asc;
    pose(a.x, a.y - 0.5, a.th);
    drawAscentPlume(ctx, 0.8 + Math.random() * 0.2);
    drawLM(ctx, { stage: 'ascent', detail });
    ctx.restore();
    return;
  }
  pose(f.x, f.y, f.th);
  drawLM(ctx, { probes, detail, engine: f.phase === 'flying' ? f.thr : 0 });
  ctx.restore();
  // Contact: a glint where the probe touched, for the moment the lamp comes on.
  if (f.contactAt != null && f.t - f.contactAt < 0.9) {
    const k = 1 - (f.t - f.contactAt) / 0.9;
    let best = null;
    for (const px of f.veh.probes) {
      const [wx, wy] = toWorld(f, px, -f.veh.probe);
      const d = wy - groundAt(sc.g, wx);
      if (!best || d < best.d) best = { wx, wy: Math.min(wy, groundAt(sc.g, wx) + 0.2), d };
    }
    if (best) {
      const gx = X(best.wx), gy = Y(best.wy), rad = 6 + 30 * k * Math.min(1, cam.s / 3);
      const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
      gl.addColorStop(0, `rgba(230, 246, 255, ${0.95 * k})`);
      gl.addColorStop(0.3, `rgba(85, 186, 255, ${0.6 * k})`);
      gl.addColorStop(1, 'rgba(85, 186, 255, 0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(gx, gy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- the footprint: where the footpads will come down ----------

function footprint(r, sc) {
  const { f, g } = sc;
  r.footQuality = null;
  if (f.phase !== 'flying') return;
  const alt = altitude(f);
  const fade = clamp((115 - alt) / 30, 0, 1) * clamp(alt / 1.5, 0, 1);
  if (fade <= 0) return;
  const { ctx, X, Y, cam } = r;
  const v = f.veh;
  const q = spotAt(g, f.x, v);
  const rest = Math.abs(q.rest);
  // The ground by the plaque's own limits: green gold, yellow silver, orange bronze, red no. Moving
  // too fast along the ground to stop before the footpads touch, no ground is good: the marks go red
  // and say how fast.
  const rank = groundRank(q);
  const speed = Math.abs(f.vx);
  const rushing = tooFastAlong({ alt, rate: f.vy, fwd: f.vx }) || (alt < 20 && speed > LIMITS.side[2]);
  const col = rushing || rank === 3 ? '255, 98, 82' : rank === 0 ? '176, 240, 150' : rank === 1 ? '255, 214, 110' : '255, 160, 80';
  r.footQuality = rushing ? 'moving' : ['good', 'fair', 'poor', 'bad'][rank];
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.strokeStyle = `rgba(${col}, .95)`;
  ctx.fillStyle = `rgba(${col}, .95)`;
  ctx.lineWidth = 1.5;
  const xl = f.x - v.half, xr = f.x + v.half;
  const yl = Y(q.padY[0]), yr = Y(q.padY[2]);
  const tick = clamp(cam.s * 2.2, 6, 12);
  ctx.beginPath();
  for (const [x, y] of [[X(xl), yl], [X(xr), yr]]) {
    ctx.moveTo(x - tick * 0.7, y + 2);
    ctx.lineTo(x - tick * 0.7, y - tick);
    ctx.moveTo(x + tick * 0.7, y + 2);
    ctx.lineTo(x + tick * 0.7, y - tick);
  }
  ctx.stroke();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(xl), yl - tick * 0.4);
  ctx.lineTo(X(xr), yr - tick * 0.4);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '700 11px "B612 Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  const label = rushing ? `${Math.round(speed)} ${f.vx < 0 ? 'BACK' : 'FWD'}` : shown(q.rock) > LIMITS.rock[1] || q.bodyHit ? 'ROCK' : q.bellHit ? 'BUMP' : `${one(rest)}°`;
  // Above the marks while there's room; once the footpads come down to it, below the ground line.
  const mid = (yl + yr) / 2, pads = Y(f.y - v.cg);
  const ly = mid - pads > tick + 34 ? mid - tick - 6 : mid + r.band + 14;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8, 10, 12, .55)';
  monoText(ctx, label, (X(xl) + X(xr)) / 2, ly, 'center', true);
  ctx.restore();
}
