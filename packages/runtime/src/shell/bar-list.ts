/**
 * The agent bar's controls in its two forms (issue 294, design 291). At rest each is an avatar
 * the bar's tooltip names (bar-tip.ts). Unfolded each is a row of a list: the same button by its
 * key, its data and its name, so the focus, the tab order and every selector hold through the
 * change of form. A row shows the face with its ring, the name, what the agent does or its state
 * in a word, and the time since it started; a space's row is lower and the selected one has a
 * check. A row has no tooltip: it says what the tooltip would. The times go on once a second
 * while a row counts one, and ask the ticker for no frames otherwise (ADR 0164).
 */
import { withTip } from "./bar-tip";
import type { ShellCtx } from "./context";
import { h, type Props } from "./dom";
import { icon } from "./icons";
import { elapsed } from "./Running";
import { IDLE } from "./ticker";

/** One control of the bar, whichever form the bar draws it in. */
export interface BarEntry {
  /** The face's classes: `avatar` for an agent (round), `avatar local-avatar` or `space` (cornered). */
  face: string;
  /** What the face shows: an initial, a program's badge, a space's glyph, a count. */
  glyph: string;
  /** The button's own attributes, the same in both forms: its key, its data, its name, its state. */
  attrs: Props;
  selected?: boolean;
  /** An endue agent that is turned off. */
  paused?: boolean;
  name: string;
  /** Under the name: what it works on, or its state in a word. */
  note?: string;
  /** Since when it works, as an ISO time: its row counts from it. */
  since?: string;
  /** A space: a lower row, checked while it is the selected one. */
  space?: boolean;
  /** The avatar's tooltip lines (bar-tip.ts). */
  tip: () => readonly string[];
  onClick: () => void;
}

/** What was asked for, on one line; nothing when it is blank. */
export const oneLine = (text: string | undefined) => text?.replace(/\s+/g, " ").trim() || undefined;

function avatar(e: BarEntry): HTMLButtonElement {
  const marks = `${e.selected ? " is-selected" : ""}${e.paused ? " is-paused" : ""}`;
  const button = h(
    "button",
    { class: `icon-button ${e.face}${marks}`, type: "button", ...e.attrs, onClick: e.onClick },
    h("span", { "aria-hidden": "true" }, e.glyph),
  );
  return withTip(button, e.tip);
}

function row(e: BarEntry, now: number): HTMLButtonElement {
  const started = e.since === undefined ? Number.NaN : Date.parse(e.since);
  const marks = `${e.space ? " bar-row-space" : ""}${e.selected ? " is-selected" : ""}`;
  return h(
    "button",
    { class: `menu-item bar-row${marks}`, type: "button", ...e.attrs, onClick: e.onClick },
    // The avatar's face, with the state its ring is drawn from.
    h(
      "span",
      {
        class: `${e.face} bar-face${e.paused ? " is-paused" : ""}`,
        "data-presence": e.attrs["data-presence"],
        "aria-hidden": "true",
      },
      e.glyph,
    ),
    h(
      "span",
      { class: "bar-row-text" },
      h("span", { class: "bar-row-name" }, e.name),
      e.note ? h("span", { class: "bar-row-note" }, e.note) : null,
    ),
    Number.isNaN(started)
      ? null
      : h("span", { class: "bar-row-time", "data-since": started }, elapsed(now - started)),
    e.space && e.selected ? icon("check", 16) : null,
  );
}

/** One control in the bar's form: a row of the list at wall-clock `now`, or an avatar. */
export const barControl = (e: BarEntry, unfolded: boolean, now: number): HTMLButtonElement =>
  unfolded ? row(e, now) : avatar(e);

/** A group's caption in the list, for the eye: the group has its name already. */
export const barCaption = (unfolded: boolean, text: string) =>
  unfolded ? h("span", { class: "bar-caption", "aria-hidden": "true" }, text) : null;

/** Keep the rows' times going in `bar`, once a second, while a row counts one. */
export function tickTimes(bar: HTMLElement, ctx: ShellCtx): () => void {
  let second = -1;
  return ctx.ticker.add(() => {
    const times = bar.querySelectorAll<HTMLElement>(".bar-row-time");
    if (times.length === 0) return IDLE;
    const now = ctx.wall();
    const sec = Math.floor(now / 1000);
    if (sec === second) return;
    second = sec;
    for (const time of times) time.textContent = elapsed(now - Number(time.dataset.since));
  });
}
