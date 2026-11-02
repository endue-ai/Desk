// Each carried track's sample entry (ISO/IEC 14496-12 12.1 and 12.2) with its codec configuration
// box, the codec string MediaSource.isTypeSupported takes, and how its samples are rewritten for
// MP4: Annex B to length-prefixed NAL units, ADTS headers dropped. Some configurations come from the
// track's first frames (AC-3's dac3, VP9's vpcC, avcC from an Annex B stream).
import { av1Codec, avcCodec, hevcCodec, vp9Codec } from "../probe/boxes.js";
import { frameAt } from "../probe/mp3.js";
import {
  ac3At,
  ac3Config,
  adtsAt,
  dfLa,
  dOps,
  findStreamInfo,
  flacFrame,
  makeAsc,
  opusSamples,
  readAsc,
  streamInfo,
} from "./audio.js";
import { box, fullBox, Writer } from "./boxes.js";
import { avcC, avcType, hevcType, hvcC, isAnnexB, prefixed, readAvcC, splitAnnexB } from "./nal.js";
import { vp9Header, vpcC } from "./vp9.js";

/**
 * @typedef {{
 *   id: number, kind: "video" | "audio", codec: string, timescale: number,
 *   width?: number, height?: number, sampleRate?: number, channels?: number, bits?: number,
 *   config?: Uint8Array, little?: boolean, frameDuration?: number, default?: boolean,
 * }} DemuxTrack
 * @typedef {{ entry: Uint8Array, codecString: string, timescale: number,
 *   rewrite?: (data: Uint8Array) => Uint8Array, frames?: (data: Uint8Array) => number | undefined }} Described
 */

export const VIDEO = ["H.264", "HEVC", "VP9", "AV1"];
export const AUDIO = ["AAC", "MP3", "Opus", "FLAC", "Apple Lossless", "AC-3", "E-AC-3", "PCM"];

function visual(
  /** @type {string} */ type,
  /** @type {DemuxTrack} */ t,
  /** @type {Uint8Array[]} */ children,
) {
  return box(type, (w) => {
    w.zeros(6)
      .u16(1)
      .zeros(16)
      .u16(t.width ?? 0)
      .u16(t.height ?? 0);
    w.u32(0x480000).u32(0x480000).u32(0).u16(1).zeros(32).u16(0x18).u16(0xffff);
    for (const c of children) w.put(c);
  });
}

function sound(
  /** @type {string} */ type,
  /** @type {number} */ channels,
  /** @type {number} */ bits,
  /** @type {number} */ rate,
  /** @type {Uint8Array[]} */ children,
) {
  return box(type, (w) => {
    w.zeros(6).u16(1).zeros(8).u16(channels).u16(bits).u16(0).u16(0);
    w.u32(rate < 0x10000 ? rate * 0x10000 : 0);
    for (const c of children) w.put(c);
  });
}

/** An MPEG-4 descriptor: tag, length (one byte when it fits), body. */
function descriptor(/** @type {number} */ tag, /** @type {Uint8Array} */ body) {
  const w = new Writer().u8(tag);
  if (body.length < 128) w.u8(body.length);
  else
    w.u8(0x80 | (body.length >> 21))
      .u8(0x80 | ((body.length >> 14) & 127))
      .u8(0x80 | ((body.length >> 7) & 127))
      .u8(body.length & 127);
  return w.put(body).done();
}

/** esds (ISO/IEC 14496-14 5.6) for an object type and its decoder specific info. */
function esds(/** @type {number} */ oti, /** @type {Uint8Array | undefined} */ info) {
  const config = new Writer().u8(oti).u8(0x15).u24(0).u32(0).u32(0);
  if (info) config.put(descriptor(5, info));
  const es = new Writer()
    .u16(0)
    .u8(0)
    .put(descriptor(4, config.done()))
    .put(descriptor(6, Uint8Array.of(2)));
  return fullBox("esds", 0, 0, descriptor(3, es.done()));
}

const fail = (/** @type {string} */ words) => {
  throw new Error(words);
};

/** The parameter sets and samples of an H.264 or HEVC track whose samples are Annex B. */
function annexB(
  /** @type {DemuxTrack} */ t,
  /** @type {Uint8Array[]} */ first,
  /** @type {boolean} */ hevc,
) {
  const type = hevc ? hevcType : avcType;
  const aud = hevc ? 35 : 9;
  const nals = [
    ...(t.config ? splitAnnexB(t.config) : []),
    ...first.flatMap((d) => splitAnnexB(d)),
  ];
  const record = hevc
    ? hvcC(nals)
    : avcC(
        nals.filter((n) => type(n) === 7).slice(0, 1),
        nals.filter((n) => type(n) === 8).slice(0, 1),
      );
  const rewrite = (/** @type {Uint8Array} */ data) =>
    isAnnexB(data) ? prefixed(splitAnnexB(data).filter((n) => type(n) !== aud)) : data;
  return { record, rewrite };
}

/**
 * The sample entry, codec string and sample rewriting for a track, given its first frames.
 * @param {DemuxTrack} t
 * @param {Uint8Array[]} first the data of its first packets (some configurations need them)
 * @returns {Described}
 */
export function describe(t, first) {
  const head = first[0] ?? new Uint8Array(0);
  const channels = t.channels ?? 2;
  const rate = t.sampleRate ?? 48000;
  switch (t.codec) {
    case "H.264": {
      const record = t.config && t.config[0] === 1 ? { record: t.config } : annexB(t, first, false);
      if (t.config && t.config[0] === 1 && readAvcC(t.config).sets.length === 0)
        fail("This H.264 video has no parameter sets.");
      return {
        entry: visual("avc1", t, [box("avcC", record.record)]),
        codecString: avcCodec("avc1", record.record),
        timescale: t.timescale,
        rewrite: "rewrite" in record ? record.rewrite : undefined,
      };
    }
    case "HEVC": {
      const record = t.config && t.config[0] === 1 ? { record: t.config } : annexB(t, first, true);
      return {
        entry: visual("hvc1", t, [box("hvcC", record.record)]),
        codecString: hevcCodec("hvc1", record.record),
        timescale: t.timescale,
        rewrite: "rewrite" in record ? record.rewrite : undefined,
      };
    }
    case "VP9": {
      const header = vp9Header(head);
      const config = vpcC(t, header);
      return {
        entry: visual("vp09", t, [fullBox("vpcC", 1, 0, config)]),
        codecString: vp9Codec(new Writer().u32(0x01000000).put(config).done()),
        timescale: t.timescale,
      };
    }
    case "AV1": {
      if (!t.config || t.config.length < 4) fail("This AV1 video has no configuration.");
      const config = /** @type {Uint8Array} */ (t.config);
      return {
        entry: visual("av01", t, [box("av1C", config)]),
        codecString: av1Codec(config),
        timescale: t.timescale,
      };
    }
    case "AAC": {
      const adts = adtsAt(head, 0);
      const asc =
        t.config && t.config.length >= 2 ? t.config : (adts?.asc ?? makeAsc(2, rate, channels));
      const info = readAsc(asc);
      const rewrite = (/** @type {Uint8Array} */ d) => {
        const h = adtsAt(d, 0);
        return h ? d.subarray(h.head, h.length) : d;
      };
      return {
        entry: sound("mp4a", info.channels || channels, 16, info.rate || rate, [esds(0x40, asc)]),
        codecString: `mp4a.40.${info.type}`,
        timescale: info.rate || rate,
        rewrite,
        frames: () => info.frame,
      };
    }
    case "MP3": {
      const frame = frameAt(head, 0);
      const r = frame?.rate ?? rate;
      return {
        entry: sound("mp4a", frame ? (frame.mono ? 1 : 2) : channels, 16, r, [
          esds(0x6b, undefined),
        ]),
        codecString: "mp4a.6B",
        timescale: r,
        frames: (d) => frameAt(d, 0)?.samples,
      };
    }
    case "AC-3":
    case "E-AC-3": {
      const frame = ac3At(head, 0) ?? fail(`This ${t.codec} track has no sync frame.`);
      const f = /** @type {NonNullable<ReturnType<typeof ac3At>>} */ (frame);
      const type = f.eac3 ? "ec-3" : "ac-3";
      return {
        entry: sound(type, channels, 16, f.rate, [box(f.eac3 ? "dec3" : "dac3", ac3Config(f))]),
        codecString: type,
        timescale: f.rate,
        frames: (d) => ac3At(d, 0)?.samples,
      };
    }
    case "Opus": {
      if (!t.config) fail("This Opus track has no OpusHead.");
      const ops = dOps(/** @type {Uint8Array} */ (t.config));
      return {
        entry: sound("Opus", ops.channels, 16, 48000, [box("dOps", ops.config)]),
        codecString: "Opus",
        timescale: 48000,
        frames: opusSamples,
      };
    }
    case "FLAC": {
      const info = t.config
        ? (findStreamInfo(t.config) ?? (t.config.length === 34 ? t.config : null))
        : null;
      if (!info) fail("This FLAC track has no STREAMINFO.");
      const s = streamInfo(/** @type {Uint8Array} */ (info));
      return {
        entry: sound("fLaC", s.channels, s.bits, s.rate, [
          fullBox("dfLa", 0, 0, dfLa(/** @type {Uint8Array} */ (info)).subarray(4)),
        ]),
        codecString: "fLaC",
        timescale: s.rate,
        frames: (d) => flacFrame(d)?.size,
      };
    }
    case "Apple Lossless": {
      const cookie = alacCookie(t.config);
      const c = new DataView(cookie.buffer, cookie.byteOffset, cookie.byteLength);
      const r = c.getUint32(20);
      return {
        entry: sound("alac", cookie[9] ?? channels, cookie[5] ?? 16, r, [
          fullBox("alac", 0, 0, cookie),
        ]),
        codecString: "alac",
        timescale: r,
        frames: () => c.getUint32(0),
      };
    }
    case "PCM": {
      const bits = t.bits ?? 16;
      const pcmC = fullBox("pcmC", 0, 0, Uint8Array.of(t.little ? 1 : 0, bits));
      const frame = (channels * bits) / 8;
      return {
        entry: sound("ipcm", channels, bits, rate, [pcmC]),
        codecString: "ipcm",
        timescale: rate,
        frames: (d) => Math.floor(d.length / frame),
      };
    }
    default:
      return fail(`The player cannot remux ${t.codec}.`);
  }
}

/** ALAC's 24-byte ALACSpecificConfig, from a bare cookie or one inside frma/alac atoms. */
function alacCookie(/** @type {Uint8Array | undefined} */ config) {
  if (!config) return fail("This Apple Lossless track has no configuration.");
  for (let at = 0; at + 4 <= config.length; at++)
    if (
      config[at] === 0x61 &&
      config[at + 1] === 0x6c &&
      config[at + 2] === 0x61 &&
      config[at + 3] === 0x63
    )
      return config.slice(at + 8, at + 32);
  return config.slice(0, 24);
}

export { flacFrame, opusSamples };
