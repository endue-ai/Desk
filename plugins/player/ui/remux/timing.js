// Samples from packets, one track at a time: decode times for containers that store only
// presentation times (Matroska), presentation times from picture order for those that store only
// decode order (AVI, MXF), sample durations, audio laid end to end at its frame length, and nothing
// before zero (tfdt cannot be negative).

/**
 * @typedef {{ track: number, pts?: number, dts?: number, order?: number, key: boolean,
 *   data: Uint8Array }} Packet times in the demuxed track's timescale
 * @typedef {{ track: number, dts: number, cts: number, duration: number, key: boolean,
 *   data: Uint8Array, time: number }} Sample times in the output timescale; `time` is the
 *   presentation time in seconds
 */

const WINDOW = 16;

/**
 * A stage for one track: push packets in decode order, take samples; end() flushes.
 * @param {{ kind: "video" | "audio", scale: number, timescale: number, frameDuration?: number,
 *   frames?: (data: Uint8Array) => number | undefined, rewrite?: (data: Uint8Array) => Uint8Array }} t
 *   `scale` is the demuxer's timescale, `timescale` the output's
 */
export function createStage(t) {
  const convert = (/** @type {number} */ v) =>
    t.scale === t.timescale ? v : Math.round((v * t.timescale) / t.scale);
  /** @type {Packet[]} */
  const held = [];
  /** @type {number[]} sorted presentation times not yet used as decode times */
  const times = [];
  /** @type {number[]} the display order of the last packets out */
  const done = [];
  /** @type {Sample | null} */
  let pending = null;
  /** @type {number | null} the first key frame's presentation time */
  let keyTime = null;
  let last = t.frameDuration ? convert(t.frameDuration) : 0;
  /** @type {number | null} where the next audio sample starts, laid end to end */
  let next = null;
  /** @type {Sample[]} */
  let out = [];

  const insert = (/** @type {number} */ v) => {
    let i = times.length;
    while (i > 0 && (times[i - 1] ?? 0) > v) i--;
    times.splice(i, 0, v);
  };

  /** A sample with its decode and presentation times known; its duration waits for the next. */
  const place = (/** @type {Packet} */ p, /** @type {number} */ dts, /** @type {number} */ pts) => {
    const data = t.rewrite ? t.rewrite(p.data) : p.data;
    if (t.kind === "audio") {
      const frame = t.frames?.(data);
      let start = pts;
      // Laid end to end after the last sample, unless the container's time says otherwise.
      if (next !== null && frame && Math.abs(pts - next) <= frame / 2 && (pending?.dts ?? 0) >= 0)
        start = next;
      if (pending) {
        pending.duration = Math.max(1, start - pending.dts);
        if (pending.duration > 0) flush(pending);
      }
      pending = {
        track: p.track,
        dts: start,
        cts: 0,
        duration: frame ?? last,
        key: true,
        data,
        time: 0,
      };
      next = start + (frame ?? last);
      if (frame) last = frame;
      return;
    }
    if (pending) {
      const d = dts - pending.dts;
      if (d > 0) last = d;
      pending.duration = d > 0 ? d : last || 1;
      flush(pending);
    }
    pending = {
      track: p.track,
      dts,
      cts: pts - dts,
      duration: last || 1,
      key: p.key,
      data,
      time: 0,
    };
  };

  const flush = (/** @type {Sample} */ s) => {
    const end = s.dts + s.cts + s.duration;
    if (end <= 0 || s.dts < 0) {
      // Audio that starts before zero plays from zero, shorter; mostly before zero, not at all.
      if (t.kind === "video" || s.dts + s.duration < s.duration / 2) return;
      s.duration = s.dts + s.duration;
      s.dts = 0;
    }
    s.time = (s.dts + s.cts) / t.timescale;
    out.push(s);
  };

  /** Packets leave the window in decode order once WINDOW later ones have arrived. */
  const release = (/** @type {boolean} */ all) => {
    while (held.length > (all ? 0 : WINDOW)) {
      const p = /** @type {Packet} */ (held.shift());
      if (p.pts !== undefined && p.dts === undefined) {
        const pts = convert(p.pts);
        place(p, times.shift() ?? pts, pts);
      } else if (p.order !== undefined && p.dts !== undefined) {
        const order = p.order;
        const later = held.filter((q) => (q.order ?? 0) < order).length;
        const earlier = done.filter((o) => o > order).length;
        done.push(order);
        if (done.length > WINDOW) done.shift();
        const dts = convert(p.dts);
        place(p, dts, dts + (later - earlier) * convert(t.frameDuration ?? 0));
      } else {
        const dts = convert(p.dts ?? p.pts ?? 0);
        place(p, dts, p.pts === undefined ? dts : convert(p.pts));
      }
    }
  };

  return {
    /** @param {Packet} p */
    push(p) {
      if (t.kind === "video") {
        if (keyTime === null && !p.key) return;
        if (keyTime === null) keyTime = p.pts ?? p.dts ?? 0;
        else if (!p.key && p.pts !== undefined && p.pts < keyTime) return;
      }
      if (t.kind === "audio") {
        const raw = p.pts ?? p.dts;
        const pts = raw === undefined ? (next ?? 0) : convert(raw);
        place(p, pts, pts);
        return;
      }
      held.push(p);
      if (p.pts !== undefined && p.dts === undefined) insert(convert(p.pts));
      release(false);
    },
    end() {
      release(true);
      if (pending) flush(pending);
      pending = null;
    },
    /** The samples ready so far, in decode order. */
    take() {
      const ready = out;
      out = [];
      return ready;
    },
  };
}
