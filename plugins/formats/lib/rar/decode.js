// Reading entries: stored data straight from the source, packed data through the format's decoder.
// A solid group (an entry and the entries packed after it with the solid flag) is decoded from its
// first entry; the decoder is kept after a read so reading on through the group does not start over.
import { badCrc, DAMAGED, sizeText } from "./entries.js";
import { Input } from "./input.js";
import { Pace } from "./pace.js";
import { Sink } from "./sink.js";

/** @typedef {import("./input.js").Source} Source */
/** @typedef {import("./entries.js").Entry} Entry */
/**
 * @typedef {{
 *   start: number, packed: number, size: number, known: boolean, crc?: number,
 *   method: number, solid: boolean, dictionary: number, copyOf?: string,
 * }} Data
 * @typedef {{ file(input: Input, sink: Sink, pace: Pace): Promise<void> }} Decoder
 * @typedef {{ entry: Entry, data?: Data }} Item
 * @typedef {{
 *   signal?: AbortSignal,
 *   maxWindow?: number,
 *   progress?: (done: number, total: number) => void,
 * }} Options
 * `progress` hears, a few times a second while a read runs, how many bytes it has decoded of how
 * many (in a solid archive the entries before the wanted one count too).
 */

const DEPENDS =
  "It follows an entry that cannot be extracted in this solid archive: not extracted.";
const MOST = 1 << 30;
const LEAST = 1 << 18;
const FILTERS = 1 << 23;

/** @param {number} n */
const power = (n) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)));

/**
 * @param {Source} source @param {Item[]} items the archive's entries in its order
 * @param {(size: number, data: Data) => Decoder} decoder a fresh decoder with a ring of `size`
 * @param {Options} [options]
 */
export function reader(source, items, decoder, options = {}) {
  /** @type {Map<Entry, { data: Data, group?: Data[], index: number }>} */
  const places = new Map();
  const byPath = new Map(items.map((item) => [item.entry.path, item.entry]));
  /** @type {Data[] | undefined} */
  let group;
  /** @type {Map<Data[], { entries: Entry[], refused: boolean }>} */
  const members = new Map();
  for (const { entry, data } of items) {
    if (!data) continue;
    if (data.method === 0 || data.copyOf) {
      places.set(entry, { data, index: 0 });
      continue;
    }
    if (!data.solid || !group) {
      group = [];
      members.set(group, { entries: [], refused: false });
    }
    places.set(entry, { data, group, index: group.length });
    group.push(data);
    const list = /** @type {{ entries: Entry[], refused: boolean }} */ (members.get(group));
    if (list.refused && !entry.refusal) entry.refusal = DEPENDS;
    if (entry.refusal) list.refused = true;
    list.entries.push(entry);
  }
  const most = 2 ** Math.floor(Math.log2(options.maxWindow ?? MOST));
  /** @type {Map<Data[], number>} */
  const rings = new Map();
  for (const [g, list] of members) {
    const total = g.some((d) => !d.known)
      ? Number.POSITIVE_INFINITY
      : g.reduce((n, d) => n + d.size, 0);
    const dictionary = Math.max(...g.map((d) => d.dictionary));
    if (power(Math.min(total, dictionary)) > most) {
      const refusal = `It needs a ${sizeText(dictionary)} dictionary, more memory than the desk gives an archive: not extracted.`;
      for (const e of list.entries) e.refusal ??= refusal;
    }
    rings.set(
      g,
      Math.min(most, power(Math.max(LEAST, Math.min(total, Math.max(dictionary, FILTERS))))),
    );
  }

  /** @type {{ group: Data[], next: number, decoder: Decoder } | undefined} */
  let cursor;
  let queue = Promise.resolve();
  /** @template T @param {() => Promise<T>} work @returns {Promise<T>} */
  const serial = (work) => {
    const run = queue.then(work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /**
   * @param {Entry} entry @param {number} limit @param {Pace} pace
   * @param {boolean} [plan] whether this read adds its bytes to the pace's total
   * @returns {Promise<Uint8Array>}
   */
  const readOne = async (entry, limit, pace, plan = true) => {
    if (entry.kind === "folder") return new Uint8Array(0);
    if (entry.refusal) throw new Error(entry.refusal);
    const place = places.get(entry);
    if (entry.kind === "link" && (entry.link !== undefined || !place))
      return new TextEncoder().encode(entry.link ?? "");
    if (!place) return new Uint8Array(0);
    const { data } = place;
    if (data.copyOf) {
      const target = byPath.get(data.copyOf);
      if (!target || target === entry || places.get(target)?.data.copyOf) throw new Error(DAMAGED);
      return readOne(target, limit, pace, plan);
    }
    if (!place.group) {
      if (plan) pace.total += Math.min(data.packed, limit);
      return stored(source, entry, data, limit, pace);
    }
    const g = place.group;
    let state = cursor && cursor.group === g && cursor.next <= place.index ? cursor : undefined;
    cursor = undefined;
    state ??= { group: g, next: 0, decoder: decoder(/** @type {number} */ (rings.get(g)), data) };
    if (plan) {
      for (let i = state.next; i < place.index; i++) pace.total += /** @type {Data} */ (g[i]).size;
      pace.total += Math.min(data.size, limit);
    }
    for (; state.next < place.index; state.next++) {
      const d = /** @type {Data} */ (g[state.next]);
      const sink = new Sink(d.known ? d.size : -1, { keep: false, pace });
      await state.decoder.file(new Input(source, d.start, d.packed), sink, pace);
      if (d.known && sink.length !== d.size) throw new Error(DAMAGED);
    }
    const sink = new Sink(data.known ? data.size : -1, { limit, pace });
    await state.decoder.file(new Input(source, data.start, data.packed), sink, pace);
    state.next++;
    if (!sink.done && state.next < g.length) cursor = state;
    return finish(entry, data, sink);
  };

  return {
    /** @param {Entry} entry @param {number} [limit] */
    read: (entry, limit = Number.POSITIVE_INFINITY) =>
      serial(() => readOne(entry, limit, new Pace(options.signal, options.progress))),
    /** @param {Entry[]} wanted @param {(entry: Entry, bytes: Uint8Array) => Promise<unknown>} visit */
    each: (wanted, visit) =>
      serial(async () => {
        const pace = new Pace(options.signal, options.progress);
        const order = new Map(items.map((item, i) => [item.entry, i]));
        const sorted = [...wanted].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        pace.total = sorted.reduce((n, e) => n + (e.kind === "file" ? Math.max(0, e.size) : 0), 0);
        for (const entry of sorted)
          await visit(entry, await readOne(entry, Number.POSITIVE_INFINITY, pace, false));
      }),
  };
}

/** Checks the size and CRC of a whole entry. @param {Entry} entry @param {Data} data @param {Sink} sink */
function finish(entry, data, sink) {
  if (sink.done) return sink.bytes();
  if (data.known && sink.length !== data.size) throw new Error(DAMAGED);
  if (data.crc !== undefined && sink.crc !== data.crc) throw new Error(badCrc(entry.path));
  return sink.bytes();
}

/** A stored entry's bytes, read in chunks. @param {Source} source @param {Entry} entry @param {Data} data @param {number} limit @param {Pace} pace */
async function stored(source, entry, data, limit, pace) {
  if (data.packed !== data.size && data.known) throw new Error(DAMAGED);
  const sink = new Sink(data.packed, { limit, pace });
  const input = new Input(source, data.start, data.packed);
  for (let at = 0; at < data.packed && !sink.done; ) {
    await input.ensure(1 << 20);
    const take = Math.min(input.ready, data.packed - at);
    sink.write(input.buf.subarray(input.pos >>> 3, (input.pos >>> 3) + take));
    input.pos += take * 8;
    at += take;
    await pace.step();
  }
  return finish(entry, { ...data, size: data.packed, known: true }, sink);
}
