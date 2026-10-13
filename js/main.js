// Contact Light: the page. Screens (title, briefing, flight, pause, result), the controls, the loop
// that steps the flight at a fixed 60 Hz, the radio, and the attract flight behind the title.

import { SITES, siteById } from './sites.js';
import { buildGround } from './terrain.js';
import { createFlight, step, altitude, pct, finish, BINGO_AFTER_LOW, LAND_AFTER_BINGO } from './sim.js';
import { judge, feet } from './judge.js';
import { createRadio, radioUpdate, openingLines, endingLines } from './calls.js';
import { createAutopilot, autopilotInput } from './autopilot.js';
import { createRenderer, resizeRenderer, renderFrame, burst, bump } from './render.js';
import { drawProfile } from './strip.js';
import * as sound from './sound.js';
import { load, save, recordLanding } from './store.js';
import { plaqueSVG } from './plaque.js';
import { makeFreeSite } from './freeflight.js';
import { createCoach, coachUpdate } from './coach.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const STEP = 1 / 60;
const MISSIONS = SITES.filter(s => !s.training);

const store = load();
let mode = store.settings.mode;
let screen = 'title';
let cur = null; // the flight you're flying
let demo = null; // the attract flight behind the title and briefing
let speed = 1; // test hook: run the clock faster
let free = null; // the Free flight ground in hand
let briefSite = null;
let demoIndex = 0;

const grounds = new Map();
function groundFor(site) {
  if (site.free) return free.ground;
  if (!grounds.has(site.id)) grounds.set(site.id, buildGround({ ...site.ground, sun: site.sun }));
  return grounds.get(site.id);
}

const r = createRenderer($('scene'));
sound.setSound(store.settings.sound);
sound.setVoice(store.settings.voice);

// ---------- the controls ----------

const input = { pad: 0, rod: 0, throttle: 0, rotate: 0 };
const held = { pad: null, lever: null, keys: new Set() };
let keyTilt = 0;

function rodClick(d) {
  if (!cur || screen !== 'flight' || cur.f.phase !== 'flying') return;
  sound.unlock();
  if (cur.mode === 'arcade') { setThrottle(input.throttle + d * 0.05); return; }
  input.rod += d;
  sound.play('click');
  const b = d > 0 ? $('rodUp') : $('rodDown');
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 110);
}
for (const [id, d] of [['rodUp', 1], ['rodDown', -1]]) {
  $(id).addEventListener('pointerdown', e => { e.preventDefault(); rodClick(d); });
  $(id).addEventListener('click', e => { if (e.detail === 0) rodClick(d); }); // keyboard Enter/Space on the button
}

// The hand controller: where you hold it along its track is the tilt (or in Arcade, the turn rate).
const track = $('acaTrack');
function padFrom(e) {
  const b = track.getBoundingClientRect();
  const half = b.width / 2 - 29;
  return Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / Math.max(20, half)));
}
track.addEventListener('pointerdown', e => {
  e.preventDefault();
  sound.unlock();
  held.pad = e.pointerId;
  track.setPointerCapture(e.pointerId);
  setPad(padFrom(e));
});
track.addEventListener('pointermove', e => { if (held.pad === e.pointerId) setPad(padFrom(e)); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  track.addEventListener(ev, e => { if (held.pad === e.pointerId) { held.pad = null; setPad(0); } });
}
function setPad(v) {
  if (cur && cur.mode === 'arcade') input.rotate = v;
  else input.pad = v;
}

// Arcade's throttle lever.
const lever = $('lever').querySelector('.lever-track');
function leverFrom(e) {
  const b = lever.getBoundingClientRect();
  return 1 - Math.max(0, Math.min(1, (e.clientY - b.top - 11) / Math.max(10, b.height - 22)));
}
lever.addEventListener('pointerdown', e => { e.preventDefault(); sound.unlock(); held.lever = e.pointerId; lever.setPointerCapture(e.pointerId); setThrottle(leverFrom(e)); });
lever.addEventListener('pointermove', e => { if (held.lever === e.pointerId) setThrottle(leverFrom(e)); });
for (const ev of ['pointerup', 'pointercancel']) lever.addEventListener(ev, e => { if (held.lever === e.pointerId) held.lever = null; });
function setThrottle(v) { input.throttle = Math.max(0, Math.min(1, Math.round(v * 100) / 100)); }

addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const k = e.key;
  if (screen === 'flight') {
    // The rate switch clicks once a press; Arcade's throttle keeps moving while the key is held.
    const repeatOk = cur && cur.mode === 'arcade';
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); if (!e.repeat || repeatOk) rodClick(1); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); if (!e.repeat || repeatOk) rodClick(-1); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'A' || k === 'd' || k === 'D') { e.preventDefault(); held.keys.add(k.toLowerCase().replace('arrow', '')); sound.unlock(); }
    else if (k === 'Escape' || k === 'p' || k === 'P') { e.preventDefault(); pause(); }
  } else if (screen === 'paused' && (k === 'Escape' || k === 'p' || k === 'P')) { e.preventDefault(); resume(); }
  else if (screen === 'ending' && (k === 'Enter' || k === ' ')) { e.preventDefault(); showResult(); }
});
addEventListener('keyup', e => held.keys.delete(e.key.toLowerCase().replace('arrow', '')));
addEventListener('blur', () => held.keys.clear());

// Held arrow keys tilt the LM further the longer you hold them, and it rights itself when you let go.
function keyInput(dt) {
  const left = held.keys.has('left') || held.keys.has('a'), right = held.keys.has('right') || held.keys.has('d');
  const want = left && !right ? -1 : right && !left ? 1 : 0;
  if (want) keyTilt = Math.max(-1, Math.min(1, keyTilt + want * dt * 1.6));
  else keyTilt = 0;
  if (held.pad == null && (want || keyTilt === 0)) setPad(keyTilt);
}

// ---------- flights ----------

function newFlight(site, m, opts = {}) {
  const g = groundFor(site);
  const f = createFlight(site, g, m === 'arcade' ? 'arcade' : 'p66');
  return {
    site, g, f, mode: m,
    key: `${site.id}-${site.seed || ''}-${Date.now()}-${Math.random()}`,
    radio: createRadio(site),
    lines: [], pending: [], ended: false, judged: null, endT: 0, ending: null,
    ap: opts.autopilot ? createAutopilot(site, g, f.veh, m === 'arcade' ? 'arcade' : 'p66') : null,
    coach: site.training && !opts.autopilot ? createCoach() : null,
    demo: !!opts.demo,
    jetT: 0,
  };
}

function startFlight(site, m = mode) {
  sound.unlock();
  sound.stopSpeech();
  cur = newFlight(site, m);
  Object.assign(input, { pad: 0, rod: 0, throttle: m === 'arcade' ? Math.round(cur.f.thr * 100) / 100 : 0, rotate: 0 });
  keyTilt = 0;
  held.keys.clear();
  for (const l of openingLines(site)) cur.pending.push({ ...l, at: l.at });
  $('hudName').textContent = site.free ? 'Free flight' : site.name;
  $('hudPlace').textContent = site.free ? `${site.place} · ground ${site.seed}` : site.place;
  $('radio').textContent = '';
  $('lampLow').classList.remove('on');
  $('lampContact').classList.remove('on');
  $('clock').hidden = true;
  $('rod').hidden = m === 'arcade';
  $('lever').hidden = m !== 'arcade';
  $('acaLbl').textContent = m === 'arcade' ? 'ROTATE' : 'HAND CONTROLLER';
  $('keys').textContent = m === 'arcade' ? '↑ ↓ throttle · ← → rotate · Esc menu' : '↑ ↓ rate · ← → tilt · Esc menu';
  store.flights++;
  if (site.free) store.free.flown++;
  save(store);
  show('flight');
}

function show(name) {
  screen = name;
  const flying = name === 'flight' || name === 'paused' || name === 'ending';
  $('hud').hidden = !flying;
  $('panel').hidden = !flying;
  $('title').hidden = name !== 'title';
  $('brief').hidden = name !== 'brief';
  $('pause').hidden = name !== 'paused';
  $('result').hidden = name !== 'result';
  $('skipBtn').hidden = name !== 'ending';
  $('coach').hidden = true;
  if (!flying) sound.engine(0);
  layout();
}

// The part of the screen the camera frames: between the numbers and the panel in flight, the open
// sky above the title card on a phone.
let view = { top: 0, bottom: 600 };
function layout() {
  resizeRenderer(r, innerWidth, innerHeight);
  if (!$('hud').hidden) {
    const hb = $('hud').getBoundingClientRect().bottom;
    // On a phone on its side the controls sit in the corners, so the flight runs down to the lamps.
    const corners = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
    let pt = (corners ? $('panel').querySelector('.lamps') : $('panel')).getBoundingClientRect().top - (corners ? 6 : 0);
    // Training's hints sit just above the panel: keep the ground clear of them.
    if (cur && cur.coach) pt -= 92;
    view = { top: Math.max(0, hb - (corners ? 0 : 34)), bottom: Math.max(hb + 120, pt) };
  } else if (screen === 'title' && innerWidth < 760) {
    const sheet = $('title'), keep = sheet.scrollTop;
    sheet.scrollTop = 0;
    const top = sheet.querySelector('.brand').getBoundingClientRect().bottom;
    const bottom = sheet.querySelector('.card').getBoundingClientRect().top;
    sheet.scrollTop = keep;
    view = { top: top - 10, bottom: Math.max(top + 160, bottom + 30) };
  } else if (screen === 'title') {
    view = { top: 40, bottom: innerHeight - 30, shift: Math.min(300, innerWidth * 0.2), lead: 0.25 };
  } else if (screen === 'brief' && innerWidth < 760) {
    view = { top: 0, bottom: innerHeight * 0.42 };
  } else view = { top: 20, bottom: innerHeight - 20 };
}
addEventListener('resize', layout);

// ---------- the loop ----------

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const running = cur && ['flight', 'paused', 'ending', 'result'].includes(screen) ? cur : demo;
  if (running && screen !== 'paused') {
    acc += dt * speed;
    let n = 0;
    while (acc >= STEP && n < 1200) { tick(running, STEP); acc -= STEP; n++; }
    if (n >= 1200) acc = 0;
  } else acc = 0;
  if (running) draw(running, dt);
  requestAnimationFrame(frame);
}

function tick(c, dt) {
  const f = c.f;
  let inp;
  if (c.ap) inp = autopilotInput(c.ap, f);
  else { keyInput(dt); inp = { ...input }; input.rod = 0; }
  const events = step(f, inp, dt);
  if (c.demo) {
    if (f.phase !== 'flying') {
      c.endT += dt;
      if (c.endT > 4.5) nextDemo();
    }
    return;
  }
  const alt = altitude(f);
  const state = { alt, rate: f.vy, fwd: f.vx, pct: pct(f), t: f.t, dustOn: r.dustI > 0.12, thickDust: r.dustI > 0.7 && c.site.dust.thick >= 5, shadowSeen: !!r.shadowSeen };
  for (const l of radioUpdate(c.radio, f, events, state)) {
    if (l.at) c.pending.push({ ...l, at: f.t + l.at });
    else say(c, l);
  }
  for (const e of events) onEvent(c, e);
  // Lines waiting for their moment.
  const now = c.ended ? c.endT : f.t;
  if (c.pending.length) {
    const due = c.pending.filter(l => l.at <= now);
    if (due.length) {
      c.pending = c.pending.filter(l => l.at > now);
      due.forEach(l => say(c, l));
    }
  }
  if (c.ended) {
    c.endT += dt;
    if (screen === 'ending' && c.ending && c.endT >= c.ending.card) showResult();
  }
}

function onEvent(c, e) {
  const f = c.f;
  switch (e.type) {
    case 'contact':
      $('lampContact').classList.add('on');
      sound.play('contact');
      break;
    case 'lowLevel':
      $('lampLow').classList.add('on');
      sound.play('lamp');
      $('clock').hidden = false;
      break;
    case 'touchdown':
    case 'abort': {
      const j = judge(e.record, c.site);
      c.judged = j;
      c.record = e.record;
      c.ended = true;
      c.endT = 0;
      if (e.type === 'touchdown') {
        finish(f, j.outcome);
        if (j.outcome === 'crash') { burst(r, f); sound.play('crash'); }
        else if (e.record.down > 5) { bump(r, 6); sound.play('hard'); }
        else { bump(r, 2); sound.play('thud'); }
      } else sound.play('abort');
      sound.engine(0);
      $('lampContact').classList.toggle('on', j.outcome === 'landed' || $('lampContact').classList.contains('on'));
      c.ending = endingLines(c.site, j);
      c.pending = c.pending.filter(l => l.big); // drop calls that hadn't been made
      for (const l of c.ending.lines) c.pending.push({ ...l, at: l.at });
      if (j.ok) {
        if (c.site.free) { store.free.landed++; if (j.tier === 'gold') store.free.gold++; }
        else c.newBest = recordLanding(store, c.mode, c.site.id, j, e.record);
        save(store);
      }
      show('ending');
      break;
    }
  }
}

function say(c, l) {
  const box = $('radio');
  const p = document.createElement('p');
  if (l.role === 'capcom') p.classList.add('capcom');
  if (l.big) p.classList.add('big');
  const b = document.createElement('b');
  b.textContent = String(l.who || '').toUpperCase();
  p.append(b, document.createTextNode(l.text.replace(/[’‘]/g, "'")));
  box.append(p);
  while (box.children.length > (innerWidth < 600 ? 2 : 3)) box.firstChild.remove();
  const ps = [...box.children];
  ps.forEach((el, k) => { el.classList.toggle('old', k === ps.length - 2); el.classList.toggle('older', k < ps.length - 2); });
  if (!c.demo) sound.radioLine(l);
}

// ---------- drawing and the numbers ----------

let stripTick = 0;
function draw(c, dt) {
  const cam = renderFrame(r, { key: c.key, site: c.site, g: c.g, f: c.f, view, dt, marks: !c.demo });
  if (c.demo || $('hud').hidden) return;
  const f = c.f;
  const alt = Math.max(0, altitude(f));
  const fly = f.phase === 'flying';
  setNum('roAlt', alt >= 10 ? String(Math.round(alt)) : alt.toFixed(1));
  const vy = fly ? f.vy : 0, vx = fly ? f.vx : 0;
  setText('roRateLbl', vy > 0.05 ? 'UP' : 'DOWN');
  setNum('roRate', Math.abs(vy).toFixed(1));
  setText('roFwdLbl', vx < -0.05 ? 'BACK' : 'FWD');
  setNum('roFwd', Math.abs(vx) >= 10 ? String(Math.round(Math.abs(vx))) : Math.abs(vx).toFixed(1));
  setNum('roFuel', pct(f).toFixed(1));
  flag('roRate', fly && alt < 40 && -vy > 9 ? 'bad' : fly && alt < 70 && -vy > 5 ? 'warn' : '');
  flag('roFwd', fly && alt < 15 && Math.abs(vx) > 4 ? 'bad' : fly && alt < 40 && Math.abs(vx) > 2 ? 'warn' : '');
  const since = f.lowAt == null ? null : f.t - f.lowAt;
  flag('roFuel', since == null ? '' : since >= BINGO_AFTER_LOW ? 'bad' : 'warn');
  // The clock Houston starts at the low-level light: time to Bingo, then time to land.
  if (since != null && fly) {
    const toBingo = BINGO_AFTER_LOW - since;
    const left = toBingo > 0 ? toBingo : toBingo + LAND_AFTER_BINGO;
    setText('clockTime', `${Math.floor(Math.max(0, left) / 60)}:${String(Math.floor(Math.max(0, left) % 60)).padStart(2, '0')}`);
    $('clock').firstElementChild.textContent = toBingo > 0 ? 'BINGO' : 'LAND';
    $('clock').classList.toggle('urgent', toBingo <= 30);
  }
  if (c.mode === 'arcade') {
    setText('leverRead', `${Math.round(input.throttle * 100)}%`);
    $('leverKnob').style.bottom = `${input.throttle * (lever.clientHeight - 24)}px`;
    $('leverFill').style.height = `${Math.max(0, f.thr * (lever.clientHeight - 12))}px`;
  } else {
    const rc = f.rateCmd;
    setText('rodRead', rc < 0 ? `DOWN ${-rc}` : rc > 0 ? `UP ${rc}` : 'HOLD');
  }
  // The hand controller follows your thumb; the green needle is where the LM actually is.
  const tw = track.clientWidth / 2 - 29;
  const v = c.mode === 'arcade' ? input.rotate : input.pad;
  $('acaKnob').style.transform = `translateX(${v * tw}px)`;
  const tilt = f.th / DEG;
  const lim = c.mode === 'arcade' ? 90 : 20;
  $('acaNeedle').style.transform = `translateX(${Math.max(-1, Math.min(1, tilt / lim)) * (track.clientWidth / 2 - 10)}px)`;
  setText('acaRead', Math.abs(tilt) < 0.5 ? 'UPRIGHT' : tilt < 0 ? `← ${Math.round(-tilt)}°` : `${Math.round(tilt)}° →`);
  // Sound.
  sound.engine(fly && screen === 'flight' ? f.thr : 0);
  c.jetT -= dt;
  if (fly && f.jets > 0.35 && c.jetT <= 0) { sound.play('jets'); c.jetT = 0.14; }
  // The strip, a few times a second is plenty.
  if (++stripTick % 3 === 0) drawProfile($('strip'), c.g, c.site, { f, view: [cam.cx - r.W / 2 / cam.s, cam.cx + r.W / 2 / cam.s] });
  // Training hints.
  if (c.coach && fly) {
    const st = coachUpdate(c.coach, f, c.site, alt);
    const box = $('coach');
    box.hidden = false;
    setText('coachText', st.text);
    const target = st.at === 'rod' ? $('rod') : st.at === 'aca' ? $('aca') : null;
    if (target) {
      const tb = target.getBoundingClientRect(), bb = box.getBoundingClientRect();
      box.style.setProperty('--arrow', `${Math.max(16, Math.min(bb.width - 16, tb.left + tb.width / 2 - bb.left))}px`);
    } else box.style.setProperty('--arrow', '-100px');
  } else if (c.coach) $('coach').hidden = true;
}

const texts = {};
function setText(id, t) { if (texts[id] !== t) { texts[id] = t; $(id).textContent = t; } }
// A monospaced point takes a whole digit's room; pull it in so 14.0 doesn't read as 14. 0.
function setNum(id, t) {
  if (texts[id] === t) return;
  texts[id] = t;
  const el = $(id), i = t.indexOf('.');
  if (i < 0) { el.textContent = t; return; }
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.textContent = '.';
  el.replaceChildren(t.slice(0, i), dot, t.slice(i + 1));
}
function flag(id, cls) { const el = $(id); el.classList.toggle('warn', cls === 'warn'); el.classList.toggle('bad', cls === 'bad'); }

// ---------- the attract flight ----------

function nextDemo(site) {
  const pick = site || MISSIONS[demoIndex++ % MISSIONS.length];
  demo = newFlight(pick, 'p66', { autopilot: true, demo: true });
}

// ---------- title ----------

const MODE_NOTES = {
  p66: 'The way the crews flew it: the computer holds the descent rate you click, and you tilt to steer.',
  arcade: 'The 1979 way: raw throttle and rotation, nothing holding you up but you.',
  free: 'New ground every time, with something wrong at the target and fuel to match.',
};

function renderTitle() {
  for (const b of $('modes').children) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  $('modeNote').textContent = MODE_NOTES[mode];
  $('sites').hidden = mode === 'free';
  $('freePanel').hidden = mode !== 'free';
  if (mode === 'free') { renderFree(); return; }
  const best = store.best[mode];
  $('sites').replaceChildren(...SITES.map(s => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'site';
    b.dataset.site = s.id;
    const e = best[s.id];
    b.innerHTML = `<span><span class="nm">${s.name} <span>· ${s.place}</span></span><span class="sub">${s.training ? 'Learn the controls in the LLTV' : `${s.craft} · ${s.date}`}</span></span><span class="medal ${e ? e.tier : ''}" aria-label="${e ? e.tier + ' plaque' : 'no plaque yet'}">${e ? e.tier[0].toUpperCase() : ''}</span>`;
    b.addEventListener('click', () => showBrief(s));
    li.append(b);
    return li;
  }));
}

for (const b of $('modes').children) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    store.settings.mode = mode;
    save(store);
    renderTitle();
  });
}

function renderFree() {
  if (!free) rollFree(store.free.seed || 1 + Math.floor(Math.random() * 9999));
  const s = free.site;
  setText('freeName', `Ground ${s.seed}`);
  setText('freeKind', `· ${s.place} · ${s.start.alt} ft up, ${s.start.vx} ft/s forward`);
  drawProfile($('freeProfile'), free.ground, s, { start: true });
  const fs = store.free;
  setText('freeStats', fs.landed ? `${fs.landed} landed${fs.gold ? `, ${fs.gold} gold` : ''} out of ${fs.flown} flown.` : fs.flown ? `${fs.flown} flown, none landed yet.` : 'Every roll has been landed by the autopilot first, so it can be done.');
}

function rollFree(seed) {
  let made = null;
  for (let k = 0; k < 20 && !made; k++) made = makeFreeSite(seed + k);
  free = made || makeFreeSite(1); // ground 1 is known to fly
  if (!free) return;
  store.free.seed = free.site.seed;
  save(store);
}

$('freeGo').addEventListener('click', () => startFlight(free.site, 'p66'));
$('freeNew').addEventListener('click', () => { rollFree(1 + Math.floor(Math.random() * 99999)); renderFree(); nextDemo(free.site); });

function showTitle() {
  show('title');
  renderTitle();
  if (!demo || demo.site.free || demo.site.training) nextDemo();
}

// ---------- briefing ----------

function showBrief(site) {
  briefSite = site;
  show('brief');
  nextDemo(site);
  $('bMission').textContent = site.training ? 'Training · LLTV' : `${site.name} · ${site.craft}`;
  $('bPlace').textContent = site.training ? 'Ellington' : site.place;
  $('bMeta').textContent = site.training ? site.region : `${site.region} · ${site.date} · ${site.crew}`;
  $('bText').textContent = site.brief;
  $('bHistory').textContent = site.history;
  const t = site.target.tiers;
  $('bGoals').textContent = `Gold: within ${feet(t[0])} of the ${site.target.label === 'SURVEYOR 3' ? 'Surveyor' : site.target.label === 'PAD' ? 'pad' : 'target'}, 3 ft/s or softer, upright and level, nothing under the footpads${site.training ? '' : ', and down before Houston’s 30-second call'}.`;
  const e = store.best[mode === 'arcade' ? 'arcade' : 'p66'][site.id];
  $('bBest').textContent = e ? `Your best${mode === 'arcade' ? ' in Arcade' : ''}: ${e.tier}, ${e.down} ft/s down, ${feet(e.dist)} away.` : '';
  $('goBtn').textContent = mode === 'arcade' ? 'Take over (Arcade)' : 'Take over';
  requestAnimationFrame(() => drawProfile($('bProfile'), groundFor(site), site, { labels: true, start: true }));
}
$('goBtn').addEventListener('click', () => startFlight(briefSite, mode === 'free' ? 'p66' : mode));
$('backBtn').addEventListener('click', showTitle);

// ---------- pause ----------

function pause() {
  if (screen !== 'flight') return;
  show('paused');
  sound.engine(0);
  sound.stopSpeech();
  const s = cur.site;
  $('pauseMeta').textContent = s.free ? `Free flight · ground ${s.seed}` : `${s.name} · ${s.place}`;
}
function resume() { if (screen === 'paused') { show('flight'); last = performance.now(); } }
$('menuBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', () => startFlight(cur.site, cur.mode));
$('quitBtn').addEventListener('click', () => { cur = null; showTitle(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (screen === 'flight') pause(); sound.engine(0); } });

// ---------- the result ----------

function showResult() {
  if (screen !== 'ending' || !cur) return;
  const c = cur, j = c.judged, rec = c.record, s = c.site;
  show('result');
  $('plaque').innerHTML = j.ok ? plaqueSVG({ tier: j.tier, site: s, rec, mode: s.free ? 'free' : c.mode }) : '';
  $('plaque').hidden = !j.ok;
  $('rTitle').textContent = j.ok ? `${j.tier[0].toUpperCase()}${j.tier.slice(1)} plaque` : j.title;
  const where = s.free ? `ground ${s.seed}` : s.training ? 'Ellington' : s.place;
  $('rReason').textContent = j.ok
    ? (c.newBest ? `Your best at ${where} so far.` : `Landed at ${where}.`)
    : j.reason;
  const rows = $('rRows');
  rows.replaceChildren(...j.rows.map(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.label}</td><td class="v">${row.value}${row.note ? `<small>${row.note}</small>` : ''}</td><td><span class="tier ${row.tier}">${row.tier === 'fail' ? 'no' : row.tier}</span></td>`;
    return tr;
  }));
  rows.hidden = !j.rows.length;
  // What to fly better next time: the first number that kept the plaque down, or the reason it failed.
  let tip = j.tip;
  if (j.ok && j.tier !== 'gold') {
    const weak = j.rows.find(row => row.tier === j.tier);
    tip = weak ? `For a better plaque: ${weak.label.toLowerCase()}, ${weak.need}.` : '';
  } else if (j.ok) tip = s.training ? 'You’re ready. Apollo 11 is next.' : '';
  $('rTip').textContent = tip;
  const i = SITES.indexOf(s);
  const next = s.free ? null : SITES[i + 1];
  $('nextBtn').hidden = !s.free && !next;
  $('nextBtn').textContent = s.free ? 'New ground' : next ? `Next: ${next.name}` : '';
  $('againBtn').textContent = j.ok ? 'Fly it again' : 'Try again';
  if (j.ok) sound.play('plaque');
}
$('skipBtn').addEventListener('click', showResult);
$('againBtn').addEventListener('click', () => startFlight(cur.site, cur.mode));
$('nextBtn').addEventListener('click', () => {
  if (cur.site.free) { rollFree(1 + Math.floor(Math.random() * 99999)); startFlight(free.site, 'p66'); return; }
  const next = SITES[SITES.indexOf(cur.site) + 1];
  if (next) showBrief(next);
});
$('sitesBtn').addEventListener('click', () => { cur = null; showTitle(); });

// ---------- settings ----------

function renderSettings() {
  for (const id of ['soundBtn', 'soundBtn2']) {
    $(id).setAttribute('aria-pressed', String(store.settings.sound));
    $(id).textContent = store.settings.sound ? 'Sound on' : 'Sound off';
  }
  for (const id of ['voiceBtn', 'voiceBtn2']) {
    $(id).setAttribute('aria-pressed', String(store.settings.voice));
    $(id).hidden = !sound.canSpeak();
  }
}
for (const id of ['soundBtn', 'soundBtn2']) {
  $(id).addEventListener('click', () => {
    store.settings.sound = !store.settings.sound;
    sound.unlock();
    sound.setSound(store.settings.sound);
    save(store);
    renderSettings();
  });
}
for (const id of ['voiceBtn', 'voiceBtn2']) {
  $(id).addEventListener('click', () => {
    store.settings.voice = !store.settings.voice;
    sound.setVoice(store.settings.voice);
    save(store);
    renderSettings();
  });
}

// ---------- start ----------

renderSettings();
showTitle();
requestAnimationFrame(t => { last = t; frame(t); });

// Offline copy.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// For the tests: look inside, fly with the autopilot, run the clock faster.
window.contactLight = {
  state() {
    const c = cur;
    if (!c) return { screen, mode };
    const f = c.f;
    return {
      screen, mode: c.mode, site: c.site.id, phase: f.phase, t: f.t, x: f.x, alt: altitude(f), vx: f.vx, vy: f.vy,
      th: f.th / DEG, rate: f.rateCmd, throttle: f.thr, fuel: pct(f), contact: f.contactAt != null, low: f.lowAt != null,
      judged: c.judged && { outcome: c.judged.outcome, tier: c.judged.tier }, record: c.record || null, key: c.key,
      lines: [...$('radio').children].map(p => p.textContent),
    };
  },
  autopilot(on = true) { if (cur) cur.ap = on ? createAutopilot(cur.site, cur.g, cur.f.veh, cur.mode === 'arcade' ? 'arcade' : 'p66') : null; },
  speed(k) { speed = k; },
  setFuel(p) { if (cur) cur.f.prop = (p / 100) * 8248; },
  fly(id, m = 'p66') { startFlight(siteById(id), m); },
  demo() { return demo && { site: demo.site.id, phase: demo.f.phase }; },
  drawing() { return r.key; },
};
