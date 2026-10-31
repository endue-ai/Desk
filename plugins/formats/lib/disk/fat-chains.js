// The cluster chains FAT and exFAT keep in their file allocation tables (Microsoft's FAT and exFAT
// specifications): the table read in 64 KiB pieces as chains need it, chains walked with a guard
// against loops and links outside the volume, and a chain's data read in one call per run of
// neighbouring clusters.
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./work.js").Work} Work */

const PIECE = 64 * 1024;
const KEEP = 64;
const MOST = 4 * 1024 * 1024;

/**
 * The table's entries by cluster number, read lazily.
 * @param {Source} source @param {number} offset where the table starts @param {number} length its bytes
 * @param {12 | 16 | 32} bits @param {string} name "FAT" or "exFAT", for sentences
 * @returns {(cluster: number) => Promise<number>}
 */
export function fatTable(source, offset, length, bits, name) {
  /** @type {Map<number, Uint8Array>} */
  const pieces = new Map();
  const piece = async (/** @type {number} */ index) => {
    const kept = pieces.get(index);
    if (kept) return kept;
    const want = Math.min(PIECE, length - index * PIECE);
    const got = await source.read(offset + index * PIECE, want);
    if (got.length < want)
      throw damaged(`The ${name} volume is cut short: its allocation table goes past the image.`);
    pieces.set(index, got);
    if (pieces.size > KEEP) pieces.delete(/** @type {number} */ (pieces.keys().next().value));
    return got;
  };
  /** The little-endian value of `width` bytes at `at`; zero past the table. */
  const value = async (/** @type {number} */ at, /** @type {number} */ width) => {
    if (at + width > length) return 0;
    const index = Math.floor(at / PIECE);
    const within = at - index * PIECE;
    let v = 0;
    if (within + width <= PIECE) {
      const p = pieces.get(index) ?? (await piece(index));
      for (let i = width - 1; i >= 0; i--) v = v * 256 + (p[within + i] ?? 0);
      return v;
    }
    for (let i = width - 1; i >= 0; i--) {
      const j = Math.floor((at + i) / PIECE);
      const p = pieces.get(j) ?? (await piece(j));
      v = v * 256 + (p[at + i - j * PIECE] ?? 0);
    }
    return v;
  };
  if (bits === 12)
    return async (n) => {
      const v = await value(n + (n >> 1), 2);
      return n & 1 ? v >> 4 : v & 0xfff;
    };
  if (bits === 16) return (n) => value(n * 2, 2);
  return (n) => value(n * 4, 4);
}

/**
 * @typedef {{ count: number, end: number, mask: number, most: number, work: Work }} ChainOptions
 * `count` clusters in the volume (numbered from 2), `end` the smallest end-of-chain value, `mask`
 * the bits of an entry that count, `most` how many clusters are wanted at most.
 */

/**
 * The clusters of the chain that starts at `first`. `broken` says the chain stopped early: a free
 * or bad link, one outside the volume, or a loop.
 * @param {(cluster: number) => Promise<number>} next @param {number} first @param {ChainOptions} options
 */
export async function chain(next, first, { count, end, mask, most, work }) {
  /** @type {number[]} */
  const clusters = [];
  const seen = new Set();
  let cluster = first;
  let broken = false;
  while (clusters.length < most) {
    if (cluster < 2 || cluster > count + 1 || seen.has(cluster)) {
      broken = true;
      break;
    }
    seen.add(cluster);
    clusters.push(cluster);
    if (clusters.length % 1024 === 0) await work.tick();
    const link = (await next(cluster)) & mask;
    if (link >= end) break;
    cluster = link;
  }
  return { clusters, broken };
}

/**
 * `length` bytes from `at`, in reads of at most 4 MiB with a turn for the event loop between them.
 * @param {Source} source @param {number} at @param {number} length @param {Uint8Array} out
 * @param {number} pos where in `out` they go @param {Work} work @param {string} name
 */
export async function readRange(source, at, length, out, pos, work, name) {
  for (let done = 0; done < length; ) {
    const n = Math.min(MOST, length - done);
    const got = await source.read(at + done, n);
    if (got.length < n)
      throw damaged(`The ${name} volume is cut short: a file goes past the end of the image.`);
    out.set(got, pos + done);
    done += n;
    await work.tick();
  }
}

/**
 * The first `want` bytes of the clusters, one read per run of neighbours.
 * @param {Source} source @param {(cluster: number) => number} offsetOf @param {number} clusterBytes
 * @param {number[]} clusters @param {number} want @param {Work} work @param {string} name
 */
export async function readClusters(source, offsetOf, clusterBytes, clusters, want, work, name) {
  const out = new Uint8Array(want);
  let pos = 0;
  for (let i = 0; i < clusters.length && pos < want; ) {
    let j = i + 1;
    while (j < clusters.length && clusters[j] === (clusters[j - 1] ?? 0) + 1) j++;
    const length = Math.min((j - i) * clusterBytes, want - pos);
    await readRange(source, offsetOf(clusters[i] ?? 0), length, out, pos, work, name);
    pos += length;
    i = j;
  }
  return out;
}
