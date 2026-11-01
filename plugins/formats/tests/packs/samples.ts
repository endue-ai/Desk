// Deterministic sample data for the pack tests: text made of words, noise, long runs, and x86-like
// code full of E8 calls, so every path of the decoders has something to do.

/** A seeded generator of numbers in [0, 1). */
export function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const WORDS =
  "the image holds files folders and links each chunk stands alone window offset match length tree block aligned verbatim".split(
    " ",
  );

/** `n` bytes of words and line breaks. */
export function text(n: number, seed = 1): Uint8Array {
  const next = random(seed);
  let s = "";
  while (s.length < n) {
    s += WORDS[Math.floor(next() * WORDS.length)] ?? "";
    s += next() < 0.1 ? ".\n" : " ";
  }
  return new TextEncoder().encode(s).subarray(0, n);
}

/** `n` bytes of noise. */
export function noise(n: number, seed = 2): Uint8Array {
  const next = random(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(next() * 256));
}

/** `n` bytes that look like x86 code: E8 calls with near, far and negative displacements. */
export function code(n: number, seed = 3): Uint8Array {
  const next = random(seed);
  const out = new Uint8Array(n);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; ) {
    const pick = next();
    if (pick < 0.3 && i + 5 <= n) {
      out[i] = 0xe8;
      const kind = next();
      const disp =
        kind < 0.4
          ? Math.floor(next() * 4096) - 2048
          : kind < 0.7
            ? -Math.floor(next() * i)
            : kind < 0.9
              ? Math.floor(next() * 0x7fffffff)
              : 12000000 - i + Math.floor(next() * 100);
      view.setInt32(i + 1, disp | 0, true);
      i += 5;
    } else if (pick < 0.5 && i > 64) {
      const from = i - 1 - Math.floor(next() * Math.min(i - 1, 3000));
      const len = Math.min(n - i, 3 + Math.floor(next() * 40));
      out.copyWithin(i, from, from + len);
      i += len;
    } else out[i++] = [0x55, 0x89, 0xe5, 0x8b, 0x45, 0xc3, 0x90][Math.floor(next() * 7)] ?? 0;
  }
  return out;
}

/** Text, a long run, repeats at every distance up to `reach`, code and noise, `n` bytes in all. */
export function mixed(n: number, reach = 30000, seed = 4): Uint8Array {
  const out = new Uint8Array(n);
  const parts = [
    text(n / 4, seed),
    new Uint8Array(1000).fill(0x61),
    code(n / 4, seed),
    noise(n / 8, seed),
  ];
  let at = 0;
  for (const p of parts) {
    out.set(p.subarray(0, Math.max(0, n - at)), at);
    at += p.length;
  }
  for (let d = 1; d <= reach && at + 8 <= n; d *= 2) {
    const from = Math.max(0, at - d);
    out.copyWithin(at, from, from + 8);
    at += 8;
  }
  if (at < n) out.set(text(n - at, seed + 1), at);
  return out;
}
