// Free flight: new ground from a number. Each roll picks a kind of country, puts something wrong at
// the target (a crater, a boulder field, a slope), leaves a few clear patches near it, and then the
// autopilot flies it to make sure it can be landed and to set the fuel: what the autopilot needed,
// plus about as much again as the real sites leave a good pilot.

import { rng, between } from './rng.js';
import { buildGround } from './terrain.js';
import { createFlight, step, pct } from './sim.js';
import { judge } from './judge.js';
import { createAutopilot, autopilotInput } from './autopilot.js';

const KINDS = [
  { id: 'mare', name: 'Mare plain', soil: [130, 125, 116], roll: [[5, 1700], [2.5, 560]], pits: 12, fields: 1 },
  { id: 'highland', name: 'Highlands', soil: [148, 144, 136], roll: [[15, 1600], [7, 600], [3, 240]], pits: 17, fields: 2 },
  { id: 'craters', name: 'Crater field', soil: [136, 131, 122], roll: [[6, 1500], [3, 500]], pits: 26, fields: 1 },
  { id: 'blocks', name: 'Boulder field', soil: [124, 120, 113], roll: [[6, 1500], [3, 520]], pits: 12, fields: 3 },
];
const TROUBLE = ['crater', 'boulders', 'slope', 'craters'];

export function makeFreeSite(seed) {
  for (let tries = 0; tries < 12; tries++) {
    const site = roll((seed + tries * 7919) >>> 0);
    const g = buildGround({ ...site.ground, sun: site.sun });
    const used = fly(site, g, 40);
    if (!used || !used.ok) continue;
    // Fuel: what it took the autopilot plus a margin like the real sites', so a careful landing
    // usually hears the low-level light and a hurried one hears the calls.
    site.fuel = Math.round((used.burned + 5.3 + between(rng(seed + 1), -0.2, 0.5)) * 10) / 10;
    const check = fly(site, g, site.fuel);
    if (check && check.ok) {
      site.seed = seed;
      return { site, ground: g };
    }
  }
  return null;
}

function roll(seed) {
  const R = rng(seed);
  const kind = KINDS[Math.floor(R() * KINDS.length)];
  const trouble = TROUBLE[Math.floor(R() * TROUBLE.length)];
  const tx = Math.round(between(R, 780, 1250));
  const craters = [], fields = [], ramps = [], mounds = [];
  // Something wrong at the target.
  if (trouble === 'crater') craters.push({ x: tx + between(R, -40, 40), r: between(R, 140, 260), d: between(R, 30, 70), rim: between(R, 4, 9), fresh: R() < 0.5 });
  if (trouble === 'craters') for (let k = 0; k < 4; k++) craters.push({ x: tx + between(R, -160, 160), r: between(R, 25, 60), d: between(R, 7, 15), rim: between(R, 1.5, 3), fresh: true });
  if (trouble === 'boulders') fields.push({ x0: tx - between(R, 160, 260), x1: tx + between(R, 160, 260), n: Math.round(between(R, 90, 160)), min: 1.2, max: between(R, 7, 12), peak: tx });
  if (trouble === 'slope') mounds.push({ x: tx + between(R, -60, 60), w: between(R, 120, 200), dh: between(R, 22, 40) * (R() < 0.5 ? 1 : -1) });
  // Some more country.
  for (let k = 0; k < 2 + Math.floor(R() * 3); k++) {
    const x = between(R, -400, 2900);
    if (Math.abs(x - tx) < 320) continue;
    craters.push({ x, r: between(R, 40, 180), d: between(R, 10, 40), rim: between(R, 2, 6) });
  }
  for (let k = 0; k < kind.fields; k++) fields.push({ x0: between(R, -500, 2400), x1: 0, n: Math.round(between(R, 20, 70)), min: 0.6, max: between(R, 3, 8) });
  for (const f of fields) if (!f.x1) f.x1 = f.x0 + between(R, 200, 600);
  if (R() < 0.4) ramps.push({ x0: between(R, -600, 600), x1: between(R, 1400, 2600), dh: between(R, -40, 40) });
  // Clear patches near the target, so there's somewhere to come down.
  const clear = [];
  for (let k = 0; k < 3; k++) {
    const side = k === 0 ? 1 : R() < 0.6 ? 1 : -1;
    const at = tx + side * between(R, 260, 700);
    clear.push([at - 50, at + 50]);
  }
  const lit = between(R, 0.55, 0.7);
  return {
    id: 'free',
    name: 'Free flight',
    place: kind.name,
    region: kind.name,
    craft: 'LM',
    date: '',
    vehicle: 'lm',
    free: true,
    kind: kind.id,
    mass: R() < 0.5 ? 6850 : 8100,
    fuel: 9,
    sun: between(R, 6, 14),
    earth: { x: between(R, 0.15, 0.85), y: between(R, 0.1, 0.22), lit },
    palette: { soil: kind.soil, deep: kind.soil.map(c => Math.round(c * 0.38)) },
    dust: { top: between(R, 80, 115), thick: between(R, 2, 5.5), dense: between(R, 0.45, 0.9) },
    people: { cdr: 'CDR', lmp: 'LMP', capcom: 'Houston', lm: 'LM', first: '', style: 'plain' },
    ground: {
      span: [-900, 3400], seed: (seed % 100000) + 17,
      roll: kind.roll,
      bumps: [[0.55, 38], [0.2, 11]],
      pits: { per1000: kind.pits, min: 3, max: 40 },
      craters, fields, ramps, mounds, clear,
    },
    start: { x: 0, alt: Math.round(between(R, 360, 540)), vx: Math.round(between(R, 26, 56)), vy: -Math.round(between(R, 8, 18)) },
    target: { x: tx, tiers: [Math.round(between(R, 300, 420)), Math.round(between(R, 750, 950))], label: 'TARGET' },
    brief: '',
    history: '',
  };
}

// Flies the site with the autopilot. Returns { ok, burned (percent of a full load) }.
function fly(site, g, fuel) {
  const s = { ...site, fuel };
  const f = createFlight(s, g, 'p66');
  const ap = createAutopilot(s, g, f.veh, 'p66');
  const p0 = pct(f);
  let rec = null;
  while (f.t < 260 && !rec) {
    const ev = step(f, autopilotInput(ap, f), 1 / 30);
    for (const e of ev) if (e.type === 'touchdown' || e.type === 'abort') rec = e.record;
  }
  if (!rec) return null;
  const j = judge(rec, s);
  return { ok: j.ok && j.tier !== 'bronze', burned: p0 - rec.fuelPct };
}
