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
    return [`${a} feet, coming down at ${r}.`, `${a} feet; coming down at ${r}. You're looking good.`, `${a}, coming down at ${r}.`][n.k % 3];
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
    schmitt: 'A little high. H-dot’s a little high.',
    plain: 'You’re a little high.',
  },
  fast: {
    bean: 'Slow down the descent rate!',
    duke: 'Give me a couple of clicks up.',
    schmitt: 'Cut the H-dot.',
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
  good: {
    aldrin: 'You’re looking good.',
    bean: 'Looking good; watch the dust.',
    mitchell: 'Going down; looking great.',
    duke: 'Looking super.',
    schmitt: 'Fuel’s good.',
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

const FUEL_CALL = {
  aldrin: p => `${p} percent.`,
  bean: p => (p >= 9 ? `You got ${p} percent. Got loads of gas.` : `${p} percent.`),
  mitchell: p => `${p} percent fuel; looks great.`,
  irwin: p => `${p} percent fuel.`,
  duke: p => (p >= 8 ? `Fuel is good: ${p} percent.` : `${p} percent. Plenty fat.`),
  schmitt: () => 'The fuel’s good.',
  plain: p => `${p} percent fuel.`,
};

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
  };
}

function who(radio, role) {
  const p = radio.people;
  return role === 'capcom' ? p.capcom : role === 'cdr' ? p.cdr : p.lmp;
}

function line(radio, role, text, extra = {}) {
  return { role, who: who(radio, role), text, say: say(text), quindar: role === 'capcom', ...extra };
}

// The opening exchange as you take over.
export function openingLines(site) {
  const r = createRadio(site);
  const lm = site.people.lm;
  const L = (role, text, at) => ({ ...line(r, role, text), at });
  switch (site.id) {
    case 'ellington': return [L('capcom', 'LLTV, Ellington. You’re clear to fly. Take your time.', 0.4)];
    case 'a11': return [L('capcom', 'Eagle, Houston. You’re go for landing.', 0.4)];
    case 'a12': return [L('lmp', 'You’re in P66, Pete.', 0.4), L('cdr', 'Right.', 1.8)];
    case 'a14': return [L('cdr', 'Let’s take it over and move up a little.', 0.4), L('lmp', 'Okay. I think so.', 2.2)];
    case 'a15': return [L('lmp', 'You’ve got P66.', 0.4), L('cdr', 'Okay.', 1.6)];
    case 'a16': return [L('cdr', 'Okay. I’m going to take over, Charlie.', 0.4), L('lmp', 'Okay.', 2.0)];
    case 'a17': return [L('cdr', 'Okay. I’ve got P66.', 0.4), L('lmp', 'Okay.', 1.6)];
    default: return [L('capcom', `${lm}, Houston. You’re go for landing.`, 0.4)];
  }
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
    const e = eventLine(kind, st, P);
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

  // Event calls, once each.
  if (state.dustOn && !radio.said.dust && st !== 'coach') ev('dust');
  if (state.thickDust && !radio.said.thickDust) ev('thickDust');
  // The LM's shadow shows up out ahead well before it reaches the footpads.
  if (!radio.said.shadow && state.alt < 240 && state.alt > 90 && state.t > 10) ev('shadow');
  if (Math.abs(state.fwd) > 45 && state.t > 8 && !radio.said.pegged && st === 'aldrin') ev('pegged');

  // Fuel percent, as the gauges show it, every couple of percent until the light.
  const pf = Math.floor(state.pct);
  if (pf < radio.lastFuel && f.lowAt == null && pf >= 6 && state.t > 5 && !radio.site.training) {
    radio.lastFuel = pf;
    if (pf % 2 === 0 || st === 'bean' || st === 'irwin') push(line(radio, 'lmp', (FUEL_CALL[st] || FUEL_CALL.plain)(pctText(state.pct))));
  }

  // Hanging about up high burns fuel; a rate too fast low down breaks legs.
  if (state.alt > 140 && Math.abs(state.rate) < 1.5) {
    radio.highSince ??= state.t;
    if (state.t - radio.highSince > 9 && !radio.said.high) ev('high');
  } else radio.highSince = null;
  if (state.alt < 110 && state.alt > 15 && state.rate < -7.5 && !radio.said.fast) ev('fast');

  // Low and nearly stopped: the gentle drifts.
  if (state.alt < 70 && state.alt > 8) {
    if (state.fwd > 0.6 && state.fwd < 2.5 && !radio.said.driftFwd) ev('driftFwd');
    if (state.fwd < -0.6 && !radio.said.driftBack) ev('driftBack');
  }

  // The steady numbers.
  if (state.t >= radio.next && state.alt > 3 && radio.said.contact == null) {
    if (state.t - radio.lastEventAt < 1.6) radio.next = state.t + 1.2;
    else {
      const text = numbersCall(st, { alt: state.alt, rate: state.rate, fwd: state.fwd, k: radio.k++ });
      out.push(line(radio, 'lmp', text, { numbers: true }));
      if (state.alt < 60 && radio.k % 3 === 0 && !radio.said.good) { radio.said.good = true; const g = eventLine('good', st, P); if (g) out.push({ ...line(radio, 'lmp', g.text), at: 1.4 }); }
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
// 'card': when to show the result card.
export function endingLines(site, judged) {
  const r = createRadio(site);
  const P = r.people;
  const L = ([role, text, at, extra]) => ({ ...line(r, role, text, extra || {}), at });
  let lines, card;
  if (judged.outcome === 'landed') {
    if (site.training) {
      lines = [L(['capcom', judged.tier === 'gold' ? 'That’s a landing. Nicely done.' : 'You’re down. Not bad at all.', 1.2, { big: true }])];
      card = 2.6;
    } else if (LANDED[site.id]) {
      lines = LANDED[site.id].map(L);
      const big = lines.find(l => l.big);
      card = (big ? big.at : 4) + 1.6;
    } else {
      lines = [L(['cdr', 'Shutdown.', 0.8]), L(['lmp', 'Okay. Engine stop.', 1.7]), L(['capcom', `We copy you down, ${P.lm}.`, 4.2]), L(['cdr', 'Houston, we’re down. Good landing.', 6, { big: true }])];
      card = 7.6;
    }
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
