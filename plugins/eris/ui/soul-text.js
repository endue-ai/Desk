// Soul text: each character condenses from light as its word is spoken, then scatters upward.
// Timings follow docs/ko/first-run-scenario.md ("소울 텍스트") and the keyframes and easings are
// ported unchanged from docs/reference/eris-opening-prototype.html.

export const WISP = {
  name: "wisp",
  inMs: 900,
  stagger: 35,
  outMs: 1600,
  jitterMs: 450,
  inEasing: "cubic-bezier(.2,.7,.2,1)",
  outEasing: "cubic-bezier(.55,0,.85,.35)",
};
export const SOLEMN = {
  name: "solemn",
  inMs: 1500,
  stagger: 0,
  outMs: 1400,
  jitterMs: 0,
  inEasing: "ease-out",
  outEasing: "ease-in",
};
/** prefers-reduced-motion: no particles and no scatter, a 200 ms fade each way. */
export const REDUCED = {
  name: "reduced",
  inMs: 200,
  stagger: 0,
  outMs: 200,
  jitterMs: 0,
  inEasing: "ease-out",
  outEasing: "ease-in",
};

// Scatter direction per glyph: [dx px, dy px, rotate deg] (prototype .d0–.d5).
const DRIFT = [
  [-12, -34, -6],
  [8, -24, 4],
  [-4, -40, 2],
  [12, -30, -3],
  [-9, -20, 5],
  [5, -38, -5],
];

/** A small seeded PRNG (mulberry32): the same seed always scatters the same way. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-glyph scatter delays in [0, jitterMs), from a fixed seed. */
export function scatterDelays(count, seed, jitterMs = WISP.jitterMs) {
  const random = mulberry32(seed + 1);
  return Array.from({ length: count }, () => Math.floor(random() * jitterMs));
}

/** Without voice timestamps: split `durationMs` over the words by character position. */
export function wordsFromText(text, startMs, durationMs) {
  const words = [];
  const pattern = /\S+/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    words.push({
      t: match[0],
      at: startMs + Math.round((durationMs * match.index) / text.length),
    });
  }
  return words;
}

/**
 * Lay out one line. `line` = { index, words: [{ t, at, cap?, gold?, user?, plainLast? }], out }:
 * `at` is when the word is spoken, `cap` when a leading capital shows first, `out` when the line
 * scatters (null: it stays). `index` seeds the scatter. All times are timeline milliseconds.
 */
export function layoutLine(line, style = WISP) {
  const total = line.words.reduce((n, word) => n + Array.from(word.t).length, 0);
  const delays =
    style.jitterMs > 0
      ? scatterDelays(total, line.index, style.jitterMs)
      : new Array(total).fill(0);
  const glyphs = [];
  let k = 0;
  line.words.forEach((word, w) => {
    const chars = Array.from(word.t);
    const hasCap = word.cap !== undefined;
    chars.forEach((char, i) => {
      const inAt = hasCap
        ? i === 0
          ? word.cap
          : word.at + (i - 1) * style.stagger
        : word.at + i * style.stagger;
      glyphs.push({
        char,
        word: w,
        inAt,
        outAt: line.out === null || line.out === undefined ? null : line.out + delays[k],
        gold: Boolean(word.gold) || (hasCap && i === 0),
        user: Boolean(word.user) && !(word.plainLast && i === chars.length - 1),
        drift: (k * 7 + line.index * 3) % DRIFT.length,
      });
      k += 1;
    });
  });
  return { glyphs, text: line.words.map((word) => word.t).join(" ") };
}

function keyframesIn(style) {
  if (style.name === "wisp") {
    return [
      { offset: 0, opacity: 0, filter: "blur(14px)", transform: "translateY(8px) scale(1.12)" },
      { offset: 0.6, opacity: 1 },
      { offset: 1, opacity: 1, filter: "blur(0px)", transform: "none" },
    ];
  }
  const blur = style.name === "solemn" ? 6 : 0;
  return [
    { opacity: 0, filter: `blur(${blur}px)` },
    { opacity: 1, filter: "blur(0px)" },
  ];
}

function keyframesOut(style, drift) {
  if (style.name === "wisp") {
    const [dx, dy, r] = DRIFT[drift];
    return [
      { opacity: 1, filter: "blur(0px)", transform: "none" },
      {
        opacity: 0,
        filter: "blur(10px)",
        transform: `translate(${dx}px, ${dy}px) rotate(${r}deg) scale(0.96)`,
      },
    ];
  }
  const blur = style.name === "solemn" ? 4 : 0;
  return [
    { opacity: 1, filter: "blur(0px)" },
    { opacity: 0, filter: `blur(${blur}px)` },
  ];
}

/**
 * Build a line's DOM and add its animations to `timeline`. Returns the line's wrapper element.
 * The wrapper is aria-hidden: screen readers get whole sentences from the live region instead.
 */
export function renderLine(doc, timeline, line, style = WISP) {
  const { glyphs } = layoutLine(line, style);
  const wrap = doc.createElement("div");
  wrap.className = "wrap";
  wrap.setAttribute("aria-hidden", "true");
  const row = doc.createElement("div");
  row.className = "line";
  const words = [];
  for (const glyph of glyphs) {
    let word = words[glyph.word];
    if (!word) {
      word = doc.createElement("span");
      word.className = "word";
      words[glyph.word] = word;
      row.append(word);
    }
    const span = doc.createElement("span");
    span.className = `ch${glyph.gold ? " gold" : ""}${glyph.user ? " user" : ""}`;
    span.textContent = glyph.char;
    word.append(span);
    timeline.add(
      span.animate(keyframesIn(style), {
        delay: glyph.inAt,
        duration: style.inMs,
        easing: style.inEasing,
        fill: "both",
      }),
    );
    if (glyph.outAt !== null) {
      timeline.add(
        span.animate(keyframesOut(style, glyph.drift), {
          delay: glyph.outAt,
          duration: style.outMs,
          easing: style.outEasing,
          fill: "forwards",
        }),
      );
    }
  }
  wrap.append(row);
  return wrap;
}

/** Let a staying line leave (it drifts up and blurs out) from `at`. */
export function leave(timeline, element, at, reduced = false) {
  const frames = reduced
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { opacity: 1, filter: "blur(0px)", transform: "none" },
        { opacity: 0, filter: "blur(8px)", transform: "translateY(-24px)" },
      ];
  timeline.add(
    element.animate(frames, {
      delay: at,
      duration: reduced ? 200 : 1100,
      easing: "ease-in",
      fill: "forwards",
    }),
  );
}
