// The source images and data the DjVu fixtures are encoded from. make-fixtures.mjs writes them as
// PBM, PPM and text for DjVuLibre's tools; the tests rebuild the same pixels and bytes here, so no
// source image needs to be kept. Everything is generated from fixed seeds: no personal data.

/** A seeded 32-bit generator (mulberry32): the same numbers in every engine. @param {number} seed */
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "the page layer mask wavelet coder shape symbol library background foreground colour text " +
  "outline chunk slice band bucket stream block marker refine dictionary bundle index scan book";

/** Words from a fixed list, `length` characters of them. @param {number} length @param {number} seed */
export function sampleText(length, seed = 1) {
  const words = WORDS.split(" ");
  const next = rng(seed);
  let out = "";
  while (out.length < length) out += `${words[Math.floor(next() * words.length)]} `;
  return out.slice(0, length);
}

/** Bytes that compress badly but not hopelessly. @param {number} length @param {number} seed */
export function sampleBytes(length, seed = 2) {
  const next = rng(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 3 ? Math.floor(next() * 256) : i % 251;
  return out;
}

/**
 * @typedef {{ width: number, height: number, bits: Uint8Array }} Bitmap  1 is black, rows top first
 * @typedef {{ width: number, height: number, rgb: Uint8Array }} Pixmap
 */

/** A glyph: two or three thick random strokes on a small canvas. @param {() => number} next */
function glyph(next) {
  const width = 6 + Math.floor(next() * 6);
  const height = 10 + Math.floor(next() * 5);
  const bits = new Uint8Array(width * height);
  const strokes = 2 + Math.floor(next() * 2);
  for (let s = 0; s < strokes; s++) {
    const x0 = next() * width;
    const y0 = next() * height;
    const x1 = next() * width;
    const y1 = next() * height;
    for (let t = 0; t <= 24; t++) {
      const x = Math.floor(x0 + ((x1 - x0) * t) / 24);
      const y = Math.floor(y0 + ((y1 - y0) * t) / 24);
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        if (x + dx < width && y + dy < height) bits[(y + dy) * width + x + dx] = 1;
      }
    }
  }
  return { width, height, bits, descends: next() < 0.2 };
}

/**
 * A page of text-like lines: 30 glyphs repeated in words (JB2 matches them), some copies with a
 * pixel or two changed (refinement), and a framed drawing (a large non-symbol shape).
 * `glyphs` seeds the glyph set (pages with the same one share shapes), `seed` the layout.
 * @param {{ width: number, height: number, seed?: number, glyphs?: number, drawing?: boolean }} options
 * @returns {Bitmap}
 */
export function textPage({ width, height, seed = 3, glyphs = 3, drawing = true }) {
  const shapes = rng(glyphs);
  const set = Array.from({ length: 30 }, () => glyph(shapes));
  const next = rng(seed);
  const bits = new Uint8Array(width * height);
  const put = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (x >= 0 && y >= 0 && x < width && y < height) bits[y * width + x] = 1;
  };
  const bottom = drawing ? height - Math.floor(height / 3) : height - 20;
  for (let base = 30; base < bottom; base += 22) {
    let x = 16 + Math.floor(next() * 8);
    while (x < width - 40) {
      const letters = 2 + Math.floor(next() * 6);
      for (let i = 0; i < letters && x < width - 16; i++) {
        const g = set[Math.floor(next() * set.length)];
        const top = base - g.height + (g.descends ? 3 : 0);
        const noisy = next() < 0.25;
        for (let gy = 0; gy < g.height; gy++) {
          for (let gx = 0; gx < g.width; gx++) if (g.bits[gy * g.width + gx]) put(x + gx, top + gy);
        }
        if (noisy) put(x + Math.floor(next() * g.width), top + Math.floor(next() * g.height));
        x += g.width + 2;
      }
      x += 7 + Math.floor(next() * 4);
    }
  }
  if (drawing) {
    const left = 30;
    const top = bottom + 10;
    const right = width - 30;
    const low = height - 20;
    for (let x = left; x <= right; x++) for (const y of [top, top + 1, low - 1, low]) put(x, y);
    for (let y = top; y <= low; y++) for (const x of [left, left + 1, right - 1, right]) put(x, y);
    const cx = (left + right) / 2;
    const cy = (top + low) / 2;
    const r = (low - top) / 3;
    for (let a = 0; a < 2000; a++) {
      const t = (a / 2000) * 2 * Math.PI;
      put(Math.round(cx + r * Math.cos(t)), Math.round(cy + r * Math.sin(t)));
      put(Math.round(cx + (r + 1) * Math.cos(t)), Math.round(cy + (r + 1) * Math.sin(t)));
    }
    for (let x = left; x <= right; x++)
      put(x, Math.round(top + ((x - left) * (low - top)) / (right - left)));
  }
  return { width, height, bits };
}

/**
 * A photo-like colour image: smooth gradients, soft discs and a little texture.
 * @param {number} width @param {number} height @param {number} [seed]
 * @returns {Pixmap}
 */
export function photo(width, height, seed = 4) {
  const next = rng(seed);
  const discs = Array.from({ length: 6 }, () => ({
    x: next() * width,
    y: next() * height,
    r: 12 + next() * Math.min(width, height) * 0.25,
    c: [next() * 255, next() * 255, next() * 255],
  }));
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 90 + 80 * Math.sin(x / 41) * Math.cos(y / 29) + (60 * y) / height;
      let g = 110 + 70 * Math.cos((x + y) / 53) + (40 * x) / width;
      let b = 140 + 60 * Math.sin((x - y) / 37);
      for (const d of discs) {
        const dist = Math.hypot(x - d.x, y - d.y);
        const w = Math.max(0, Math.min(1, (d.r - dist) / 6));
        r += (d.c[0] - r) * w * 0.8;
        g += (d.c[1] - g) * w * 0.8;
        b += (d.c[2] - b) * w * 0.8;
      }
      const grain = ((x * 7 + y * 13) % 5) - 2;
      const at = (y * width + x) * 3;
      rgb[at] = clamp(r + grain);
      rgb[at + 1] = clamp(g + grain);
      rgb[at + 2] = clamp(b + grain);
    }
  }
  return { width, height, rgb };
}

/** A solid colour image. @param {number} width @param {number} height @param {number[]} colour */
export function solid(width, height, colour) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i += 3) rgb.set(colour, i);
  return { width, height, rgb };
}

/** @param {number} v */
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** The luminance of a colour image, as a grey image. @param {Pixmap} image */
export function grey(image) {
  const out = new Uint8Array(image.width * image.height);
  for (let i = 0; i < out.length; i++) {
    const [r, g, b] = image.rgb.subarray(i * 3, i * 3 + 3);
    out[i] = clamp(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { width: image.width, height: image.height, grey: out };
}

/** @param {Bitmap} page */
export function pbm(page) {
  const head = new TextEncoder().encode(`P4\n${page.width} ${page.height}\n`);
  const stride = (page.width + 7) >> 3;
  const out = new Uint8Array(head.length + stride * page.height);
  out.set(head);
  for (let y = 0; y < page.height; y++) {
    for (let x = 0; x < page.width; x++) {
      if (page.bits[y * page.width + x])
        out[head.length + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** @param {Pixmap} image */
export function ppm(image) {
  const head = new TextEncoder().encode(`P6\n${image.width} ${image.height}\n255\n`);
  const out = new Uint8Array(head.length + image.rgb.length);
  out.set(head);
  out.set(image.rgb, head.length);
  return out;
}

/** @param {{ width: number, height: number, grey: Uint8Array }} image */
export function pgm(image) {
  const head = new TextEncoder().encode(`P5\n${image.width} ${image.height}\n255\n`);
  const out = new Uint8Array(head.length + image.grey.length);
  out.set(head);
  out.set(image.grey, head.length);
  return out;
}

/** The pages the fixtures are made from (make-fixtures.mjs) and checked against (the tests). */
export const PAGES = {
  bitonal: { width: 640, height: 480, seed: 3, glyphs: 3 },
  shared1: { width: 480, height: 360, seed: 11, glyphs: 5, drawing: false },
  shared2: { width: 480, height: 360, seed: 12, glyphs: 5 },
  mask: { width: 600, height: 400, seed: 7, glyphs: 3, drawing: false },
  colours: { width: 480, height: 320, seed: 13, glyphs: 3, drawing: false },
  big: { width: 2550, height: 3300, seed: 21, glyphs: 3 },
};

/** The compound page's text colour, and the JB2-colours page's two colours (top, bottom half). */
export const INK = [20, 40, 160];
export const COLOURS = [
  [200, 30, 30],
  [30, 60, 200],
];

/** The compound page: a photo with the mask's text painted in INK. @param {Bitmap} mask */
export function compound(mask) {
  const page = photo(mask.width, mask.height, 8);
  for (let i = 0; i < mask.bits.length; i++) if (mask.bits[i]) page.rgb.set(INK, i * 3);
  return page;
}

/** Text in two colours on white: COLOURS[0] above the middle, COLOURS[1] below. @param {Bitmap} text */
export function colours(text) {
  const page = solid(text.width, text.height, [255, 255, 255]);
  for (let y = 0; y < text.height; y++) {
    for (let x = 0; x < text.width; x++) {
      const at = y * text.width + x;
      if (text.bits[at]) page.rgb.set(COLOURS[y < text.height / 2 ? 0 : 1], at * 3);
    }
  }
  return page;
}

/** The hidden text djvused puts on the book's first two pages. */
export const TEXT = [
  `(page 0 0 600 400
 (line 20 340 300 380 (word 20 340 120 380 "Hello") (word 140 340 300 380 "pages"))
 (line 20 280 300 320 (word 20 280 160 320 "second") (word 180 280 300 320 "line")))
`,
  `(page 0 0 480 320
 (column 0 0 480 320
  (para 10 200 470 300
   (line 10 260 470 300 (word 10 260 120 300 "Grüße") (word 140 260 260 300 "한글"))
   (line 10 200 470 240 (word 10 200 200 240 "colours")))))
`,
];

/** The book's outline. */
export const OUTLINE = `(bookmarks
 ("Cover" "#1")
 ("Chapter one" "#2" ("A section" "#3"))
 ("Elsewhere" "https://example.com/"))
`;
