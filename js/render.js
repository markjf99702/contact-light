// Drawing the scene on the canvas: the black sky and Earth, far hills, the ground lit by a low Sun with
// long shadows, boulders, the lander and its shadow, and the dust the engine blasts out sideways below
// about 100 feet. The camera zooms in as you come down, so near the ground a foot is several pixels
// and a six-foot boulder is easy to see.

import { groundAt, surfaceAt, boulderTop, nearBoulders, STEP, spotAt, litAt } from './terrain.js';
import { toWorld, altitude, G_MOON } from './sim.js';
import { drawLM, drawLLTV, drawAscentPlume, OUTLINE, setMinLine } from './craft.js';
import { rng } from './rng.js';

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
  lmShadow(r, sc);
  boulders(r, sc);
  if (sc.marks !== false) marks(r, sc);
  dust(r, sc);
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
  const viewFt = clamp(alt * 1.38 + 74, 100, 1100);
  let s = Math.min(sceneH / viewFt, r.W / 96);
  const lead = clamp((f.phase === 'flying' ? f.vx : 0) / 50, -1, 1) * 0.26;
  // Low down, sit the LM a little left of centre: its shadow falls ahead, to the right.
  const low = clamp((90 - alt) / 60, 0, 1) * (1 - clamp(Math.abs(f.vx) / 12, 0, 1)) * 0.12;
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
  if (!e) return;
  const { ctx, W } = r;
  const v = sc.view;
  const R = clamp(Math.min(W, r.H) * 0.03, 10, 22);
  const top = v.top + 70; // clear of the radio lines
  const x = W * e.x, y = top + (v.bottom - top) * e.y + R;
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
  const ridge = (n, span, amp, wl, base, p, col, lit) => {
    const pts = [];
    const ph = [R() * 6, R() * 6, R() * 6];
    for (let k = 0; k <= n; k++) {
      const x = -span + (2 * span * k) / n;
      let h = base + amp * (0.55 * Math.sin(x / wl + ph[0]) + 0.3 * Math.sin(x / (wl * 0.37) + ph[1]) + 0.15 * Math.sin(x / (wl * 0.13) + ph[2]));
      pts.push([x, Math.max(0, h)]);
    }
    layers.push({ pts, p, col, lit });
  };
  if (site.world === 'earth') {
    layers.push({ earth: true });
    return layers;
  }
  const big = site.backdrop;
  if (big === 'apennines') {
    layers.push({ massif: true, p: 0.05, col: [44, 42, 40], lit: [150, 143, 132], pts: massif([[-1400, 0], [-1100, 60], [-760, 190], [-430, 240], [-160, 205], [80, 120], [260, 60], [420, 28], [700, 70], [980, 150], [1200, 165], [1500, 70], [1800, 0]]) });
  } else if (big === 'massifs') {
    layers.push({ massif: true, p: 0.05, col: [42, 40, 38], lit: [146, 139, 128], pts: massif([[-1500, 0], [-1200, 90], [-900, 150], [-620, 140], [-420, 210], [-150, 250], [120, 235], [380, 170], [560, 115], [760, 160], [1000, 200], [1300, 120], [1600, 0]]) });
  } else if (big === 'highlands') {
    layers.push({ massif: true, p: 0.06, col: [50, 48, 45], lit: [156, 150, 140], pts: massif([[-1500, 0], [-1100, 70], [-700, 110], [-350, 85], [0, 120], [300, 95], [700, 135], [1100, 80], [1500, 0]]) });
  }
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
  let datum = 0;
  for (let k = -4; k <= 4; k++) datum += groundAt(sc.g, cam.cx + k * 100);
  const base = r.Y(datum / 9) + 2;
  for (const L of r.bg) {
    if (L.earth) { earthBackdrop(r, base, bs); continue; }
    const X = x => r.ox + (x - cam.cx * L.p) * bs;
    if (L.massif) { massifLayer(ctx, L, X, base, bs); continue; }
    ctx.beginPath();
    ctx.moveTo(X(L.pts[0][0]), base + 400);
    for (const [x, h] of L.pts) ctx.lineTo(X(x), base - h * bs);
    ctx.lineTo(X(L.pts[L.pts.length - 1][0]), base + 400);
    ctx.closePath();
    const top = Math.max(...L.pts.map(p => p[1]));
    const gr = ctx.createLinearGradient(0, base - top * bs, 0, base);
    gr.addColorStop(0, rgb(L.lit, 0.82));
    gr.addColorStop(0.5, rgb(L.col, 1.1));
    gr.addColorStop(1, rgb(L.col, 0.75));
    ctx.fillStyle = gr;
    ctx.fill();
    // Faces turned toward the low Sun on the left catch the light.
    ctx.lineWidth = Math.max(1, bs * 1.6);
    ctx.strokeStyle = rgb(L.lit, 1.1);
    ctx.beginPath();
    for (let k = 1; k < L.pts.length; k++) {
      const [x0, h0] = L.pts[k - 1], [x1, h1] = L.pts[k];
      if (h1 > h0 + 0.4) { ctx.moveTo(X(x0), base - h0 * bs); ctx.lineTo(X(x1), base - h1 * bs); }
    }
    ctx.stroke();
  }
}

// A mountain lit from the left: faces turned to the Sun bright, faces turned away in shade, and
// darker toward its foot.
function massifLayer(ctx, L, X, base, bs) {
  const LEVELS = 14;
  const paths = Array.from({ length: LEVELS }, () => new Path2D());
  const outline = new Path2D();
  outline.moveTo(X(L.pts[0][0]), base + 400);
  for (let k = 0; k < L.pts.length; k++) outline.lineTo(X(L.pts[k][0]), base - L.pts[k][1] * bs);
  outline.lineTo(X(L.pts[L.pts.length - 1][0]), base + 400);
  outline.closePath();
  for (let k = 1; k < L.pts.length; k++) {
    const [x0, h0] = L.pts[k - 1], [x1, h1] = L.pts[k];
    const slope = (h1 - h0) / Math.max(1, x1 - x0);
    const t = clamp(0.42 + slope * 1.6, 0, 1);
    const lv = Math.round(t * (LEVELS - 1));
    const a = X(x0) - 0.5, b = X(x1) + 0.5;
    paths[lv].moveTo(a, base - h0 * bs);
    paths[lv].lineTo(b, base - h1 * bs);
    paths[lv].lineTo(b, base + 400);
    paths[lv].lineTo(a, base + 400);
    paths[lv].closePath();
  }
  for (let lv = 0; lv < LEVELS; lv++) {
    const t = lv / (LEVELS - 1);
    const c = L.col.map((v, i) => v + (L.lit[i] - v) * t);
    ctx.fillStyle = rgb(c);
    ctx.fill(paths[lv]);
  }
  const top = Math.max(...L.pts.map(p => p[1]));
  const fade = ctx.createLinearGradient(0, base - top * bs, 0, base);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = fade;
  ctx.fill(outline);
}

// Ellington: a tree line, the hangars and a water tower across the field.
function earthBackdrop(r, base, bs) {
  const { ctx, W, cam } = r;
  const X = x => r.ox + (x - cam.cx * 0.2) * bs;
  ctx.fillStyle = '#6f8a6a';
  ctx.beginPath();
  ctx.moveTo(-10, base + 50);
  for (let x = -2600; x <= 2600; x += 18) ctx.lineTo(X(x), base - (10 + 5 * Math.sin(x * 0.07) + 3 * Math.sin(x * 0.23)) * bs);
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
  const i0 = clamp(Math.floor((xa - g.x0) / STEP), 0, g.n - 1), i1 = clamp(Math.ceil((xb - g.x0) / STEP), 0, g.n - 1);
  const idx = [];
  for (let i = i0; i <= i1; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== i1) idx.push(i1);
  const sx = i => X(g.x0 + i * STEP), sy = i => Y(g.h[i]);
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
  const sun = g.sun * DEG, sinS = Math.sin(sun), cosS = Math.cos(sun);
  const LEVELS = 28;
  const paths = Array.from({ length: LEVELS }, () => new Path2D());
  const used = new Uint8Array(LEVELS);
  const lower = new Path2D();
  for (let k = 0; k < idx.length - 1; k++) {
    const i = idx[k], j = idx[k + 1];
    const sh = shadeAt(g, i, sinS, cosS);
    const lv = Math.min(LEVELS - 1, Math.round((sh / 1.4) * (LEVELS - 1)));
    const p = paths[lv];
    used[lv] = 1;
    const x0 = sx(i) - 0.4, x1 = sx(j) + 0.4, y0 = sy(i), y1 = sy(j);
    p.moveTo(x0, y0);
    p.lineTo(x1, y1);
    p.lineTo(x1, y1 + band);
    p.lineTo(x0, y0 + band);
    p.closePath();
    lower.moveTo(x0, y0 + band * 0.42);
    lower.lineTo(x1, y1 + band * 0.42);
    lower.lineTo(x1, y1 + band + 0.6);
    lower.lineTo(x0, y0 + band + 0.6);
    lower.closePath();
  }
  const warm = site.world === 'earth' ? [0, 0, 0] : [8, 4, -2];
  for (let lv = 0; lv < LEVELS; lv++) {
    if (!used[lv]) continue;
    const k = (lv / (LEVELS - 1)) * 1.4;
    const w = k > 0.5 ? warm : [-3, -1, 4];
    ctx.fillStyle = `rgb(${clamp(pal.soil[0] * k + w[0], 0, 255) | 0},${clamp(pal.soil[1] * k + w[1], 0, 255) | 0},${clamp(pal.soil[2] * k + w[2], 0, 255) | 0})`;
    ctx.fill(paths[lv]);
  }
  // The band's lower edge fades into the ground below it.
  ctx.fillStyle = rgb(pal.soil, 0.72, 0.45);
  ctx.fill(lower);

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
      ctx.fillStyle = `rgba(232, 226, 214, ${0.62 * la})`;
      ctx.fillText(l.name.toUpperCase(), X(l.x), y);
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
    ctx.fillText(site.target.label, clamp(X(tx), 46, W - 46), top - 10);
  }
  ctx.restore();
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
  const y = v.top + (v.bottom - v.top) * 0.5;
  const text = `${sc.site.target.label} ${Math.round(d).toLocaleString('en-US')} ft`;
  ctx.save();
  ctx.font = '700 10px "B612 Mono", ui-monospace, monospace';
  const w = ctx.measureText(text).width + 26;
  const x = right ? W - w - 8 : 8;
  ctx.fillStyle = 'rgba(8, 14, 20, .72)';
  ctx.strokeStyle = 'rgba(140, 220, 255, .55)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y - 11, w, 22, 11);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(160, 228, 255, .95)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = right ? 'left' : 'right';
  if (right) {
    ctx.fillText(text, x + 9, y + 0.5);
    tri(ctx, x + w - 9, y, 1);
  } else {
    ctx.fillText(text, x + w - 9, y + 0.5);
    tri(ctx, x + 9, y, -1);
  }
  ctx.restore();
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
// when you're high, and slides back to meet the footpads as you come down.
function lmShadow(r, sc) {
  const { ctx, X, Y, band, cam } = r;
  const { g, f } = sc;
  if (f.phase === 'abort') return;
  const out = OUTLINE[f.veh.id];
  const tan = Math.tan(g.sun * DEG);
  let near = Infinity, far = -Infinity;
  for (const [bx, by] of out) {
    const [wx, wy] = toWorld(f, bx, by);
    let gx = wx;
    for (let k = 0; k < 3; k++) gx = wx + Math.max(0, wy - groundAt(g, gx)) / tan;
    near = Math.min(near, gx);
    far = Math.max(far, gx);
  }
  r.shadowSeen = X(near) > 0 && X(near) < r.W;
  if (X(near) > r.W + 10 || X(far) < -10) return;
  // A dark patch on the ground along the track, deepest near the end the footpads cast.
  const a = 0.7;
  const gr = ctx.createLinearGradient(X(near), 0, X(far), 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(Math.min(0.12, 6 / Math.max(1, X(far) - X(near))), `rgba(0,0,0,${a})`);
  gr.addColorStop(0.72, `rgba(0,0,0,${a})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr;
  const step = Math.max(1, 2 / cam.s);
  const top = [], bot = [];
  for (let x = near; x <= far + 0.01; x += step) {
    const t = (x - near) / Math.max(1, far - near);
    const fat = Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85)) * 0.8 + 0.2;
    const y = Y(groundAt(g, x));
    top.push([X(x), y - 0.5]);
    bot.push([X(x), y + band * (0.8 + 1.5 * fat)]);
  }
  ctx.beginPath();
  top.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(bot[k][0], bot[k][1]);
  ctx.closePath();
  ctx.fill();
}

// ---------- dust ----------

function dust(r, sc) {
  const { ctx, X, Y, band, cam } = r;
  const { g, f, site } = sc;
  const d = site.dust;
  const dt = Math.min(0.05, sc.dt || 0.016);
  let I = 0, gx = f.x;
  if (f.phase === 'flying' && f.thr > 0.04) {
    const [nx, ny] = toWorld(f, 0, f.veh.bellClear);
    const h = ny - groundAt(g, nx);
    gx = nx - Math.tan(f.th) * h;
    I = d.dense * Math.pow(clamp((d.top - h) / (d.top - 4), 0, 1), 1.3) * Math.min(1, f.thr / 0.22);
    // Particles race out along the ground on nearly flat paths and keep going: there's no air.
    const n = I * 420 * dt;
    for (let k = 0; k < n; k++) {
      if (r.dust.length > 420) break;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const sp = (70 + Math.random() * 120) * (0.55 + 0.45 * I);
      const x = gx + dir * Math.random() * 4;
      r.dust.push({ x, y: groundAt(g, x) + Math.random() * 1.4, vx: dir * sp, vy: sp * (0.012 + Math.random() * 0.05), a: 0.12 + Math.random() * 0.35 });
    }
  }
  r.dustI = I;
  r.dustX = gx;
  // Move every particle on its ballistic path.
  const [xa, xb] = visibleRange(r);
  const keep = [];
  for (const p of r.dust) {
    p.x += p.vx * dt;
    p.vy -= G_MOON * dt;
    p.y += p.vy * dt;
    if (p.y < groundAt(g, p.x) - 0.6 || p.x < xa - 300 || p.x > xb + 300) continue;
    keep.push(p);
  }
  r.dust = keep;

  // The sheet itself, hugging the ground and hiding it, thickest right under you.
  if (I > 0.02) {
    const alt = Math.max(0, altitude(f));
    const R = 24 + Math.max(0, d.top - alt) * 1.35;
    const T = d.thick * (0.35 + 0.65 * I);
    const tNow = performance.now() / 1000;
    const top = [], bot = [];
    for (let x = gx - R; x <= gx + R; x += Math.max(1, 2 / cam.s)) {
      const gy = groundAt(g, x);
      const wob = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(x * 0.21 - Math.sign(x - gx) * tNow * 14));
      top.push([X(x), Y(gy + T * wob)]);
      bot.push([X(x), Y(gy) + band + 1]);
    }
    const gr = ctx.createLinearGradient(X(gx - R), 0, X(gx + R), 0);
    const c = site.world === 'earth' ? '150,150,110' : '200,192,178';
    const a = Math.min(0.92, d.dense * 0.9 * I + 0.08);
    gr.addColorStop(0, `rgba(${c},0)`);
    gr.addColorStop(0.3, `rgba(${c},${a * 0.75})`);
    gr.addColorStop(0.5, `rgba(${c},${a})`);
    gr.addColorStop(0.7, `rgba(${c},${a * 0.75})`);
    gr.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = gr;
    ctx.beginPath();
    top.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(bot[k][0], bot[k][1]);
    ctx.closePath();
    ctx.fill();
  }
}

function particles(r, sc) {
  const { ctx, X, Y } = r;
  const { f, g } = sc;
  const dt = Math.min(0.05, sc.dt || 0.016);
  // Dust streaks.
  if (r.dust.length) {
    const c = sc.site.world === 'earth' ? '170,168,130' : '222,214,200';
    const groups = [new Path2D(), new Path2D(), new Path2D()];
    for (const p of r.dust) {
      const k = p.a < 0.22 ? 0 : p.a < 0.34 ? 1 : 2;
      groups[k].moveTo(X(p.x), Y(p.y));
      groups[k].lineTo(X(p.x - p.vx * 0.05), Y(p.y - p.vy * 0.05));
    }
    ctx.lineWidth = 1.1;
    [0.16, 0.28, 0.42].forEach((a, k) => {
      ctx.strokeStyle = `rgba(${c},${a})`;
      ctx.stroke(groups[k]);
    });
  }
  // Puffs from the attitude jets.
  if (f.phase === 'flying' && f.veh.id === 'lm' && f.jets > 0.2 && Math.random() < f.jets * 0.6) {
    const s = Math.sign(f.w) || 1;
    for (const [bx, by, up] of [[-7.0, 15.6, s > 0 ? 1 : -1], [6.5, 15.7, s > 0 ? -1 : 1]]) {
      const [wx, wy] = toWorld(f, bx, by + up * 0.9);
      const dir = [Math.sin(f.th) * up, Math.cos(f.th) * up];
      r.puffs.push({ x: wx, y: wy, vx: dir[0] * 24 + f.vx, vy: dir[1] * 24 + f.vy, t: 0 });
    }
  }
  const keep = [];
  for (const p of r.puffs) {
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.t > 0.3) continue;
    keep.push(p);
    const rad = (0.4 + p.t * 5) * r.cam.s;
    ctx.fillStyle = `rgba(240, 240, 235, ${0.5 * (1 - p.t / 0.3)})`;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), Math.max(1, rad), 0, Math.PI * 2);
    ctx.fill();
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
      ctx.fillStyle = p.c;
      ctx.fillRect(X(p.x) - 1.5, Y(p.y) - 1.5, 3, 3);
    }
  }
}

// Bits of foil and metal when it all goes wrong.
export function burst(r, f, n = 46) {
  const cols = ['#d8b058', '#1c1a17', '#c9ccc9', '#a97d2f', '#f3d98a'];
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI, sp = 8 + Math.random() * 30;
    r.debris.push({ x: f.x + (Math.random() - 0.5) * 10, y: f.y - f.veh.cg + 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: cols[k % cols.length] });
  }
  r.shake = 10;
}

export function bump(r, k = 3) { r.shake = Math.max(r.shake, k); }

// ---------- the lander ----------

function craft(r, sc) {
  const { ctx, cam, X, Y } = r;
  const { f } = sc;
  const span = 2 * f.veh.half;
  // Far off, draw it a little bigger than true so it never shrinks to a speck.
  const k = Math.max(1, 30 / (span * cam.s));
  const sc2 = cam.s * k;
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
}

// ---------- the footprint: where the footpads will come down ----------

function footprint(r, sc) {
  const { f, g } = sc;
  if (f.phase !== 'flying') return;
  const alt = altitude(f);
  const fade = clamp((115 - alt) / 30, 0, 1) * clamp(alt / 1.5, 0, 1);
  if (fade <= 0) return;
  const { ctx, X, Y, cam } = r;
  const v = f.veh;
  const q = spotAt(g, f.x, v);
  const rest = Math.abs(q.rest);
  const bad = rest > 12 || q.rock > 3 || q.bodyHit;
  const fair = rest <= 6 && q.rock < 1.5 && !q.bellHit;
  const good = rest <= 3 && q.rock < 0.5 && !q.bellHit;
  const col = bad ? '255, 98, 82' : good ? '176, 240, 150' : fair ? '255, 214, 110' : '255, 160, 80';
  r.footQuality = bad ? 'bad' : good ? 'good' : fair ? 'fair' : 'poor';
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
  const label = q.rock >= 1.5 || q.bodyHit ? 'ROCK' : q.bellHit ? 'BUMP' : `${Math.round(rest)}°`;
  ctx.fillText(label, (X(xl) + X(xr)) / 2, (yl + yr) / 2 - tick - 6);
  ctx.restore();
}
