// The landers, drawn side-on in feet with y up, from the footpads. The LM: 31 ft across the footpads,
// about 23 ft tall, gold and black foil on the descent stage, the grey ascent stage on top. Seen from
// the side you see the aft leg (left), the forward leg with the ladder and porch (right, and no probe:
// the crews had it taken off), and the near side leg in front of the engine bell.
// The LLTV is Ellington's jet-lifted trainer: a frame on four legs with a jet in the middle.

const GOLD = ['#f3d98a', '#d8b058', '#a97d2f', '#6e4f1b'];

// Thin parts (struts, probes) never get thinner than this many feet, so they stay a pixel wide when small.
let MINW = 0;
export function setMinLine(w) { MINW = w; }
const lw = w => Math.max(w, MINW);

// ctx is already set up so that 1 unit = 1 foot, y up, origin between the footpads.
// o: { probes: 'hang' | 'bent' | 'none', detail: 0..1, engine: 0..1, stage: 'all' | 'descent' | 'ascent' }
export function drawLM(ctx, o = {}) {
  const detail = o.detail ?? 1;
  const stage = o.stage || 'all';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (stage !== 'ascent') {
    descentBack(ctx, detail, o);
    if (stage === 'all') ascent(ctx, detail);
    descentFront(ctx, detail, o);
  } else ascent(ctx, detail);
}

function descentBack(ctx, detail, o) {
  // The far side leg hides behind everything; the aft and forward legs first.
  for (const s of [-1, 1]) {
    // Primary strut, from high on the stage out to the footpad.
    strut(ctx, s * 6.2, 9.0, s * 15.1, 1.0, 0.62, '#2b2620', '#8f7a52');
    // The lower brace.
    strut(ctx, s * 6.9, 5.3, s * 13.0, 2.4, 0.34, '#3b342a', '#9b8a63');
    // A deployment truss up to the stage.
    if (detail > 0.4) strut(ctx, s * 6.9, 7.4, s * 12.2, 3.3, 0.22, '#4a4234', '#a39470');
    footpad(ctx, s * 15.5, 1);
  }
  // Probes on the aft leg; none on the forward leg with the ladder.
  if (o.probes !== 'none') probe(ctx, -15.5, o.probes === 'bent' ? -1 : 0);

  // The engine bell under the stage.
  const bell = ctx.createLinearGradient(-2.5, 0, 2.5, 0);
  bell.addColorStop(0, '#5b5650');
  bell.addColorStop(0.35, '#3a3632');
  bell.addColorStop(1, '#1d1b19');
  ctx.fillStyle = bell;
  ctx.beginPath();
  ctx.moveTo(-1.15, 4.8);
  ctx.lineTo(1.15, 4.8);
  ctx.lineTo(2.5, 1.55);
  ctx.lineTo(-2.5, 1.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7a7368';
  ctx.fillRect(-2.55, 1.45, 5.1, 0.28);
  if (o.engine > 0.02) plume(ctx, o.engine);

  // The descent stage: an octagon, so three faces show, wrapped in foil.
  const face = (x0, x1, top, g) => {
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, 4.7);
    ctx.lineTo(x1, 4.7);
    ctx.lineTo(x1, top);
    ctx.lineTo(x0, top);
    ctx.closePath();
    ctx.fill();
  };
  const gMid = ctx.createLinearGradient(0, 4.7, 0, 10.1);
  gMid.addColorStop(0, GOLD[2]);
  gMid.addColorStop(0.45, GOLD[1]);
  gMid.addColorStop(1, GOLD[0]);
  face(-3.6, 3.6, 10.1, gMid);
  const gL = ctx.createLinearGradient(-6.9, 0, -3.6, 0);
  gL.addColorStop(0, GOLD[1]);
  gL.addColorStop(1, GOLD[0]);
  face(-6.9, -3.6, 9.9, gL);
  const gR = ctx.createLinearGradient(3.6, 0, 6.9, 0);
  gR.addColorStop(0, GOLD[2]);
  gR.addColorStop(1, GOLD[3]);
  face(3.6, 6.9, 9.9, gR);
  if (detail > 0.3) {
    // Crinkles in the foil.
    ctx.globalAlpha = 0.35;
    const marks = [[-5.8, 6.1, 1.6, 0.9], [-2.6, 8.4, 2.1, 0.7], [0.4, 6.0, 1.7, 1.1], [2.2, 8.9, 1.2, 0.5], [4.6, 6.8, 1.5, 1.4], [-1.2, 5.3, 1.1, 0.5], [5.4, 8.6, 0.9, 0.6]];
    marks.forEach(([x, y, w, h], i) => {
      ctx.fillStyle = i % 2 ? '#fff1c2' : '#7b5a22';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h * 0.3);
      ctx.lineTo(x + w * 0.7, y + h);
      ctx.lineTo(x - w * 0.2, y + h * 0.6);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    // Black blankets round the top deck and a quad bay.
    ctx.fillStyle = '#1c1a17';
    ctx.fillRect(-6.9, 9.55, 13.8, 0.55);
    ctx.fillRect(-6.5, 5.0, 2.4, 3.6);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fillRect(-6.3, 7.9, 2.0, 0.25);
  }
  // Porch and ladder on the forward leg.
  if (detail > 0.3) {
    ctx.strokeStyle = '#d8d6cf';
    ctx.lineWidth = lw(0.22);
    ctx.beginPath();
    ctx.moveTo(6.9, 9.75);
    ctx.lineTo(9.3, 9.75);
    ctx.moveTo(9.3, 9.75);
    ctx.lineTo(9.3, 11.2);
    ctx.stroke();
    ctx.lineWidth = lw(0.14);
    for (let k = 0; k < 7; k++) {
      const t = 0.12 + k * 0.12;
      const x = 6.2 + (15.1 - 6.2) * t, y = 9.0 + (1.0 - 9.0) * t;
      ctx.beginPath();
      ctx.moveTo(x - 0.35, y + 0.4);
      ctx.lineTo(x + 0.55, y + 0.4);
      ctx.stroke();
    }
  }
}

function descentFront(ctx, detail, o) {
  // The near side leg, pointing at you: a strut straight down to its footpad, with braces.
  strut(ctx, -2.4, 5.0, -0.25, 2.1, 0.24, '#463e31', '#a8956b');
  strut(ctx, 2.4, 5.0, 0.25, 2.1, 0.24, '#463e31', '#a8956b');
  strut(ctx, 0, 7.6, 0, 1.0, 0.7, '#2e2922', '#9a8459');
  footpad(ctx, 0, 1.12);
  if (o.probes !== 'none') probe(ctx, 0, o.probes === 'bent' ? 1 : 0);
}

function ascent(ctx, detail) {
  // Aft equipment bay.
  ctx.fillStyle = '#2a2b2d';
  ctx.beginPath();
  ctx.moveTo(-3.4, 10.9);
  ctx.lineTo(-7.5, 11.2);
  ctx.lineTo(-7.5, 14.4);
  ctx.lineTo(-3.4, 15.2);
  ctx.closePath();
  ctx.fill();
  // Crew cabin, front face toward the direction of flight.
  const g = ctx.createLinearGradient(-4, 0, 6.3, 0);
  g.addColorStop(0, '#a9aba8');
  g.addColorStop(0.55, '#d4d5d0');
  g.addColorStop(1, '#8d8f8c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-3.6, 10.15);
  ctx.lineTo(4.4, 10.15);
  ctx.lineTo(6.2, 12.2);
  ctx.lineTo(6.2, 15.4);
  ctx.lineTo(4.7, 17.4);
  ctx.lineTo(-1.8, 17.4);
  ctx.lineTo(-3.6, 16.1);
  ctx.closePath();
  ctx.fill();
  if (detail > 0.3) {
    // Dark panels: the black front round the windows, and thermal patches.
    ctx.fillStyle = '#18191b';
    ctx.beginPath();
    ctx.moveTo(4.0, 12.5);
    ctx.lineTo(6.2, 12.2);
    ctx.lineTo(6.2, 15.4);
    ctx.lineTo(4.7, 17.0);
    ctx.lineTo(3.4, 16.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5c5f62';
    ctx.fillRect(-2.9, 11.0, 2.4, 2.6);
    ctx.fillRect(0.2, 14.6, 2.6, 1.9);
    ctx.fillStyle = '#26282a';
    ctx.fillRect(-0.2, 11.0, 2.2, 1.5);
    // The triangular windows.
    ctx.fillStyle = '#4c6377';
    ctx.beginPath();
    ctx.moveTo(4.55, 13.3);
    ctx.lineTo(5.85, 13.0);
    ctx.lineTo(5.85, 15.0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.moveTo(5.0, 13.35);
    ctx.lineTo(5.6, 13.25);
    ctx.lineTo(5.6, 14.0);
    ctx.closePath();
    ctx.fill();
    // The hatch.
    ctx.strokeStyle = '#3b3d40';
    ctx.lineWidth = 0.14;
    ctx.strokeRect(4.75, 10.5, 1.2, 1.5);
  }
  // Docking tunnel on top.
  ctx.fillStyle = '#c3c4bf';
  ctx.fillRect(-1.5, 17.35, 3.0, 1.3);
  ctx.fillStyle = '#7d7f7c';
  ctx.fillRect(-1.6, 18.55, 3.2, 0.3);
  if (detail > 0.4) {
    // Rendezvous radar dish on the front, the steerable S-band dish aft, VHF aerials.
    ctx.strokeStyle = '#9fa19d';
    ctx.lineWidth = lw(0.22);
    ctx.beginPath();
    ctx.moveTo(3.4, 17.3);
    ctx.lineTo(3.4, 18.4);
    ctx.moveTo(-4.0, 16.0);
    ctx.lineTo(-5.4, 18.4);
    ctx.moveTo(-6.6, 14.4);
    ctx.lineTo(-7.8, 17.4);
    ctx.moveTo(5.2, 16.2);
    ctx.lineTo(6.6, 18.6);
    ctx.stroke();
    dish(ctx, 3.4, 18.6, 1.0, 0.0);
    dish(ctx, -5.5, 18.7, 1.15, -0.5);
    // Reaction control thruster quads, one each side.
    quad(ctx, -7.0, 15.6, -1);
    quad(ctx, 6.5, 15.7, 1);
  }
}

function quad(ctx, x, y, s) {
  ctx.fillStyle = '#9da09d';
  ctx.fillRect(x - 0.5, y - 0.5, 1.0, 1.0);
  ctx.fillStyle = '#56585a';
  const cone = (x0, y0, dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(x0 - dy * 0.22, y0 + dx * 0.22);
    ctx.lineTo(x0 + dy * 0.22, y0 - dx * 0.22);
    ctx.lineTo(x0 + dx * 0.75 + dy * 0.36, y0 + dy * 0.75 - dx * 0.36);
    ctx.lineTo(x0 + dx * 0.75 - dy * 0.36, y0 + dy * 0.75 + dx * 0.36);
    ctx.closePath();
    ctx.fill();
  };
  cone(x, y + 0.45, 0, 1);
  cone(x, y - 0.45, 0, -1);
  cone(x + s * 0.45, y, s, 0);
}

function dish(ctx, x, y, r, tilt) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.fillStyle = '#e4e3dc';
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b8c88';
  ctx.beginPath();
  ctx.ellipse(0, -0.05, r * 0.8, r * 0.16, 0, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}

function strut(ctx, x0, y0, x1, y1, w, dark, light) {
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw(w);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = light;
  ctx.lineWidth = lw(w * 0.38);
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.18, y0 + w * 0.12);
  ctx.lineTo(x1 - w * 0.18, y1 + w * 0.12);
  ctx.stroke();
}

function footpad(ctx, x, k) {
  const w = 1.55 * k;
  const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, '#e9e3cf');
  g.addColorStop(0.6, '#b9b29c');
  g.addColorStop(1, '#6f6a5c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - w, 0.95);
  ctx.lineTo(x + w, 0.95);
  ctx.lineTo(x + w * 0.72, 0.1);
  ctx.lineTo(x - w * 0.72, 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8a8370';
  ctx.fillRect(x - w, 0.88, 2 * w, 0.16);
}

// A 67-inch contact probe. bend: 0 hanging, ±1 folded back after touchdown.
function probe(ctx, x, bend) {
  const L = 67 / 12;
  ctx.strokeStyle = '#d7d4c8';
  ctx.lineWidth = lw(0.13);
  ctx.beginPath();
  ctx.moveTo(x, 0.12);
  if (!bend) ctx.lineTo(x, -L);
  else ctx.lineTo(x + bend * L * 0.86, -L * 0.18 + 0.1);
  ctx.stroke();
  ctx.fillStyle = '#d7d4c8';
  ctx.beginPath();
  if (!bend) ctx.arc(x, -L, 0.14, 0, Math.PI * 2);
  else ctx.arc(x + bend * L * 0.86, -L * 0.18 + 0.1, 0.14, 0, Math.PI * 2);
  ctx.fill();
}

// The descent engine's exhaust is nearly invisible in vacuum; a faint shimmer shows it's working.
function plume(ctx, k) {
  const L = 3 + 9 * k;
  const g = ctx.createLinearGradient(0, 1.5, 0, 1.5 - L);
  g.addColorStop(0, `rgba(255, 236, 205, ${0.22 * k + 0.05})`);
  g.addColorStop(0.4, `rgba(255, 214, 170, ${0.08 * k})`);
  g.addColorStop(1, 'rgba(255, 214, 170, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-2.4, 1.5);
  ctx.lineTo(2.4, 1.5);
  ctx.lineTo(3.4 + 2 * k, 1.5 - L);
  ctx.lineTo(-3.4 - 2 * k, 1.5 - L);
  ctx.closePath();
  ctx.fill();
}

// The ascent stage's own engine, for an abort.
export function drawAscentPlume(ctx, k) {
  const L = 4 + 6 * k;
  const g = ctx.createLinearGradient(0, 10, 0, 10 - L);
  g.addColorStop(0, 'rgba(255, 240, 220, .55)');
  g.addColorStop(1, 'rgba(255, 200, 150, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-0.9, 10.1);
  ctx.lineTo(0.9, 10.1);
  ctx.lineTo(2.2, 10 - L);
  ctx.lineTo(-2.2, 10 - L);
  ctx.closePath();
  ctx.fill();
}

// The Lunar Landing Training Vehicle: a tubular frame on four legs, a jet engine standing up in the
// middle, the pilot's cab out front and the hydrogen-peroxide tanks for its lift rockets.
export function drawLLTV(ctx, o = {}) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const tube = (x0, y0, x1, y1, w = 0.32, c = '#d9dbd6') => {
    ctx.strokeStyle = c;
    ctx.lineWidth = lw(w);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  // Legs and pads.
  for (const s of [-1, 1]) {
    tube(s * 4.0, 6.2, s * 7.3, 0.7, 0.42, '#b8bbb6');
    tube(s * 4.0, 4.4, s * 6.4, 1.6, 0.26, '#a5a8a3');
    ctx.fillStyle = '#8d908b';
    ctx.fillRect(s * 7.5 - 1.1, 0, 2.2, 0.55);
  }
  // Exhaust from the jet when it's running.
  if (o.engine > 0.02) {
    const L = 4 + 6 * o.engine;
    const g = ctx.createLinearGradient(0, 2.9, 0, 2.9 - L);
    g.addColorStop(0, `rgba(210, 210, 200, ${0.3 * o.engine + 0.1})`);
    g.addColorStop(1, 'rgba(210, 210, 200, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-1.0, 2.9);
    ctx.lineTo(1.0, 2.9);
    ctx.lineTo(2.2, 2.9 - L);
    ctx.lineTo(-2.2, 2.9 - L);
    ctx.closePath();
    ctx.fill();
  }
  // The frame.
  tube(-4.2, 4.4, 4.2, 4.4);
  tube(-4.2, 8.6, 4.2, 8.6);
  tube(-4.2, 4.4, -4.2, 8.6);
  tube(4.2, 4.4, 4.2, 8.6);
  tube(-4.2, 4.4, 0, 8.6, 0.2);
  tube(4.2, 4.4, 0, 8.6, 0.2);
  // Tanks.
  for (const x of [-2.9, 2.6]) {
    ctx.fillStyle = '#e7e8e3';
    ctx.beginPath();
    ctx.arc(x, 9.7, 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath();
    ctx.arc(x + 0.35, 9.55, 0.8, -0.6, 1.9);
    ctx.fill();
  }
  // The jet, on its gimbal.
  const g = ctx.createLinearGradient(-1.4, 0, 1.4, 0);
  g.addColorStop(0, '#9a9e98');
  g.addColorStop(0.5, '#6d716c');
  g.addColorStop(1, '#3f423e');
  ctx.fillStyle = g;
  ctx.fillRect(-1.3, 3.0, 2.6, 8.4);
  ctx.fillStyle = '#2b2d2a';
  ctx.fillRect(-1.0, 2.6, 2.0, 0.5);
  ctx.fillStyle = '#c7c9c4';
  ctx.fillRect(-1.5, 8.2, 3.0, 0.5);
  // The pilot's cab, facing the way it flies.
  ctx.fillStyle = '#f0f0ea';
  ctx.beginPath();
  ctx.moveTo(4.2, 6.6);
  ctx.lineTo(7.0, 6.6);
  ctx.lineTo(7.4, 9.4);
  ctx.lineTo(6.4, 11.4);
  ctx.lineTo(4.2, 11.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3e5568';
  ctx.beginPath();
  ctx.moveTo(5.6, 9.2);
  ctx.lineTo(7.05, 9.2);
  ctx.lineTo(6.3, 10.9);
  ctx.lineTo(5.6, 10.9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d0582c';
  ctx.fillRect(4.2, 7.3, 2.9, 0.35);
}

// Rough outlines for the shadows on the ground (feet, y up).
export const OUTLINE = {
  lm: [[-16.9, 0], [-14, 0.9], [-6.9, 5], [-6.9, 10], [-7.6, 11.2], [-7.6, 15], [-3.6, 16.2], [-1.6, 18.8], [1.6, 18.8], [4.7, 17.4], [6.2, 15.4], [6.9, 10], [6.9, 5], [14, 0.9], [16.9, 0], [2.5, 1.6], [-2.5, 1.6]],
  lltv: [[-8.6, 0], [-4.2, 4.4], [-4.2, 10.7], [4.2, 11.4], [7.4, 9.4], [7.0, 6.6], [8.6, 0], [1.2, 2.8], [-1.2, 2.8]],
};
