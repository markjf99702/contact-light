// Flies Contact Light in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Learns the controls at Ellington with real taps and drags, lands at Tranquility Base, crashes,
// aborts, tries Arcade and Free flight, checks the plaques are kept, plays once more offline, comes
// down through Surveyor crater's dust with the phone on its side, and has the calls read aloud.
// It ends with the checks every junkdrawer.works project wants.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const problems = [];
function watch(page) {
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('requestfailed', r => problems.push('failed: ' + r.url()));
  page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });
}
const LONG = { timeout: 60000 };

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page);
  const cdp = await ctx.newCDPSession(page);
  const state = () => page.evaluate(() => window.contactLight.state());
  const until = (fn, arg) => page.waitForFunction(fn, arg, LONG);
  const noSideways = async where => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `the page scrolls sideways (${where})`);
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('contact-light.v1') || 'null'));
  const centre = async sel => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b]; };
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });

  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);

  // ---------- the title ----------
  await page.waitForFunction(() => window.contactLight && window.contactLight.demo());
  assert.equal(await page.locator('#title').isVisible(), true, 'the title shows first');
  assert.equal(await page.locator('.site').count(), 7, 'Ellington and six landings');
  assert.equal(await page.locator('.medal.gold, .medal.silver, .medal.bronze').count(), 0, 'no plaques yet');
  assert.match((await page.evaluate(() => window.contactLight.demo())).site, /^a1\d$/, 'the autopilot flies a landing behind the title');
  await noSideways('title');

  // ---------- Ellington: learning the controls with real taps and drags ----------
  await page.tap('[data-site=ellington]');
  await page.locator('#brief').waitFor();
  assert.match(await page.textContent('#bPlace'), /Ellington/);
  await page.tap('#goBtn');
  await until(() => window.contactLight.state().screen === 'flight');
  await until(() => /Tap ▼ three times/.test(document.getElementById('coachText').textContent));
  assert.equal(await page.locator('#coach').isVisible(), true, 'training shows hints');
  // The hand controller says which way is which: BACK at the left end, FWD at the right.
  const ends = await page.$$eval('.aca-end', els => els.map(e => { const b = e.getBoundingClientRect(); return [e.textContent, b.left, b.right]; }));
  const track = await page.locator('#acaTrack').boundingBox();
  assert.deepEqual(ends.map(e => e[0]), ['BACK', 'FWD']);
  assert.ok(ends[0][1] < track.x + track.width * 0.25 && ends[1][2] > track.x + track.width * 0.75, `at the ends of the track: ${JSON.stringify(ends)}`);
  for (let k = 0; k < 3; k++) { await page.tap('#rodDown'); await page.waitForTimeout(120); }
  await until(() => window.contactLight.state().rate === -3);
  assert.equal(await page.textContent('#rodRead'), 'DOWN 3');
  await until(() => Math.abs(window.contactLight.state().vy + 3) < 0.3);
  assert.match(await page.textContent('#roRateLbl'), /DOWN/);
  // Then ▲ three times, to hold the height all the way over to the pad.
  await until(() => /Tap it three times to stop and hold your height/.test(document.getElementById('coachText').textContent));
  for (let k = 0; k < 3; k++) { await page.tap('#rodUp'); await page.waitForTimeout(120); }
  await until(() => window.contactLight.state().rate === 0);
  assert.equal(await page.textContent('#rodRead'), 'HOLD');
  await until(() => /drag the hand controller right, toward FWD/.test(document.getElementById('coachText').textContent));
  await until(() => Math.abs(window.contactLight.state().vy) < 0.3);

  // Hold the hand controller over to the right: the LM leans over and speeds up.
  const [ax, ay, ab] = await centre('#acaTrack');
  await touch('touchStart', [[ax, ay]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[ax + (ab.width / 2 - 8) * k / 6, ay]]);
  await until(() => window.contactLight.state().th > 15);
  await until(() => window.contactLight.state().vx > 6);
  // A second thumb clicks the rate switch while the first holds the controller.
  await touch('touchStart', [[ax + ab.width / 2 - 8, ay], [...(await centre('#rodDown')).slice(0, 2)]]);
  await touch('touchEnd', [[ax + ab.width / 2 - 8, ay]]);
  await until(() => window.contactLight.state().rate === -1);
  assert.ok((await state()).th > 15, 'still leaning while the other thumb works the rate switch');
  await until(() => /^tilted forward (1[5-9]|20) degrees$/.test(document.getElementById('aca').getAttribute('aria-valuetext')));
  await touch('touchEnd', []);
  await until(() => Math.abs(window.contactLight.state().th) < 1);
  const vx = (await state()).vx;
  await page.waitForTimeout(800);
  assert.ok(Math.abs((await state()).vx - vx) < 0.4, 'let go, it stands upright and coasts');
  await until(() => /As the pad comes under you, drag left, toward BACK, until FWD reads 0/.test(document.getElementById('coachText').textContent));
  // The keyboard works too.
  await page.keyboard.press('ArrowUp');
  await until(() => window.contactLight.state().rate === 0);
  await noSideways('flight');

  // Hand over to the autopilot to finish the landing.
  await page.evaluate(() => { window.contactLight.autopilot(true); window.contactLight.speed(6); });
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal(await page.locator('#plaque svg').count(), 1, 'a plaque for the landing');
  assert.match(await page.textContent('#rTitle'), /^(Gold|Silver|Bronze) plaque$/);
  assert.equal(await page.locator('#rRows tr').count(), 7, 'every number judged');
  assert.ok((await store()).best.p66.ellington, 'the plaque is kept');
  assert.match(await page.textContent('#nextBtn'), /Next: Apollo 11/);
  await noSideways('result');

  // ---------- Apollo 11, all the way down ----------
  await page.tap('#nextBtn');
  await page.locator('#brief').waitFor();
  assert.match(await page.textContent('#bText'), /West crater/);
  assert.equal(await page.textContent('#bControls'), '▲ slows your descent · drag the hand controller left to slow down', 'the briefing names the two controls, and which way slows you down');
  // Take over while the briefing's own flight is low in its dust: the radio hears only yours.
  await page.evaluate(() => window.contactLight.speed(8));
  await until(() => { const d = window.contactLight.demo(); return d.site === 'a11' && d.alt < 50 && window.contactLight.scene().dust > 0.12; });
  await page.evaluate(() => window.contactLight.speed(1));
  await page.tap('#goBtn');
  await until(() => window.contactLight.state().site === 'a11' && window.contactLight.state().screen === 'flight');
  await until(() => window.contactLight.state().lines.some(l => /Eagle, Houston\. You're go for landing\./.test(l)));
  await page.waitForTimeout(1000);
  assert.ok(!(await state()).lines.some(l => /dust/i.test(l)), `no dust call 500 feet up: ${(await state()).lines}`);
  assert.equal(await page.locator('#lampContact').getAttribute('class'), 'lamp blue', 'the contact light is off');
  await page.evaluate(() => { window.contactLight.autopilot(true); window.contactLight.speed(6); });
  await until(() => window.contactLight.state().contact);
  assert.match(await page.locator('#lampContact').getAttribute('class'), /\bon\b/, 'contact light!');
  await until(() => window.contactLight.state().lines.some(l => /Contact light\./.test(l)));
  await until(() => window.contactLight.state().lines.some(l => /The Eagle has landed\./.test(l)));
  // The line the whole landing builds to, large over the scene, with the LM in view a moment longer.
  await page.evaluate(() => window.contactLight.speed(1));
  await until(() => !document.getElementById('moment').hidden);
  assert.equal(await page.textContent('#momentLine'), 'The Eagle has landed.');
  assert.equal(await page.textContent('#momentLead'), 'Houston, Tranquility Base here.');
  assert.match(await page.textContent('#momentWho'), /^ARMSTRONG · 102:4\d:\d\d$/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#radio p')].filter(p => p.offsetHeight > 2 && /Eagle has landed/.test(p.textContent)).length), 0, 'said once, large, and not in the radio as well');
  const mb = await page.locator('#moment').boundingBox(), hb = await page.locator('#hud').boundingBox();
  assert.ok(mb.y >= hb.y + hb.height && mb.y + mb.height <= (await page.locator('#panel').boundingBox()).y, 'between the numbers and the panel');
  assert.equal((await state()).screen, 'ending', 'the card waits');
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal(await page.locator('#moment').isVisible(), false, 'and goes when the card comes');
  assert.equal(await page.textContent('#roAlt'), '0.0', 'down is 0 feet up');
  assert.equal(await page.getAttribute('#nextBtn', 'class'), 'go', 'after a gold, the big button moves you on');
  assert.equal(await page.evaluate(() => document.querySelector('#result .actions').firstElementChild.id), 'nextBtn');
  const r11 = await state();
  assert.equal(r11.judged.outcome, 'landed');
  assert.equal(r11.judged.tier, 'gold', 'the autopilot earns gold at Tranquility Base');
  assert.ok(r11.record.down < 3 && r11.record.side < 1, 'a soft landing');
  assert.match(await page.textContent('#plaque'), /TRANQUILITY BASE/);
  assert.match(await page.textContent('#rReason'), /Contact light at 102:4\d:\d\d; Eagle’s came on at 102:45:40\./, 'your contact light against Eagle\'s');
  assert.ok(await page.locator('#loopList li').count() > 8, 'the landing as a transcript');
  assert.match(await page.textContent('#loopList'), /102:43:22Duke: Eagle, Houston\. You’re go for landing\./, 'stamped from when Armstrong took over');
  assert.match(await page.textContent('#loopList'), /Armstrong: Houston, Tranquility Base here\. The Eagle has landed\./);
  const loop = await page.textContent('#loopList');
  assert.ok(loop.indexOf('Picking up some dust.') > loop.indexOf('You’re go for landing.'), 'the dust call comes when the dust does');

  await page.tap('#sitesBtn');
  await page.locator('#title').waitFor();
  assert.equal(await page.locator('[data-site=a11] .medal.gold').count(), 1, 'the gold plaque shows in the list');
  assert.equal(await page.locator('[data-site=ellington] .start').count(), 0, 'Start here goes once Ellington is landed');
  await page.reload();
  await page.waitForFunction(() => window.contactLight && window.contactLight.demo());
  assert.equal(await page.locator('[data-site=a11] .medal.gold').count(), 1, 'and is still there after a reload');

  // ---------- a hard landing ----------
  await page.evaluate(() => window.contactLight.fly('ellington'));
  await until(() => window.contactLight.state().screen === 'flight');
  // Fresh from a reload, a tap's click comes with detail 0, like a key press: it still counts once.
  for (let k = 0; k < 3; k++) await page.tap('#rodDown');
  await page.waitForTimeout(200);
  assert.equal((await state()).rate, -3, 'three taps, three clicks');
  for (let k = 0; k < 11; k++) await page.tap('#rodDown');
  await until(() => window.contactLight.state().rate <= -12);
  await page.evaluate(() => window.contactLight.speed(4));
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal((await state()).judged.outcome, 'crash');
  assert.equal(await page.textContent('#rTitle'), 'Hard landing');
  assert.match(await page.textContent('#rReason'), /The legs were built for 10/);
  assert.equal(await page.locator('#plaque').isVisible(), false, 'no plaque for a crash');
  assert.equal(await page.textContent('#againBtn'), 'Try again');
  assert.equal(await page.getAttribute('#againBtn', 'class'), 'go', 'after a crash, the big button is another go');

  // ---------- a newcomer who touches nothing ----------
  // Tranquility Base at 14 ft/s down and 58 forward all the way: the radio says slow down, FWD goes
  // red, the marks under the LM show the speed instead of a green angle, and the card names both.
  await page.evaluate(() => { window.contactLight.fly('a11'); window.contactLight.speed(3); });
  await until(() => window.contactLight.state().lines.some(l => /58 forward\. Slow it down\./.test(l)));
  await until(() => window.contactLight.state().alt < 100);
  assert.match(await page.getAttribute('#roFwd', 'class'), /\bbad\b/, 'FWD is red: it can\'t stop in time');
  await until(() => window.contactLight.scene().marks === 'moving');
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal(await page.textContent('#rTitle'), 'Hard landing');
  assert.equal(await page.locator('#rRows .tier').count(), 2, 'only the two numbers that broke it are marked');
  assert.match(await page.textContent('#rTip'), /drag the hand controller left, toward BACK, until FWD reads 0/);
  assert.doesNotMatch(await page.textContent('#loopList'), /looking good/i, 'nobody said it was going well');

  // ---------- far past the end of the site ----------
  // Fly on past everything at Tranquility Base: there's still lit ground under the LM, not a void.
  await page.evaluate(() => { window.contactLight.fly('a11'); window.contactLight.hold({ rod: 13 }); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.contactLight.hold({ pad: 0.6 }); window.contactLight.speed(8); });
  await until(() => window.contactLight.state().x > 4800);
  await page.evaluate(() => { window.contactLight.speed(0); window.contactLight.hold({ pad: 0 }); });
  await page.waitForTimeout(200);
  const ground = await page.evaluate(() => {
    const c = document.getElementById('scene'), y = document.getElementById('panel').getBoundingClientRect().top - 30;
    const d = c.getContext('2d').getImageData(0, Math.round(y * c.width / innerWidth), c.width, 1).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  });
  assert.ok(ground > 50, `lit ground past the end of the site (brightness ${ground.toFixed(0)})`);
  await page.evaluate(() => window.contactLight.speed(1));

  // ---------- climbing away ----------
  // Held at UP 8 the LM climbs and climbs: it stays in view, below the numbers, not behind them.
  await page.evaluate(() => { window.contactLight.fly('a17'); window.contactLight.hold({ rod: 33 }); window.contactLight.speed(6); });
  await until(() => window.contactLight.state().alt > 1300);
  await page.evaluate(() => window.contactLight.speed(0));
  await page.waitForTimeout(200);
  const lm = (await page.evaluate(() => window.contactLight.scene())).lm;
  const hudBox = await page.locator('#hud').boundingBox(), panelBox = await page.locator('#panel').boundingBox();
  assert.ok(lm[1] > hudBox.y + hudBox.height && lm[3] < panelBox.y, `the LM is in view 1,300 feet up: ${lm.map(Math.round)}`);
  await page.evaluate(() => window.contactLight.speed(1));

  // ---------- out of fuel ----------
  await page.evaluate(() => { window.contactLight.fly('a14'); window.contactLight.setFuel(0.3); window.contactLight.speed(3); });
  await until(() => window.contactLight.state().lines.some(l => /Antares, Houston\. We copy the abort\./.test(l)));
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal((await state()).judged.outcome, 'abort');
  assert.equal(await page.textContent('#rTitle'), 'Abort');
  assert.match(await page.textContent('#rReason'), /ran dry/);

  // ---------- pause ----------
  await page.evaluate(() => window.contactLight.fly('a11'));
  await until(() => window.contactLight.state().screen === 'flight');
  await page.tap('#menuBtn');
  await page.locator('#pause').waitFor();
  const t0 = (await state()).t;
  await page.waitForTimeout(500);
  assert.equal((await state()).t, t0, 'paused means stopped');
  assert.equal(await page.evaluate(() => window.contactLight.drawing()), (await state()).key, 'the paused flight stays on screen behind the menu');
  assert.equal(await page.locator('#pause .jd-foot').isVisible(), true, 'the drawer link is in the menu');
  await page.tap('#resumeBtn');
  await until(t => window.contactLight.state().t > t, t0);
  await page.keyboard.press('Escape');
  await page.locator('#pause').waitFor();
  await page.tap('#quitBtn');
  await page.locator('#title').waitFor();
  await until(() => history.state === null); // the button took its step off the history

  // ---------- the phone's Back button ----------
  // Back on a briefing comes back to the list, Back mid-flight pauses, and Back on the pause menu
  // comes back to the list; none of them leaves the game.
  const back = () => page.evaluate(() => history.back());
  await page.tap('[data-site=a12]');
  await page.locator('#brief').waitFor();
  await back();
  await page.locator('#title').waitFor();
  await page.tap('[data-site=a12]');
  await page.tap('#goBtn');
  await until(() => window.contactLight.state().screen === 'flight' && window.contactLight.state().site === 'a12');
  await back();
  await page.locator('#pause').waitFor();
  assert.equal((await state()).screen, 'paused', 'Back mid-flight pauses');
  await back();
  await page.locator('#title').waitFor();
  assert.equal(page.url(), base, 'still in the game');

  // ---------- Arcade ----------
  await page.tap('[data-mode=arcade]');
  assert.match(await page.textContent('#modeNote'), /1979/);
  assert.equal(await page.locator('[data-site=a11] .medal.gold').count(), 0, 'Arcade keeps its own plaques');
  // Training in Arcade teaches the throttle lever, not the rate switch Arcade doesn't have.
  assert.equal(await page.locator('[data-site=ellington] .start').count(), 1, 'Start here, until Ellington is landed in Arcade too');
  await page.tap('[data-site=ellington]');
  await page.locator('#brief').waitFor();
  await page.tap('#goBtn');
  await until(() => window.contactLight.state().screen === 'flight' && window.contactLight.state().mode === 'arcade');
  await until(() => /This lever is the throttle/.test(document.getElementById('coachText').textContent));
  const [, , tl] = await centre('.lever-track');
  const bubble = await page.locator('#coach').boundingBox();
  assert.ok(bubble.y + bubble.height <= (await page.locator('#panel').boundingBox()).y, 'the hint sits above the panel, clear of the THROTTLE label');
  await touch('touchStart', [[tl.x + tl.width / 2, tl.y + tl.height * 0.62]]);
  await touch('touchMove', [[tl.x + tl.width / 2, tl.y + tl.height * 0.72]]);
  await touch('touchEnd', []);
  await until(() => /Push the throttle up past a third/.test(document.getElementById('coachText').textContent));
  await page.tap('#menuBtn');
  await page.tap('#quitBtn');
  await page.locator('#title').waitFor();
  await page.tap('[data-site=a11]');
  await page.locator('#brief').waitFor();
  await page.tap('#goBtn');
  await until(() => window.contactLight.state().screen === 'flight' && window.contactLight.state().mode === 'arcade');
  assert.equal(await page.locator('#lever').isVisible(), true, 'a throttle lever');
  assert.equal(await page.locator('#rod').isVisible(), false, 'and no rate switch');
  const [, , lb] = await centre('.lever-track');
  await touch('touchStart', [[lb.x + lb.width / 2, lb.y + lb.height - 10]]);
  await touch('touchMove', [[lb.x + lb.width / 2, lb.y + 12]]);
  await until(() => window.contactLight.state().throttle > 0.8);
  await touch('touchEnd', []);
  await page.evaluate(() => { window.contactLight.autopilot(true); window.contactLight.speed(6); });
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal((await state()).judged.outcome, 'landed');
  assert.ok((await store()).best.arcade.a11, 'an Arcade plaque');
  await page.tap('#sitesBtn');

  // ---------- Free flight ----------
  await page.tap('[data-mode=free]');
  await page.locator('#freePanel').waitFor();
  await until(() => window.contactLight.demo().site === 'free'); // its own ground flies behind the title
  assert.match(await page.textContent('#freeName'), /^Ground \d+$/);
  await page.tap('#freeNew');
  await page.tap('#freeGo');
  await until(() => window.contactLight.state().site === 'free' && window.contactLight.state().screen === 'flight');
  assert.match(await page.textContent('#hudName'), /^Ground \d+$/, 'the ground\'s number leads the name, so it shows beside the clock');
  await page.evaluate(() => { window.contactLight.autopilot(true); window.contactLight.speed(6); });
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal((await state()).judged.outcome, 'landed');
  assert.equal(await page.textContent('#nextBtn'), 'New ground');
  assert.equal((await store()).free.landed, 1);
  await page.tap('#sitesBtn');

  // ---------- settings are kept ----------
  await page.tap('#soundBtn');
  assert.equal(await page.getAttribute('#soundBtn', 'aria-pressed'), 'false');
  await page.reload();
  await page.waitForFunction(() => window.contactLight && window.contactLight.demo());
  assert.equal(await page.textContent('#soundBtn'), 'Sound off');
  assert.equal(await page.getAttribute('[data-mode=free]', 'aria-checked'), 'true', 'it comes back to the mode you left');

  // ---------- installable, and offline ----------
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, LONG);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, [], 'Chrome says it can’t install it');
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, [], 'the manifest has errors');
  assert.equal(JSON.parse(manifest.data).name, 'Contact Light');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.contactLight && window.contactLight.demo());
  await page.evaluate(() => window.contactLight.fly('a12'));
  await until(() => window.contactLight.state().screen === 'flight' && window.contactLight.state().t > 1);
  await ctx.setOffline(false);
  await noSideways('offline');
  await ctx.close();

  // ---------- a laptop ----------
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await desk.newPage();
  watch(dp);
  await dp.goto(base);
  await dp.waitForFunction(() => window.contactLight && window.contactLight.demo());
  assert.equal(await dp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on a laptop');
  const card = await dp.locator('#title .card').boundingBox();
  assert.ok(card.x < 200 && card.width <= 440, 'the site list sits to the left of the flight');
  await dp.click('[data-site=a17]');
  await dp.click('#goBtn');
  await dp.waitForFunction(() => window.contactLight.state().screen === 'flight');
  assert.equal(await dp.locator('#keys').isVisible(), true, 'the keys are listed');
  await dp.keyboard.press('ArrowUp');
  await dp.keyboard.press('ArrowUp');
  await dp.waitForFunction(() => window.contactLight.state().rate === -23);
  await dp.keyboard.down('ArrowLeft');
  await dp.waitForFunction(() => window.contactLight.state().th < -8);
  await dp.keyboard.up('ArrowLeft');
  await dp.waitForFunction(() => Math.abs(window.contactLight.state().th) < 1);
  // Falcon's line is long and the sky over a laptop is shallow: it still sits in the middle, clear of the Earth.
  await dp.evaluate(() => { window.contactLight.fly('a15'); window.contactLight.autopilot(true); window.contactLight.speed(6); });
  await dp.waitForFunction(() => !document.getElementById('moment').hidden, null, LONG);
  await dp.evaluate(() => window.contactLight.speed(0));
  const cap = await dp.locator('#moment').boundingBox(), earth = (await dp.evaluate(() => window.contactLight.scene())).earth;
  assert.ok(Math.abs(cap.x + cap.width / 2 - 640) < 2, `the landing's line is in the middle (${cap.x}, ${cap.width})`);
  assert.ok(earth[3] < cap.y || earth[1] > cap.y + cap.height || earth[2] < cap.x || earth[0] > cap.x + cap.width, 'and clear of the Earth');
  // A shorter laptop window, at Ellington: a shallow sky with no Earth in it. The line still finds its
  // place and the card still comes (it used to stop the game there).
  await dp.setViewportSize({ width: 1366, height: 600 });
  await dp.evaluate(() => { window.contactLight.fly('ellington'); window.contactLight.autopilot(true); window.contactLight.speed(6); });
  await dp.waitForFunction(() => !document.getElementById('moment').hidden, null, LONG);
  const low = await dp.locator('#moment').boundingBox();
  assert.ok(Math.abs(low.x + low.width / 2 - 683) < 2 && low.y >= (await dp.locator('#hud').boundingBox()).height, `Ellington's line is in the middle, under the numbers (${low.x}, ${low.y})`);
  await dp.waitForFunction(() => window.contactLight.state().screen === 'result', null, LONG);
  await desk.close();

  // ---------- the dust at Surveyor crater, and a phone on its side ----------
  // Apollo 12 came down in thick dust; the moment the engine stops, it's gone, and the LM's
  // shadow lies beside it. Held sideways, Houston's clock sits at the right, clear of the radio.
  const side = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const sp = await side.newPage();
  watch(sp);
  await sp.goto(base);
  await sp.waitForFunction(() => window.contactLight && window.contactLight.demo());
  await sp.evaluate(() => { window.contactLight.fly('a12'); window.contactLight.autopilot(true); window.contactLight.speed(4); });
  await sp.waitForFunction(() => window.contactLight.state().alt < 12, null, LONG);
  await sp.evaluate(() => window.contactLight.speed(1));
  await sp.waitForFunction(() => window.contactLight.scene().dust > 0.5, null, LONG);
  await sp.waitForFunction(() => window.contactLight.state().phase !== 'flying', null, LONG);
  await sp.waitForFunction(() => window.contactLight.scene().dust === 0, null, { timeout: 5000 });
  assert.equal((await sp.evaluate(() => window.contactLight.scene())).shadow, true, 'the shadow is on screen beside the LM');
  assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on its side');
  await sp.evaluate(() => { window.contactLight.fly('a14'); window.contactLight.setFuel(5.7); window.contactLight.speed(2); });
  await sp.waitForFunction(() => window.contactLight.state().low, null, LONG);
  await sp.evaluate(() => window.contactLight.speed(0));
  // The Triplet craters' names are ahead, low on the right: none runs under the corner controls.
  const corners = await sp.$$eval('#rod, #aca', els => els.map(e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }));
  for (const l of (await sp.evaluate(() => window.contactLight.scene())).labels.filter(q => q.alpha > 0.05)) {
    for (const [a, b, c, d] of corners) assert.ok(l.box[2] < a || l.box[0] > c || l.box[3] < b || l.box[1] > d, `${l.text} is under a control`);
  }
  const clock = await sp.locator('#clock').boundingBox();
  assert.ok(clock && clock.x > 844 / 2, `the clock is on the right (${clock && clock.x})`);
  for (const p of await sp.locator('#radio p').all()) {
    const b = await p.boundingBox();
    if (b) assert.ok(b.x + b.width < clock.x || b.y > clock.y + clock.height || b.y + b.height < clock.y, 'the clock is clear of the radio');
  }
  await side.close();

  // ---------- reading the calls aloud ----------
  // The browser's voice is swapped for a recorder. An iPhone only lets a page speak once it has
  // spoken during a tap, so the first thing said has to be said in one.
  const vc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await vc.addInitScript(() => {
    window.said = [];
    const voice = {
      speaking: false, pending: false, onvoiceschanged: null,
      speak(u) { window.said.push({ text: u.text, volume: u.volume, during: window.event ? window.event.type : null }); },
      cancel() { window.said.push({ cancel: true }); },
      getVoices() { return []; },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: voice, configurable: true });
  });
  const vp = await vc.newPage();
  watch(vp);
  await vp.goto(base);
  await vp.waitForFunction(() => window.contactLight && window.contactLight.demo());
  await vp.tap('#voiceBtn');
  assert.equal(await vp.getAttribute('#voiceBtn', 'aria-pressed'), 'true');
  assert.deepEqual(await vp.evaluate(() => window.said.find(s => 'text' in s)), { text: ' ', volume: 0, during: 'click' }, 'the voice is woken during the tap');
  await vp.tap('[data-site=a11]');
  await vp.tap('#goBtn');
  await vp.waitForFunction(() => window.said.some(s => /^Eagle, Houston/.test(s.text || '')), null, LONG);
  await vp.tap('#menuBtn');
  const saidBefore = await vp.evaluate(() => window.said.length);
  await vp.tap('#voiceBtn2');
  assert.ok(await vp.evaluate(n => window.said.slice(n).some(s => s.cancel), saidBefore), 'turning the voice off stops it');
  await vc.close();

  assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'no errors, and nothing loaded from anywhere else');
} finally {
  await browser.close();
  server.close();
}
console.log('contact light e2e: all passed');
