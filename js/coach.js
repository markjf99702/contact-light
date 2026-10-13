// The training flight at Ellington teaches the controls one at a time. Each step says what to do and
// which control it's about, and moves on when you've done it. P66 and Arcade fly differently, so each
// has its own lesson.

import { mass, ENGINE } from './sim.js';

export const STEPS = [
  {
    at: 'rod',
    text: 'This is P66: the computer holds whatever descent rate you set. Tap ▼ three times to come down at 3 feet a second.',
    done: (f) => f.rateCmd <= -3,
  },
  {
    at: 'aca',
    text: '▲ slows the descent and ▼ speeds it up, a foot per second a click. Now drag the hand controller right to fly toward the pad.',
    done: (f) => f.vx > 6,
  },
  {
    at: 'aca',
    text: 'Let go and it stands up straight and keeps drifting. Drag it left to slow down, and stop over the pad.',
    done: (f, s) => Math.abs(f.x - s.target.x) < 25 && Math.abs(f.vx) < 1.5,
  },
  {
    at: 'rod',
    text: 'Hold it there and come down at 2 or 3 feet a second. Low down, the marks under you show where the footpads will land.',
    done: (f, s, alt) => alt < 32,
  },
  {
    at: 'none',
    text: 'On the Moon a blue light comes on when the probes under the footpads touch, 5½ feet down. That’s contact light. Hold steady.',
    done: () => false,
  },
];

// The throttle that just holds the LM up at its present weight and lean.
const hoverThrottle = f => (mass(f) * 1.62) / ENGINE.max / Math.max(0.35, Math.cos(f.th));

export const ARCADE_STEPS = [
  {
    at: 'lever',
    text: 'Arcade has no computer holding you up. This lever is the throttle, and about a third of it hovers. Drag it down a little to start coming down.',
    done: (f) => f.vy < -2,
  },
  {
    at: 'lever',
    text: 'Nothing slows the fall but you. Push the throttle back up to about a third, where it hovers, to hold 2 to 5 feet a second down.',
    done: (f) => f.vy < -1.2 && f.vy > -7 && Math.abs(f.thr - hoverThrottle(f)) < 0.035,
  },
  {
    at: 'aca',
    text: 'Now drag the controller right: the LM keeps turning while you hold it. Lean it a little forward to fly toward the pad.',
    done: (f) => f.vx > 6,
  },
  {
    at: 'aca',
    text: 'It stays leaning when you let go. Drag left to turn it back past upright, slow down, and stop over the pad.',
    done: (f, s) => Math.abs(f.x - s.target.x) < 25 && Math.abs(f.vx) < 1.5,
  },
  {
    at: 'lever',
    text: 'Stand it upright and come down at 2 or 3 feet a second. Leaning takes lift away, so give it a little more throttle while you lean.',
    done: (f, s, alt) => alt < 32,
  },
  {
    at: 'none',
    text: 'Keep it upright and slow: 3 feet a second or less as the footpads touch.',
    done: () => false,
  },
];

export function createCoach(mode = 'p66') { return { step: 0, shownAt: 0, steps: mode === 'arcade' ? ARCADE_STEPS : STEPS }; }

// Returns the step to show now.
export function coachUpdate(c, f, site, alt) {
  const steps = c.steps || STEPS;
  while (c.step < steps.length - 1 && steps[c.step].done(f, site, alt)) { c.step++; c.shownAt = f.t; }
  return steps[c.step];
}
