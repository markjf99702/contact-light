// The radio. While you fly, the LM pilot calls out your altitude, descent rate and forward speed the
// way each crew did, built from your own numbers ("40 feet, down 2 1/2. Picking up some dust.").
// Houston's lines come between Quindar tones. After touchdown come the real words from the
// air-to-ground transcripts. Plain logic with no page involved, so it runs in Node for the tests.

// ---------- numbers, the way they were said ----------

// Descent rates to the nearest half: "2 1/2", "a half", "4".
export function rateText(v) {
  const r = Math.round(Math.abs(v) * 2) / 2;
  const whole = Math.floor(r), half = r - whole >= 0.5;
  if (whole === 0) return half ? 'a half' : '0';
  return half ? `${whole} 1/2` : String(whole);
}
// The same, for the speech voice.
export function rateSay(v) {
  const t = rateText(v);
  return t === 'a half' ? 'a half' : t.replace(' 1/2', ' and a half');
}
// Altitude to the nearest 5 feet low down, 10 higher up.
export function altText(a) {
  a = Math.max(0, a);
  if (a >= 100) return String(Math.round(a / 10) * 10);
  return String(Math.max(5, Math.round(a / 5) * 5));
}
const pctText = p => String(Math.max(1, Math.round(p)));
const say = text => text.replace(/(\d+) 1\/2/g, '$1 and a half').replace(/\bH-dot\b/g, 'H dot').replace(/\bROD\b/g, 'R O D');

// ---------- each pilot's way of calling the numbers ----------
// n: { alt, rate (ft/s, negative is down), fwd (ft/s), k (a counter, to vary the wording) }

function fwdBit(fwd, style) {
  const s = Math.round(Math.abs(fwd));
  if (s < 1) return '';
  if (fwd < 0) return style === 'duke' ? `You're backing up, ${s}.` : `${s} back.`;
  return `${s} forward.`;
}

const STYLES = {
  aldrin(n) {
    const a = altText(n.alt), r = rateText(n.rate), f = fwdBit(n.fwd, 'aldrin');
    if (n.rate > 0.25) return `${a} feet, up ${r}. ${f}`.trim();
    if (Math.abs(n.rate) <= 0.25) return `${a} feet, holding. ${f}`.trim();
    return [`${a} feet, down ${r}. ${f}`, `${a}, ${r} down. ${f}`, `${a} feet, down at ${r}. ${f}`][n.k % 3].trim();
  },
  bean(n) {
    const a = altText(n.alt), r = rateText(n.rate);
    if (n.rate > 0.25) return `${a} feet; you're climbing, Pete.`;
    if (Math.abs(n.rate) <= 0.25) return `${a} feet, holding.`;
    return [`${a} feet, coming down at ${r}.`, `Coming down at ${r}; ${a} feet.`, `${a}, coming down at ${r}.`][n.k % 3];
  },
  mitchell(n) {
    const a = altText(n.alt), r = rateText(n.rate);
    if (n.rate > 0.25) return `${a} feet, going up ${r}.`;
    if (Math.abs(n.rate) <= 0.25) return `${a} feet and holding.`;
    return [`${r} feet per second, ${a} feet.`, `You're ${a} feet, Al.`, `${a} feet, ${r} per second.`][n.k % 3];
  },
  irwin(n) {
    const a = altText(n.alt), r = rateText(n.rate);
    if (n.rate > 0.25) return `${a}. Plus ${r}.`;
    if (Math.abs(n.rate) <= 0.25) return `${a}. Zero.`;
    return [`${a} at minus ${r}.`, `${a}; ${r}.`, `${a} at ${r}.`][n.k % 3];
  },
  duke(n) {
    const a = altText(n.alt), r = rateText(n.rate), s = Math.round(Math.abs(n.fwd));
    if (n.rate > 0.25) return `${a} feet, going up.`;
    if (Math.abs(n.rate) <= 0.25) return `${a} feet. You leveled off.`;
    if (s >= 1 && n.k % 2) return `${r} down at ${a} feet, ${s} ${n.fwd < 0 ? 'back' : 'forward'}.`;
    return [`${a} feet, ${r} down.`, `${a} feet, down at ${r}.`][n.k % 2];
  },
  schmitt(n) {
    const a = altText(n.alt), r = rateText(n.rate);
    if (n.rate > 0.25) return `${a} feet; going up.`;
    if (Math.abs(n.rate) <= 0.25) return `${a} feet. Holding.`;
    return [`${a} feet; going down at ${r}.`, `${r} feet per second down at ${a}.`, `${a} feet, down at ${r}.`][n.k % 3];
  },
  plain(n) {
    const a = altText(n.alt), r = rateText(n.rate), f = fwdBit(n.fwd, 'plain');
    if (n.rate > 0.25) return `${a} feet, up ${r}. ${f}`.trim();
    if (Math.abs(n.rate) <= 0.25) return `${a} feet, holding. ${f}`.trim();
    return `${a} feet, down ${r}. ${f}`.trim();
  },
};

export const numbersCall = (style, n) => (STYLES[style] || STYLES.plain)(n);

// Things a pilot says when something happens. A function gets the people (cdr, lm, first...).
const LINES = {
  dust: {
    aldrin: 'Picking up some dust.',
    bean: 'Going to get some dust before long.',
    mitchell: 'There’s some dust.',
    irwin: { role: 'cdr', text: 'Okay. I’ve got some dust.' },
    duke: 'There’s dust.',
    schmitt: 'Stand by for some dust.',
    plain: 'Picking up some dust.',
  },
  thickDust: {
    bean: 'Watch for the dust.',
    irwin: 'Lot of dust.',
    schmitt: 'Getting a little dust.',
    plain: 'Can’t see much for the dust.',
  },
  shadow: {
    aldrin: 'I got the shadow out there.',
    duke: 'There comes the shadow.',
    plain: 'There’s our shadow.',
  },
  high: {
    aldrin: 'Ease her down.',
    bean: p => `Come on down, ${p.first}.`,
    mitchell: 'I’d give it a few clicks.',
    duke: 'Let her on down.',
    schmitt: 'Let it come on down, Geno.',
    plain: 'You’re a little high.',
  },
  fast: {
    bean: 'Slow down the descent rate!',
    duke: 'Give me a couple of clicks up.',
    schmitt: 'H-dot’s a little high, Geno. Cut the H-dot.',
    plain: 'Watch your rate.',
  },
  pegged: { aldrin: 'Okay, you’re pegged on horizontal velocity.' },
  driftFwd: {
    aldrin: 'Drifting forward just a little bit; that’s good.',
    schmitt: p => `Moving forward a little. Little forward velocity, ${p.first}.`,
    plain: 'Drifting forward a little.',
  },
  driftBack: {
    duke: 'You’re backing up slightly.',
    aldrin: 'Drifting back a little.',
    plain: 'Drifting back a little.',
  },
  // Only said when it's true: see steady() below. Schmitt's is about the fuel, so not after the light.
  good: {
    aldrin: 'You’re looking good.',
    bean: 'Looking good; watch the dust.',
    mitchell: 'Going down; looking great.',
    duke: 'Looking super.',
    schmitt: { text: 'Fuel’s good.', fuel: true },
    plain: 'Looking good.',
  },
  contact: {
    aldrin: 'Contact light.',
    bean: 'Contact light.',
    mitchell: p => `Contact, ${p.first}.`,
    irwin: 'Contact.',
    duke: 'Contact! Stop.',
    schmitt: 'Contact.',
    plain: 'Contact light.',
  },
};

function eventLine(kind, style, people) {
  const set = LINES[kind];
  if (!set) return null;
  let v = set[style];
  if (v === undefined) v = set.plain;
  if (v === undefined) return null;
  if (typeof v === 'function') v = v(people);
  if (typeof v === 'string') v = { role: 'lmp', text: v };
  return { ...v };
}

// The fuel gauge read out, cheerful only while there's plenty.
const FUEL_CALL = {
  aldrin: p => `${p} percent.`,
  bean: p => (p >= 9 ? `You got ${p} percent. Got loads of gas.` : `${p} percent.`),
  mitchell: p => (p >= 8 ? `${p} percent fuel; looks great.` : `${p} percent fuel.`),
  irwin: p => `${p} percent fuel.`,
  duke: p => (p >= 8 ? `Fuel is good: ${p} percent.` : p >= 7 ? `${p} percent. Plenty fat.` : `${p} percent.`),
  schmitt: p => (p >= 8 ? 'The fuel’s good.' : `${p} percent.`),
  plain: p => `${p} percent fuel.`,
};

// Moving along the ground faster than you could stop before the footpads touch. s: speed, d: 'forward' or 'back'.
const SLOW_IT = {
  aldrin: (s, d) => `${s} ${d}. Slow it down.`,
  bean: (s, d, p) => `${s} ${d}, ${p.first}. Slow it down.`,
  mitchell: (s, d, p) => `${s} feet per second ${d}, ${p.first}. Slow it down.`,
  irwin: (s, d) => `${d === 'back' ? 'Back' : 'Forward'} ${s}. Slow it down.`,
  duke: (s, d, p) => `${s} ${d}, ${p.first}. Slow it down.`,
  schmitt: (s, d) => `${s} ${d}, Geno. Slow it down.`,
  plain: (s, d) => `${s} ${d}. Slow it down.`,
};

// Going well enough to say so: coming down gently and nearly stopped along the ground.
export const steady = st => st.rate >= -4.2 && st.rate <= 0.3 && Math.abs(st.fwd) <= 2;
// Too fast along the ground to stop before the footpads touch at this descent rate, even leaning
// all the way back (20° of tilt slows you 1.9 ft/s every second).
export function tooFastAlong(st) {
  const v = Math.abs(st.fwd);
  if (st.alt > 200 || st.alt < 6 || v < 3) return false;
  return (v - 1) / 1.9 > st.alt / Math.max(0.5, -st.rate);
}

// ---------- the radio itself ----------

export function createRadio(site) {
  const p = site.people || {};
  return {
    site,
    style: p.style || 'plain',
    people: p,
    next: 3.2,
    k: 0,
    said: {},
    lastFuel: Math.floor(site.fuel),
    highSince: null,
    lastEventAt: -99,
    goodAt: null, // a 'looking good' waiting for its moment, if it's still true then
    alongAt: -99, alongN: 0, // the calls to slow down along the ground
    driftT: null, driftDir: 0, driftAt: -99,
  };
}

function who(radio, role) {
  const p = radio.people;
  return role === 'capcom' ? p.capcom : role === 'cdr' ? p.cdr : p.lmp;
}

function line(radio, role, text, extra = {}) {
  return { role, who: who(radio, role), text, say: say(text), quindar: role === 'capcom', ...extra };
}

// The opening exchange as you take over. Arcade has no P66 to be in, so where the crew's own words
// are about P66, Arcade hears Houston's go for landing instead.
export function openingLines(site, mode = 'p66') {
  const r = createRadio(site);
  const lm = site.people.lm;
  const L = (role, text, at) => ({ ...line(r, role, text), at });
  const go = [L('capcom', `${lm}, Houston. You’re go for landing.`, 0.4)];
  const crew = (() => {
    switch (site.id) {
      case 'ellington': return [L('capcom', 'LLTV, Ellington. You’re clear to fly. Take your time.', 0.4)];
      case 'a11': return [L('capcom', 'Eagle, Houston. You’re go for landing.', 0.4)];
      case 'a12': return [L('lmp', 'You’re in P66, Pete.', 0.4), L('cdr', 'Right.', 1.8)];
      case 'a14': return [L('cdr', 'Let’s take it over and move up a little.', 0.4), L('lmp', 'Okay. I think so.', 2.2)];
      case 'a15': return [L('lmp', 'You’ve got P66.', 0.4), L('cdr', 'Okay.', 1.6)];
      case 'a16': return [L('cdr', 'Okay. I’m going to take over, Charlie.', 0.4), L('lmp', 'Okay.', 2.0)];
      case 'a17': return [L('cdr', 'Okay. I’ve got P66.', 0.4), L('lmp', 'Okay.', 1.6)];
      default: return go;
    }
  })();
  return mode === 'arcade' && crew.some(l => /P66/.test(l.text)) ? go : crew;
}

// Called every step with the flight and the events the step produced. Returns lines to show now.
// state: { alt, rate, fwd, pct, t, dustOn, shadowSeen, thickDust }
export function radioUpdate(radio, f, events, state) {
  const out = [];
  const st = radio.style, P = radio.people;
  const push = l => { if (l) { out.push(l); radio.lastEventAt = state.t; } };
  const ev = (kind) => {
    if (radio.said[kind]) return;
    radio.said[kind] = true;
    let e = eventLine(kind, st, P);
    // Arcade has no rate switch, so a crew's call for clicks of it becomes the plain call.
    if (e && f.mode === 'arcade' && /\bclicks?\b/i.test(e.text)) e = eventLine(kind, 'plain', P);
    if (e) push(line(radio, e.role || 'lmp', e.text));
  };

  for (const e of events) {
    if (e.type === 'lowLevel') {
      if (st === 'aldrin') push(line(radio, 'lmp', `${pctText(state.pct)} percent. Quantity light.`));
      else push(line(radio, 'capcom', 'Low level.'));
    } else if (e.type === 'call60') push(line(radio, 'capcom', '60 seconds.'));
    else if (e.type === 'call30') push(line(radio, 'capcom', '30 seconds.'));
    else if (e.type === 'bingo') push(line(radio, 'capcom', 'Bingo.'));
    else if (e.type === 'contact') { radio.said.contact = true; const c = eventLine('contact', st, P); if (c) push(line(radio, c.role || 'lmp', c.text, { big: true })); }

  }
  if (f.phase !== 'flying') return out;

  // Event calls, once each. The tower at Ellington doesn't talk about the dust or your shadow.
  const site = radio.site, tower = !!site.training;
  if (state.dustOn && !radio.said.dust && !tower) ev('dust');
  if (state.thickDust && !radio.said.thickDust && !tower) ev('thickDust');
  // The LM's shadow shows up out ahead well before it reaches the footpads.
  if (!radio.said.shadow && state.alt < 240 && state.alt > 90 && state.t > 10 && !tower) ev('shadow');
  if (Math.abs(state.fwd) > 45 && state.t > 8 && !radio.said.pegged && st === 'aldrin') ev('pegged');

  // Fuel percent, as the gauges show it, every couple of percent until the light.
  const pf = Math.floor(state.pct);
  if (pf < radio.lastFuel && f.lowAt == null && pf >= 6 && state.t > 5 && !tower) {
    radio.lastFuel = pf;
    if (pf % 2 === 0 || st === 'bean' || st === 'irwin') push(line(radio, 'lmp', (FUEL_CALL[st] || FUEL_CALL.plain)(pctText(state.pct))));
  }

  // Hanging about up high burns fuel; a rate too fast low down breaks legs.
  if (state.alt > 140 && Math.abs(state.rate) < 1.5) {
    radio.highSince ??= state.t;
    if (state.t - radio.highSince > 9 && !radio.said.high) ev('high');
  } else radio.highSince = null;
  if (state.alt < 110 && state.alt > 15 && state.rate < -7.5 && !radio.said.fast) ev('fast');
  if (state.alt < 45 && state.alt > 6 && state.rate < -6 && !radio.said.fastLow) {
    radio.said.fastLow = true;
    push(line(radio, 'lmp', `Down at ${rateText(state.rate)}. Too fast; ${f.mode === 'arcade' ? 'more throttle' : 'click it up'}!`));
  }

  // Still going fast along the ground near the bottom: say so, with the number, until it's fixed.
  if (tooFastAlong(state) && state.t - radio.alongAt > 7 && radio.alongN < 3) {
    radio.alongAt = state.t;
    radio.alongN++;
    push(line(radio, 'lmp', (SLOW_IT[st] || SLOW_IT.plain)(Math.round(Math.abs(state.fwd)), state.fwd < 0 ? 'back' : 'forward', P)));
  }
  // Flying on past the target and away from it.
  const past = (f.x - site.target.x) * Math.sign(state.fwd);
  if (!radio.said.long && state.t > 8 && Math.abs(state.fwd) > 8 && past > site.target.tiers[1]) {
    radio.said.long = true;
    const word = site.target.label === 'SURVEYOR 3' ? 'Surveyor’s' : site.target.label === 'PAD' ? 'The pad’s' : 'The target’s';
    const back = (Math.round(Math.abs(f.x - site.target.x) / 100) * 100).toLocaleString('en-US');
    push(line(radio, 'lmp', `${tower ? 'You’re' : 'We’re'} long. ${word} ${back} feet back.`));
  }

  // Low and nearly stopped: the gentle drifts, once each, and only when the drift has lasted a
  // moment and the other one wasn't just called.
  if (state.alt < 70 && state.alt > 8 && state.rate > -5) {
    const dir = state.fwd > 0.6 && state.fwd < 2.5 ? 1 : state.fwd < -0.6 && state.fwd > -2.5 ? -1 : 0;
    if (dir !== radio.driftDir) { radio.driftDir = dir; radio.driftT = dir ? state.t : null; }
    const kind = dir > 0 ? 'driftFwd' : 'driftBack';
    if (dir && state.t - radio.driftT > 1.2 && state.t - radio.driftAt > 8 && !radio.said[kind]) {
      radio.driftAt = state.t;
      ev(kind);
    }
  } else { radio.driftDir = 0; radio.driftT = null; }

  // 'Looking good', a moment after the numbers that earned it, if they still do.
  if (radio.goodAt != null && state.t >= radio.goodAt) {
    radio.goodAt = null;
    const g = eventLine('good', st, P);
    if (g && steady(state) && state.alt > 8 && !radio.said.good && !radio.said.contact && (!g.fuel || f.lowAt == null)) {
      radio.said.good = true;
      push(line(radio, 'lmp', g.text));
    }
  }

  // The steady numbers.
  if (state.t >= radio.next && state.alt > 3 && radio.said.contact == null) {
    if (state.t - radio.lastEventAt < 1.6) radio.next = state.t + 1.2;
    else {
      const text = numbersCall(st, { alt: state.alt, rate: state.rate, fwd: state.fwd, k: radio.k++ });
      out.push(line(radio, 'lmp', text, { numbers: true }));
      if (state.alt < 60 && state.alt > 12 && steady(state) && !radio.said.good) radio.goodAt = state.t + 1.4;
      radio.next = state.t + (state.alt > 250 ? 6.5 : state.alt > 100 ? 5.5 : 4.2);
    }
  }
  return out;
}

// ---------- after touchdown: the real words ----------
// Delays are seconds after the footpads touch, squeezed a little from the real ones.

const LANDED = {
  a11: [
    ['cdr', 'Shutdown.', 0.8],
    ['lmp', 'Okay. Engine stop.', 1.7],
    ['lmp', 'ACA out of detent.', 2.7],
    ['cdr', 'Out of detent. Auto.', 3.5],
    ['lmp', 'Mode control, both auto. Descent engine command override, off. Engine arm, off. 413 is in.', 4.5],
    ['capcom', 'We copy you down, Eagle.', 8],
    ['cdr', 'Houston, Tranquility Base here. The Eagle has landed.', 9.6, { big: true }],
    ['capcom', 'Roger, Twan… Tranquility. We copy you on the ground. You got a bunch of guys about to turn blue. We’re breathing again. Thanks a lot.', 13.2],
  ],
  a12: [
    ['capcom', 'Roger. Copy contact.', 1],
    ['lmp', 'Good landing, Pete! Outstanding, man!', 3],
    ['cdr', 'Okay, we’re in hot shape, Houston. We’re in real good shape!', 6, { big: true }],
    ['capcom', 'Roger, Pete.', 8.6],
  ],
  a14: [
    ['cdr', 'Stop. Great. Pro, auto, auto.', 1],
    ['lmp', 'We’re on the surface.', 3.4],
    ['cdr', 'Okay, we made a good landing.', 5, { big: true }],
    ['capcom', 'Roger, Antares.', 7],
  ],
  a15: [
    ['lmp', 'Bam!', 1.1],
    ['cdr', 'Okay, Houston. The Falcon is on the Plain at Hadley.', 4.2, { big: true }],
    ['capcom', 'Roger, Roger, Falcon.', 7],
    ['lmp', 'No denying that. We had contact.', 9.4],
  ],
  a16: [
    ['lmp', 'Boom.', 0.8],
    ['lmp', 'Pro. Engine arm. Wow! Look at that!', 2.6],
    ['cdr', 'Well, we don’t have to walk far to pick up rocks, Houston. We’re among them!', 5.6, { big: true }],
    ['lmp', 'Old Orion is finally here, Houston. Fantastic!', 9.6],
    ['capcom', 'Sounds great.', 11.8],
  ],
  a17: [
    ['lmp', 'Stop, push. Engine stop; engine arm; proceed; command override, off.', 1.2],
    ['cdr', 'Okay, Houston. The Challenger has landed!', 5, { big: true }],
    ['capcom', 'Roger, Challenger. That’s super.', 7.4],
    ['lmp', 'Yes, sir! But we is here.', 9],
    ['cdr', 'Man, is we here.', 10.4],
  ],
};

// The lines after it's over. judged: the result of judge(); returns lines with an 'at' delay, and
// 'card': when to show the result card. After a landing, its big line is the moment: it's shown
// large over the scene, and the card waits a few seconds more so it can be read.
const HOLD = 3.4;
export function endingLines(site, judged) {
  const r = createRadio(site);
  const P = r.people;
  const L = ([role, text, at, extra]) => ({ ...line(r, role, text, extra || {}), at });
  let lines, card;
  if (judged.outcome === 'landed') {
    if (site.training) {
      lines = [L(['capcom', judged.tier === 'gold' ? 'That’s a landing. Nicely done.' : 'You’re down. Not bad at all.', 1.2, { big: true }])];
    } else if (LANDED[site.id]) {
      lines = LANDED[site.id].map(L);
    } else {
      lines = [L(['cdr', 'Shutdown.', 0.8]), L(['lmp', 'Okay. Engine stop.', 1.7]), L(['capcom', `We copy you down, ${P.lm}.`, 4.2]), L(['cdr', 'Houston, we’re down. Good landing.', 6, { big: true }])];
    }
    const big = lines.find(l => l.big);
    if (big) big.moment = true;
    card = (big ? big.at : 4) + HOLD;
  } else if (judged.outcome === 'tipped') {
    lines = [L(['lmp', 'We’re going over!', 0.6]), L(['capcom', `${P.lm}, Houston. Say your status.`, 4])];
    card = 4.4;
  } else if (judged.outcome === 'crash') {
    lines = [L(['capcom', `${P.lm}, Houston. We’ve lost all data.`, 2.2])];
    card = 3.4;
  } else {
    // Abort: the crew stages, and Houston watches the ascent stage climb away.
    lines = [L(['lmp', 'Abort stage.', 0.2]), L(['capcom', `${P.lm}, Houston. We copy the abort.`, 2.6])];
    card = 5.6;
  }
  return { lines, card };
}

export { say as speakable };

// The mission clock the transcripts are kept in: hours:minutes:seconds since launch. A landing's
// lines are stamped from the moment that crew took over in P66, so yours read like theirs.
export function missionTime(site, t) {
  if (!site.get) {
    const s = Math.max(0, Math.round(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const [h, m, sec] = site.get.split(':').map(Number);
  const all = h * 3600 + m * 60 + sec + Math.round(t);
  return `${Math.floor(all / 3600)}:${String(Math.floor(all / 60) % 60).padStart(2, '0')}:${String(all % 60).padStart(2, '0')}`;
}
