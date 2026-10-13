// What's kept in the browser: the best plaque at each site in each mode, Free flight counts, and the
// sound settings. One localStorage key, contact-light.v1.

import { TIERS } from './judge.js';

export const KEY = 'contact-light.v1';

const fresh = () => ({
  v: 1,
  best: { p66: {}, arcade: {} },
  free: { flown: 0, landed: 0, gold: 0, seed: 0 },
  settings: { sound: true, voice: false, mode: 'p66' },
  flights: 0,
});

const obj = v => v && typeof v === 'object' && !Array.isArray(v);

// Anything that doesn't look right is dropped rather than trusted.
export function clean(raw) {
  const s = fresh();
  if (!obj(raw)) return s;
  for (const mode of ['p66', 'arcade']) {
    const b = obj(raw.best) && obj(raw.best[mode]) ? raw.best[mode] : {};
    for (const [id, e] of Object.entries(b)) {
      if (!obj(e) || !TIERS.includes(e.tier) || !/^[a-z0-9-]{1,20}$/.test(id)) continue;
      s.best[mode][id] = {
        tier: e.tier,
        q: Number.isFinite(e.q) ? e.q : 999,
        down: num(e.down), side: num(e.side), dist: num(e.dist), fuel: num(e.fuel),
        at: typeof e.at === 'string' ? e.at.slice(0, 10) : '',
      };
    }
  }
  if (obj(raw.free)) for (const k of ['flown', 'landed', 'gold', 'seed']) s.free[k] = Math.max(0, Math.floor(num(raw.free[k])));
  if (obj(raw.settings)) {
    s.settings.sound = raw.settings.sound !== false;
    s.settings.voice = raw.settings.voice === true;
    if (['p66', 'arcade', 'free'].includes(raw.settings.mode)) s.settings.mode = raw.settings.mode;
  }
  s.flights = Math.max(0, Math.floor(num(raw.flights)));
  return s;
}
const num = v => (Number.isFinite(+v) ? +v : 0);

export function load() {
  try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return fresh(); }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: it just won't remember */ }
}

// How good a landing is, for keeping the best: the plaque first, then how many of its numbers
// were gold, then the distance. Lower is better.
export function quality(judged, rec) {
  const ranks = judged.rows.reduce((a, r) => a + Math.min(2, r.rank), 0);
  return TIERS.indexOf(judged.tier) * 100 + ranks * 5 + Math.min(4.99, rec.dist / 1000);
}

// Records a landing. Returns true if it's a new best for that site and mode.
export function recordLanding(s, mode, siteId, judged, rec, today = new Date().toISOString().slice(0, 10)) {
  if (!judged.ok || !s.best[mode]) return false;
  const q = quality(judged, rec);
  const old = s.best[mode][siteId];
  if (old && old.q <= q) return false;
  s.best[mode][siteId] = { tier: judged.tier, q, down: round1(rec.down), side: round1(rec.side), dist: Math.round(rec.dist), fuel: round1(rec.fuelPct), at: today };
  return true;
}
const round1 = v => Math.round(v * 10) / 10;
