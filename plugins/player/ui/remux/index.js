// Remuxing for Media Source Extensions: the plugin's own demuxers (Matroska and WebM, AVI, FLV, Ogg,
// MXF) read a file by ranges, and the tracks whose codecs WebKit decodes come out as fragmented MP4:
// an initialization segment, then media segments from the key frame at or before a time.

import { openAvi } from "./avi.js";
import { AUDIO, describe, VIDEO } from "./config.js";
import { openFlv } from "./flv.js";
import { initSegment } from "./fmp4.js";
import { createFragmenter } from "./fragments.js";
import { openMatroska } from "./matroska.js";
import { openMpegTs } from "./mpegts.js";
import { openMxf } from "./mxf.js";
import { openOgg } from "./ogg.js";
import { createStage } from "./timing.js";

/**
 * @typedef {import("./reader.js").Source} Source
 * @typedef {import("./config.js").DemuxTrack} DemuxTrack
 * @typedef {import("./matroska.js").Demuxed} Demuxed
 * @typedef {{ id: number, kind: "video" | "audio", codec: string, codecString: string }} RemuxTrack
 * @typedef {{ id: number, kind: "video" | "audio", codec: string }} Choice
 * @typedef {{ data: Uint8Array, start: number, end: number }} Fragment
 * @typedef {{ duration: number, tracks: RemuxTrack[], choices: Choice[], mime: string,
 *   init: Uint8Array, fragments(from: number): AsyncGenerator<Fragment>,
 *   keyframe(time: number): Promise<number> }} Remuxed
 */

/** @type {Record<string, (source: Source) => Promise<Demuxed>>} */
const OPENERS = {
  matroska: openMatroska,
  webm: openMatroska,
  avi: openAvi,
  flv: openFlv,
  ogg: openOgg,
  mxf: openMxf,
  mpegts: openMpegTs,
};

const NAMES = /** @type {Record<string, string>} */ ({
  matroska: "Matroska",
  webm: "WebM",
  avi: "AVI",
  flv: "Flash Video",
  ogg: "Ogg",
  mxf: "MXF",
  mpegts: "MPEG transport stream",
  asf: "Windows Media",
  mp4: "MP4",
  realmedia: "RealMedia",
});

export const REMUX_FORMATS = Object.keys(OPENERS);
export const REMUX_CODECS = { video: VIDEO, audio: AUDIO };

/** The first packets read for configurations taken from the stream (dac3, vpcC, Annex B avcC). */
const FIRST = 4;

/**
 * The track of `kind` to carry: the one asked for, or the first (default first) the muxer handles.
 * A container whose tracks of that kind are all codecs MP4 cannot carry is refused in words.
 * @param {DemuxTrack[]} tracks
 * @param {"video" | "audio"} kind
 * @param {number | null | undefined} asked
 * @param {string} container
 */
function pick(tracks, kind, asked, container) {
  if (asked === null) return undefined;
  const all = tracks.filter((t) => t.kind === kind);
  const known = kind === "video" ? VIDEO : AUDIO;
  if (asked !== undefined) {
    const t = all.find((c) => c.id === asked);
    if (!t) throw new Error(`This ${container} file has no ${kind} track ${asked}.`);
    if (!known.includes(t.codec))
      throw new Error(`This ${container}'s ${kind} is ${t.codec}, which the player cannot remux.`);
    return t;
  }
  const usable = all.filter((t) => known.includes(t.codec));
  if (all.length > 0 && usable.length === 0)
    throw new Error(
      `This ${container}'s ${kind} is ${all[0]?.codec}, which the player cannot remux.`,
    );
  return usable.find((t) => t.default !== false) ?? usable[0];
}

/**
 * Open a file for remuxing.
 * @param {Source} source
 * @param {string} format the probe's format name
 * @param {{ video?: number | null, audio?: number | null }} [options] track ids; null carries none
 * @returns {Promise<Remuxed>}
 */
export async function openRemux(source, format, options = {}) {
  const container = NAMES[format] ?? format;
  const open = OPENERS[format];
  if (!open) throw new Error(`The player cannot remux ${container} files.`);
  const demux = await open(source);
  const chosen = [
    pick(demux.tracks, "video", options.video, container),
    pick(demux.tracks, "audio", options.audio, container),
  ].filter((t) => t !== undefined);
  if (chosen.length === 0) throw new Error(`This ${container} file has no audio or video to play.`);
  const want = new Set(chosen.map((t) => t.id));
  /** @type {Map<number, Uint8Array[]>} */
  const first = new Map(chosen.map((t) => [t.id, []]));
  let read = 0;
  for await (const p of demux.packets(0, want)) {
    const list = first.get(p.track);
    if (list && list.length < FIRST) list.push(p.data);
    if (++read > 4000 || [...first.values()].every((l) => l.length >= FIRST)) break;
  }
  const described = chosen.map((t) => ({ t, d: describe(t, first.get(t.id) ?? []) }));
  const carried = described.map(({ t, d }, i) => ({
    id: i + 1,
    kind: t.kind,
    timescale: d.timescale,
    width: t.width,
    height: t.height,
    entry: d.entry,
  }));
  const video = chosen.some((t) => t.kind === "video");
  const codecs = described.map(({ d }) => d.codecString).join(", ");
  return {
    duration: demux.duration,
    tracks: described.map(({ t, d }) => ({
      id: t.id,
      kind: t.kind,
      codec: t.codec,
      codecString: d.codecString,
    })),
    choices: demux.tracks.map((t) => ({ id: t.id, kind: t.kind, codec: t.codec })),
    mime: `${video ? "video" : "audio"}/mp4; codecs="${codecs}"`,
    init: initSegment(carried, demux.duration),
    async *fragments(from) {
      const stages = new Map(
        described.map(({ t, d }, i) => [
          t.id,
          {
            id: i + 1,
            stage: createStage({
              kind: t.kind,
              scale: t.timescale,
              timescale: d.timescale,
              frameDuration: t.frameDuration,
              frames: d.frames,
              rewrite: d.rewrite,
            }),
          },
        ]),
      );
      const fragmenter = createFragmenter(carried);
      const take = (/** @type {{ id: number, stage: ReturnType<typeof createStage> }} */ s) =>
        fragmenter.push(s.stage.take().map((sample) => ({ ...sample, track: s.id })));
      for await (const p of demux.packets(Math.max(0, from), want)) {
        const s = stages.get(p.track);
        if (!s) continue;
        s.stage.push(p);
        yield* take(s);
      }
      for (const s of stages.values()) {
        s.stage.end();
        yield* take(s);
      }
      yield* fragmenter.end();
    },
    keyframe: (time) => demux.keyframe(Math.max(0, time)),
  };
}
