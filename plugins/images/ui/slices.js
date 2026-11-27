// Change the active volume's displayed slice using the same request as the arrow keys.
/**
 * @typedef {import("./images.js").Entry} Entry
 * @param {{ current(): Entry | undefined, remodel(entry: Entry, decoded: Entry["decoded"]): void,
 *   render(): void, say(message: string): void }} parts
 */
export function volumeSlices({ current, remodel, render, say }) {
  /** @type {WeakMap<Entry, object>} */
  const pending = new WeakMap();
  async function show(/** @type {number} */ at) {
    const entry = current();
    const slices = entry?.decoded.slices;
    if (!entry || !slices) throw new Error("The current image has no volume slices.");
    const index = at - 1;
    if (index < 0 || index >= slices.count) throw new Error("That image slice is out of range.");
    if (index === slices.index && !pending.has(entry)) return { at, count: slices.count };
    const request = {};
    pending.set(entry, request);
    entry.slice = index;
    try {
      const rgba = await slices.at(index);
      if (pending.get(entry) !== request || entry.decoded.slices !== slices || current() !== entry)
        throw new Error("The active image slice changed.");
      remodel(entry, { ...entry.decoded, rgba, slices: { ...slices, index } });
      render();
      say(`Slice ${at} of ${slices.count}.`);
      return { at, count: slices.count };
    } finally {
      if (pending.get(entry) === request) {
        pending.delete(entry);
        entry.slice = undefined;
      }
    }
  }
  return {
    show,
    move(/** @type {number} */ delta) {
      const entry = current();
      const slices = entry?.decoded.slices;
      if (!entry || !slices) return;
      const from = entry.slice ?? slices.index;
      const next = Math.max(0, Math.min(slices.count - 1, from + delta));
      if (next !== from) return show(next + 1);
    },
  };
}
