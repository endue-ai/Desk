/**
 * Keyboard shortcut routing: the focused surface's keymap first, then the global keymap. A key is a
 * sequence of chords (ADR 0118); the pending prefix lives in `sequences/router.ts`.
 */
import { comboOf, type KeyLike, MODIFIER_KEYS, type Platform } from "./sequences/chord";
import { canonicalSequence, chordsOf, formatSequence } from "./sequences/parse";
import { type Handler, SequenceRouter } from "./sequences/router";

export { comboOf, type KeyLike, type Platform } from "./sequences/chord";

/** Route window keys while leaving composition and plain text editing to their controls. */
export function listenForShortcuts(win: Window, shortcuts: ShortcutRouter): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const editable = (event.target as Element | null)?.closest?.(
      "input, textarea, select, [contenteditable]:not([contenteditable=false])",
    );
    // While a prefix is pending the next key is the desk's, typed in a field or not.
    const pending = shortcuts.sequences.pending.length > 0;
    if (
      editable &&
      !pending &&
      !(event.metaKey || event.ctrlKey || event.altKey) &&
      event.key !== "Escape"
    )
      return;
    if (shortcuts.handle(event)) event.preventDefault();
  };
  win.addEventListener("keydown", onKey);
  return () => win.removeEventListener("keydown", onKey);
}

/** Guess the platform from the browser; tests pass it explicitly. */
export function detectPlatform(): Platform {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return /Mac|iPhone|iPad/.test(nav?.platform ?? nav?.userAgent ?? "") ? "mac" : "other";
}

/** "Mod+Shift+k" → "Meta+Shift+K" on macOS; a sequence chord by chord: "Meta+K Meta+S". */
export function canonical(combo: string, platform: Platform): string {
  return canonicalSequence(combo, platform);
}

/** How a canonical key reads: "⇧⌘K" on macOS, "Ctrl+Shift+K" elsewhere; "⌘K ⌘S" for a sequence. */
export function formatCombo(combo: string, platform: Platform): string {
  return formatSequence(combo, platform);
}

export class ShortcutRouter {
  readonly #platform: Platform;
  readonly #sequences = new SequenceRouter();
  #focused: string | null = null;

  constructor(options: { platform: Platform }) {
    this.#platform = options.platform;
  }

  get platform(): Platform {
    return this.#platform;
  }

  /** The pending prefix, its listeners and its timeout. */
  get sequences(): SequenceRouter {
    return this.#sequences;
  }

  /** Bind a key such as "Mod+K" or "Mod+K Mod+S" (Mod is Meta on macOS, Control elsewhere).
   * Returns an unbind. */
  bind(combo: string, handler: Handler, options: { surface?: string } = {}): () => void {
    const chords = chordsOf(canonical(combo, this.#platform));
    return this.#sequences.bind(chords, handler, options.surface);
  }

  /** Hand the next key to `handler` instead of its binding (desk.describe.open waits for one this
   * way): a whole sequence when its first chords are a prefix. Returns a function that stops. */
  captureNext(handler: (combo: string) => void): () => void {
    return this.#sequences.captureNext(handler);
  }

  focus(surface: string | null): void {
    this.#focused = surface;
  }

  get focused(): string | null {
    return this.#focused;
  }

  /** Run the handler bound to this key press, or wait for the next chord. Returns whether the key
   * was the desk's. */
  handle(event: KeyLike): boolean {
    if (MODIFIER_KEYS.has(event.key)) return false;
    // A chord still held and repeating is not the next key of a sequence or a capture.
    const waiting = this.#sequences.pending.length > 0 || this.#sequences.capturing;
    if (waiting && event.repeat) return true;
    return this.#sequences.press(comboOf(event), this.#focused);
  }
}
