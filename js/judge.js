// Judging a touchdown. Each number gets gold, silver or bronze, and the plaque is the worst of them,
// so the table always says exactly what to fly better. Limits past bronze are the LM's own (Apollo
// Experience Report TN D-6722): the landing gear's design envelope ran from 10 ft/s down with no
// sideways speed to 7 ft/s down at 4 ft/s sideways, and it was certified for slopes up to 12°.

export const TIERS = ['gold', 'silver', 'bronze'];

export const LIMITS = {
  down: [3, 5, 10], // ft/s at the footpads
  side: [1, 2, 4], // ft/s along the ground
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

const rankBy = (v, lim) => (v <= lim[0] ? 0 : v <= lim[1] ? 1 : v <= lim[2] ? 2 : 3);

// The most the legs take coming straight down, less the faster you're moving sideways.
export const downLimit = side => LIMITS.down[2] - 0.75 * Math.min(LIMITS.side[2], Math.max(0, side));

export const one = v => (v < 9.95 ? v.toFixed(1) : String(Math.round(v)));
export const feet = v => `${Math.round(v).toLocaleString('en-US')} ft`;

export function judge(rec, site) {
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
  const rows = [
    { key: 'down', label: 'Down', value: `${one(rec.down)} ft/s`, rank: rankBy(rec.down, [LIMITS.down[0], LIMITS.down[1], downLimit(rec.side)]), need: `${LIMITS.down[0]} ft/s or softer` },
    { key: 'side', label: 'Sideways', value: `${one(rec.side)} ft/s`, rank: rankBy(rec.side, LIMITS.side), need: `${LIMITS.side[0]} ft/s or less` },
    { key: 'tilt', label: 'Tilt', value: `${Math.round(rec.tilt)}°`, rank: rankBy(rec.tilt, LIMITS.tilt), need: `upright, within ${LIMITS.tilt[0]}°` },
    { key: 'slope', label: 'Ground', value: `${Math.round(rec.rest)}° slope`, rank: rankBy(rec.rest, LIMITS.slope), need: `level, within ${LIMITS.slope[0]}°` },
    rockRow(rec),
    { key: 'dist', label: 'Target', value: `${feet(rec.dist)} away`, rank: rec.dist <= tgt[0] ? 0 : rec.dist <= tgt[1] ? 1 : 2, need: `within ${feet(tgt[0])}` },
    { key: 'fuel', label: 'Fuel', value: `${rec.fuelPct.toFixed(1)}%`, note: FUEL_NOTE[rec.clock] || '', rank: FUEL[rec.clock] ?? 0, need: 'down before the 30-second call' },
  ];

  // What went wrong, if anything did. The worst problem names it.
  let outcome = 'landed', title = '', reason = '', tip = '';
  if (rec.struck) {
    outcome = 'crash'; title = 'Crashed';
    reason = 'The descent stage hit the ground before the footpads did.';
    tip = 'Keep well above the crater walls and boulders until you are over your spot, then come straight down.';
  } else if (rec.down > downLimit(rec.side)) {
    outcome = 'crash'; title = 'Hard landing';
    reason = rec.side < 0.5
      ? `${one(rec.down)} ft/s down. The legs were built for 10.`
      : `${one(rec.down)} ft/s down while moving ${one(rec.side)} ft/s sideways. The legs were built for ${one(downLimit(rec.side))} like that, and 10 coming straight down.`;
    tip = 'Click the rate up as you get low: 3 or 4 ft/s down by 50 feet, 2 or less for the last few.';
  } else if (rec.bodyHit) {
    outcome = 'crash'; title = 'Down on a boulder';
    reason = 'A boulder under the descent stage stove it in.';
    tip = 'Watch the footprint marks under the LM: they turn red over rocks.';
  } else if (rec.rock > LIMITS.rock[2]) {
    outcome = 'tipped'; title = 'Tipped over';
    reason = `A footpad came down on a ${one(rec.rock)}-foot rock and the LM went over.`;
    tip = 'Pick a spot with nothing under the footprint marks, and drift onto it slowly.';
  } else if (rec.side > LIMITS.side[2]) {
    outcome = 'tipped'; title = 'Tipped over';
    reason = `Still moving ${one(rec.side)} ft/s along the ground when the footpads caught. The legs take 4.`;
    tip = 'Stop over the spot first: tilt against the drift until the speed reads 0, then come down.';
  } else if (rec.tilt > LIMITS.tilt[2]) {
    outcome = 'tipped'; title = 'Tipped over';
    reason = `Leaning ${Math.round(rec.tilt)}° as it touched; one leg took it all and it went over.`;
    tip = 'Let go of the hand controller for the last few feet and the LM stands upright.';
  } else if (rec.rest > LIMITS.slope[2]) {
    outcome = 'tipped'; title = 'Tipped over';
    reason = `A ${Math.round(rec.rest)}° slope. The LM can stand on 12° and no more.`;
    tip = 'Crater walls and rims are steep. Look for flat ground between them.';
  }

  const ok = outcome === 'landed';
  const worst = Math.max(...rows.map(r => Math.min(2, r.rank)));
  for (const r of rows) r.tier = r.rank <= 2 ? TIERS[r.rank] : 'fail';
  return { ok, outcome, title: ok ? TIERS[worst] : title, tier: ok ? TIERS[worst] : null, rows, reason, tip };
}

function rockRow(rec) {
  let rank = rankBy(rec.rock, LIMITS.rock), value = 'Clear';
  if (rec.rock >= 0.5) value = `${one(rec.rock)} ft rock under a pad`;
  if (rec.bellHit) { rank = Math.max(rank, 2); value = rec.rock >= 0.5 ? value + ', bell touched' : 'Engine bell touched'; }
  return { key: 'rock', label: 'Rocks', value, rank, need: 'nothing under the footpads' };
}

const ORDER = { gold: 0, silver: 1, bronze: 2 };
// Is plaque a better than plaque b?
export const better = (a, b) => (a ? ORDER[a] : 9) < (b ? ORDER[b] : 9);
