// The plaque you earn at a site: a metal plate with the site, the date you landed and your numbers
// engraved on it, in bronze, silver or gold. This game's own design.

const METAL = {
  gold: { rim: ['#8a6a1e', '#f7dc8a', '#b8902f', '#6e5216'], face: ['#f0d68a', '#cfa94e'], ink: '#5a4310' },
  silver: { rim: ['#6d757c', '#f2f5f7', '#959ea5', '#59616a'], face: ['#e3e7ea', '#b5bcc2'], ink: '#353c42' },
  bronze: { rim: ['#6b3f1b', '#e8b07c', '#9a6332', '#58321a'], face: ['#d59a66', '#a96c3a'], ink: '#3a210c' },
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// A small LM in outline, standing on its footpads at 0,0: legs out to the pads, the gold descent
// stage, the ascent stage with its sloping front and the docking tunnel on top.
const LM_PATH = [
  'M-33 0 H-27 M27 0 H33 M-3 0 H3', // footpads
  'M-30 -0.5 L-14 -15 M30 -0.5 L14 -15 M-28 -1 L-14 -7 M28 -1 L14 -7 M0 -7 V-1', // legs
  'M-14 -6 H14 V-19 H-14 Z', // descent stage
  'M-5 -6 L-7 -2.5 H7 L5 -6', // engine bell
  'M-12 -19 L-17 -20 V-27 L-11 -29 L-9 -34 L-3 -36.5 H5 L10 -33 L13 -28 V-21 L10 -19', // ascent stage
  'M-3 -36.5 V-39.5 H3 V-36.5 M10 -27 L12.5 -30', // tunnel, window
  'M-12 -33 L-15 -38 M-17.5 -37 A3 1.4 -25 0 0 -12.5 -39.5', // S-band dish on its boom
].join(' ');
// The LLTV for the training plaque: the frame on its legs, the jet up the middle, the cab out front.
const LLTV_PATH = [
  'M-20 0 H-13 M13 0 H20',
  'M-17 -0.5 L-10 -14 M17 -0.5 L10 -14 M-15 -2 L-10 -9 M15 -2 L10 -9',
  'M-10 -9 H10 V-20 H-10 Z M-10 -9 L0 -20 L10 -9',
  'M-3 -6 V-29 H3 V-6 Z',
  'M10 -16 H19 L20 -24 L17 -30 H10',
  'M-7 -24 A3 3 0 1 0 -7 -23.9 M7 -24 A3 3 0 1 0 7 -23.9',
].join(' ');

export function plaqueSVG({ tier, site, rec, mode, date }) {
  const m = METAL[tier] || METAL.bronze;
  const title = site.training ? 'TRAINING' : site.free ? 'FREE FLIGHT' : site.name.toUpperCase();
  const place = site.training ? 'ELLINGTON' : site.free ? `GROUND ${site.seed}` : site.place.toUpperCase();
  // The big line shrinks to fit the plate.
  const big = Math.min(19, (268 / place.length - 2.4) / 0.64);
  const craft = site.vehicle === 'lltv' ? LLTV_PATH : LM_PATH;
  const when = (date || new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  const line1 = `DOWN AT ${rec.down.toFixed(1)} FT/S · ${Math.round(rec.dist).toLocaleString('en-US')} FT FROM THE ${site.target.label === 'SURVEYOR 3' ? 'SURVEYOR' : site.target.label === 'PAD' ? 'PAD' : 'TARGET'}`;
  const line2 = `${rec.fuelPct.toFixed(1)}% FUEL LEFT · ${mode === 'arcade' ? 'ARCADE' : mode === 'free' ? 'FREE FLIGHT' : 'P66'}`;
  const engr = (x, y, size, text, weight = 600, ls = 2) =>
    `<text x="${x}" y="${y + 0.8}" font-size="${size}" font-weight="${weight}" letter-spacing="${ls}" fill="rgba(255,255,255,.45)" text-anchor="middle">${esc(text)}</text>` +
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" letter-spacing="${ls}" fill="${m.ink}" text-anchor="middle">${esc(text)}</text>`;
  const screw = (x, y) => `<circle cx="${x}" cy="${y}" r="4.2" fill="url(#rim-${tier})" stroke="${m.ink}" stroke-opacity=".5"/><path d="M${x - 2.6} ${y + 1.2} L${x + 2.6} ${y - 1.2}" stroke="${m.ink}" stroke-width="1.1" stroke-opacity=".7"/>`;
  return `<svg viewBox="0 0 320 196" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(tier)} plaque: ${esc(title)}, ${esc(place)}">
  <defs>
    <linearGradient id="rim-${tier}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${m.rim[1]}"/><stop offset=".45" stop-color="${m.rim[2]}"/><stop offset=".7" stop-color="${m.rim[0]}"/><stop offset="1" stop-color="${m.rim[3]}"/>
    </linearGradient>
    <linearGradient id="face-${tier}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${m.face[0]}"/><stop offset="1" stop-color="${m.face[1]}"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="316" height="192" rx="16" fill="url(#rim-${tier})"/>
  <rect x="11" y="11" width="298" height="174" rx="10" fill="url(#face-${tier})" stroke="${m.ink}" stroke-opacity=".35"/>
  ${screw(24, 24)}${screw(296, 24)}${screw(24, 172)}${screw(296, 172)}
  <g font-family="Jost, Futura, system-ui, sans-serif">
    ${engr(160, 38, 11, title, 600, 3.2)}
    ${engr(160, 60, big, place, 600, 2.4)}
    <g transform="translate(160 118)" fill="none" stroke-linejoin="round" stroke-linecap="round">
      <path d="M-120 0.8 H120" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/>
      <path d="M-120 0 H120" stroke="${m.ink}" stroke-width="1.2"/>
      <path d="${craft}" transform="translate(0 0.8)" stroke="rgba(255,255,255,.4)" stroke-width="1.6"/>
      <path d="${craft}" stroke="${m.ink}" stroke-width="1.6"/>
    </g>
    ${engr(160, 142, 9, line1, 600, 1.2)}
    ${engr(160, 156, 9, line2, 600, 1.2)}
    ${engr(160, 172, 8, `${tier.toUpperCase()} · ${when}`, 700, 2.4)}
  </g>
</svg>`;
}
