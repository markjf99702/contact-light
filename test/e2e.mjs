// Flies Contact Light in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Learns the controls at Ellington with real taps and drags, lands at Tranquility Base, crashes,
// aborts, tries Arcade and Free flight, checks the plaques are kept, and plays once more offline.
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
  assert.equal(await page.locator('#coach').isVisible(), true, 'training shows hints');
  assert.match(await page.textContent('#coachText'), /Tap ▼ three times/);
  for (let k = 0; k < 3; k++) { await page.tap('#rodDown'); await page.waitForTimeout(120); }
  await until(() => window.contactLight.state().rate === -3);
  assert.equal(await page.textContent('#rodRead'), 'DOWN 3');
  await until(() => /drag the hand controller right/.test(document.getElementById('coachText').textContent));
  await until(() => Math.abs(window.contactLight.state().vy + 3) < 0.3);
  assert.match(await page.textContent('#roRateLbl'), /DOWN/);

  // Hold the hand controller over to the right: the LM leans over and speeds up.
  const [ax, ay, ab] = await centre('#acaTrack');
  await touch('touchStart', [[ax, ay]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[ax + (ab.width / 2 - 8) * k / 6, ay]]);
  await until(() => window.contactLight.state().th > 15);
  await until(() => window.contactLight.state().vx > 6);
  // A second thumb clicks the rate switch while the first holds the controller.
  await touch('touchStart', [[ax + ab.width / 2 - 8, ay], [...(await centre('#rodUp')).slice(0, 2)]]);
  await touch('touchEnd', [[ax + ab.width / 2 - 8, ay]]);
  await until(() => window.contactLight.state().rate === -2);
  assert.ok((await state()).th > 15, 'still leaning while the other thumb works the rate switch');
  await touch('touchEnd', []);
  await until(() => Math.abs(window.contactLight.state().th) < 1);
  const vx = (await state()).vx;
  await page.waitForTimeout(800);
  assert.ok(Math.abs((await state()).vx - vx) < 0.4, 'let go, it stands upright and coasts');
  await until(() => /Drag it left to slow down/.test(document.getElementById('coachText').textContent));
  // The keyboard works too.
  await page.keyboard.press('ArrowUp');
  await until(() => window.contactLight.state().rate === -1);
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
  await page.tap('#goBtn');
  await until(() => window.contactLight.state().site === 'a11' && window.contactLight.state().screen === 'flight');
  await until(() => window.contactLight.state().lines.some(l => /Eagle, Houston\. You're go for landing\./.test(l)));
  assert.equal(await page.locator('#lampContact').getAttribute('class'), 'lamp blue', 'the contact light is off');
  await page.evaluate(() => { window.contactLight.autopilot(true); window.contactLight.speed(6); });
  await until(() => window.contactLight.state().contact);
  assert.match(await page.locator('#lampContact').getAttribute('class'), /\bon\b/, 'contact light!');
  await until(() => window.contactLight.state().lines.some(l => /Contact light\./.test(l)));
  await until(() => window.contactLight.state().lines.some(l => /The Eagle has landed\./.test(l)));
  await until(() => window.contactLight.state().screen === 'result');
  const r11 = await state();
  assert.equal(r11.judged.outcome, 'landed');
  assert.equal(r11.judged.tier, 'gold', 'the autopilot earns gold at Tranquility Base');
  assert.ok(r11.record.down < 3 && r11.record.side < 1, 'a soft landing');
  assert.match(await page.textContent('#plaque'), /TRANQUILITY BASE/);
  assert.match(await page.textContent('#rReason'), /Contact light at 102:4\d:\d\d; Eagle’s came on at 102:45:40\./, 'your contact light against Eagle\'s');
  assert.ok(await page.locator('#loopList li').count() > 8, 'the landing as a transcript');
  assert.match(await page.textContent('#loopList'), /102:43:22Duke: Eagle, Houston\. You’re go for landing\./, 'stamped from when Armstrong took over');
  assert.match(await page.textContent('#loopList'), /Armstrong: Houston, Tranquility Base here\. The Eagle has landed\./);

  await page.tap('#sitesBtn');
  await page.locator('#title').waitFor();
  assert.equal(await page.locator('[data-site=a11] .medal.gold').count(), 1, 'the gold plaque shows in the list');
  await page.reload();
  await page.waitForFunction(() => window.contactLight && window.contactLight.demo());
  assert.equal(await page.locator('[data-site=a11] .medal.gold').count(), 1, 'and is still there after a reload');

  // ---------- a hard landing ----------
  await page.evaluate(() => window.contactLight.fly('ellington'));
  await until(() => window.contactLight.state().screen === 'flight');
  for (let k = 0; k < 14; k++) await page.tap('#rodDown');
  await until(() => window.contactLight.state().rate <= -12);
  await page.evaluate(() => window.contactLight.speed(4));
  await until(() => window.contactLight.state().screen === 'result');
  assert.equal((await state()).judged.outcome, 'crash');
  assert.equal(await page.textContent('#rTitle'), 'Hard landing');
  assert.match(await page.textContent('#rReason'), /The legs were built for 10/);
  assert.equal(await page.locator('#plaque').isVisible(), false, 'no plaque for a crash');
  assert.equal(await page.textContent('#againBtn'), 'Try again');

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

  // ---------- Arcade ----------
  await page.tap('[data-mode=arcade]');
  assert.match(await page.textContent('#modeNote'), /1979/);
  assert.equal(await page.locator('[data-site=a11] .medal.gold').count(), 0, 'Arcade keeps its own plaques');
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
  assert.match(await page.textContent('#freeName'), /^Ground \d+$/);
  await page.tap('#freeNew');
  await page.tap('#freeGo');
  await until(() => window.contactLight.state().site === 'free' && window.contactLight.state().screen === 'flight');
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

  // ---------- offline ----------
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, LONG);
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
  await desk.close();

  assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'no errors, and nothing loaded from anywhere else');
} finally {
  await browser.close();
  server.close();
}
console.log('contact light e2e: all passed');
