// NEON HARBOR — seeded random number generator. A small mulberry32-style
// generator written here so the city layout is identical on every load for
// a given seed, which keeps screenshots reproducible.

// 32-bit integer hash of a string seed, so 'neon-harbor' and 1337 both work.
export function hashSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Mulberry32: tiny, fast, good enough for procedural layout.
export function createRng(seed) {
  let a = hashSeed(seed);
  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    // Float in [min, max).
    range(min, max) {
      return min + next() * (max - min);
    },
    // Integer in [min, max] inclusive.
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    // One element of an array.
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    // True with probability p.
    chance(p) {
      return next() < p;
    },
    // Shuffle a copy of an array (Fisher-Yates).
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
  };
}
