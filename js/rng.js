// LAST RESORT — deterministic randomness.
//
// LAW (spec §7): seeds carry a VERSION FIELD. A seed without v: is not a seed,
// it is a bug waiting for the day the generator changes and old replays,
// daily-tide runs and shared build codes quietly stop reproducing.
//
// LAW: the sim draws from this and nothing else. No Math.random() below the
// render layer, ever.

export const SEED_VERSION = 1;

// mulberry32 — 32-bit, fast, no state beyond one uint. House standard.
export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a — turn a human seed ("besaid", a date key) into a uint32.
export function hashString(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// The seed OBJECT. Everything that can change the shape of a run rides in here
// so a run is reproducible from one JSON blob.
//   v     — seed format version (LAW)
//   seed  — the uint32 actually fed to mulberry32
//   label — what the human typed, kept for display/share links
//   rules — which tuning generation produced it
export function makeSeed(input, rules) {
  let seed, label;
  if (input && typeof input === 'object') {
    seed = (input.seed >>> 0) || hashString(input.label || 'castaway');
    label = input.label !== undefined ? String(input.label) : String(seed);
  } else if (typeof input === 'number') {
    seed = input >>> 0; label = String(seed);
  } else if (typeof input === 'string' && input !== '') {
    seed = hashString(input); label = input;
  } else {
    // No seed given: pick one ONCE, at the boundary, and record it. The sim
    // itself never touches Math.random().
    seed = (Math.random() * 4294967296) >>> 0;
    label = String(seed);
  }
  return { v: SEED_VERSION, seed: seed >>> 0, label, rules: rules || 'p0' };
}

// A named sub-stream. Keeps one system's draws from shifting another's when we
// add content later — spawn rolls stay stable even after loot rolls appear.
export function subStream(seedObj, name) {
  return mulberry32((seedObj.seed ^ hashString(name)) >>> 0);
}

// Integer helpers — used everywhere in the sim so the call sites read plainly
// and every draw is one rng() call (draw ORDER is part of determinism).
export function randInt(rng, loInclusive, hiInclusive) {
  return loInclusive + Math.floor(rng() * (hiInclusive - loInclusive + 1));
}

export function randRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
