/**
 * What the which-key overlay shows and what a key does in it, as plain data (ADR 0118). After a
 * prefix it lists every continuation: the keys still to press, the command's title and its owner.
 * With the search empty every key is first tried as the next chord, so `Ctrl+C p f` works as typed;
 * a key that continues nothing moves the selection (arrows), runs it (Enter), goes back one chord
 * (Backspace), starts a search (a printable character) or, for any other chord, ends the wait as
 * unbound. Once the search has text, keys edit it, and only chords with Meta, Control or Alt still
 * continue. Escape and Ctrl+G always cancel.
 */
import { isChorded, type Platform } from "./chord";
import type { Resolved } from "./conflicts";
import { formatChords, isCancel } from "./parse";

export interface Item {
  /** The whole canonical sequence. */
  combo: string;
  /** The chords still to press after the prefix. */
  rest: string[];
  /** `rest` as people read it on the platform. */
  keys: string[];
  command: string;
  title: string;
  /** Who binds it, in words. */
  owner: string;
  /** The command cannot run now. */
  off: boolean;
}

export interface ItemFacts {
  platform: Platform;
  title(command: string): string | undefined;
  available(command: string): boolean;
  owner(owner: string): string;
}

/** The continuations of `prefix` among `bindings`, in sequence order. */
export function itemsOf(bindings: Resolved[], prefix: string[], facts: ItemFacts): Item[] {
  return bindings
    .filter((b) => b.chords.length > prefix.length && prefix.every((c, i) => b.chords[i] === c))
    .map((b) => {
      const rest = b.chords.slice(prefix.length);
      return {
        combo: b.combo,
        rest,
        keys: formatChords(rest.join(" "), facts.platform),
        command: b.command,
        title: facts.title(b.command) ?? b.command,
        owner: facts.owner(b.owner),
        off: !facts.available(b.command),
      };
    });
}

/** The items whose keys, title, command or owner hold every word of `query`. */
export function filterItems(items: Item[], query: string): Item[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = [item.keys.join(" "), item.title, item.command, item.owner]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export type OverlayAction =
  | "cancel"
  | "continue"
  | "up"
  | "down"
  | "run"
  | "back"
  | "stay"
  | "type"
  | "unbound";

export interface KeyFacts {
  /** The search has text. */
  searching: boolean;
  /** The pending prefix and this chord lead to a binding or a longer prefix. */
  continues: boolean;
  /** A character the search would take: one character, no Meta, Control or Alt. */
  printable: boolean;
}

/** What a canonical chord does in the overlay. */
export function overlayAction(chord: string, facts: KeyFacts): OverlayAction {
  if (isCancel(chord)) return "cancel";
  if (facts.continues && (!facts.searching || isChorded(chord))) return "continue";
  if (chord === "ArrowDown") return "down";
  if (chord === "ArrowUp") return "up";
  if (chord === "Enter") return "run";
  if (chord === "Tab" || chord === "Shift+Tab") return "stay";
  if (facts.searching) return "type";
  if (chord === "Backspace") return "back";
  return facts.printable ? "type" : "unbound";
}

/** The next selection after a move, wrapping around; -1 when there is nothing to select. */
export function moveSelection(selected: number, count: number, by: 1 | -1): number {
  if (count === 0) return -1;
  return ((((selected < 0 ? (by > 0 ? -1 : 0) : selected) + by) % count) + count) % count;
}
