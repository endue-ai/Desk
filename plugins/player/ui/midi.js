// Standard MIDI Files, format 0 and 1 (and RIFF RMID around one): every track's events merged by
// tick, the tempo map turning ticks into seconds (SMPTE time too), and the notes with their channel,
// key, velocity and the program in force. Format 2 holds independent patterns and is refused.
import { Cursor, latin1, startsWith } from "./bytes.js";

/**
 * @typedef {{ channel: number, key: number, velocity: number, program: number, start: number, end: number }} Note
 * @typedef {{ tick: number, time: number, bpm: number }} Tempo
 * @typedef {{ format: number, tracks: number, division: number, title: string, tempos: Tempo[],
 *   notes: Note[], duration: number }} Song
 * @typedef {{ tick: number, track: number, order: number, status: number, a: number, b: number,
 *   tempo?: number }} Event
 */

const damaged = () => new Error("The MIDI file is damaged: a chunk runs past its end.");
const exact = (/** @type {number} */ seconds) => Math.round(seconds * 1e6) / 1e6;

/** A variable-length quantity: seven bits a byte, at most four bytes. */
function vlq(/** @type {Cursor} */ c) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (c.left < 1) throw damaged();
    const b = c.u8();
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) return value;
  }
  return value;
}

/** One MTrk chunk's events with absolute ticks, and its name. */
function trackEvents(/** @type {Uint8Array} */ data, /** @type {number} */ track) {
  const c = new Cursor(data);
  /** @type {Event[]} */
  const events = [];
  let tick = 0;
  let running = 0;
  let name = "";
  let order = 0;
  while (c.left > 0) {
    tick += vlq(c);
    let status = data[c.pos] ?? 0;
    if (status & 0x80) c.skip(1);
    else if (running) status = running;
    else throw new Error("The MIDI file is damaged: data with no status byte.");
    if (status === 0xff) {
      const type = c.u8();
      const length = vlq(c);
      const body = c.take(length);
      if (body.length < length) throw damaged();
      if (type === 0x2f) {
        events.push({ tick, track, order: order++, status: 0xff, a: 0x2f, b: 0 });
        break;
      }
      if (type === 0x51 && length === 3) {
        const tempo = ((body[0] ?? 0) << 16) | ((body[1] ?? 0) << 8) | (body[2] ?? 0);
        events.push({ tick, track, order: order++, status: 0xff, a: 0x51, b: 0, tempo });
      }
      if (type === 0x03 && !name) name = latin1(body).trim();
    } else if (status === 0xf0 || status === 0xf7) {
      const length = vlq(c);
      if (c.take(length).length < length) throw damaged();
    } else {
      running = status;
      const kind = status & 0xf0;
      const a = c.u8();
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : c.u8();
      if (c.pos > data.length) throw damaged();
      events.push({ tick, track, order: order++, status, a, b });
    }
  }
  return { events, name };
}

/** The SMF inside a RIFF RMID file, or the bytes as they are. */
function unwrap(/** @type {Uint8Array} */ bytes) {
  if (!startsWith(bytes, "RIFF") || !startsWith(bytes, "RMID", 8)) return bytes;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = new Cursor(bytes, at + 4, true).u32();
    if (startsWith(bytes, "data", at)) return bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  throw new Error("This RMID file has no data chunk.");
}

/**
 * Read a Standard MIDI File. Throws an Error that says why in words.
 * @param {Uint8Array} file
 * @returns {Song}
 */
export function readMidi(file) {
  const bytes = unwrap(file);
  if (!startsWith(bytes, "MThd") || bytes.length < 14)
    throw new Error("The MIDI file is damaged: no complete MThd header.");
  const head = new Cursor(bytes, 4);
  const headerLength = head.u32();
  const format = head.u16();
  const count = head.u16();
  const division = head.u16();
  if (format === 2) throw new Error("MIDI format 2 (independent patterns) is not played.");
  if (format > 2) throw new Error(`MIDI format ${format} is not one the player reads.`);
  /** @type {Event[]} */
  const events = [];
  let title = "";
  let at = 8 + headerLength;
  for (let track = 0; at + 8 <= bytes.length && track < count; ) {
    const id = latin1(bytes.subarray(at, at + 4));
    const size = new Cursor(bytes, at + 4).u32();
    if (at + 8 + size > bytes.length) throw damaged();
    if (id === "MTrk") {
      const found = trackEvents(bytes.subarray(at + 8, at + 8 + size), track);
      events.push(...found.events);
      if (!title && found.name && (format === 0 || track === 0)) title = found.name;
      track++;
    }
    at += 8 + size;
  }
  if (count > 0 && events.length === 0 && at < bytes.length) throw damaged();
  events.sort((x, y) => x.tick - y.tick || x.track - y.track || x.order - y.order);

  // Ticks to seconds: SMPTE division is a fixed rate; otherwise the tempo map decides.
  const smpte = division & 0x8000;
  const perTickSmpte = smpte ? 1 / ((256 - (division >> 8)) * (division & 0xff)) : 0;
  const ticksPerBeat = smpte ? 1 : division || 96;
  /** @type {Tempo[]} */
  const tempos = [];
  /** @type {Array<{ tick: number, time: number, us: number }>} */
  const map = [{ tick: 0, time: 0, us: 500000 }];
  for (const e of events) {
    if (e.tempo === undefined || e.tempo === 0) continue;
    const last = /** @type {(typeof map)[number]} */ (map.at(-1));
    const time = last.time + ((e.tick - last.tick) * last.us) / ticksPerBeat / 1e6;
    if (e.tick === last.tick) map[map.length - 1] = { tick: e.tick, time: last.time, us: e.tempo };
    else map.push({ tick: e.tick, time, us: e.tempo });
  }
  for (const m of map)
    tempos.push({ tick: m.tick, time: exact(m.time), bpm: Math.round(60e9 / m.us) / 1000 });
  const seconds = (/** @type {number} */ tick) => {
    if (smpte) return exact(tick * perTickSmpte);
    let segment = map[0] ?? { tick: 0, time: 0, us: 500000 };
    for (const m of map) if (m.tick <= tick) segment = m;
    return exact(segment.time + ((tick - segment.tick) * segment.us) / ticksPerBeat / 1e6);
  };

  /** @type {Note[]} */
  const notes = [];
  const programs = new Array(16).fill(0);
  /** @type {Map<number, Array<{ tick: number, velocity: number, program: number }>>} */
  const sounding = new Map();
  let end = 0;
  for (const e of events) {
    end = Math.max(end, e.tick);
    if (e.status === 0xff) continue;
    const kind = e.status & 0xf0;
    const channel = e.status & 15;
    if (kind === 0xc0) programs[channel] = e.a;
    if (kind !== 0x80 && kind !== 0x90) continue;
    const id = channel * 128 + e.a;
    const stack = sounding.get(id) ?? [];
    if (kind === 0x90 && e.b > 0) {
      stack.push({ tick: e.tick, velocity: e.b, program: programs[channel] ?? 0 });
      sounding.set(id, stack);
    } else {
      const on = stack.shift();
      if (on)
        notes.push({
          channel,
          key: e.a,
          velocity: on.velocity,
          program: on.program,
          start: seconds(on.tick),
          end: seconds(e.tick),
        });
    }
  }
  for (const [id, stack] of sounding)
    for (const on of stack)
      notes.push({
        channel: id >> 7,
        key: id & 127,
        velocity: on.velocity,
        program: on.program,
        start: seconds(on.tick),
        end: seconds(end),
      });
  notes.sort((x, y) => x.start - y.start || x.channel - y.channel || x.key - y.key);
  const duration = notes.reduce((longest, n) => Math.max(longest, n.end), seconds(end));
  return { format, tracks: count, division, title, tempos, notes, duration };
}
