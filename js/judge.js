// Judging a touchdown. Each number gets gold, silver or bronze, and the plaque is the worst of them,
// so the table always says exactly what to fly better. Limits past bronze are the LM's own (Apollo
// Experience Report TN D-6722): the landing gear's design envelope ran from 10 ft/s down with no
// sideways speed to 7 ft/s down at 4 ft/s sideways, and it was certified for slopes up to 12°.

export const TIERS = ['gold', 'silver', 'bronze'];

export const LIMITS = {
  down: [3, 5, 10], // ft/s at the footpads
  side: [1, 2, 4], // ft/s along the ground, forward or back
  tilt: [3, 6, 12], // degrees the LM leaned as it touched
  slope: [3, 6, 12], // degrees it comes to rest at
  rock: [0.5, 1.5, 3], // feet of rock under a footpad
};

const FUEL = { plenty: 0, low: 0, after60: 0, after30: 1, afterBingo: 2 };
const FUEL_NOTE = {
  plenty: 'before the low-level light',
  low: 'before the 60-second call',
  after60: 'before the 30-second call',
  after30: 'after the 30-second call',
  afterBingo: 'after Bingo',
};

export const rankBy = (v, lim) => (v <= lim[0] ? 0 : v <= lim[1] ? 1 : v <= lim[2] ? 2 : 3);

// The most the legs take coming straight down, less the faster you're moving sideways.
export const downLimit = side => LIMITS.down[2] - 0.75 * Math.min(LIMITS.side[2], Math.max(0, side));

// A number the way the card shows it: tenths below 10, whole numbers above. Everything is judged on
// the number as shown, so a slope the card calls 3.0° is gold and one it calls 3.1° isn't.
export const one = v => (v < 9.95 ? v.toFixed(1) : String(Math.round(v)));
export const shown = v => +one(Math.max(0, v));
export const feet = v => `${Math.round(v).toLocaleString('en-US')} ft`;

// How good a spot is to land on, by the same limits: 0 gold, 1 silver, 2 bronze, 3 no. The marks
// under the LM use it, so their colour agrees with the plaque you'd get for the ground.
export function groundRank(spot) {
  if (spot.bodyHit) return 3;
  const r = Math.max(rankBy(shown(Math.abs(spot.rest)), LIMITS.slope), rankBy(shown(spot.rock), LIMITS.rock));
  return spot.bellHit ? Math.max(r, 2) : r;
}

const targetWord = site => (site.target.label === 'SURVEYOR 3' ? 'Surveyor' : site.target.label === 'PAD' ? 'pad' : 'target');

export function judge(rec, site) {
  const arcade = rec.mode === 'arcade';
  if (rec.abort) {
    return {
      ok: false, outcome: 'abort', tier: null, rows: [],
      title: 'Abort',
      reason: rec.abort === 'dry'
        ? `The descent tanks ran dry ${feet(Math.max(0, rec.alt))} up. Abort stage: the ascent stage fired and left the descent stage behind.`
        : `Twenty seconds after Bingo and still ${feet(Math.max(0, rec.alt))} up, so it was abort. The ascent stage fired and left the descent stage behind.`,
      tip: 'Head for a clear spot early and come down at 4 or 5 ft/s until the last 50 feet; hovering high burns the fuel.',
    };
  }
  const tgt = site.target.tiers;
  const down = shown(rec.down), side = shown(rec.side), tilt = shown(rec.tilt), rest = shown(rec.rest), rock = shown(rec.rock);
  const dist = Math.round(rec.dist);
  const along = rec.fwd < 0 ? 'back' : 'forward';
  const legs = shown(downLimit(side));
  const rows = [
    { key: 'down', label: 'Down', value: `${one(down)} ft/s`, rank: rankBy(down, [LIMITS.down[0], LIMITS.down[1], legs]), need: `touch down at ${LIMITS.down[0]} ft/s or softer` },
    { key: 'side', label: along === 'back' ? 'Back' : 'Forward', value: `${one(side)} ft/s`, rank: rankBy(side, LIMITS.side), need: `stop moving along the ground before the footpads touch: ${LIMITS.side[0]} ft/s or less` },
    { key: 'tilt', label: 'Tilt', value: `${one(tilt)}°`, rank: rankBy(tilt, LIMITS.tilt), need: `come down upright, within ${LIMITS.tilt[0]}°` },
    { key: 'slope', label: 'Ground', value: `${one(rest)}° slope`, rank: rankBy(rest, LIMITS.slope), need: `find level ground, within ${LIMITS.slope[0]}°` },
    rockRow(rock, rec.bellHit),
    { key: 'dist', label: 'Target', value: `${feet(dist)} away`, rank: dist <= tgt[0] ? 0 : dist <= tgt[1] ? 1 : 2, need: `land within ${feet(tgt[0])} of the ${targetWord(site)}` },
    { key: 'fuel', label: 'Fuel', value: `${rec.fuelPct.toFixed(1)}%`, note: FUEL_NOTE[rec.clock] || '', rank: FUEL[rec.clock] ?? 0, need: 'be down before Houston’s 30-second call' },
  ].filter(r => !rec.struck || (r.key !== 'slope' && r.key !== 'rock')); // it never stood on its footpads

  // What went wrong, if anything did. The worst problem names it, and why says which way it tips over.
  let outcome = 'landed', title = '', reason = '', tip = '', why = null;
  const slowDown = arcade
    ? 'Push the throttle up as you get low: 3 or 4 ft/s down by 50 feet, 2 or less for the last few.'
    : 'Click the rate up as you get low: 3 or 4 ft/s down by 50 feet, 2 or less for the last few.';
  const stop = `stop moving along the ground before you come down: ${stopAlong(arcade, along === 'back')}`;
  if (rec.struck) {
    outcome = 'crash'; title = 'Crashed';
    reason = 'The descent stage hit the ground before the footpads did.';
    tip = 'Keep well above the crater walls and boulders until you are over your spot, then come straight down.';
  } else if (down > legs) {
    outcome = 'crash'; title = 'Hard landing';
    if (side < 0.5) reason = `${one(down)} ft/s down. The legs were built for 10.`;
    else if (side > LIMITS.side[2]) reason = `${one(down)} ft/s down while moving ${one(side)} ft/s ${along}. The legs were built for 10 coming straight down, and no more than ${LIMITS.side[2]} ft/s along the ground.`;
    else reason = `${one(down)} ft/s down while moving ${one(side)} ft/s ${along}. The legs were built for ${one(legs)} like that, and 10 coming straight down.`;
    tip = side > LIMITS.side[2] ? `${slowDown} And ${stop}.` : slowDown;
  } else if (rec.bodyHit) {
    outcome = 'crash'; title = 'Down on a boulder';
    reason = 'A boulder under the descent stage stove it in.';
    tip = 'Watch the footprint marks under the LM: they turn red over rocks.';
  } else if (rock > LIMITS.rock[2]) {
    outcome = 'tipped'; title = 'Tipped over'; why = 'rock';
    reason = `A footpad came down on a ${one(rock)}-foot rock and the LM went over.`;
    tip = 'Pick a spot with nothing under the footprint marks, and drift onto it slowly.';
  } else if (side > LIMITS.side[2]) {
    outcome = 'tipped'; title = 'Tipped over'; why = 'side';
    reason = `Still moving ${one(side)} ft/s ${along} when the footpads caught. The legs take ${LIMITS.side[2]}.`;
    tip = `Stop over the spot first: ${stopAlong(arcade, along === 'back')}, then come down.`;
  } else if (tilt > LIMITS.tilt[2]) {
    outcome = 'tipped'; title = 'Tipped over'; why = 'tilt';
    reason = `Leaning ${one(tilt)}° as it touched; one leg took it all and it went over.`;
    tip = arcade
      ? 'In Arcade the LM stays leaning when you let go: turn it upright before the last few feet.'
      : 'Let go of the hand controller for the last few feet and the LM stands upright.';
  } else if (rest > LIMITS.slope[2]) {
    outcome = 'tipped'; title = 'Tipped over'; why = 'slope';
    reason = `A ${one(rest)}° slope. The LM can stand on 12° and no more.`;
    tip = 'Crater walls and rims are steep. Look for flat ground between them.';
  }

  const ok = outcome === 'landed';
  const worst = Math.max(...rows.map(r => Math.min(2, r.rank)));
  for (const r of rows) r.tier = r.rank <= 2 ? TIERS[r.rank] : 'fail';
  return { ok, outcome, why, title: ok ? TIERS[worst] : title, tier: ok ? TIERS[worst] : null, rows, reason, tip };
}

// How to stop moving along the ground, in the controls of the mode you flew.
function stopAlong(arcade, back) {
  if (arcade) return back ? 'lean forward until BACK reads 0 and stand it up' : 'lean back until FWD reads 0 and stand it up';
  return back ? 'drag the hand controller right, toward FWD, until BACK reads 0' : 'drag the hand controller left, toward BACK, until FWD reads 0';
}

function rockRow(rock, bellHit) {
  let rank = rankBy(rock, LIMITS.rock), value = rank === 0 ? 'Clear' : `${one(rock)} ft rock under a pad`;
  if (bellHit) { value = rank === 0 ? 'Engine bell touched' : `${value}, bell touched`; rank = Math.max(rank, 2); }
  return { key: 'rock', label: 'Rocks', value, rank, need: `keep the footpads clear of rocks: ${LIMITS.rock[0]} ft or less` };
}

const ORDER = { gold: 0, silver: 1, bronze: 2 };
// Is plaque a better than plaque b?
export const better = (a, b) => (a ? ORDER[a] : 9) < (b ? ORDER[b] : 9);
