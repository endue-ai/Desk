// The MXF demuxer for OP1a, frame wrapped (SMPTE ST 377-1, 379-2, 381-3, 382): partitions from the
// random index pack, the picture and sound descriptors from the header metadata, edit units from the
// index table segments, and the essence elements of each content package. The picture's codec is
// read from its first element (H.264 Annex B is remuxed; MPEG-2 and others are named); sound is PCM.
import { Cursor } from "../bytes.js";
import { avcType, isAnnexB, pictureOrder, readSps, splitAnnexB } from "./nal.js";
import { PART, Reader } from "./reader.js";

/**
 * @typedef {import("./reader.js").Source} Source
 * @typedef {import("./config.js").DemuxTrack} DemuxTrack
 * @typedef {import("./timing.js").Packet} Packet
 * @typedef {{ at: number, body: number, sid: number, essence: number }} Partition
 * @typedef {{ offset: number, key: boolean }} Unit
 */

const PREFIX = [0x06, 0x0e, 0x2b, 0x34];
const is = (/** @type {Uint8Array} */ k, /** @type {number[]} */ bytes, at = 4) =>
  bytes.every((b, i) => k[at + i] === b);
const PARTITION = [0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02, 0x01, 0x01];
const INDEX = [0x02, 0x53, 0x01, 0x01, 0x0d, 0x01, 0x02, 0x01, 0x01, 0x10, 0x01];
const SET = [0x02, 0x53, 0x01, 0x01, 0x0d, 0x01, 0x01, 0x01, 0x01, 0x01];
const ESSENCE = [0x01, 0x02, 0x01, 0x01, 0x0d, 0x01, 0x03, 0x01];
const PICTURE = [0x05, 0x15];
const SOUND = [0x06, 0x16];

/** A KLV's key, value offset and length at `at` in `b` (BER lengths), or null. */
function klvAt(/** @type {Uint8Array} */ b, /** @type {number} */ at) {
  if (at + 17 > b.length || !PREFIX.every((x, i) => b[at + i] === x)) return null;
  const first = b[at + 16] ?? 0;
  let length = first;
  let head = 17;
  if (first & 0x80) {
    const n = first & 0x7f;
    if (n > 8 || at + 17 + n > b.length) return null;
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + (b[at + 17 + i] ?? 0);
    head += n;
  }
  return { key: b.subarray(at, at + 16), at: at + head, length, end: at + head + length };
}

async function readAll(
  /** @type {Source} */ source,
  /** @type {number} */ at,
  /** @type {number} */ size,
) {
  const out = new Uint8Array(Math.max(0, Math.min(size, source.size - at)));
  for (let done = 0; done < out.length; ) {
    const part = await source.read(at + done, Math.min(PART, out.length - done));
    if (part.length === 0) return out.subarray(0, done);
    out.set(part, done);
    done += part.length;
  }
  return out;
}

/** A local set's tags: tag -> value bytes. */
function local(/** @type {Uint8Array} */ v) {
  /** @type {Map<number, Uint8Array>} */
  const out = new Map();
  for (let at = 0; at + 4 <= v.length; ) {
    const tag = ((v[at] ?? 0) << 8) | (v[at + 1] ?? 0);
    const length = ((v[at + 2] ?? 0) << 8) | (v[at + 3] ?? 0);
    out.set(tag, v.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return out;
}

const u32 = (/** @type {Uint8Array | undefined} */ b) =>
  b && b.length >= 4 ? new Cursor(b).u32() : 0;
const rational = (/** @type {Uint8Array | undefined} */ b) =>
  b && b.length >= 8 ? [new Cursor(b).u32(), new Cursor(b, 4).u32()] : [0, 0];

/** A partition pack's facts, and where its essence starts (after header metadata, index and fill). */
async function partition(/** @type {Source} */ source, /** @type {number} */ at) {
  const b = await source.read(at, 512);
  const k = klvAt(b, 0);
  if (!k || !is(k.key, PARTITION)) return null;
  const c = new Cursor(b, k.at + 32);
  const header = c.u64();
  const index = c.u64();
  c.skip(4);
  const body = c.u64();
  const sid = c.u32();
  let essence = at + k.end + header + index;
  const fill = klvAt(await source.read(essence, 32), 0);
  if (fill && is(fill.key, [0x03, 0x01, 0x02, 0x10], 8) && header + index === 0)
    essence += fill.end;
  return {
    at,
    body,
    sid,
    essence,
    headerAt: at + k.end,
    header,
    index,
    footer: k.key[13] === 0x04,
  };
}

/** @param {Source} source */
export async function openMxf(source) {
  const first = await partition(source, 0);
  if (!first) throw new Error("This MXF file has no header partition.");
  // Partitions from the random index pack at the end, else the header partition alone.
  const tail = await source.read(Math.max(0, source.size - 4), 4);
  const ripLength = tail.length === 4 ? new Cursor(tail).u32() : 0;
  /** @type {number[]} */
  const offsets = [];
  if (ripLength > 20 && ripLength < source.size) {
    const rip = await readAll(source, source.size - ripLength, ripLength);
    const k = klvAt(rip, 0);
    if (k)
      for (let at = k.at; at + 12 <= k.end - 4; at += 12)
        offsets.push(new Cursor(rip, at + 4).u64());
  }
  const partitions = /** @type {NonNullable<Awaited<ReturnType<typeof partition>>>[]} */ (
    (await Promise.all((offsets.length ? offsets : [0]).map((o) => partition(source, o)))).filter(
      (p) => p !== null,
    )
  );
  const meta = await readAll(source, first.headerAt, Math.min(first.header, 8 << 20));
  /** @type {Map<number, Uint8Array>[]} */
  const sets = [];
  for (let at = 0; at < meta.length; ) {
    const k = klvAt(meta, at);
    if (!k) break;
    if (is(k.key, SET)) sets.push(local(meta.subarray(k.at, k.end)));
    at = k.end;
  }
  const picture = sets.find((s) => s.has(0x3203) || s.has(0x3201));
  const sound = sets.find((s) => s.has(0x3d03));
  /** @type {Unit[]} */
  const units = [];
  let rate = rational(picture?.get(0x3001));
  for (const p of partitions) {
    if (!p.index) continue;
    const b = await readAll(source, p.headerAt + p.header, Math.min(p.index, 16 << 20));
    for (let at = 0; at < b.length; ) {
      const k = klvAt(b, at);
      if (!k) break;
      if (is(k.key, INDEX)) {
        const s = local(b.subarray(k.at, k.end));
        if (!rate[0]) rate = rational(s.get(0x3f0b));
        const start = Number(new Cursor(s.get(0x3f0c) ?? new Uint8Array(8)).u64());
        const entries = s.get(0x3f0a);
        if (entries && entries.length >= 8) {
          const c = new Cursor(entries);
          const n = c.u32();
          const size = c.u32();
          for (let i = 0; i < n; i++) {
            const e = new Cursor(entries, 8 + i * size);
            e.skip(2);
            const flags = e.u8();
            units[start + i] = { offset: e.u64(), key: (flags & 0x80) !== 0 };
          }
        }
      }
      at = k.end;
    }
  }
  const [num, den] = rate[0] && rate[1] ? rate : [25, 1];
  const bodies = partitions.filter((p) => p.sid !== 0 && !p.footer).sort((a, b) => a.body - b.body);
  const essence = bodies[0]?.essence ?? first.essence;

  /** The file offset of a stream offset, through the body partition that holds it. */
  const fileOffset = (/** @type {number} */ offset) => {
    let best = bodies[0];
    for (const p of bodies) if (p.body <= offset) best = p;
    return best ? best.essence + offset - best.body : essence;
  };

  // The first content package names the tracks: its picture and sound elements.
  /** @type {Map<number, DemuxTrack>} */
  const tracks = new Map();
  const probe = new Reader(source, essence);
  for (let n = 0; n < 32 && !probe.eof; n++) {
    await probe.need(32);
    const k = klvAt(probe.peek(32), 0);
    if (!k) break;
    const number = new Cursor(k.key, 12).u32();
    if (
      is(k.key, ESSENCE) &&
      (PICTURE.includes(k.key[12] ?? 0) || SOUND.includes(k.key[12] ?? 0))
    ) {
      if (tracks.has(number)) break;
      const data = await probe.take(k.end);
      const value = data.subarray(k.at);
      if (PICTURE.includes(k.key[12] ?? 0)) {
        const avc = isAnnexB(value) && splitAnnexB(value).some((x) => avcType(x) === 7);
        const mpeg2 = value[0] === 0 && value[1] === 0 && value[2] === 1 && value[3] === 0xb3;
        tracks.set(number, {
          id: number,
          kind: "video",
          codec: avc ? "H.264" : mpeg2 ? "MPEG-2 Video" : "an MXF picture codec",
          timescale: num,
          frameDuration: den,
          width: u32(picture?.get(0x3203)) || undefined,
          height: u32(picture?.get(0x3202)) || undefined,
        });
      } else {
        const bits = u32(sound?.get(0x3d01)) || 16;
        tracks.set(number, {
          id: number,
          kind: "audio",
          codec: bits === 16 || bits === 24 || bits === 32 ? "PCM" : `PCM (${bits}-bit)`,
          timescale: rational(sound?.get(0x3d03))[0] || 48000,
          sampleRate: rational(sound?.get(0x3d03))[0] || 48000,
          channels: u32(sound?.get(0x3d07)) || 1,
          bits,
          little: true,
        });
      }
      continue;
    }
    probe.skip(k.end);
  }
  if (tracks.size === 0)
    throw new Error("This MXF file has no picture or sound the player can read.");
  const video = [...tracks.values()].find((t) => t.kind === "video");

  /** The key edit unit at or before `from` seconds: its number and file offset. */
  const startOf = (/** @type {number} */ from) => {
    const target = Math.floor((from * num) / den + 1e-6);
    for (let u = Math.min(target, units.length - 1); u >= 0; u--) {
      const unit = units[u];
      if (unit?.key) return { unit: u, at: fileOffset(unit.offset) };
    }
    return { unit: 0, at: essence };
  };

  /** @param {number} from @param {Set<number>} want @returns {AsyncGenerator<Packet>} */
  async function* packets(from, want) {
    const start = from > 0 ? startOf(from) : { unit: 0, at: essence };
    const r = new Reader(source, start.at);
    let unit = start.unit;
    /** @type {Map<number, number>} */
    const samples = new Map();
    const poc = { msb: 0, lsb: 0, epoch: 0, count: 0 };
    /** @type {ReturnType<typeof readSps> | null} */
    let sps = null;
    while (!r.eof) {
      await r.need(32);
      const k = klvAt(r.peek(32), 0);
      if (!k) return;
      if (is(k.key, PARTITION) && k.key[13] === 0x04) return;
      const track = tracks.get(new Cursor(k.key, 12).u32());
      if (!is(k.key, ESSENCE) || !track || !want.has(track.id)) {
        if (is(k.key, ESSENCE) && track?.kind === "video") unit++;
        r.skip(k.end);
        continue;
      }
      const data = (await r.take(k.end)).subarray(k.at);
      if (track.kind === "video") {
        const nals = splitAnnexB(data);
        const set = nals.find((x) => avcType(x) === 7);
        if (set) sps = readSps(set);
        /** @type {Packet} */
        const p = {
          track: track.id,
          dts: unit * den,
          key: units[unit]?.key ?? nals.some((x) => avcType(x) === 5),
          data,
        };
        if (sps && track.codec === "H.264") p.order = pictureOrder(nals, sps, poc);
        unit++;
        yield p;
        continue;
      }
      const frame = ((track.channels ?? 1) * (track.bits ?? 16)) / 8;
      const at =
        samples.get(track.id) ?? Math.round((start.unit * den * (track.sampleRate ?? 48000)) / num);
      samples.set(track.id, at + Math.floor(data.length / frame));
      yield { track: track.id, pts: at, key: true, data };
    }
  }

  return {
    duration: units.length > 0 ? (units.length * den) / num : 0,
    tracks: [...tracks.values()],
    packets,
    async keyframe(/** @type {number} */ time) {
      return video ? (startOf(time).unit * den) / num : Math.max(0, time);
    },
  };
}
