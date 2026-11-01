// The DOM of the calendar: a bar to move and switch views, the file's name and state, and the view
// itself: the month grid (month.js), a week or a day of time columns or the agenda (timeline.js).
// Plain keys work when no field has the focus (t today, j/k or n/p next and previous, m w d a views,
// c new, g go to a date); chords are never prevented, so Mod+S and Mod+W reach the desk.
import { h } from "./dom.js";
import { createMonth } from "./month.js";
import { createTimeline } from "./timeline.js";

/**
 * @typedef {import("./calendar.js").CalendarState} CalendarState
 * @typedef {import("./calendar/layout.js").Mode} Mode
 * @typedef {object} Actions
 * @property {() => void} previous @property {() => void} next @property {() => void} today
 * @property {(mode: Mode) => void} show @property {(day: number) => void} goto
 * @property {(at?: { day?: number, minute?: number, allDay?: boolean }) => void} compose
 * @property {(id: string) => void} edit @property {() => void} ask go to a date the person names
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const title = byId("cal-title");
  const name = byId("cal-name");
  const mark = byId("cal-mark");
  const problems = byId("cal-problems");
  const grid = byId("grid");
  const status = byId("status");
  const modes = [...doc.querySelectorAll("button[data-mode]")];
  const month = createMonth(doc, grid, actions);
  const timeline = createTimeline(doc, actions);
  /** @type {CalendarState | undefined} */
  let state;

  byId("prev").addEventListener("click", () => actions.previous());
  byId("next").addEventListener("click", () => actions.next());
  byId("today").addEventListener("click", () => actions.today());
  byId("new").addEventListener("click", () => actions.compose());
  for (const button of modes)
    button.addEventListener("click", () =>
      actions.show(/** @type {Mode} */ (button.getAttribute("data-mode"))),
    );

  doc.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    if (target.closest("input, textarea, select, dialog[open]") || !state?.calendar) return;
    /** @type {Record<string, () => void>} */
    const keys = {
      t: () => actions.today(),
      j: () => actions.next(),
      n: () => actions.next(),
      k: () => actions.previous(),
      p: () => actions.previous(),
      m: () => actions.show("month"),
      w: () => actions.show("week"),
      d: () => actions.show("day"),
      a: () => actions.show("agenda"),
      c: () => actions.compose(),
      g: () => actions.ask(),
    };
    const run = keys[event.key];
    if (!run) return;
    event.preventDefault();
    run();
  });

  return {
    /** @param {CalendarState} s */
    render(s) {
      const moved = !state || state.mode !== s.mode || state.anchor !== s.anchor;
      state = s;
      title.textContent = s.calendar ? s.title : "No calendar open";
      name.textContent = s.calendar
        ? `${s.calendar.name} · ${s.calendar.path}`
        : "Open an .ics file, or run Open my calendar.";
      mark.hidden = !s.calendar?.modified;
      const count = s.calendar?.problems.length ?? 0;
      problems.hidden = count === 0;
      problems.textContent = count
        ? `${count} thing${count > 1 ? "s" : ""} in this file could not be read`
        : "";
      problems.title = s.calendar?.problems.join("\n") ?? "";
      for (const button of modes)
        button.setAttribute("aria-checked", String(button.getAttribute("data-mode") === s.mode));
      /** @type {HTMLButtonElement} */ for (const id of ["prev", "next", "today", "new"])
        byId(id).disabled = !s.calendar || (id === "new" && s.calendar.readOnly);
      const focused = grid.contains(doc.activeElement)
        ? doc.activeElement?.getAttribute("data-day")
        : null;
      grid.replaceChildren(
        !s.calendar
          ? h(doc, "p", { class: "empty", text: "No calendar open." })
          : s.mode === "month"
            ? month.render(s)
            : s.mode === "agenda"
              ? timeline.agenda(s)
              : timeline.columns(s),
      );
      grid.setAttribute("data-mode", s.mode);
      if (focused)
        /** @type {HTMLElement | null} */ (
          grid.querySelector(`[data-day="${moved ? month.focusDay() : focused}"][role="gridcell"]`)
        )?.focus();
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    focus() {
      const target =
        /** @type {HTMLElement | null} */ (grid.querySelector('[tabindex="0"]')) ?? byId("today");
      target.focus();
    },
  };
}
