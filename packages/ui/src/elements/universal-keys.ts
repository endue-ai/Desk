// Where a key takes focus among a universal view's entries, without a DOM. A board's columns are
// lanes: Up and Down stay in one, Left and Right cross to the nearest one with cards and Shift with
// them moves the card; a calendar's Left and Right step through its days; elsewhere there is one lane.

/** An entry as the keys see it: the lane it is drawn in. */
export interface Laned {
  lane: number;
}

/** What a key does: focus another entry, move this one a column over, or select it. */
export type KeyMove<T> = { focus: T } | { shift: -1 | 1 } | { select: true } | null;

/** How the entries are laid out. */
export type KeyLayout = "board" | "grid" | "line";

/** The entry at `at` (or the last) in the nearest lane in `step`'s direction that has any. */
function beside<T extends Laned>(entries: T[], from: T, step: -1 | 1, at: number): T | undefined {
  const lanes = Math.max(...entries.map((each) => each.lane));
  for (let lane = from.lane + step; lane >= 0 && lane <= lanes; lane += step) {
    const there = entries.filter((each) => each.lane === lane);
    if (there.length > 0) return there[Math.min(at, there.length - 1)];
  }
  return undefined;
}

/** What `key` (with Shift or not) does on `entry`; null when it does nothing there. */
export function keyMove<T extends Laned>(
  entries: T[],
  entry: T,
  key: string,
  shift: boolean,
  layout: KeyLayout,
): KeyMove<T> {
  const lane = layout === "board" ? entries.filter((each) => each.lane === entry.lane) : entries;
  const at = lane.indexOf(entry);
  const to = (found: T | undefined): KeyMove<T> => (found ? { focus: found } : null);
  switch (key) {
    case "ArrowDown":
      return to(lane[at + 1]);
    case "ArrowUp":
      return to(lane[at - 1]);
    case "Home":
      return to(lane[0]);
    case "End":
      return to(lane[lane.length - 1]);
    case "ArrowLeft":
    case "ArrowRight": {
      const step = key === "ArrowLeft" ? -1 : 1;
      if (layout === "grid") return to(entries[entries.indexOf(entry) + step]);
      if (layout !== "board") return null;
      return shift ? { shift: step } : to(beside(entries, entry, step, at));
    }
    case "Enter":
    case " ":
      return { select: true };
    default:
      return null;
  }
}
