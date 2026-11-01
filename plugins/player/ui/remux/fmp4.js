// Fragmented MP4 (ISO/IEC 14496-12, ISO BMFF fragments as Media Source Extensions take them): an
// initialization segment with every track's sample entry and no samples, and media segments of one
// moof (a traf per track: tfhd, tfdt, trun with signed composition offsets) and one mdat.
import { box, concat, fullBox } from "./boxes.js";

/**
 * @typedef {{ id: number, kind: "video" | "audio", timescale: number, width?: number,
 *   height?: number, entry: Uint8Array }} MuxTrack
 * @typedef {{ duration: number, size: number, key: boolean, cts: number }} MuxSample
 * @typedef {{ track: number, base: number, samples: MuxSample[], data: Uint8Array[] }} Run
 */

const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
/** sample_depends_on 2 (an I frame), and 1 plus is_non_sync_sample (ISO/IEC 14496-12 8.8.3.1). */
const SYNC = 0x02000000;
const NON_SYNC = 0x01010000;

const matrix = (/** @type {import("./boxes.js").Writer} */ w) => {
  for (const value of MATRIX) w.u32(value);
};

function trak(/** @type {MuxTrack} */ t) {
  const video = t.kind === "video";
  const tkhd = fullBox("tkhd", 0, 3, (w) => {
    w.u32(0).u32(0).u32(t.id).u32(0).u32(0).zeros(8).u16(0).u16(0);
    w.u16(video ? 0 : 0x0100).u16(0);
    matrix(w);
    w.u32((t.width ?? 0) * 0x10000).u32((t.height ?? 0) * 0x10000);
  });
  // 'und' in ISO 639-2/T, five bits a letter.
  const mdhd = fullBox("mdhd", 0, 0, (w) =>
    w.u32(0).u32(0).u32(t.timescale).u32(0).u16(0x55c4).u16(0),
  );
  const name = video ? "VideoHandler\0" : "SoundHandler\0";
  const hdlr = fullBox("hdlr", 0, 0, (w) =>
    w
      .u32(0)
      .text(video ? "vide" : "soun")
      .zeros(12)
      .text(name),
  );
  const header = video
    ? fullBox("vmhd", 0, 1, (w) => w.zeros(8))
    : fullBox("smhd", 0, 0, (w) => w.zeros(4));
  const dinf = box(
    "dinf",
    fullBox("dref", 0, 0, (w) => w.u32(1), fullBox("url ", 0, 1)),
  );
  const stbl = box(
    "stbl",
    fullBox("stsd", 0, 0, (w) => w.u32(1), t.entry),
    fullBox("stts", 0, 0, (w) => w.u32(0)),
    fullBox("stsc", 0, 0, (w) => w.u32(0)),
    fullBox("stsz", 0, 0, (w) => w.u32(0).u32(0)),
    fullBox("stco", 0, 0, (w) => w.u32(0)),
  );
  return box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", header, dinf, stbl)));
}

/**
 * The initialization segment: ftyp and moov (mvhd, a trak per track, mvex with trex).
 * @param {MuxTrack[]} tracks
 * @param {number} duration seconds, 0 when unknown
 */
export function initSegment(tracks, duration) {
  const ftyp = box("ftyp", (w) => w.text("iso6").u32(0).text("iso6").text("isom").text("mp41"));
  const next = Math.max(0, ...tracks.map((t) => t.id)) + 1;
  const mvhd = fullBox("mvhd", 0, 0, (w) => {
    w.u32(0).u32(0).u32(1000).u32(0).u32(0x10000).u16(0x100).zeros(10);
    matrix(w);
    w.zeros(24).u32(next);
  });
  const ms = Math.round(duration * 1000);
  const mehd = ms > 0 && ms < 2 ** 32 ? [fullBox("mehd", 0, 0, (w) => w.u32(ms))] : [];
  const trex = tracks.map((t) =>
    fullBox("trex", 0, 0, (w) => w.u32(t.id).u32(1).u32(0).u32(0).u32(0)),
  );
  const mvex = box("mvex", ...mehd, ...trex);
  return concat([ftyp, box("moov", mvhd, ...tracks.map(trak), mvex)]);
}

/** The flags trun carries per sample: duration, size, flags, composition offset; and data_offset. */
const TRUN_FLAGS = 0x000001 | 0x000100 | 0x000200 | 0x000400 | 0x000800;

/** @param {Run[]} runs @param {number} sequence @param {number[]} offsets */
function moof(runs, sequence, offsets) {
  const mfhd = fullBox("mfhd", 0, 0, (w) => w.u32(sequence));
  const trafs = runs.map((run, i) =>
    box(
      "traf",
      // default-base-is-moof: data offsets count from the moof's first byte.
      fullBox("tfhd", 0, 0x020000, (w) => w.u32(run.track)),
      fullBox("tfdt", 1, 0, (w) => w.u64(run.base)),
      fullBox("trun", 1, TRUN_FLAGS, (w) => {
        w.u32(run.samples.length).i32(offsets[i] ?? 0);
        for (const s of run.samples)
          w.u32(s.duration)
            .u32(s.size)
            .u32(s.key ? SYNC : NON_SYNC)
            .i32(s.cts);
      }),
    ),
  );
  return box("moof", mfhd, ...trafs);
}

/**
 * One media segment: moof then mdat, the runs' data in order. A run's base is its first sample's
 * decode time in its track's timescale.
 * @param {Run[]} runs
 * @param {number} sequence from 1
 */
export function mediaSegment(runs, sequence) {
  const sizes = runs.map((r) => r.data.reduce((n, d) => n + d.length, 0));
  const first = moof(runs, sequence, []);
  /** @type {number[]} */
  const offsets = [];
  let at = first.length + 8;
  for (const size of sizes) {
    offsets.push(at);
    at += size;
  }
  const head = moof(runs, sequence, offsets);
  const total = sizes.reduce((a, b) => a + b, 0);
  const mdat = new Uint8Array(8);
  new DataView(mdat.buffer).setUint32(0, 8 + total);
  mdat.set([0x6d, 0x64, 0x61, 0x74], 4);
  return concat([head, mdat, ...runs.flatMap((r) => r.data)]);
}
