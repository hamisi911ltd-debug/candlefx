/** Deterministic seeded PRNG (mulberry32) + Box-Muller gaussian sampling.
 * Not required to match the old Python backend bit-for-bit - only needs to be a
 * pure, deterministic function of its inputs so the same (seed, symbol, tick)
 * always produces the same candle, with no server-side state to store. */

function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededUniform(...parts: (string | number)[]): number {
  const rng = mulberry32(hashStringToSeed(parts.join("|")));
  return rng();
}

/** Deterministic pseudo-gaussian sample (mean 0, given stddev) via Box-Muller,
 * seeded by the same string key scheme used elsewhere. */
export function seededGaussian(stddev: number, ...parts: (string | number)[]): number {
  const rng = mulberry32(hashStringToSeed(parts.join("|")));
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stddev;
}

export function seededChoice<T>(choices: T[], ...parts: (string | number)[]): T {
  const rng = mulberry32(hashStringToSeed(parts.join("|")));
  const idx = Math.floor(rng() * choices.length);
  return choices[Math.min(idx, choices.length - 1)];
}
