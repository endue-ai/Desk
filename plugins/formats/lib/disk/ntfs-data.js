// Reading an NTFS stream: a resident value as it is; a non-resident one through its runs, with
// sparse runs and the bytes past the initialized size as zeros; a compressed one a compression
// unit (16 clusters, usually) at a time: all clusters present means stored, some means LZNT1,
// none means zeros.
import { lznt1 } from "./lznt1.js";
import { damaged } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./ntfs-records.js").Stream} Stream */
/** @typedef {import("./ntfs-records.js").Run} Run */
/** @typedef {import("./work.js").Work} Work */

const PIECE = 4 * 1024 * 1024;
const SHORT = "A file's data runs on this NTFS volume end before its size.";

/** The run that holds cluster `vcn`, searched from `hint`. @param {Run[]} runs @param {number} vcn */
function runAt(runs, vcn) {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const run = /** @type {Run} */ (runs[mid]);
    if (vcn < run.vcn) hi = mid - 1;
    else if (vcn >= run.vcn + run.length) lo = mid + 1;
    else return run;
  }
  return undefined;
}

/**
 * `length` bytes of the stream from `offset` (fewer at its end).
 * @param {Source} volume @param {number} cluster bytes per cluster @param {Stream} stream
 * @param {number} offset @param {number} length @param {Work} work @returns {Promise<Uint8Array>}
 */
export async function readStream(volume, cluster, stream, offset, length, work) {
  const start = Math.max(0, Math.min(offset, stream.size));
  const end = Math.min(stream.size, start + Math.max(0, length));
  if (stream.resident) return stream.resident.slice(start, end);
  const out = new Uint8Array(end - start);
  const filled = Math.min(end, stream.initialized);
  if (stream.compressed && stream.unit)
    await compressed(volume, cluster, stream, start, filled, out, work);
  else await plain(volume, cluster, stream.runs, start, filled, out, work);
  return out;
}

/**
 * Bytes `start`..`end` of uncompressed runs into `out` (which starts at `from`).
 * @param {Source} volume @param {number} cluster @param {Run[]} runs @param {number} start
 * @param {number} end @param {Uint8Array} out @param {Work} work @param {number} [from]
 */
async function plain(volume, cluster, runs, start, end, out, work, from = start) {
  for (let pos = start; pos < end; ) {
    const vcn = Math.floor(pos / cluster);
    const run = runAt(runs, vcn);
    if (!run) throw damaged(SHORT);
    const inside = pos - run.vcn * cluster;
    const n = Math.min(end - pos, run.length * cluster - inside, PIECE);
    if (run.lcn >= 0) {
      const bytes = await volume.read(run.lcn * cluster + inside, n);
      if (bytes.length < n) throw damaged("An NTFS file's data goes past the end of the volume.");
      out.set(bytes, pos - from);
    }
    pos += n;
    await work.tick();
  }
}

/**
 * Bytes `start`..`end` of a compressed stream into `out`, unit by unit.
 * @param {Source} volume @param {number} cluster @param {Stream} stream @param {number} start
 * @param {number} end @param {Uint8Array} out @param {Work} work
 */
async function compressed(volume, cluster, stream, start, end, out, work) {
  const clusters = 2 ** stream.unit;
  const unitBytes = clusters * cluster;
  for (let index = Math.floor(start / unitBytes); index * unitBytes < end; index++) {
    const unit = await decodeUnit(volume, cluster, stream.runs, index * clusters, clusters);
    const base = index * unitBytes;
    const from = Math.max(start, base);
    const to = Math.min(end, base + unitBytes);
    if (unit) out.set(unit.subarray(from - base, to - base), from - start);
    await work.tick();
  }
}

/**
 * One compression unit's bytes, or undefined when it is all sparse.
 * @param {Source} volume @param {number} cluster @param {Run[]} runs @param {number} first
 * @param {number} clusters
 */
async function decodeUnit(volume, cluster, runs, first, clusters) {
  /** @type {Uint8Array[]} */
  const parts = [];
  let present = 0;
  for (let vcn = first; vcn < first + clusters; ) {
    const run = runAt(runs, vcn);
    if (!run) throw damaged(SHORT);
    const n = Math.min(run.vcn + run.length, first + clusters) - vcn;
    if (run.lcn >= 0) {
      const bytes = await volume.read((run.lcn + vcn - run.vcn) * cluster, n * cluster);
      if (bytes.length < n * cluster)
        throw damaged("An NTFS file's data goes past the end of the volume.");
      parts.push(bytes);
      present += n;
    }
    vcn += n;
  }
  if (!present) return undefined;
  const data = new Uint8Array(present * cluster);
  let at = 0;
  for (const part of parts) {
    data.set(part, at);
    at += part.length;
  }
  return present === clusters ? data : lznt1(data, clusters * cluster);
}
