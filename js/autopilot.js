// A steady pilot that flies through the same controls you do: rate clicks and the hand controller
// in P66, or the throttle and rotation in Arcade. The tests use it to prove every site can be landed
// with fuel to spare, the title screen flies it in the background, and Free flight uses it to check
// that new ground can be landed on before handing it over.

import { spotAt, surfaceAt, groundAt } from './terrain.js';
import { G_MOON, ENGINE, mass, toWorld } from './sim.js';

const DEG = Math.PI / 180;
const TILT = 20 * DEG; // full deflection of the hand controller

// Is x a good place to come down? Gold-quality ground with room to drift a few feet either way.
export function goodAt(g, x, veh, strict = true) {
  const s = spotAt(g, x, veh);
  if (s.bellHit || s.bodyHit) return false;
  return strict ? Math.abs(s.rest) <= 2.6 && s.rock < 0.4 : Math.abs(s.rest) <= 5.5 && s.rock < 1.4;
}

// The best spot: good ground with at least `margin` feet of good ground each side, as near the target
// as it can be, without asking for a turn back that the fuel won't stand.
export function chooseSpot(site, g, veh, from = site.start, margin = 5) {
  const step = 2;
  const [x0, x1] = g.site || [g.x0, g.x1]; // the site itself, not the country beyond it
  const lo = x0 + veh.half + 20, hi = x1 - veh.half - 20;
  const brake = G_MOON * Math.tan(15 * DEG);
  const stop = from.x + (Math.sign(from.vx || 0) * from.vx * from.vx) / (2 * brake);
  let best = null;
  for (const strict of [true, false]) {
    let run = [];
    const flush = () => {
      if (run.length && (run[run.length - 1] - run[0]) >= 2 * margin) {
        const mid = (run[0] + run[run.length - 1]) / 2;
        // Clamp the choice to the run, as near the target as the margins allow.
        const x = Math.max(run[0] + margin, Math.min(run[run.length - 1] - margin, site.target.x));
        const pick = Math.abs(mid - site.target.x) < Math.abs(x - site.target.x) ? mid : x;
        const behind = Math.sign(from.vx || 1) * (stop - pick); // > 0 means it needs a turn back
        const cost = Math.abs(pick - site.target.x) + Math.max(0, behind) * 1.4;
        if (!best || cost < best.cost) best = { x: pick, cost, strict };
      }
      run = [];
    };
    for (let x = lo; x <= hi; x += step) {
      if (goodAt(g, x, veh, strict)) run.push(x);
      else flush();
    }
    flush();
    if (best) break;
  }
  return best ? best.x : site.target.x;
}

export function createAutopilot(site, g, veh, mode = 'p66') {
  return { site, g, veh, mode, spot: chooseSpot(site, g, veh), lastClick: -1, clicks: 0 };
}

// Returns the input for this step: { pad, rod } in P66, { throttle, rotate } in Arcade.
export function autopilotInput(ap, f) {
  const { g, veh } = ap;
  if (f.phase !== 'flying') return { pad: 0, rod: 0, throttle: 0, rotate: 0 };
  const dx = ap.spot - f.x;
  const alt = f.y - veh.cg - groundAt(g, f.x);

  // Along the ground: the fastest speed that can still stop in the distance left.
  const brake = G_MOON * Math.tan(TILT) * 0.72;
  const vWant = Math.sign(dx) * Math.min(62, Math.sqrt(2 * brake * Math.max(0, Math.abs(dx) - 1.5)));
  const aWant = (vWant - f.vx) / 1.8;

  // Up and down: keep clear of what's ahead, and glide down toward the spot as it gets close.
  const dir = Math.sign(f.vx || dx || 1);
  const look = Math.max(120, Math.abs(f.vx) * 9);
  let clearTop = -Infinity;
  for (let s = -30; s <= look; s += 6) clearTop = Math.max(clearTop, surfaceAt(g, f.x + dir * s));
  const padsY = f.y - veh.cg;
  const over = Math.abs(dx) < 7 && Math.abs(f.vx) < 0.9;
  let vyWant;
  if (over) {
    vyWant = alt > 45 ? -5 : alt > 18 ? -3 : -1.6;
  } else {
    const spotY = groundAt(g, ap.spot);
    const glide = spotY + 36 + Math.abs(dx) * 0.11;
    const want = Math.max(clearTop + 30, glide);
    vyWant = Math.max(-(3 + alt * 0.045), Math.min(5, (want - padsY) / 4));
    if (alt < 28 && Math.abs(dx) > 10) vyWant = Math.max(vyWant, 0.5);
  }

  if (ap.mode === 'arcade') {
    // Point the thrust where the acceleration is wanted and set the throttle to match.
    // The engine can only push, so the upward part of the thrust is never less than nothing.
    const up = Math.max(0, G_MOON + (vyWant - f.vy) / 1.2);
    const lim = 24 * DEG;
    const th = Math.max(-lim, Math.min(lim, Math.atan2(aWant, Math.max(up, 1))));
    const rotate = Math.max(-1, Math.min(1, ((th - f.th) * 3.2 - f.w) / (32 * DEG)));
    // Throttle for the upward part at the tilt it actually has now.
    const aT = up / Math.max(0.4, Math.cos(f.th));
    const throttle = Math.max(0, Math.min(1, (mass(f) * aT * 0.3048) / ENGINE.max));
    return { throttle, rotate };
  }

  const pad = Math.max(-1, Math.min(1, Math.atan(aWant / G_MOON) / TILT));
  // Rate clicks, one at a time, a few a second at most.
  let rod = 0;
  const target = Math.round(vyWant);
  if (f.t - ap.lastClick > 0.18 && target !== f.rateCmd) {
    rod = Math.sign(target - f.rateCmd);
    ap.lastClick = f.t;
    ap.clicks++;
  }
  return { pad, rod };
}

// Is there daylight under the lander? (Used by the renderer for the shadow and the tests.)
export function padsWorld(f) {
  return [toWorld(f, -f.veh.half, 0), toWorld(f, f.veh.half, 0)];
}
