// Someone doing exactly what the training's hints say, for the unit tests: a moment to read each new
// hint, taps a third of a second apart, and a control held until the number the hint names reads
// right. It knows nothing the hints don't tell it, except where the pad is, which you can see.
// In Arcade it knows about a third of the throttle hovers, and works the lever from there as the DOWN
// number strays from what the hint asks for.

const DEG = Math.PI / 180;

export function literalPilot(mode, site) {
  const me = { text: null, since: 0, lastTap: -9, throttle: null, phase: null, levelling: false, lastAdj: 0, trim: 0 };
  // Arcade: turn toward a lean and stop turning there (the LM keeps whatever lean it's left at).
  const lean = (f, deg) => Math.max(-0.6, Math.min(0.6, (deg * DEG - f.th) / (6 * DEG) - f.w / (40 * DEG)));

  return (f, text) => {
    // A new hint: finish standing it up, if that's what you were doing, while you read it.
    if (text !== me.text) Object.assign(me, { text, since: f.t, levelling: me.phase === 'up' || me.phase === 'level', phase: null });
    if (me.throttle == null) me.throttle = f.thr;
    const read = f.t - me.since > 1.2;
    const dx = site.target.x - f.x;
    const under = Math.abs(dx) < Math.max(3, 4 * Math.abs(f.vx)); // the pad is coming under you

    if (mode === 'p66') {
      // The rate switch: tap until RATE reads what the hint asks for.
      let rod = 0;
      const n = /come down at (\d) feet a second/.exec(text);
      const want = /hold your height/.test(text) ? 0 : n ? -n[1] : /tap ▲ to slow to 2 or 3/.test(text) ? -3 : null;
      const there = want === 0 ? f.rateCmd >= 0 : /tap ▲/.test(text) ? f.rateCmd >= want : f.rateCmd === want;
      if (want != null && read && !there && f.t - me.lastTap > 0.35) { rod = Math.sign(want - f.rateCmd); me.lastTap = f.t; }
      let pad = 0;
      const fwd = f.vx > 0.2, back = f.vx < -0.2;
      if (/drag the hand controller right/.test(text)) pad = read ? 1 : 0;
      else if (/As the pad comes under you, drag left/.test(text)) {
        if (!me.phase && fwd && under) me.phase = 'brake';
        pad = me.phase === 'brake' && fwd ? -1 : 0;
      } else if (/As it comes under you, drag right/.test(text)) {
        if (!me.phase && back && under) me.phase = 'brake';
        pad = me.phase === 'brake' && back ? 1 : 0;
      } else if (/drag left, toward BACK, until FWD reads 0/.test(text)) pad = read && fwd ? -1 : 0;
      else if (/drag right, toward FWD, until BACK reads 0/.test(text)) pad = read && back ? 1 : 0;
      else if (/Nudge the controller left, toward BACK, until FWD reads 0/.test(text)) pad = read && f.vx > 0.15 ? -0.4 : 0;
      else if (/Nudge the controller right, toward FWD, until BACK reads 0/.test(text)) pad = read && f.vx < -0.15 ? 0.4 : 0;
      else if (/Nudge the controller right to drift onto it/.test(text)) pad = read && f.vx < 1.2 ? 0.4 : 0;
      else if (/Nudge the controller left to drift back onto it/.test(text)) pad = read && f.vx > -1.2 ? -0.4 : 0;
      return { pad, rod };
    }

    let rotate = 0, vyWant = null;
    if (/Drag it down a little to start coming down/.test(text)) {
      if (read && !me.phase) { me.throttle -= 0.04; me.phase = 'down'; }
    } else if (/Push the throttle up past a third until DOWN reads 0/.test(text)) {
      if (read && !me.phase) me.phase = 'push';
      if (me.phase === 'push') { me.throttle = 0.37; if (f.vy > -0.3) { me.throttle = 1 / 3; me.phase = 'hover'; } }
    } else if (/Lean a little forward to fly toward the pad/.test(text)) {
      if (read) rotate = lean(f, 8);
      vyWant = 0;
    } else if (/Drag left until the controller reads UPRIGHT/.test(text)) {
      rotate = read ? lean(f, 0) : 0;
      vyWant = 0;
    } else if (/As the pad comes under you, drag left to lean back|As it comes under you, lean forward/.test(text)) {
      const s = /lean forward/.test(text) ? 1 : -1;
      if (!me.phase && Math.abs(f.vx) > 0.2 && under) me.phase = 'lean';
      if (me.phase === 'lean') { rotate = lean(f, 20 * s); if (s * f.vx > -0.3) me.phase = 'up'; }
      if (me.phase === 'up') rotate = lean(f, 0);
      vyWant = 0;
    } else if (/[Ll]ean (back|forward) a touch/.test(text)) {
      const backward = /ean back a touch/.test(text), toDrift = /drift/.test(text);
      if (read && !me.phase) me.phase = 'tip';
      if (me.phase === 'tip') {
        rotate = lean(f, backward ? -4 : 4);
        if (toDrift ? Math.abs(f.vx) > 1.2 : backward ? f.vx < 0.15 : f.vx > -0.15) me.phase = 'level';
      }
      if (me.phase === 'level') rotate = lean(f, 0);
      vyWant = 0;
    } else if (/lean (back|forward) until (FWD|BACK) reads 0, then stand it up/.test(text)) {
      if (Math.abs(f.vx) > 0.3 && me.phase !== 'level') rotate = lean(f, f.vx > 0 ? -15 : 15);
      else { me.phase = 'level'; rotate = lean(f, 0); }
      vyWant = -2.5;
    } else if (/Stand it upright, then ease the throttle down a touch|Keep it upright and slow|push the throttle up to slow/.test(text)) {
      rotate = lean(f, 0);
      vyWant = -2.5;
    }
    if (!read && me.levelling) rotate = lean(f, 0);
    if (vyWant != null && f.t - me.lastAdj > 0.4) {
      me.trim = Math.max(-0.05, Math.min(0.05, me.trim + 0.0015 * (vyWant - f.vy)));
      me.throttle = (1 / 3 + me.trim) / Math.cos(f.th) + 0.012 * (vyWant - f.vy);
      me.lastAdj = f.t;
    }
    me.throttle = Math.max(0, Math.min(1, me.throttle));
    return { throttle: me.throttle, rotate };
  };
}
