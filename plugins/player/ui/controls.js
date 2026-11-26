// The playlist and subtitle controls used by the view, keyboard and agent commands.

/** @typedef {import("./player.js").Entry} Entry */

/**
 * @param {{
 *   playEntry: ReturnType<typeof import("./playing.js").createPlaying>["playEntry"],
 *   choose: ReturnType<typeof import("./playing.js").createPlaying>["choose"],
 *   refresh(entry: Entry): void,
 *   say(words: string): void,
 * }} parts
 */
export function createPlayerControls({ playEntry, choose, refresh, say }) {
  const setOffset = (
    /** @type {NonNullable<Entry["subs"]>} */ subs,
    /** @type {number} */ value,
  ) => {
    subs.offset = value;
    say(
      value === 0
        ? "Subtitles in time."
        : `Subtitles ${Math.abs(value).toFixed(1)} s ${value > 0 ? "later" : "earlier"}.`,
    );
  };
  return {
    async entry(/** @type {Entry} */ entry, /** @type {unknown} */ to) {
      const list = entry.playlist;
      if (!list) throw new Error("The current file has no playlist.");
      const end = list.entries.length - 1;
      let from;
      let step;
      switch (to) {
        case "next":
          [from, step] = [list.index + 1, 1];
          break;
        case "previous":
          [from, step] = [list.index - 1, -1];
          break;
        case "first":
          [from, step] = [0, 1];
          break;
        case "last":
          [from, step] = [end, -1];
          break;
        default: {
          if (typeof to !== "number" || !Number.isSafeInteger(to) || to < 1 || to > end + 1)
            throw new Error("Choose a listed one-based playlist entry or a direction.");
          const row = list.entries[to - 1];
          if (!row?.path || row.remote || list.states[to - 1])
            throw new Error("That playlist entry is unavailable.");
          if (list.index === to - 1 && entry.item?.path === row.path) return;
          [from, step] = [to - 1, 0];
        }
      }
      const failure = await playEntry(entry, from, step);
      refresh(entry);
      if (failure !== null) {
        const boundary = step === 1 ? "That was the last entry." : "This is the first entry.";
        throw new Error(failure || (step ? boundary : "That playlist entry is unavailable."));
      }
    },
    async subtitle(
      /** @type {Entry} */ entry,
      /** @type {unknown} */ track,
      /** @type {unknown} */ offset = undefined,
    ) {
      const subs = entry.subs;
      if (!subs) throw new Error("The current item has no subtitle tracks.");
      if (offset !== undefined && (typeof offset !== "number" || !Number.isFinite(offset)))
        throw new Error("Give a finite subtitle offset in seconds.");
      const id =
        track === "off" ? "" : track === "on" ? subs.selected || subs.options[0]?.id : track;
      if (id !== "" && !subs.options.some((option) => option.id === id))
        throw new Error("Choose an available subtitle track, on or off.");
      await choose(entry, /** @type {string} */ (id));
      if (typeof offset === "number") setOffset(subs, offset);
      refresh(entry);
    },
    offset(/** @type {Entry} */ entry, /** @type {number} */ delta) {
      if (entry.subs) setOffset(entry.subs, Math.round((entry.subs.offset + delta) * 10) / 10);
    },
  };
}
