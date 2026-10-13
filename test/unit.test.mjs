// The parts that don't need a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../js/rng.js';
import { buildGround, groundAt, surfaceAt, spotAt, litAt } from '../js/terrain.js';
import { createFlight, step, altitude, pct, hoverSeconds, G_MOON, VEHICLES, ENGINE, LOW_LEVEL, BINGO_AFTER_LOW, FULL_LOAD } from '../js/sim.js';
import { judge, LIMITS } from '../js/judge.js';
import { rateText, rateSay, altText, numbersCall, createRadio, radioUpdate, openingLines, endingLines } from '../js/calls.js';
import { createAutopilot, autopilotInput, chooseSpot } from '../js/autopilot.js';
import { SITES, siteById } from '../js/sites.js';
import { makeFreeSite } from '../js/freeflight.js';
import { clean, recordLanding, quality } from '../js/store.js';
import { STEPS } from '../js/coach.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DT = 1 / 60;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} is not within ${tol} of ${b}`);

// A flat, empty site to try the flight model on.
const flatSite = (over = {}) => ({
  id: 'flat', vehicle: 'lm', mass: 6850, fuel: 9, sun: 10,
  people: { lm: 'LM', capcom: 'Houston', cdr: 'CDR', lmp: 'LMP', style: 'plain' },
  ground: { span: [-2000, 4000], seed: 5 },
  start: { x: 0, alt: 300, vx: 0, vy: 0 },
  target: { x: 0, tiers: [100, 300], label: 'TARGET' },
  ...over,
});
const flatGround = site => buildGround({ ...site.ground, sun: site.sun });

function fly(f, input, seconds) {
  const events = [];
  const end = f.t + seconds;
  while (f.t < end - 1e-9) for (const e of step(f, typeof input === 'function' ? input(f) : input, DT)) events.push({ ...e, at: f.t });
  return events;
}

// ---------- terrain ----------

test('the same seed draws the same ground', () => {
  const a = rng(42), b = rng(42);
  for (let k = 0; k < 5; k++) assert.equal(a(), b());
  const s = siteById('a11');
  const g1 = buildGround({ ...s.ground, sun: s.sun }), g2 = buildGround({ ...s.ground, sun: s.sun });
  assert.deepEqual([...g1.h.slice(1000, 1010)], [...g2.h.slice(1000, 1010)]);
  assert.equal(g1.boulders.length, g2.boulders.length);
});

test('a crater is a bowl with a raised rim', () => {
  const g = buildGround({ span: [-500, 500], seed: 1, craters: [{ x: 0, r: 100, d: 30, rim: 5 }] });
  near(groundAt(g, 0), -30, 0.01, 'the middle is as deep as the crater');
  near(groundAt(g, 100), 5, 0.01, 'the rim stands up');
  near(groundAt(g, 400), 0, 0.01, 'far away it is flat');
  assert.ok(groundAt(g, 50) < 0 && groundAt(g, 150) > 0);
});

test('a boulder throws a long shadow away from the low Sun', () => {
  const g = buildGround({ span: [-200, 400], seed: 1, sun: 10, rocks: [{ x: 0, h: 5, w: 6 }] });
  assert.ok(surfaceAt(g, 0) > 4, 'the boulder stands on the ground');
  assert.equal(litAt(g, -10), 1, 'the sunny side is lit');
  // Its top stands 4.4 ft clear of the ground, so at a 10° Sun its shadow reaches 4.4 / tan(10°) = 25 ft, on the far side.
  assert.equal(litAt(g, 10), 0);
  assert.equal(litAt(g, 22), 0);
  assert.equal(litAt(g, 30), 1);
});

test('a spot to land: level, sloped, or with a rock under a footpad', () => {
  const lm = VEHICLES.lm;
  const flat = buildGround({ span: [-300, 300], seed: 1 });
  const s0 = spotAt(flat, 0, lm);
  near(s0.slope, 0, 0.01, 'flat ground has no slope');
  near(s0.rest, 0, 0.01, 'and it sits level');
  assert.equal(s0.rock, 0);
  assert.equal(s0.bellHit || s0.bodyHit, false);
  // A 10% grade is 5.7°.
  const ramp = buildGround({ span: [-300, 300], seed: 1, ramps: [{ x0: -200, x1: 200, dh: 40 }] });
  near(Math.abs(spotAt(ramp, 0, lm).slope), Math.atan(40 / 400 * 1.5) * 180 / Math.PI, 1.2, 'slope in the middle of a ramp');
  // A 2-foot rock under the right footpad tips it about atan(2/31) = 3.7°.
  const rock = buildGround({ span: [-300, 300], seed: 1, rocks: [{ x: 15.5, h: 2, w: 4 }] });
  const s1 = spotAt(rock, 0, lm);
  near(s1.rock, 2 * 0.88, 0.25, 'the rock is under a pad');
  near(Math.abs(s1.rest), Math.atan(1.76 / 31) * 180 / Math.PI, 0.6, 'it rests tipped');
  // A rock right under the middle meets the engine bell; a big one stoves in the descent stage.
  const mid = buildGround({ span: [-300, 300], seed: 1, rocks: [{ x: 0, h: 3, w: 4 }] });
  assert.equal(spotAt(mid, 0, lm).bellHit, true);
  assert.equal(spotAt(mid, 0, lm).bodyHit, false);
  const big = buildGround({ span: [-300, 300], seed: 1, rocks: [{ x: 0, h: 7, w: 7 }] });
  assert.equal(spotAt(big, 0, lm).bodyHit, true);
});

// ---------- the flight model ----------

test('P66 holds the rate you click, a foot per second a click', () => {
  const site = flatSite();
  const f = createFlight(site, flatGround(site));
  const alt0 = altitude(f);
  fly(f, { pad: 0 }, 20);
  near(altitude(f), alt0, 0.6, 'a hover at rate 0 stays put');
  near(f.vy, 0, 0.05, 'and isn\'t moving');
  fly(f, { rod: -1 }, DT);
  fly(f, { rod: -1 }, DT);
  fly(f, { rod: -1 }, DT);
  assert.equal(f.rateCmd, -3);
  fly(f, {}, 8);
  near(f.vy, -3, 0.1, 'it settles on 3 ft/s down');
  fly(f, { rod: 4 }, DT);
  fly(f, {}, 8);
  near(f.vy, 1, 0.1, 'four clicks up and it climbs at 1');
});

test('tilting accelerates you along the ground at g × tan(tilt)', () => {
  const site = flatSite();
  const f = createFlight(site, flatGround(site));
  fly(f, { pad: 1 }, 4); // let it tilt over
  near(f.th * 180 / Math.PI, 20, 0.3, 'full deflection is 20°');
  const v0 = f.vx;
  fly(f, { pad: 1 }, 5);
  near((f.vx - v0) / 5, G_MOON * Math.tan(20 * Math.PI / 180), 0.12, 'acceleration');
  fly(f, { pad: 0 }, 4);
  near(f.th, 0, 0.002, 'let go and it stands up straight');
  const v1 = f.vx;
  fly(f, { pad: 0 }, 3);
  near(f.vx, v1, 0.05, 'upright, it coasts');
});

test('fuel burns at the descent engine\'s rate, and the calls follow the low-level light', () => {
  const site = flatSite({ fuel: 6.2, start: { x: 0, alt: 900, vx: 0, vy: 0 } });
  const f = createFlight(site, flatGround(site));
  const m = f.dry + f.prop;
  const flow = (m * 1.62) / (ENGINE.isp * 9.80665);
  near(hoverSeconds(f), f.prop / flow, 0.01, 'hover seconds');
  const p0 = f.prop;
  fly(f, {}, 10);
  near((p0 - f.prop) / 10, flow, flow * 0.03, 'a hover burns about what the rocket equation says');
  const ev = fly(f, {}, 200);
  const at = type => ev.find(e => e.type === type)?.at;
  assert.ok(at('lowLevel'), 'the low-level light came on');
  near(pct({ ...f, prop: (LOW_LEVEL / 100) * FULL_LOAD }), LOW_LEVEL, 1e-9, 'at 5.6%');
  near(at('call60') - at('lowLevel'), BINGO_AFTER_LOW - 60, 0.05, '60 seconds');
  near(at('call30') - at('lowLevel'), BINGO_AFTER_LOW - 30, 0.05, '30 seconds');
  near(at('bingo') - at('lowLevel'), BINGO_AFTER_LOW, 0.05, 'Bingo');
  assert.ok(ev.some(e => e.type === 'abort'), 'hovering high past Bingo ends in an abort');
});

test('contact light comes on with the probes 67 inches down, before the footpads touch', () => {
  const site = flatSite({ start: { x: 0, alt: 30, vx: 0, vy: -2 } });
  const f = createFlight(site, flatGround(site));
  const ev = fly(f, {}, 30);
  const contact = ev.find(e => e.type === 'contact'), down = ev.find(e => e.type === 'touchdown');
  assert.ok(contact && down, 'both happened');
  near(contact.alt, 67 / 12, 0.1, 'the probes touch at 5.6 ft');
  near(down.at - contact.at, (67 / 12) / 2, 0.15, 'the footpads follow at 2 ft/s');
  near(down.record.down, 2, 0.1, 'touching down at the rate held');
  assert.ok(f.phase === 'settling' || f.phase === 'landed');
});

test('the LLTV has no probes, so no contact light', () => {
  const site = flatSite({ vehicle: 'lltv', start: { x: 0, alt: 20, vx: 0, vy: -2 } });
  const f = createFlight(site, flatGround(site));
  const ev = fly(f, {}, 20);
  assert.equal(ev.some(e => e.type === 'contact'), false);
  assert.ok(ev.some(e => e.type === 'touchdown'));
});

// ---------- judging ----------

const rec = (over = {}) => ({ down: 1.5, side: 0.3, tilt: 1, slope: 1, rest: 1, rock: 0, bellHit: false, bodyHit: false, dist: 50, fuelPct: 5, fuelSec: 60, clock: 'low', ...over });

test('a plaque is as good as its worst number', () => {
  const site = flatSite();
  assert.equal(judge(rec(), site).tier, 'gold');
  assert.equal(judge(rec({ dist: 200 }), site).tier, 'silver');
  assert.equal(judge(rec({ dist: 2000 }), site).tier, 'bronze');
  assert.equal(judge(rec({ down: 4 }), site).tier, 'silver');
  assert.equal(judge(rec({ side: 3 }), site).tier, 'bronze');
  assert.equal(judge(rec({ rest: 5 }), site).tier, 'silver');
  assert.equal(judge(rec({ rock: 1 }), site).tier, 'silver');
  assert.equal(judge(rec({ bellHit: true }), site).tier, 'bronze');
  assert.equal(judge(rec({ clock: 'after60' }), site).tier, 'gold', 'down before the 30-second call is gold');
  assert.equal(judge(rec({ clock: 'after30' }), site).tier, 'silver');
  assert.equal(judge(rec({ clock: 'afterBingo' }), site).tier, 'bronze');
  const j = judge(rec({ dist: 200 }), site);
  assert.equal(j.rows.find(r => r.key === 'dist').tier, 'silver', 'the table says which number cost it');
});

test('past the LM\'s limits it crashes or tips over', () => {
  const site = flatSite();
  const at = over => judge(rec(over), site);
  assert.equal(at({ down: LIMITS.down[2] + 0.5, side: 0 }).outcome, 'crash');
  // The design envelope narrows with speed along the ground: 9 ft/s is fine straight down, not at 3 ft/s sideways.
  assert.equal(at({ down: 9, side: 0 }).outcome, 'landed');
  assert.equal(at({ down: 9, side: 3 }).outcome, 'crash');
  assert.match(at({ down: 9, side: 3 }).reason, /built for 7\.8 like that/);
  assert.match(at({ down: 14 }).reason, /14 ft\/s down\. The legs were built for 10/);
  assert.equal(at({ side: 4.5 }).outcome, 'tipped');
  assert.equal(at({ tilt: 13 }).outcome, 'tipped');
  assert.equal(at({ rest: 13 }).outcome, 'tipped');
  assert.equal(at({ rock: 3.5 }).outcome, 'tipped');
  assert.equal(at({ bodyHit: true }).outcome, 'crash');
  const a = judge({ abort: 'dry', alt: 80, dist: 0, fuelPct: 0 }, site);
  assert.equal(a.outcome, 'abort');
  assert.match(a.reason, /ran dry 80 ft up/);
  for (const o of [at({ down: 12 }), at({ side: 5 }), a]) assert.equal(o.tier, null);
});

// ---------- the radio ----------

test('numbers are called the way the crews said them', () => {
  assert.equal(rateText(-2.5), '2 1/2');
  assert.equal(rateText(-2.3), '2 1/2');
  assert.equal(rateText(-0.5), 'a half');
  assert.equal(rateText(-4), '4');
  assert.equal(rateSay(-2.5), '2 and a half');
  assert.equal(altText(43), '45');
  assert.equal(altText(538), '540');
  assert.equal(altText(1), '5');
  assert.equal(numbersCall('aldrin', { alt: 40, rate: -2.5, fwd: 0.2, k: 0 }), '40 feet, down 2 1/2.');
  assert.equal(numbersCall('aldrin', { alt: 400, rate: -9, fwd: 58, k: 2 }), '400 feet, down at 9. 58 forward.');
  assert.equal(numbersCall('irwin', { alt: 80, rate: -5, fwd: 0, k: 0 }), '80 at minus 5.');
  assert.equal(numbersCall('bean', { alt: 300, rate: -5, fwd: 0, k: 0 }), '300 feet, coming down at 5.');
  for (const style of ['aldrin', 'bean', 'mitchell', 'irwin', 'duke', 'schmitt', 'plain']) {
    for (const n of [{ alt: 120, rate: -3, fwd: 4 }, { alt: 60, rate: 0, fwd: 0 }, { alt: 30, rate: 1.5, fwd: -2 }]) {
      for (let k = 0; k < 3; k++) assert.doesNotMatch(numbersCall(style, { ...n, k }), /undefined|NaN|null/);
    }
  }
});

test('the radio makes its calls once, in Houston\'s and the crew\'s voices', () => {
  const site = siteById('a11');
  const radio = createRadio(site);
  const f = createFlight(site, flatGround(site));
  const base = { alt: 300, rate: -4, fwd: 20, pct: 6, t: 20, dustOn: false, shadowSeen: false };
  const low = radioUpdate(radio, f, [{ type: 'lowLevel' }], base);
  assert.match(low[0].text, /Quantity light/);
  assert.equal(radioUpdate(radio, f, [{ type: 'call60' }], base)[0].who, 'Duke');
  assert.equal(radioUpdate(radio, f, [{ type: 'call60' }], base)[0].quindar, true, 'Houston gets Quindar tones');
  const dust1 = radioUpdate(radio, f, [], { ...base, alt: 40, dustOn: true, t: 40 });
  assert.ok(dust1.some(l => l.text === 'Picking up some dust.'));
  const dust2 = radioUpdate(radio, f, [], { ...base, alt: 38, dustOn: true, t: 41 });
  assert.ok(!dust2.some(l => l.text === 'Picking up some dust.'), 'only once');
  assert.match(openingLines(site)[0].text, /Eagle, Houston\. You’re go for landing/);
});

test('after a good landing come the real words', () => {
  const j = { ok: true, outcome: 'landed', tier: 'gold', rows: [] };
  const e11 = endingLines(siteById('a11'), j);
  assert.ok(e11.lines.some(l => l.text === 'Houston, Tranquility Base here. The Eagle has landed.'));
  assert.ok(e11.card > e11.lines.find(l => l.big).at, 'the card waits for the big line');
  assert.ok(endingLines(siteById('a15'), j).lines.some(l => /Falcon is on the Plain at Hadley/.test(l.text)));
  assert.ok(endingLines(siteById('a17'), j).lines.some(l => /Challenger has landed/.test(l.text)));
  for (const s of SITES) {
    const e = endingLines(s, j);
    assert.ok(e.lines.length && e.card > 0, s.id);
  }
  assert.match(endingLines(siteById('a12'), { outcome: 'crash' }).lines[0].text, /Intrepid, Houston/);
});

// ---------- every site can be landed ----------

function autoland(site, mode) {
  const g = buildGround({ ...site.ground, sun: site.sun });
  const f = createFlight(site, g, mode);
  const ap = createAutopilot(site, g, f.veh, mode);
  let r = null;
  while (f.t < 300 && !r) for (const e of step(f, autopilotInput(ap, f), DT)) if (e.type === 'touchdown' || e.type === 'abort') r = e.record;
  return { r, j: r && judge(r, site), f };
}

for (const mode of ['p66', 'arcade']) {
  test(`the autopilot lands every site in ${mode === 'p66' ? 'P66' : 'Arcade'} with fuel to spare`, () => {
    for (const site of SITES) {
      const { r, j } = autoland(site, mode);
      assert.ok(r, `${site.id}: it came down`);
      assert.equal(j.outcome, 'landed', `${site.id}: ${j.reason}`);
      assert.equal(j.tier, 'gold', `${site.id}: ${JSON.stringify(j.rows.map(x => [x.key, x.value, x.tier]))}`);
      assert.ok(r.fuelSec > 60, `${site.id}: ${r.fuelSec.toFixed(0)} s of hover left`);
      assert.ok(['plenty', 'low', 'after60'].includes(r.clock), `${site.id}: down before the 30-second call (${r.clock})`);
    }
  });
}

test('each site picks a landing spot clear of its trouble', () => {
  for (const site of SITES.filter(s => !s.training)) {
    const g = buildGround({ ...site.ground, sun: site.sun });
    const x = chooseSpot(site, g, VEHICLES.lm);
    const q = spotAt(g, x, VEHICLES.lm);
    assert.ok(Math.abs(q.rest) <= 3 && q.rock < 0.5 && !q.bellHit, `${site.id} at ${x}`);
    assert.ok(Math.abs(x - site.target.x) <= site.target.tiers[0], `${site.id}: a gold distance is possible`);
  }
  // And the planned spot itself is no good: that's the point of each site.
  for (const id of ['a11', 'a12', 'a15', 'a16', 'a17']) {
    const s = siteById(id);
    const g = buildGround({ ...s.ground, sun: s.sun });
    const q = spotAt(g, s.target.x, VEHICLES.lm);
    assert.ok(Math.abs(q.rest) > 3 || q.rock >= 0.5 || q.bellHit || q.bodyHit, `${id}'s planned spot should be bad`);
  }
});

test('Free flight rolls new ground that can be landed, the same ground for the same number', () => {
  for (const seed of [1, 2, 3, 77, 1234, 98765]) {
    const made = makeFreeSite(seed);
    assert.ok(made, `seed ${seed}`);
    const { r, j } = autoland(made.site, 'p66');
    assert.ok(r && j.ok, `seed ${seed}: ${j && j.reason}`);
  }
  const a = makeFreeSite(4321), b = makeFreeSite(4321);
  assert.equal(a.site.fuel, b.site.fuel);
  assert.deepEqual(a.site.start, b.site.start);
});

// ---------- saved data and the rest ----------

test('saved data: junk is dropped, and only a better landing replaces the best', () => {
  const s = clean({ best: { p66: { a11: { tier: 'gold', q: 3 }, bad: { tier: 'platinum' }, '<x>': { tier: 'gold' } } }, settings: { sound: false, mode: 'weird' }, free: { landed: 'x' } });
  assert.deepEqual(Object.keys(s.best.p66), ['a11']);
  assert.equal(s.settings.sound, false);
  assert.equal(s.settings.mode, 'p66');
  assert.equal(s.free.landed, 0);
  assert.deepEqual(clean('nonsense').best, { p66: {}, arcade: {} });
  const site = flatSite();
  const store = clean(null);
  const silver = judge(rec({ dist: 200 }), site), gold = judge(rec(), site);
  assert.ok(quality(gold, rec()) < quality(silver, rec({ dist: 200 })));
  assert.equal(recordLanding(store, 'p66', 'flat', silver, rec({ dist: 200 })), true);
  assert.equal(recordLanding(store, 'p66', 'flat', silver, rec({ dist: 250 })), false, 'a worse silver doesn\'t replace it');
  assert.equal(recordLanding(store, 'p66', 'flat', gold, rec()), true);
  assert.equal(store.best.p66.flat.tier, 'gold');
  assert.equal(recordLanding(store, 'p66', 'flat', judge(rec({ down: 12 }), site), rec({ down: 12 })), false, 'a crash is never a best');
});

test('every site has what the game needs', () => {
  for (const s of SITES) {
    assert.ok(s.brief && s.history && s.place && s.people, s.id);
    assert.ok(s.target.tiers[0] < s.target.tiers[1], s.id);
    assert.ok(s.ground.span[0] < s.start.x && s.target.x < s.ground.span[1], s.id);
  }
  assert.equal(SITES.filter(s => !s.training).map(s => s.name).join(', '), 'Apollo 11, Apollo 12, Apollo 14, Apollo 15, Apollo 16, Apollo 17');
  assert.equal(STEPS.length, 5);
});

test('the offline copy lists every file the page uses', async () => {
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const shell = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];'));
  const listed = new Set([...shell.matchAll(/'([^']+)'/g)].map(m => m[1]));
  const files = ['index.html', 'manifest.webmanifest', 'icon.svg', 'css/app.css'];
  for (const dir of ['js', 'fonts']) for (const f of await readdir(join(root, dir))) files.push(`${dir}/${f}`);
  for (const f of files) assert.ok(listed.has(f), `sw.js is missing ${f}`);
  for (const f of listed) if (f !== './') await readFile(join(root, f));
  assert.match(sw, /const CACHE = 'contact-light-v\d+'/);
});
