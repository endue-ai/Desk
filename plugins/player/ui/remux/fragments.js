// Media segments from samples: one fragment per group of pictures (cut at a key frame once it holds
// a second), or a second of audio when there is no video, each track's samples in its own run, audio
// cut at the key frame's presentation time so a fragment covers one stretch of time for every track.
import { mediaSegment } from "./fmp4.js";

/**
 * @typedef {import("./timing.js").Sample} Sample
 * @typedef {{ data: Uint8Array, start: number, end: number }} Fragment
 * @typedef {{ id: number, kind: "video" | "audio", timescale: number }} Carried
 */

const SPAN = 1;
const MAX_SPAN = 4;
const MAX_BYTES = 12 << 20;

/** @param {Carried[]} tracks */
export function createFragmenter(tracks) {
  const video = tracks.find((t) => t.kind === "video");
  /** @type {Map<number, Sample[]>} */
  const queues = new Map(tracks.map((t) => [t.id, []]));
  let sequence = 0;
  let bytes = 0;

  const span = (/** @type {Sample[]} */ q, /** @type {Carried} */ t) =>
    q.length === 0 ? 0 : ((q.at(-1)?.dts ?? 0) - (q[0]?.dts ?? 0)) / t.timescale;

  /** Build a fragment of the queued samples `pick` chooses; null when it chose none. */
  const cut = (/** @type {(t: Carried, q: Sample[]) => number} */ pick) => {
    /** @type {import("./fmp4.js").Run[]} */
    const runs = [];
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const t of tracks) {
      const q = queues.get(t.id) ?? [];
      const n = pick(t, q);
      if (n <= 0) continue;
      const taken = q.splice(0, n);
      for (const s of taken) {
        start = Math.min(start, s.time);
        end = Math.max(end, s.time + s.duration / t.timescale);
        bytes -= s.data.length;
      }
      runs.push({
        track: t.id,
        base: taken[0]?.dts ?? 0,
        samples: taken.map((s) => ({
          duration: s.duration,
          size: s.data.length,
          key: s.key,
          cts: s.cts,
        })),
        data: taken.map((s) => s.data),
      });
    }
    if (runs.length === 0) return null;
    return { data: mediaSegment(runs, ++sequence), start, end };
  };

  /** Audio (and other) samples before `time`, every video sample queued. */
  const before =
    (/** @type {number} */ time) => (/** @type {Carried} */ t, /** @type {Sample[]} */ q) => {
      if (t.kind === "video") return q.length;
      let n = 0;
      while (n < q.length && (q[n]?.time ?? 0) < time) n++;
      return n;
    };

  return {
    /**
     * Queue samples; answers the fragments that are complete.
     * @param {Sample[]} samples
     * @returns {Fragment[]}
     */
    push(samples) {
      /** @type {Fragment[]} */
      const out = [];
      for (const s of samples) {
        const t = tracks.find((c) => c.id === s.track);
        const q = queues.get(s.track);
        if (!t || !q) continue;
        if (video && t === video) {
          const vq = q;
          const long = span(vq, t) >= MAX_SPAN || bytes >= MAX_BYTES;
          if (vq.length > 0 && ((s.key && span(vq, t) >= SPAN * 0.9) || long)) {
            const at = s.key ? s.time : Math.max(...vq.map((v) => v.time));
            const f = cut(before(at));
            if (f) out.push(f);
          }
        }
        q.push(s);
        bytes += s.data.length;
        if (!video && span(q, t) >= SPAN) {
          const f = cut((_, all) => all.length);
          if (f) out.push(f);
        }
      }
      return out;
    },
    /** Everything still queued, as the last fragment. */
    end() {
      const f = cut((_, q) => q.length);
      return f ? [f] : [];
    },
  };
}
