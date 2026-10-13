// The site in profile, end to end: a thin strip under the numbers while you fly (where you are,
// where the target is, what the screen is showing), and a bigger one on the briefing card.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// o: { f (the flight, optional), view: [xa, xb] (what the main screen shows), labels: bool, start: bool }
export function drawProfile(canvas, g, site, o = {}) {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  // Most of the site, not the far ends where nobody goes.
  const x0 = Math.max(g.x0, site.start.x - 350), x1 = Math.min(g.x1, Math.max(site.target.x + 1400, site.start.x + 2300));
  let lo = Infinity, hi = -Infinity;
  for (let x = x0; x <= x1; x += 8) { const y = g.h[Math.round((x - g.x0))] ?? 0; lo = Math.min(lo, y); hi = Math.max(hi, y); }
  const top = site.start.alt + (g.h[Math.round(site.start.x - g.x0)] || 0);
  const span = x1 - x0;
  const sx = (w - 8) / span;
  // Heights are stretched so craters read; the start altitude sets the top.
  const pad = o.labels ? 18 : 3;
  const sy = Math.min(sx * 4, (h - pad - 4) / Math.max(40, top - lo));
  const X = x => 4 + (x - x0) * sx;
  const base = h - 3;
  const Y = y => base - (y - lo) * sy;

  // The ground.
  ctx.beginPath();
  ctx.moveTo(X(x0), h);
  for (let x = x0; x <= x1; x += Math.max(1, 1 / sx)) ctx.lineTo(X(x), Y(g.h[Math.round(x - g.x0)]));
  ctx.lineTo(X(x1), h);
  ctx.closePath();
  const col = site.palette.soil;
  ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},.38)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${col[0] * 1.5 | 0},${col[1] * 1.5 | 0},${col[2] * 1.5 | 0},.95)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += Math.max(1, 1 / sx)) {
    const px = X(x), py = Y(g.h[Math.round(x - g.x0)]);
    x === x0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  // Rocks big enough to matter.
  ctx.fillStyle = 'rgba(236, 232, 223, .75)';
  for (const b of g.boulders) {
    if (b.h < 2 || b.x < x0 || b.x > x1) continue;
    ctx.fillRect(X(b.x) - 0.6, Y(b.base + b.h) - 1.4, 1.3, 1.3);
  }
  // What the main screen is showing.
  if (o.view) {
    const a = clamp(X(o.view[0]), 0, w), b = clamp(X(o.view[1]), 0, w);
    ctx.fillStyle = 'rgba(140, 220, 255, .1)';
    ctx.fillRect(a, 0, Math.max(2, b - a), h);
    ctx.strokeStyle = 'rgba(140, 220, 255, .35)';
    ctx.strokeRect(a + 0.5, 0.5, Math.max(2, b - a) - 1, h - 1);
  }
  const tx = X(site.target.x), ty = Y(g.h[Math.round(site.target.x - g.x0)]);
  // The target.
  ctx.fillStyle = 'rgba(140, 220, 255, .95)';
  ctx.beginPath();
  ctx.moveTo(tx, ty - 9);
  ctx.lineTo(tx + 3.5, ty - 5);
  ctx.lineTo(tx, ty - 1);
  ctx.lineTo(tx - 3.5, ty - 5);
  ctx.closePath();
  ctx.fill();
  // The lander: where it starts on the briefing, where it is in flight.
  const lx = o.f ? o.f.x : site.start.x;
  const ly = o.f ? o.f.y - o.f.veh.cg : top;
  const px = clamp(X(lx), 3, w - 3), py = clamp(Y(ly), 4, h - 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const off = X(lx) > w - 3 ? 1 : X(lx) < 3 ? -1 : 0;
  if (off) {
    // Flown off the end of the strip: an arrow at that end, pointing the way you went.
    const ex = off > 0 ? w - 1 : 1;
    ctx.moveTo(ex, py);
    ctx.lineTo(ex - off * 7, py - 4.5);
    ctx.lineTo(ex - off * 7, py + 4.5);
  } else {
    ctx.moveTo(px, py - 4);
    ctx.lineTo(px + 4, py + 3);
    ctx.lineTo(px - 4, py + 3);
  }
  ctx.closePath();
  ctx.fill();
  if (o.start) {
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(tx, py, tx, ty - 10);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Crater names: over the crater, a row higher if the target's mark or another name is in the way,
  // or beside the mark.
  if (o.labels) {
    ctx.font = '600 9px Jost, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(9, 10, 12, .9)';
    ctx.fillStyle = 'rgba(236, 232, 223, .6)';
    const taken = [[tx - 6, ty - 11, tx + 6, ty]];
    const clear = (a, y, tw) => a >= 2 && a + tw <= w - 2 && y - 8 >= 0 &&
      taken.every(([l, t, r, b]) => a + tw < l - 3 || a > r + 3 || y < t - 1 || y - 8 > b + 1);
    for (const l of g.labels) {
      if (l.x < x0 + 30 || l.x > x1 - 30) continue;
      const text = l.name.toUpperCase(), tw = ctx.measureText(text).width;
      const mid = X(l.x) - tw / 2;
      // Just above the highest ground under the words.
      const above = a => {
        let top = h;
        for (let p = a; p <= a + tw; p += 2) top = Math.min(top, Y(g.h[Math.round(x0 + (p - 4) / sx - g.x0)] ?? lo));
        return top - 3;
      };
      const y0 = above(mid);
      const spot = [[mid, y0], [mid, y0 - 11], [tx + 10, above(tx + 10)], [tx - 10 - tw, above(tx - 10 - tw)], [mid, y0 - 22]]
        .find(([a, y]) => clear(a, y, tw));
      if (!spot) continue;
      const [a, y] = spot;
      taken.push([a, y - 8, a + tw, y + 1]);
      ctx.strokeText(text, a, y);
      ctx.fillText(text, a, y);
    }
  }
}
