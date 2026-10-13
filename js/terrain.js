// The ground along the line you fly: a height every foot, boulders sitting on it, and how the low sun
// lights it. Everything here is plain arithmetic with no page involved, so it runs in Node for the tests.
// Heights and distances are in feet. x grows in the direction of flight (west, with the Sun behind you).

import { rng, between, powerSize } from './rng.js';

export const STEP = 1; // feet between height samples

const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export function buildGround(spec) {
  const [x0, x1] = spec.span;
  const n = Math.floor((x1 - x0) / STEP) + 1;
  const h = new Float32Array(n);
  const R = rng(spec.seed || 1);
  const X = i => x0 + i * STEP;
  const clear = spec.clear || [];
  const inClear = (x, pad = 0) => clear.some(([a, b]) => x > a - pad && x < b + pad);

  // Long, gentle rolls of the ground.
  for (const [amp, wl] of spec.roll || []) {
    const ph = R() * Math.PI * 2;
    for (let i = 0; i < n; i++) h[i] += amp * Math.sin((X(i) * 2 * Math.PI) / wl + ph);
  }
  // Small bumps, so no stretch is perfectly flat.
  for (const [amp, wl] of spec.bumps || []) addNoise(h, x0, amp, wl, R);
  // Ramps: the ground rising or falling between two points and staying there.
  for (const s of spec.ramps || []) {
    for (let i = 0; i < n; i++) h[i] += s.dh * smooth((X(i) - s.x0) / (s.x1 - s.x0));
  }
  // Hummocks: single rounded rises (Fra Mauro, the highlands).
  for (const m of spec.mounds || []) {
    for (let i = 0; i < n; i++) {
      const u = (X(i) - m.x) / m.w;
      if (u > -1 && u < 1) h[i] += m.dh * Math.pow(Math.cos((u * Math.PI) / 2), 2);
    }
  }
  // A rille: a channel far deeper than any crater, with steep walls (Hadley).
  if (spec.rille) {
    const { x0: rx, width, depth } = spec.rille;
    for (let i = 0; i < n; i++) {
      const u = (X(i) - rx) / width;
      if (u > 0) h[i] -= depth * smooth(Math.min(1, u / 0.32)) * (u < 1 ? 1 : smooth(1 - (u - 1) / 0.32));
    }
  }

  // Craters: the named ones from the maps, then a scatter of small ones.
  const craters = (spec.craters || []).map(c => ({ ...c }));
  if (spec.pits) {
    const { per1000, min, max } = spec.pits;
    const count = Math.round(((x1 - x0) / 1000) * per1000);
    for (let k = 0; k < count; k++) {
      const r = powerSize(R, min, max, 2.4);
      const x = between(R, x0, x1);
      if (r > 3 && inClear(x, r)) continue;
      if (craters.some(c => !c.small && Math.abs(x - c.x) < c.r * 1.05)) continue; // not inside the big ones
      craters.push({ x, r, d: r * between(R, 0.14, 0.24), rim: r * between(R, 0.03, 0.07), small: true });
    }
  }
  for (const c of craters) carveCrater(h, x0, n, c);

  // Boulders: the ones placed by hand, then the fields.
  const boulders = [];
  for (const b of spec.rocks || []) boulders.push(makeBoulder(b.x, b.h, b.w, R, b.kind));
  for (const f of spec.fields || []) {
    for (let k = 0; k < f.n; k++) {
      // A field can thin out from its middle (a crater rim's blocks) or be even.
      let x = between(R, f.x0, f.x1);
      if (f.peak != null) {
        const s = (f.x1 - f.x0) / 2;
        x = f.peak + (R() + R() + R() - 1.5) * s * 0.9;
        if (x < f.x0 || x > f.x1) continue;
      }
      if (inClear(x, 2)) continue;
      boulders.push(makeBoulder(x, powerSize(R, f.min, f.max, f.k || 2.3), null, R));
    }
  }
  boulders.sort((a, b) => a.x - b.x);

  const g = {
    x0, x1, n, h, boulders,
    sun: spec.sun || 10,
    labels: craters.filter(c => c.name).map(c => ({ x: c.x, name: c.name, r: c.r })).concat(spec.labels || []),
    top: new Float32Array(n),
    lit: new Uint8Array(n),
    alb: new Float32Array(n),
  };
  for (const b of boulders) b.base = groundAt(g, b.x) - b.h * 0.12;
  computeTop(g);
  computeLight(g, R);
  return g;
}

// Value noise: random heights every wl feet, joined smoothly.
function addNoise(h, x0, amp, wl, R) {
  const n = h.length;
  const knots = Math.ceil((n * STEP) / wl) + 3;
  const v = Array.from({ length: knots }, () => R() * 2 - 1);
  for (let i = 0; i < n; i++) {
    const t = (i * STEP) / wl, k = Math.floor(t), f = t - k;
    const s = f * f * (3 - 2 * f);
    h[i] += amp * (v[k] * (1 - s) + v[k + 1] * s);
  }
}

// A crater in cross-section: a bowl dug to depth d with a raised rim that dies away over about one radius.
// Fresh craters (fresh: true) have steeper walls than old, worn ones.
function carveCrater(h, x0, n, c) {
  const reach = c.r * 2;
  const i0 = Math.max(0, Math.floor((c.x - reach - x0) / STEP)), i1 = Math.min(n - 1, Math.ceil((c.x + reach - x0) / STEP));
  const p = c.fresh ? 3.2 : c.worn ? 1.25 : 2;
  for (let i = i0; i <= i1; i++) {
    const u = Math.abs(x0 + i * STEP - c.x) / c.r;
    let z;
    if (u <= 1) z = c.rim - (c.d + c.rim) * (1 - Math.pow(u, p));
    else z = c.rim * Math.pow(Math.max(0, 2 - u), 2);
    h[i] += z;
  }
}

function makeBoulder(x, height, width, R, kind) {
  const hgt = Math.max(0.3, height);
  const r = width ? width / 2 : hgt * between(R, 0.6, 1.05);
  // A few random facets, so no two rocks look alike.
  const facets = Array.from({ length: 7 }, () => between(R, 0.82, 1.08));
  return { x, h: hgt, r, facets, tilt: between(R, -0.25, 0.25), kind: kind || 'rock', base: 0 };
}

// The top of a boulder at x, or -Infinity off it. A rounded block with a fairly flat top.
export function boulderTop(b, x) {
  const u = (x - b.x) / b.r;
  if (u <= -1 || u >= 1) return -Infinity;
  return b.base + b.h * Math.pow(1 - u * u, 0.42);
}

function computeTop(g) {
  const { n, h, x0, top, boulders } = g;
  top.set(h);
  for (const b of boulders) {
    const i0 = Math.max(0, Math.floor((b.x - b.r - x0) / STEP)), i1 = Math.min(n - 1, Math.ceil((b.x + b.r - x0) / STEP));
    for (let i = i0; i <= i1; i++) {
      const y = boulderTop(b, x0 + i * STEP);
      if (y > top[i]) top[i] = y;
    }
    // A rock narrower than a sample still counts at its nearest sample.
    const ic = Math.round((b.x - x0) / STEP);
    if (ic >= 0 && ic < n) top[ic] = Math.max(top[ic], b.base + b.h);
  }
}

// Which bits of bare ground the Sun reaches. The Sun is low behind you (on the left), so sweeping
// left to right, a shadow line falls away from every high point at the Sun's angle.
function computeLight(g, R) {
  const { n, h, top, lit, alb } = g;
  const t = Math.tan((g.sun * Math.PI) / 180) * STEP;
  let line = -1e9;
  for (let i = 0; i < n; i++) {
    line -= t;
    lit[i] = h[i] >= line - 0.05 ? 1 : 0;
    if (top[i] > line) line = top[i];
  }
  // A little patchiness in how bright the soil is.
  const v = new Float32Array(n);
  addNoise(v, 0, 1, 23, R);
  addNoise(v, 0, 0.5, 7, R);
  for (let i = 0; i < n; i++) alb[i] = 1 + v[i] * 0.05;
}

const idx = (g, x) => (x - g.x0) / STEP;

function sample(arr, g, x) {
  let f = idx(g, x);
  if (f <= 0) return arr[0];
  if (f >= g.n - 1) return arr[g.n - 1];
  const i = Math.floor(f);
  f -= i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

export const groundAt = (g, x) => sample(g.h, g, x);
export const surfaceAt = (g, x) => sample(g.top, g, x);
export const litAt = (g, x) => g.lit[Math.max(0, Math.min(g.n - 1, Math.round(idx(g, x))))];

// Slope of the bare ground at x, in degrees, measured over a short base.
export function slopeAt(g, x, base = 2) {
  return (Math.atan2(groundAt(g, x + base) - groundAt(g, x - base), 2 * base) * 180) / Math.PI;
}

// The highest thing under a footpad that spans x - half .. x + half, and how much of that is rock.
export function support(g, x, half) {
  let top = -Infinity, ground = -Infinity;
  for (let s = x - half; s <= x + half + 1e-6; s += Math.min(STEP, half || STEP)) {
    top = Math.max(top, surfaceAt(g, s));
    ground = Math.max(ground, groundAt(g, s));
  }
  for (const b of nearBoulders(g, x - half, x + half)) {
    const lo = Math.max(x - half, b.x - b.r), hi = Math.min(x + half, b.x + b.r);
    if (lo > hi) continue;
    const at = b.x < lo ? lo : b.x > hi ? hi : b.x;
    top = Math.max(top, boulderTop(b, at));
  }
  return { y: top, rock: Math.max(0, top - ground) };
}

export function nearBoulders(g, a, b) {
  const out = [];
  const bs = g.boulders;
  // Boulders are sorted by x; walk from a binary-searched start.
  let lo = 0, hi = bs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bs[m].x < a - 30) lo = m + 1; else hi = m; }
  for (let i = lo; i < bs.length && bs[i].x - bs[i].r <= b; i++) if (bs[i].x + bs[i].r >= a) out.push(bs[i]);
  return out;
}

// How a lander would sit with its centre at x. veh: { half (centre to an outer footpad), pad (footpad
// half-width), bell (nozzle exit radius), bellClear (nozzle height above the footpads), body: [half-width, height] }.
// Returns the slope of the bare ground across the footpads, the angle it would rest at (rocks under a
// pad tip it more), the tallest rock under a pad, and whether the engine bell or the body would hit.
export function spotAt(g, x, veh) {
  const L = support(g, x - veh.half, veh.pad), Rt = support(g, x + veh.half, veh.pad);
  // The middle footpad in this side view is the near side leg, out of the line you fly: it stands on
  // the ground beside a boulder, not on it. A boulder in the middle is under the engine bell.
  const C = { y: Math.max(groundAt(g, x - veh.pad), groundAt(g, x), groundAt(g, x + veh.pad)), rock: 0 };
  const slope = (Math.atan2(groundAt(g, x + veh.half) - groundAt(g, x - veh.half), 2 * veh.half) * 180) / Math.PI;
  // The footpads rest on a line through two of the three supports, with the third on or above the ground.
  let line = { a: L.y, b: Rt.y }; // heights of the line at the left and right pads
  const mid = (L.y + Rt.y) / 2;
  if (C.y > mid + 1e-6) {
    // A hump under the middle: it sits on the hump and one outer pad.
    const viaL = { a: L.y, b: 2 * C.y - L.y }, viaR = { a: 2 * C.y - Rt.y, b: Rt.y };
    const okL = viaL.b >= Rt.y - 1e-6, okR = viaR.a >= L.y - 1e-6;
    if (okL && okR) line = Math.abs(viaL.b - viaL.a) <= Math.abs(viaR.b - viaR.a) ? viaL : viaR;
    else line = okL ? viaL : viaR;
  }
  const rest = (Math.atan2(line.b - line.a, 2 * veh.half) * 180) / Math.PI;
  const lineAt = s => line.a + ((s - (x - veh.half)) / (2 * veh.half)) * (line.b - line.a);
  // What sticks up under the engine bell and under the body.
  let bellUp = -Infinity, bodyUp = -Infinity;
  for (let s = x - veh.body[0]; s <= x + veh.body[0]; s += 0.5) {
    const up = surfaceAt(g, s) - lineAt(s);
    if (Math.abs(s - x) <= veh.bell) bellUp = Math.max(bellUp, up);
    bodyUp = Math.max(bodyUp, up);
  }
  for (const b of nearBoulders(g, x - veh.body[0], x + veh.body[0])) {
    const at = Math.max(x - veh.body[0], Math.min(x + veh.body[0], b.x));
    const up = boulderTop(b, at) - lineAt(at);
    if (Math.abs(at - x) <= veh.bell) bellUp = Math.max(bellUp, up);
    bodyUp = Math.max(bodyUp, up);
  }
  return {
    slope,
    rest,
    rock: Math.max(L.rock, C.rock, Rt.rock),
    bellHit: bellUp > veh.bellClear,
    bodyHit: bodyUp > veh.body[1],
    bellUp: Math.max(0, bellUp),
    padY: [line.a, (line.a + line.b) / 2, line.b],
  };
}
