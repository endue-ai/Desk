/**
 * The pending-prefix router (ADR 0118): bound sequences in a trie per scope (the global keymap and
 * each surface's), and the prefix pressed so far. A chord that starts or continues a prefix waits
 * for the next one; Escape and Ctrl+G cancel; an unbound continuation ends the wait and is said so.
 * While a prefix is pending every key belongs to the desk, wherever it came from (a plugin frame
 * forwards its chords; the which-key overlay takes the focus for plain ones). The wait has no time
 * limit unless `configure` gives one (desk.keys.sequence-timeout), as in Emacs.
 */
import type { Clock } from "../clock";
import { isCancel } from "./parse";

/** A handler returns false when it did nothing, so a single chord goes on as if unbound. */
export type Handler = () => unknown;

interface Node {
  handler?: Handler;
  children: Map<string, Node>;
}

const node = (): Node => ({ children: new Map() });

/** How a wait for the next chord ended. */
export type Outcome = "ran" | "off" | "unbound" | "cancelled" | "timeout" | "captured";

export type SequenceEvent =
  | { kind: "pending"; chords: string[]; capturing: boolean }
  | { kind: "done"; chords: string[]; outcome: Outcome };

export class SequenceRouter {
  readonly #global = node();
  readonly #surfaces = new Map<string, Node>();
  readonly #listeners = new Set<(event: SequenceEvent) => void>();
  #pending: string[] = [];
  #scope: string | null = null;
  #capture: ((sequence: string) => void) | undefined;
  #timeoutMs = 0;
  #clock: Clock | undefined;
  #stopTimer: (() => void) | undefined;

  /** Bind a canonical sequence in the global keymap or a surface's. Returns an unbind. */
  bind(chords: string[], handler: Handler, surface?: string): () => void {
    let at = surface ? this.#surface(surface) : this.#global;
    const path: Node[] = [at];
    for (const chord of chords) {
      let next = at.children.get(chord);
      if (!next) {
        next = node();
        at.children.set(chord, next);
      }
      at = next;
      path.push(at);
    }
    at.handler = handler;
    return () => {
      if (at.handler !== handler) return;
      at.handler = undefined;
      // Prune the branches nothing is bound under any more.
      for (let i = chords.length; i > 0; i--) {
        const here = path[i];
        if (!here || here.handler || here.children.size) break;
        path[i - 1]?.children.delete(chords[i - 1] ?? "");
      }
    };
  }

  /** Wait at most `timeoutMs` for the next chord (0: as long as it takes), timed on `clock`. */
  configure(options: { timeoutMs?: number; clock?: Clock }): void {
    if (options.timeoutMs !== undefined) this.#timeoutMs = Math.max(0, options.timeoutMs);
    if (options.clock) this.#clock = options.clock;
    if (this.#pending.length) this.#startTimer();
  }

  /** The chords pressed so far of a sequence that is not complete yet; empty when none. */
  get pending(): string[] {
    return [...this.#pending];
  }

  get capturing(): boolean {
    return this.#capture !== undefined;
  }

  /** Hear prefixes start, grow and end. */
  onChange(listener: (event: SequenceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Hand the next whole sequence to `handler` instead of its binding. Returns a stop function. */
  captureNext(handler: (sequence: string) => void): () => void {
    this.#capture = handler;
    return () => {
      if (this.#capture !== handler) return;
      this.#capture = undefined;
      if (this.#pending.length) this.#end("cancelled");
    };
  }

  /** Whether `chords` lead somewhere: a binding, or a prefix of some, for the focused surface. */
  bound(chords: string[], focused: string | null = this.#scope): boolean {
    return this.#lookup(chords, focused) !== undefined;
  }

  /** Route one canonical chord; `focused` is the surface whose keymap is asked first. */
  press(chord: string, focused: string | null): boolean {
    const waiting = this.#pending.length > 0;
    if (waiting && isCancel(chord)) {
      this.cancel();
      return true;
    }
    const scope = waiting ? this.#scope : focused;
    const chords = [...this.#pending, chord];
    const found = this.#lookup(chords, scope);
    const capture = this.#capture;
    if (found && !found.handler && found.children.size) {
      this.#wait(chords, scope);
      return true;
    }
    if (capture) {
      this.#capture = undefined;
      if (waiting) this.#end("captured");
      capture(chords.join(" "));
      return true;
    }
    if (!found?.handler) {
      if (waiting) this.#end("unbound", chords);
      return waiting;
    }
    if (!waiting) return found.handler() !== false;
    // The overlay closes (and gives the focus back) before the command runs and moves it.
    this.#end("ran", chords);
    if (found.handler() === false) this.#emit({ kind: "done", chords, outcome: "off" });
    return true;
  }

  /** Press the rest of a sequence, as choosing it in the overlay does. */
  feed(chords: string[]): void {
    for (const chord of chords) {
      this.press(chord, this.#scope);
      if (!this.#pending.length) return;
    }
  }

  /** Take back the last chord of the pending prefix; with only one, stop waiting. */
  back(): void {
    if (this.#pending.length <= 1) this.cancel();
    else this.#wait(this.#pending.slice(0, -1), this.#scope);
  }

  /** Stop waiting for the next chord, if the desk is: Escape, Ctrl+G, a timeout, a click elsewhere.
   * A capture waiting on the sequence hears "Escape", as when Escape was its first chord. */
  cancel(outcome: "cancelled" | "timeout" = "cancelled"): void {
    if (!this.#pending.length) return;
    const capture = this.#capture;
    this.#capture = undefined;
    this.#end(outcome);
    capture?.("Escape");
  }

  #wait(chords: string[], scope: string | null): void {
    this.#pending = chords;
    this.#scope = scope;
    this.#startTimer();
    this.#emit({ kind: "pending", chords: [...chords], capturing: this.capturing });
  }

  #end(outcome: Outcome, chords = this.#pending): void {
    this.#stopTimer?.();
    this.#stopTimer = undefined;
    this.#pending = [];
    this.#scope = null;
    this.#emit({ kind: "done", chords: [...chords], outcome });
  }

  #startTimer(): void {
    this.#stopTimer?.();
    this.#stopTimer = undefined;
    const clock = this.#clock;
    if (!clock || this.#timeoutMs <= 0) return;
    const deadline = clock.now() + this.#timeoutMs;
    const tick = (now: number) => {
      if (now >= deadline) {
        this.#stopTimer = undefined;
        this.cancel("timeout");
      } else this.#stopTimer = clock.requestFrame(tick);
    };
    this.#stopTimer = clock.requestFrame(tick);
  }

  #lookup(chords: string[], scope: string | null): Node | undefined {
    const walk = (root: Node | undefined) => {
      let at = root;
      for (const chord of chords) at = at?.children.get(chord);
      return at && (at.handler || at.children.size) ? at : undefined;
    };
    return (scope ? walk(this.#surfaces.get(scope)) : undefined) ?? walk(this.#global);
  }

  #surface(id: string): Node {
    let root = this.#surfaces.get(id);
    if (!root) {
      root = node();
      this.#surfaces.set(id, root);
    }
    return root;
  }

  #emit(event: SequenceEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
