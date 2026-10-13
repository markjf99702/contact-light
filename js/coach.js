// The training flight at Ellington teaches the controls one at a time. Each step says what to do and
// which control it's about, and moves on when you've done it.

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

export function createCoach() { return { step: 0, shownAt: 0 }; }

// Returns the step to show now.
export function coachUpdate(c, f, site, alt) {
  while (c.step < STEPS.length - 1 && STEPS[c.step].done(f, site, alt)) { c.step++; c.shownAt = f.t; }
  return STEPS[c.step];
}
