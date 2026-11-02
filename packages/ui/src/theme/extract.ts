/**
 * The main colours of an image (docs/ko/theme-requirements.md TS-09): k-means in OKLab on a
 * downsampled copy of its pixels, from seeded first centres, so the same image always gives the same
 * colours, ordered by how much of the image they cover. Pixels at least half transparent do not count.
 * DOM-free: it reads RGBA bytes as ImageData holds them, so the studio decodes an image on the device
 * and tests build images in memory. Each colour returned is one of the image's own pixels.
 */
import { formatColor, toOklch } from "./color";

/** RGBA bytes, four per pixel, row by row: what ImageData holds. */
export interface Pixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface Swatch {
  /** `#rrggbb`, a colour of the image. */
  color: string;
  /** The part of the counted pixels its cluster covers, 0–1. */
  share: number;
}

export interface ExtractOptions {
  /** How many colours: five by default. */
  count?: number;
  /** At most about this many pixels are read, on an even grid: 4096 by default. */
  samples?: number;
  /** The seed the first centres are drawn with. */
  seed?: number;
}

type Lab = [number, number, number];

/** A distinct colour of the sample and how many sampled pixels have it. */
interface Point {
  rgb: number;
  lab: Lab;
  weight: number;
}

const lab = (rgb: number): Lab => {
  const [L, C, H] = toOklch([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 1]);
  const h = (H * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
};
const dist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = (rgb: number) => formatColor([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 1]);

/** mulberry32: a small seeded generator, 0 ≤ n < 1. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The distinct opaque colours on an even grid of about `samples` pixels, with their counts. */
function sample(image: Pixels, samples: number): Point[] {
  const { width, height, data } = image;
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / Math.max(1, samples))));
  const counts = new Map<number, number>();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if ((data[i + 3] ?? 0) < 128) continue;
      const rgb = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    }
  }
  return [...counts].map(([rgb, weight]) => ({ rgb, lab: lab(rgb), weight }));
}

/** Pick a point with a chance proportional to `weight(i)`. */
function draw(points: Point[], weight: (i: number) => number, next: () => number): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += weight(i);
  let target = next() * total;
  for (let i = 0; i < points.length; i++) {
    target -= weight(i);
    if (target < 0) return i;
  }
  return points.length - 1;
}

/** First centres by weighted k-means++, a few draws a step and the one that helps most kept. */
function seeds(points: Point[], k: number, next: () => number): Lab[] {
  const first = points[draw(points, (i) => points[i]?.weight ?? 0, next)];
  if (!first) return [];
  const centres: Lab[] = [first.lab];
  const near = points.map((p) => dist2(p.lab, first.lab));
  const trials = 2 + Math.floor(Math.log(k));
  while (centres.length < k) {
    const cost = (i: number) => (points[i]?.weight ?? 0) * (near[i] ?? 0);
    if (points.every((_, i) => cost(i) === 0)) break;
    let best: { lab: Lab; total: number } | undefined;
    for (let t = 0; t < trials; t++) {
      const candidate = points[draw(points, cost, next)]?.lab;
      if (!candidate) continue;
      let total = 0;
      for (const [i, p] of points.entries())
        total += p.weight * Math.min(near[i] ?? 0, dist2(p.lab, candidate));
      if (!best || total < best.total) best = { lab: candidate, total };
    }
    if (!best) break;
    const chosen = best.lab;
    centres.push(chosen);
    for (const [i, p] of points.entries()) near[i] = Math.min(near[i] ?? 0, dist2(p.lab, chosen));
  }
  return centres;
}

/** Lloyd's iterations: each point to its nearest centre, each centre to its points' mean. */
function cluster(points: Point[], centres: Lab[]): number[] {
  let owner = points.map(() => -1);
  for (let round = 0; round < 32; round++) {
    const next = points.map((p) => {
      let best = 0;
      for (let c = 1; c < centres.length; c++)
        if (dist2(p.lab, centres[c] as Lab) < dist2(p.lab, centres[best] as Lab)) best = c;
      return best;
    });
    if (next.every((c, i) => c === owner[i])) break;
    owner = next;
    centres.forEach((_, c) => {
      const sum: Lab = [0, 0, 0];
      let weight = 0;
      for (const [i, p] of points.entries()) {
        if (owner[i] !== c) continue;
        for (const axis of [0, 1, 2] as const) sum[axis] += p.lab[axis] * p.weight;
        weight += p.weight;
      }
      if (weight > 0) centres[c] = [sum[0] / weight, sum[1] / weight, sum[2] / weight];
    });
  }
  return owner;
}

/** The member most central to its cluster, among those nearest the centre: a colour of the image. */
function representative(members: Point[], centre: Lab): Point | undefined {
  const near = [...members].sort((a, b) => dist2(a.lab, centre) - dist2(b.lab, centre));
  let best: { point: Point; spread: number } | undefined;
  for (const candidate of near.slice(0, 16)) {
    let spread = 0;
    for (const m of members) spread += m.weight * Math.sqrt(dist2(m.lab, candidate.lab));
    if (!best || spread < best.spread) best = { point: candidate, spread };
  }
  return best?.point;
}

/** Up to `count` main colours of `image`, the most covering first. */
export function extractColors(image: Pixels, options: ExtractOptions = {}): Swatch[] {
  const count = Math.max(1, Math.floor(options.count ?? 5));
  const points = sample(image, options.samples ?? 4096);
  const total = points.reduce((sum, p) => sum + p.weight, 0);
  const byShare = (a: Swatch & { rgb: number }, b: Swatch & { rgb: number }) =>
    b.share - a.share || a.rgb - b.rgb;
  if (points.length <= count) {
    return points
      .map((p) => ({ rgb: p.rgb, color: hex(p.rgb), share: p.weight / total }))
      .sort(byShare)
      .map(({ color, share }) => ({ color, share }));
  }
  const centres = seeds(points, count, random(options.seed ?? 0x5eed));
  const owner = cluster(points, centres);
  return centres
    .flatMap((centre, c) => {
      const members = points.filter((_, i) => owner[i] === c);
      const chosen = representative(members, centre);
      if (!chosen) return [];
      const weight = members.reduce((sum, p) => sum + p.weight, 0);
      return [{ rgb: chosen.rgb, color: hex(chosen.rgb), share: weight / total }];
    })
    .sort(byShare)
    .map(({ color, share }) => ({ color, share }));
}
