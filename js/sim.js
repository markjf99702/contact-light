// The flight model: one axis along the ground track, Moon gravity, the descent engine and the
// computer's P66 landing program. Plain arithmetic with no page involved, so it runs in Node for the tests.
//
// Units: feet, seconds, kilograms and newtons. x grows in the direction of flight, y is height on the
// same datum as the ground. th is the LM's tilt in radians, positive with its top leaning forward.

import { surfaceAt, groundAt, spotAt } from './terrain.js';

export const G_MOON = 1.62 * 3.28084; // 5.32 ft/s²
const G0 = 9.80665;
const M_PER_FT = 0.3048;
const DEG = Math.PI / 180;

// The descent engine: 1,050 to 10,125 lbf (4.67 to 45.04 kN), specific impulse about 311 s.
// In P66 the computer throttled it between 10% and 60%.
export const ENGINE = { max: 45040, isp: 311, p66Min: 0.1, p66Max: 0.6, lag: 0.3 };
// A full descent propellant load, for the percent gauge (18,184 lb). The low-level sensor tripped at 5.6%.
export const FULL_LOAD = 8248;
export const LOW_LEVEL = 5.6;
// After the low-level light, Houston counted 94 s to Bingo; at Bingo it was land within 20 s or abort.
export const BINGO_AFTER_LOW = 94;
export const LAND_AFTER_BINGO = 20;

// The lander as seen from the side, in feet, with the origin between the footpads at their bottoms.
// The LM is 31 ft across its footpads; its 67-inch probes hang from the aft and side legs. The forward
// leg carries the ladder and no probe. The LLTV is the jet-lifted trainer flown at Ellington.
export const VEHICLES = {
  lm: { id: 'lm', half: 15.5, pad: 1.55, probe: 67 / 12, probes: [-15.5, 0], bell: 2.5, bellClear: 1.5, body: [6.9, 4.7], cg: 9, height: 22.9 },
  lltv: { id: 'lltv', half: 7.5, pad: 1.1, probe: 0, probes: [], bell: 1.3, bellClear: 2.4, body: [5.2, 3.4], cg: 6.5, height: 12.5 },
};

const THETA_MAX = 20 * DEG; // full deflection of the hand controller in P66
const ATT_K = 2.4, ATT_W = 14 * DEG, ATT_A = 30 * DEG; // how briskly the jets bring it to the commanded tilt
const ROT_W = 32 * DEG, ROT_A = 70 * DEG; // arcade: raw rotation
const ROD_TAU = 1.5; // P66 closes on the commanded descent rate in about this many seconds
export const ROD_LIMITS = [-25, 8];

export function createFlight(site, ground, mode = 'p66') {
  const veh = VEHICLES[site.vehicle || 'lm'];
  const s = site.start;
  const gy = groundAt(ground, s.x);
  const f = {
    site, g: ground, mode, veh,
    t: 0,
    x: s.x, y: gy + s.alt + veh.cg, vx: s.vx, vy: s.vy,
    th: (s.tilt || 0) * DEG, w: 0,
    dry: site.mass, prop: (site.fuel / 100) * FULL_LOAD,
    thr: 0.3,
    rateCmd: Math.round(s.vy),
    phase: 'flying', // flying, settling, landed, tipping, crashed, abort
    lowAt: null, said: {},
    contactAt: null, touchAt: null, record: null,
    jets: 0, // recent attitude jet activity, for puffs and sound
    asc: null, // the ascent stage after an abort
    debris: null,
    end: null,
  };
  // Start with the throttle where it needs to be, so the first second doesn't lurch.
  f.thr = clamp(thrustFor(f, 0) / ENGINE.max, 0.1, 0.6);
  return f;
}

export const mass = f => f.dry + Math.max(0, f.prop);
export const pct = f => (Math.max(0, f.prop) / FULL_LOAD) * 100;
// Seconds of hovering left at the present weight.
export const hoverSeconds = f => Math.max(0, f.prop) / ((mass(f) * 1.62) / (ENGINE.isp * G0));
export const altitude = f => f.y - f.veh.cg - groundAt(f.g, f.x);

function thrustFor(f, aUp) {
  // Newtons needed to give an upward acceleration aUp (ft/s²) at the present tilt.
  return (mass(f) * ((G_MOON + aUp) * M_PER_FT)) / Math.max(0.35, Math.cos(f.th));
}

// Where a point on the lander (bx, by in its own frame) is in the world.
export function toWorld(f, bx, by, th = f.th, x = f.x, y = f.y) {
  const dy = by - f.veh.cg;
  return [x + bx * Math.cos(th) + dy * Math.sin(th), y - bx * Math.sin(th) + dy * Math.cos(th)];
}

// input: { pad: -1..1 (P66 tilt command), rod: whole clicks to apply, throttle: 0..1, rotate: -1..1 (arcade) }
export function step(f, input, dt) {
  const ev = [];
  if (f.phase === 'flying') fly(f, input, dt, ev);
  else afterwards(f, dt, ev);
  f.t += dt;
  return ev;
}

function fly(f, input, dt, ev) {
  const arcade = f.mode === 'arcade';

  // Attitude: in P66 the hand controller sets the tilt and the computer holds it; in arcade it turns the LM.
  const w0 = f.w;
  if (arcade) {
    const want = clamp(input.rotate || 0, -1, 1) * ROT_W;
    f.w += clamp(want - f.w, -ROT_A * dt, ROT_A * dt);
  } else {
    const cmd = clamp(input.pad || 0, -1, 1) * THETA_MAX;
    const want = clamp((cmd - f.th) * ATT_K, -ATT_W, ATT_W);
    f.w += clamp(want - f.w, -ATT_A * dt, ATT_A * dt);
  }
  f.th += f.w * dt;
  const lim = arcade ? 95 * DEG : 30 * DEG;
  if (Math.abs(f.th) > lim) { f.th = Math.sign(f.th) * lim; f.w = 0; }
  f.jets = Math.max(f.jets * Math.exp(-dt * 6), Math.min(1, Math.abs(f.w - w0) / (dt * ATT_A)));

  // The rate-of-descent switch: each click is a foot per second.
  if (input.rod) {
    const before = f.rateCmd;
    f.rateCmd = clamp(f.rateCmd + Math.round(input.rod), ROD_LIMITS[0], ROD_LIMITS[1]);
    if (f.rateCmd !== before) ev.push({ type: 'rod', rate: f.rateCmd });
  }

  // Throttle.
  let want;
  if (arcade) want = clamp(input.throttle || 0, 0, 1);
  else want = clamp(thrustFor(f, (f.rateCmd - f.vy) / ROD_TAU) / ENGINE.max, ENGINE.p66Min, ENGINE.p66Max);
  if (f.prop <= 0) want = 0;
  f.thr += (want - f.thr) * (1 - Math.exp(-dt / ENGINE.lag));
  if (f.prop <= 0) f.thr = 0;

  const F = f.thr * ENGINE.max;
  const a = (F / mass(f)) / M_PER_FT; // ft/s²
  f.vx += a * Math.sin(f.th) * dt;
  f.vy += (a * Math.cos(f.th) - G_MOON) * dt;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.prop -= (F / (ENGINE.isp * G0)) * dt;

  // The fuel calls.
  const p = pct(f);
  if (f.lowAt == null && p <= LOW_LEVEL) { f.lowAt = f.t; ev.push({ type: 'lowLevel' }); }
  if (f.lowAt != null) {
    const since = f.t - f.lowAt;
    if (since >= BINGO_AFTER_LOW - 60 && !f.said.c60) { f.said.c60 = true; ev.push({ type: 'call60' }); }
    if (since >= BINGO_AFTER_LOW - 30 && !f.said.c30) { f.said.c30 = true; ev.push({ type: 'call30' }); }
    if (since >= BINGO_AFTER_LOW && !f.said.bingo) { f.said.bingo = true; ev.push({ type: 'bingo' }); }
    // Twenty seconds after Bingo it's land or abort; low and nearly down, you keep going.
    if (since >= BINGO_AFTER_LOW + LAND_AFTER_BINGO && !f.said.limit) {
      f.said.limit = true;
      if (altitude(f) > 20) { abort(f, ev, 'limit'); return; }
    }
  }
  if (f.prop <= 0 && !f.said.dry) {
    f.said.dry = true;
    ev.push({ type: 'dry' });
    if (altitude(f) > 12) { abort(f, ev, 'dry'); return; }
  }

  // Contact: a probe touches the ground.
  const v = f.veh;
  // (The middle leg is the near side leg, out of the line you fly, so it meets bare ground.)
  const under = (wx, mid) => (mid ? groundAt(f.g, wx) : surfaceAt(f.g, wx));
  if (f.contactAt == null) {
    for (const px of v.probes) {
      const [wx, wy] = toWorld(f, px, -v.probe);
      if (wy <= under(wx, px === 0)) { f.contactAt = f.t; ev.push({ type: 'contact', alt: altitude(f) }); break; }
    }
  }

  // Touchdown: a footpad reaches the ground. The descent stage hitting first is a crash.
  for (const bx of [-v.half - v.pad, -v.half + v.pad, -v.pad, v.pad, v.half - v.pad, v.half + v.pad]) {
    const [wx, wy] = toWorld(f, bx, 0);
    if (wy <= under(wx, Math.abs(bx) <= v.pad)) { touchdown(f, ev); return; }
  }
  for (const [bx, by] of hull(v)) {
    const [wx, wy] = toWorld(f, bx, by);
    if (wy <= surfaceAt(f.g, wx)) { strike(f, ev); return; }
  }
  // Off the top of the world or far off the map: keep it sane.
  if (f.y > groundAt(f.g, f.x) + 4000) f.vy = Math.min(f.vy, 0);
}

// Points on the lander that mustn't hit anything before the footpads do: the descent stage and the
// legs. (The engine bell is built to crumple, so a rock under it only counts against you at touchdown.)
function hull(v) {
  const [bw, bh] = v.body;
  return [
    [-bw, bh], [0, bh], [bw, bh], [-bw, bh + 4], [bw, bh + 4],
    [-v.half * 0.7, bh * 0.45], [v.half * 0.7, bh * 0.45],
  ];
}

function touchdown(f, ev) {
  const spot = spotAt(f.g, f.x, f.veh);
  const p = pct(f);
  f.touchAt = f.t;
  f.record = {
    down: Math.max(0, -f.vy),
    side: Math.abs(f.vx),
    fwd: f.vx,
    mode: f.mode,
    tilt: Math.abs(f.th / DEG),
    slope: Math.abs(spot.slope),
    rest: Math.abs(spot.rest),
    rock: spot.rock,
    bellHit: spot.bellHit,
    bodyHit: spot.bodyHit,
    x: f.x,
    dist: Math.abs(f.x - f.site.target.x),
    fuelPct: p,
    fuelSec: hoverSeconds(f),
    clock: fuelClock(f),
    time: f.t,
    contact: f.contactAt != null,
  };
  // A footpad line rising to the right means the top leans left, which is a negative tilt here.
  f.restTh = -spot.rest * DEG;
  f.padY = spot.padY;
  f.vxAtTouch = f.vx;
  f.phase = 'settling';
  f.thr = 0;
  f.end = { t: 0, from: { y: f.y, th: f.th } };
  ev.push({ type: 'touchdown', record: f.record });
}

function strike(f, ev) {
  f.touchAt = f.t;
  f.record = {
    down: Math.max(0, -f.vy), side: Math.abs(f.vx), fwd: f.vx, mode: f.mode, tilt: Math.abs(f.th / DEG),
    slope: Math.abs(spotAt(f.g, f.x, f.veh).slope), rest: 90, rock: 0, bellHit: true, bodyHit: true,
    x: f.x, dist: Math.abs(f.x - f.site.target.x), fuelPct: pct(f), fuelSec: hoverSeconds(f),
    clock: fuelClock(f), time: f.t, contact: f.contactAt != null, struck: true,
  };
  f.thr = 0;
  ev.push({ type: 'touchdown', record: f.record });
  crash(f);
}

// Where the fuel stood when it landed, in Houston's terms.
export function fuelClock(f) {
  if (f.lowAt == null) return 'plenty';
  const since = f.t - f.lowAt;
  if (since < BINGO_AFTER_LOW - 60) return 'low';
  if (since < BINGO_AFTER_LOW - 30) return 'after60';
  if (since < BINGO_AFTER_LOW) return 'after30';
  return 'afterBingo';
}

// ---------- what happens after the footpads touch (or it all goes wrong) ----------

// The game decides how it went (judge.js) and tells the flight which ending to show. why says what
// tipped it over: 'side' (still moving), 'tilt' (leaning), 'slope' or 'rock'.
export function finish(f, outcome, why) {
  if (outcome === 'landed') return; // settling carries on into landed
  if (outcome === 'tipped') {
    f.phase = 'tipping';
    // Over the way it was moving or leaning if that's what did it, otherwise toward the low side.
    const lean = f.restTh || 0, moving = Math.sign(f.vxAtTouch || f.th || 1);
    f.tipDir = why === 'side' ? moving
      : why === 'tilt' ? Math.sign(f.th || moving)
      : Math.abs(lean) > 0.5 * DEG ? Math.sign(lean) : moving;
    f.end = { t: 0, from: { y: f.y, th: f.th, x: f.x } };
  } else crash(f);
}

function crash(f) {
  f.phase = 'crashed';
  f.thr = 0;
  f.end = { t: 0, from: { y: f.y, th: f.th, x: f.x } };
  f.crashTh = f.th + (f.vx >= 0 ? 1 : -1) * (0.16 + Math.min(0.35, Math.abs(f.vx) / 40));
}

function abort(f, ev, why) {
  f.phase = 'abort';
  f.abortWhy = why;
  f.thr = 0;
  // Abort stage: the ascent stage fires and leaves; the empty descent stage falls.
  f.asc = { x: f.x, y: f.y + 6, vx: f.vx, vy: f.vy, th: f.th, t: 0 };
  f.end = { t: 0 };
  f.record = {
    abort: why, down: 0, side: Math.abs(f.vx), fwd: f.vx, mode: f.mode, tilt: Math.abs(f.th / DEG), slope: 0, rest: 0, rock: 0,
    x: f.x, dist: Math.abs(f.x - f.site.target.x), fuelPct: pct(f), fuelSec: hoverSeconds(f), clock: fuelClock(f),
    time: f.t, alt: altitude(f), contact: false,
  };
  ev.push({ type: 'abort', why, record: f.record });
}

function afterwards(f, dt, ev) {
  const e = f.end;
  if (!e) return;
  e.t += dt;
  if (f.phase === 'settling' || f.phase === 'landed') {
    // The gear strokes a little and the LM comes to rest on its footpads.
    const k = Math.min(1, e.t / 0.6), s = 1 - Math.pow(1 - k, 3);
    f.th = e.from.th + (f.restTh - e.from.th) * s;
    const restY = (f.padY ? f.padY[1] : groundAt(f.g, f.x)) + f.veh.cg * Math.cos(f.th) - 0.25 * s;
    f.y = e.from.y + (restY - e.from.y) * s;
    f.vx = 0; f.vy = 0; f.w = 0;
    if (k >= 1 && f.phase === 'settling') { f.phase = 'landed'; ev.push({ type: 'settled' }); }
  } else if (f.phase === 'tipping') {
    // It goes over onto its side, slowly at first, as a top-heavy thing does in low gravity.
    const k = Math.min(1, e.t / 2.4), s = k * k * (3 - 2 * k);
    const target = f.tipDir * 95 * DEG;
    f.th = e.from.th + (target - e.from.th) * s;
    f.x = e.from.x + f.tipDir * 9 * s;
    f.y = groundAt(f.g, f.x) + f.veh.cg * (0.95 - 0.55 * s) + 2;
    if (k >= 1 && !f.said.over) { f.said.over = true; ev.push({ type: 'over' }); }
  } else if (f.phase === 'crashed') {
    // The legs fold and it slumps over onto what's left of them.
    const k = Math.min(1, e.t / 0.5), s = 1 - Math.pow(1 - k, 2);
    f.th = e.from.th + (f.crashTh - e.from.th) * s;
    f.y = e.from.y + (groundAt(f.g, f.x) + f.veh.cg * 0.78 - e.from.y) * s;
    if (k >= 1 && !f.said.over) { f.said.over = true; ev.push({ type: 'over' }); }
  } else if (f.phase === 'abort') {
    // The descent stage falls; the ascent stage climbs away on its own engine (3,500 lbf).
    if (!f.said.dsDown) {
      f.vy -= G_MOON * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.y - f.veh.cg <= groundAt(f.g, f.x) + 1) {
        f.said.dsDown = true;
        f.y = groundAt(f.g, f.x) + f.veh.cg * 0.6;
        f.th += 0.25 * Math.sign(f.vx || 1);
        ev.push({ type: 'dsDown' });
      }
    }
    const a = f.asc;
    a.t += dt;
    a.th += (0 - a.th) * Math.min(1, dt * 1.5);
    const acc = (16000 / 4700) / M_PER_FT;
    a.vy += (acc * Math.cos(a.th) - G_MOON) * dt;
    a.vx *= Math.exp(-dt * 0.1);
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    if (a.t > 6 && !f.said.over) { f.said.over = true; ev.push({ type: 'over' }); }
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
