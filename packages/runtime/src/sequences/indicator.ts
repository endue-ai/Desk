/**
 * The pending keys in the status area (ADR 0118), as Emacs echoes "C-x-": "⌃X –" while the desk
 * waits for the next key, then a moment of "⌃X ⌃Q is not bound" (or not available, timed out,
 * quit) when the wait ends without a command. It is in the DOM only while it says something.
 */
import type { Clock } from "../clock";
import { h } from "../shell/dom";
import type { Platform } from "./chord";
import { type SequenceLanguage, sequenceText } from "./copy";
import { formatChords } from "./parse";
import type { Outcome, SequenceRouter } from "./router";

/** How long the outcome of a wait stays in the status area. */
export const OUTCOME_MS = 1500;

export interface IndicatorOptions {
  root: HTMLElement;
  sequences: SequenceRouter;
  platform: Platform;
  language: SequenceLanguage;
  clock: Clock;
}

const SAID: Partial<Record<Outcome, Parameters<typeof sequenceText>[1]>> = {
  unbound: "unbound",
  off: "offNow",
  timeout: "timeout",
  cancelled: "quit",
};

export function mountIndicator(options: IndicatorOptions): { dispose(): void } {
  const { root, sequences, platform, clock } = options;
  const tr = (key: Parameters<typeof sequenceText>[1]) => sequenceText(options.language, key);
  let el: HTMLElement | undefined;
  let stopTimer: (() => void) | undefined;

  const remove = () => {
    stopTimer?.();
    stopTimer = undefined;
    el?.remove();
    el = undefined;
  };
  const show = (children: Array<Node | string>, outcome?: Outcome) => {
    stopTimer?.();
    stopTimer = undefined;
    if (!el) {
      el = h("div", { class: "desk-keys-pending", role: "status", "aria-live": "polite" });
      root.append(el);
    }
    if (outcome) el.dataset.outcome = outcome;
    else delete el.dataset.outcome;
    el.replaceChildren(...children);
  };
  /** The chords as <kbd>s, a space apart, so the text reads "⌃X ⌃Q" too. */
  const keys = (chords: string[]) =>
    formatChords(chords.join(" "), platform).flatMap((chord, i) =>
      i ? [" ", h("kbd", {}, chord)] : [h("kbd", {}, chord)],
    );

  const off = sequences.onChange((event) => {
    if (event.kind === "pending") {
      show([
        h("span", { class: "desk-visually-hidden" }, tr("waiting")),
        ...keys(event.chords),
        h("span", { "aria-hidden": "true" }, "–"),
      ]);
      return;
    }
    const said = SAID[event.outcome];
    if (!said) return remove();
    show(
      event.outcome === "cancelled" ? [tr(said)] : [...keys(event.chords), " ", tr(said)],
      event.outcome,
    );
    const until = clock.now() + OUTCOME_MS;
    const tick = (now: number) => {
      if (now >= until) remove();
      else stopTimer = clock.requestFrame(tick);
    };
    stopTimer = clock.requestFrame(tick);
  });

  return {
    dispose: () => {
      off();
      remove();
    },
  };
}
