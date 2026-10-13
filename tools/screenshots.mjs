// Renders the README screenshots (docs/phone-*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded and the autopilot flies, so the pictures come out much the same every time.
// Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
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
const SEED = 7;
const LONG = { timeout: 120000 };
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// Saves a screenshot with fewer colours, which keeps the dust and the cratered ground a fraction of the
// size. The README shows its pictures at a third of their size, where 256 colours look the same as all of
// them; the link preview is seen full size, and needs about a thousand to keep the lamp's glow smooth.
async function save(page, path, colours) {
  const img = UPNG.decode(await page.screenshot());
  await writeFile(join(root, path), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, colours)));
}

async function open(viewport, deviceScaleFactor, phone = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, isMobile: phone, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => window.contactLight && window.contactLight.demo());
  return page;
}

// Fly a site with the autopilot until test(state) holds, then hold the clock still there.
async function flyTo(page, id, test, speed = 4) {
  await page.evaluate(([id, speed]) => { window.contactLight.speed(1); window.contactLight.fly(id); window.contactLight.autopilot(true); window.contactLight.speed(speed); }, [id, speed]);
  await page.waitForFunction(test, null, LONG);
  await page.evaluate(() => window.contactLight.speed(0));
}

// Phone screenshots for the README: low over Tranquility Base in the dust, the landing's own line,
// and the plaque.
{
  const page = await open({ width: 390, height: 844 }, 2, true);
  await flyTo(page, 'a11', () => { const s = window.contactLight.state(); return s.alt < 30 && Math.abs(s.vx) < 0.5; });
  await page.waitForTimeout(700); // the dust fills in
  await save(page, 'docs/phone-flight.png', 256);
  await page.evaluate(() => window.contactLight.speed(3));
  await page.waitForFunction(() => !document.getElementById('moment').hidden, null, LONG);
  await page.evaluate(() => window.contactLight.speed(0));
  await page.waitForTimeout(1400); // the line fades in
  await save(page, 'docs/phone-landed.png', 256);
  await page.evaluate(() => window.contactLight.speed(6));
  await page.waitForFunction(() => window.contactLight.state().screen === 'result', null, LONG);
  await page.waitForTimeout(500);
  await save(page, 'docs/phone-plaque.png', 256);
  await page.context().close();
}

// Link preview, 1200 x 630: a card in the title's own look, the name and one line on the left and a
// real frame from the game on the right.
{
  // The frame: Apollo 11's briefing flies the landing behind it, drawn without the marks and pointers.
  const shot = await open({ width: 1100, height: 630 }, 2);
  await shot.click('[data-site=a11]');
  await shot.evaluate(() => window.contactLight.speed(4));
  await shot.waitForFunction(() => { const d = window.contactLight.demo(); return d.site === 'a11' && d.alt < 13 && Math.abs(d.vx) < 0.3; }, null, LONG);
  await shot.evaluate(() => window.contactLight.speed(0));
  await shot.waitForTimeout(700); // the dust fills in
  const scene = await shot.evaluate(() => document.getElementById('scene').toDataURL('image/png'));
  await shot.context().close();

  const font = async f => `data:font/woff2;base64,${(await readFile(join(root, 'fonts', f))).toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Jost; src: url(${await font('jost.woff2')}) format('woff2'); font-weight: 300 700; }
    @font-face { font-family: B612M; src: url(${await font('b612-mono-700.woff2')}) format('woff2'); font-weight: 700; }
    html, body { margin: 0; width: 1200px; height: 630px; background: #030304; overflow: hidden; }
    /* Landing, the camera keeps the LM about 30% in from the left of the frame; this puts it at about 880. */
    .scene { position: absolute; left: 550px; top: 0; width: 1100px; height: 630px; background: url(${scene}) 0 0 / 1100px 630px; }
    .scene::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, #030304 0%, rgba(3, 3, 4, 0) 16%); }
    .text { position: absolute; left: 72px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; color: #ece8df; font-family: Jost; }
    .lamp { width: 96px; height: 36px; border-radius: 9px; border: 2px solid #000; background: radial-gradient(circle at 50% 40%, #d6efff, #55baff 58%, #1d6fb8); box-shadow: 0 0 30px rgba(85, 186, 255, .9), 0 0 80px rgba(85, 186, 255, .45); }
    h1 { margin: 32px 0 0; font: 600 54px/1 Jost; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; text-shadow: 0 2px 20px #030304; }
    p { margin: 20px 0 0; font: 400 29px/1.3 Jost; color: rgba(236, 232, 223, .8); text-shadow: 0 2px 16px #030304; }
    .clock { margin-top: 30px; font: 700 17px B612M; letter-spacing: .12em; color: #55baff; }
    .clock i { font-style: normal; margin: 0 -.32em 0 -.04em; }
  </style></head><body>
    <div class="scene"></div>
    <div class="text">
      <div class="lamp"></div>
      <h1>Contact Light</h1>
      <p>Land on the Moon the way Armstrong did, a click at a time.</p>
      <div class="clock">102<i>:</i>45<i>:</i>40 · ALDRIN · CONTACT LIGHT</div>
    </div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await save(page, 'og.png', 1024);
  await page.close();
}

await browser.close();
server.close();
console.log('screenshots written');
