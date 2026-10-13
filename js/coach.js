// The training flight at Ellington teaches the controls one at a time. Each step says what to do and
// which control it's about, and moves on when you've done it. P66 and Arcade fly differently, so each
// has its own lesson. Both hold your height while you fly to the pad, and only come down once you've
// stopped over it, so doing exactly what the hints say lands you on the pad.

import { mass, ENGINE } from './sim.js';

const DEG = Math.PI / 180;

// Over the pad, stopped and upright, near enough to come straight down onto it.
const overPad = (f, s) => Math.abs(f.x - s.target.x) < 20 && Math.abs(f.vx) < 0.4 && Math.abs(f.th) < 4 * DEG;

// What to do about drifting while you should be stopped: still moving along the ground, heading back
// to the pad after flying past it, or stopped short of it or past it. 'stop' is the step that stops
// you over the pad; 'still' is any step after it.
const WORDS = {
  p66: {
    fwd: 'Still drifting forward. Nudge the controller left, toward BACK, until FWD reads 0.',
    back: 'Drifting back. Nudge the controller right, toward FWD, until BACK reads 0.',
    backTo: 'Drifting back toward the pad. As it comes under you, drag right, toward FWD, until BACK reads 0.',
    short: 'Stopped short of the pad. Nudge the controller right to drift onto it, then stop again.',
    past: 'Past the pad. Nudge the controller left to drift back onto it, then stop again.',
  },
  arcade: {
    fwd: 'Still drifting forward. Lean back a touch until FWD reads 0, then stand it up.',
    back: 'Drifting back. Lean forward a touch until BACK reads 0, then stand it up.',
    backTo: 'Drifting back toward the pad. As it comes under you, lean forward until BACK reads 0, then stand it up.',
    short: 'Stopped short of the pad. Lean forward a touch to drift onto it, then stop again.',
    past: 'Past the pad. Lean back a touch to drift back onto it, then stop again.',
  },
};
function drift(kind, mode, f, s) {
  const w = WORDS[mode] || WORDS.p66, dx = s.target.x - f.x, v = f.vx;
  const say = text => ({ at: 'aca', text });
  if (kind === 'still') return Math.abs(v) > 0.6 ? say(v > 0 ? w.fwd : w.back) : null;
  const away = Math.abs(dx) >= 20;
  if (away && Math.abs(v) < 1) return say(dx > 0 ? w.short : w.past);
  if (Math.abs(v) <= 0.4) return null;
  // Drifting over the pad, or heading away from it: stop. Heading back to it: the way back.
  if ((!away && Math.abs(v) < 2.5) || v * dx < 0) return say(v > 0 ? w.fwd : w.back);
  return v < 0 ? say(w.backTo) : null;
}

export const STEPS = [
  {
    at: 'rod',
    text: 'This is P66: the computer holds whatever descent rate you set. Tap ▼ three times to come down at 3 feet a second.',
    done: (f) => f.rateCmd <= -3,
  },
  {
    at: 'rod',
    text: '▲ slows the descent, a foot per second a click. Tap it three times to stop and hold your height.',
    done: (f) => f.rateCmd >= 0,
  },
  {
    at: 'aca',
    text: 'Now drag the hand controller right, toward FWD. The LLTV leans over and flies toward the pad.',
    done: (f) => f.vx > 6,
  },
  {
    at: 'aca',
    text: 'Let go and it stands up straight and keeps drifting. As the pad comes under you, drag left, toward BACK, until FWD reads 0.',
    done: overPad,
    nudge: 'stop',
  },
  {
    at: 'rod',
    text: 'Over the pad. Tap ▼ three times to come down at 3 feet a second. Low down, the marks under you show where the footpads will land.',
    done: (f, s, alt) => alt < 32,
    nudge: 'still',
  },
  {
    at: 'none',
    text: 'On the Moon a blue light comes on when the probes under the footpads touch, 5½ feet down. That’s contact light. Hold steady.',
    done: () => false,
    nudge: 'still',
  },
];

// The throttle that just holds the LM up at its present weight and lean.
export const hoverThrottle = f => (mass(f) * 1.62) / ENGINE.max / Math.max(0.35, Math.cos(f.th));

export const ARCADE_STEPS = [
  {
    at: 'lever',
    text: 'Arcade has no computer holding you up. This lever is the throttle, and about a third of it hovers. Drag it down a little to start coming down.',
    done: (f) => f.vy < -2,
  },
  {
    at: 'lever',
    text: 'Nothing slows the fall but you. Push the throttle up past a third until DOWN reads 0, then back to a third to hover.',
    done: (f) => Math.abs(f.vy) < 1 && Math.abs(f.thr - hoverThrottle(f)) < 0.03,
  },
  {
    at: 'aca',
    text: 'Drag the controller right to lean a little toward the pad: it keeps turning while you hold it. Leaning takes lift away, so add a touch of throttle.',
    done: (f) => f.vx > 6,
  },
  {
    at: 'aca',
    text: 'It stays leaning when you let go, and keeps speeding up. Drag left until the controller reads UPRIGHT again, and it coasts.',
    done: (f) => Math.abs(f.th) < 0.6 * DEG && Math.abs(f.w) < 2 * DEG,
  },
  {
    at: 'aca',
    text: 'As the pad comes under you, drag left to lean back until FWD reads 0, then right to stand it up.',
    done: overPad,
    nudge: 'stop',
  },
  {
    at: 'lever',
    text: 'Stand it upright, then ease the throttle down a touch to come down at 2 or 3 feet a second.',
    done: (f, s, alt) => alt < 32,
    nudge: 'still',
  },
  {
    at: 'none',
    text: 'Keep it upright and slow: 3 feet a second or less as the footpads touch.',
    done: () => false,
    nudge: 'still',
  },
];

export function createCoach(mode = 'p66') { return { mode, step: 0, shownAt: 0, steps: mode === 'arcade' ? ARCADE_STEPS : STEPS }; }

// Returns what to show now: { at, text }. Trouble near the ground comes first, whatever the lesson
// was on, so a hint never asks for something else while the LM is about to touch down badly. A hint
// stays up for a couple of seconds at least, unless the lesson moves on or there's trouble, so it
// doesn't flicker while you're doing what it says.
export function coachUpdate(c, f, site, alt) {
  const steps = c.steps || STEPS;
  let moved = false;
  while (c.step < steps.length - 1 && steps[c.step].done(f, site, alt)) { c.step++; c.shownAt = f.t; moved = true; }
  const st = steps[c.step];
  const bad = trouble(c, f, alt);
  const want = bad || (st.nudge && drift(st.nudge, c.mode, f, site)) || st;
  if (c.shown && want.text !== c.shown.text && !moved && !bad && f.t - c.since < 2) return c.shown;
  if (!c.shown || want.text !== c.shown.text) { c.shown = want; c.since = f.t; }
  return want;
}

function trouble(c, f, alt) {
  if (alt > 40 || alt < 0.5) return null;
  const arcade = c.mode === 'arcade';
  if (Math.abs(f.vx) > 2) {
    const fwd = f.vx > 0;
    if (arcade) return { at: 'aca', text: `Nearly down and still moving ${fwd ? 'forward' : 'back'}: lean ${fwd ? 'back' : 'forward'} until ${fwd ? 'FWD' : 'BACK'} reads 0, then stand it up.` };
    return { at: 'aca', text: fwd ? 'Nearly down and still moving forward: drag left, toward BACK, until FWD reads 0.' : 'Nearly down and moving back: drag right, toward FWD, until BACK reads 0.' };
  }
  if (f.vy < -4.5) {
    return arcade
      ? { at: 'lever', text: 'Coming down too fast: push the throttle up to slow to 2 or 3 feet a second.' }
      : { at: 'rod', text: 'Coming down too fast: tap ▲ to slow to 2 or 3 feet a second.' };
  }
  return null;
}
