#!/usr/bin/env node
// theme-textures: the small raster tiles the built-in showcase themes lay behind the desk (#299): a
// paper tile for Paper & Ink and scanlines for Amber CRT, one per scheme. Each is drawn by a seeded
// generator with whole-number and basic float arithmetic only (no sin, no pow), so every machine and
// Node version draws the same pixels, and written as a 16-level indexed PNG with node:zlib. Nothing is
// downloaded. `node scripts/theme-textures.mjs` writes them; its test checks the committed tiles.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LEVELS = 16;

/** mulberry32: a small seeded generator, the same numbers for the same seed everywhere. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Paper: pulp clouds at two scales, a speck per pixel and wandering fibres; seamless at the edges. */
function paper(seed, size) {
  const rand = random(seed);
  const field = new Float64Array(size * size);
  const wrap = (v) => ((v % size) + size) % size;
  for (const [cells, weight] of [
    [4, 0.3],
    [16, 0.25],
  ]) {
    const grid = Float64Array.from({ length: cells * cells }, rand);
    const at = (gx, gy) => grid[(gy % cells) * cells + (gx % cells)];
    const step = size / cells;
    for (let y = 0; y < size; y++) {
      const y0 = Math.floor(y / step);
      const fy = smooth(y / step - y0);
      for (let x = 0; x < size; x++) {
        const x0 = Math.floor(x / step);
        const fx = smooth(x / step - x0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
        field[y * size + x] += weight * (top + (bottom - top) * fy);
      }
    }
  }
  for (let i = 0; i < field.length; i++) field[i] += 0.45 * rand();
  for (let n = 0; n < 70; n++) {
    let [x, y] = [rand() * size, rand() * size];
    let [dx, dy] = [rand() - 0.5, rand() - 0.5];
    const ink = 0.25 + 0.35 * rand();
    for (let s = 0, length = 10 + rand() * 30; s < length; s++) {
      const norm = Math.sqrt(dx * dx + dy * dy) || 1;
      [dx, dy] = [dx / norm, dy / norm];
      field[wrap(Math.floor(y)) * size + wrap(Math.floor(x))] += ink;
      [x, y] = [x + dx, y + dy];
      [dx, dy] = [dx + (rand() - 0.5) * 0.35, dy + (rand() - 0.5) * 0.35];
    }
  }
  // Spread the middle of the field over the levels; the densest fibre crossings simply saturate.
  const sorted = Float64Array.from(field).sort();
  const [lo, hi] = [
    sorted[Math.floor(sorted.length * 0.02)],
    sorted[Math.floor(sorted.length * 0.995)],
  ];
  const levels = new Uint8Array(size * size);
  for (let i = 0; i < field.length; i++) {
    levels[i] = Math.round(clamp01((field[i] - lo) / (hi - lo)) * (LEVELS - 1));
  }
  return { width: size, height: size, levels };
}

/** Scanlines: a lit row, a half-lit row and a dark one, with a little flicker on the lit rows. */
function scanlines(seed, size) {
  const rand = random(seed);
  const levels = new Uint8Array(size * size);
  const rows = [15, 6, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const base = rows[y % rows.length];
      const flicker = base > 0 ? Math.floor(rand() * 3) - 1 : 0;
      levels[y * size + x] = Math.min(LEVELS - 1, Math.max(0, base + flicker));
    }
  }
  return { width: size, height: size, levels };
}

/** The tiles: where each goes, how it is drawn, and its colour at full strength (RGB, alpha 0–255). */
export const TILES = [
  {
    file: "plugins/theme-paper/images/paper-light.png",
    draw: () => paper(0x9a9e7, 256),
    color: [92, 68, 34],
    alpha: 34,
  },
  {
    file: "plugins/theme-paper/images/paper-dark.png",
    draw: () => paper(0x5eed5, 256),
    color: [236, 222, 196],
    alpha: 16,
  },
  {
    file: "plugins/theme-amber/images/scanlines-light.png",
    draw: () => scanlines(0xc47, 96),
    color: [120, 64, 0],
    alpha: 20,
  },
  {
    file: "plugins/theme-amber/images/scanlines-dark.png",
    draw: () => scanlines(0xc47, 96),
    color: [255, 170, 40],
    alpha: 24,
  },
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 as PNG chunks carry it. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A 4-bit indexed PNG: sixteen entries of one colour, from clear to `alpha`. */
export function encode({ width, height, levels }, color, alpha) {
  const row = 1 + Math.ceil(width / 2);
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw[y * row + 1 + (x >> 1)] |= levels[y * width + x] << (x & 1 ? 0 : 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([4, 3, 0, 0, 0], 8);
  const palette = Buffer.from(Array.from({ length: LEVELS }, () => color).flat());
  const ramp = Buffer.from(Array.from({ length: LEVELS }, (_, i) => Math.round((i * alpha) / 15)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("tRNS", ramp),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Every tile's PNG bytes, by its path from the repository root. */
export function render() {
  return new Map(TILES.map((t) => [t.file, encode(t.draw(), t.color, t.alpha)]));
}

/** Write every tile into the repository. */
export function write(root = ROOT) {
  for (const [file, png] of render()) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), png);
    console.log(`${file} (${png.length} bytes)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) write();
