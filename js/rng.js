// A small seeded random number generator (mulberry32), so every site comes out the same each time
// and Free flight can roll new ground from a number.

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (r, lo, hi) => lo + (hi - lo) * r();

// A size from a power law between lo and hi: lots of small ones, a few big ones, like rocks on the Moon.
export function powerSize(r, lo, hi, k = 2.2) {
  const u = r();
  const a = Math.pow(lo, 1 - k), b = Math.pow(hi, 1 - k);
  return Math.pow(a + (b - a) * u, 1 / (1 - k));
}
