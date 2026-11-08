// The DOM of the calendar: a bar to move and switch views, the file's name and state, a toggle for
// each calendar of the system calendar's layer, and the view itself: the month grid (month.js), a
// week or a day of time columns or the agenda (timeline.js). With no file open, the layer is drawn.
// Plain keys work when no field has the focus (t today, j/k or n/p next and previous, m w d a views,
// c new, g go to a date); chords are never prevented, so Mod+S and Mod+W reach the desk.
import { h, sourceStyle } from "./dom.js";
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
 * @property {(key: string) => void} [layer] hide or show one of the layer's calendars
 */

/** Whether there is something to draw: a file, or the system calendar's layer. */
const opened = (/** @type {CalendarState | undefined} */ s) =>
  Boolean(s?.calendar || s?.layer?.length);

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
  const layers = byId("cal-layers");
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
    if (target.closest("input, textarea, select, dialog[open]") || !opened(state)) return;
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

  /** One calendar of the layer: pressed while it shows; a click hides or shows it. */
  const toggle = (/** @type {import("./layer.js").Source} */ source) => {
    const button = h(
      doc,
      "button",
      {
        type: "button",
        class: "desk-btn desk-btn-quiet layer",
        "aria-pressed": String(!source.hidden),
        "data-source": source.key,
        style: sourceStyle(source.color),
        title: `${source.hidden ? "Show" : "Hide"} ${source.name}`,
      },
      [h(doc, "span", { class: "swatch", "aria-hidden": "true" }), source.name],
    );
    button.addEventListener("click", () => actions.layer?.(source.key));
    return button;
  };

  return {
    /** @param {CalendarState} s */
    render(s) {
      const moved = !state || state.mode !== s.mode || state.anchor !== s.anchor;
      state = s;
      const open = opened(s);
      title.textContent = open ? s.title : "No calendar open";
      name.textContent = s.calendar
        ? `${s.calendar.name} · ${s.calendar.path}`
        : open
          ? "System calendar · read-only"
          : "Open an .ics file, or run Open my calendar.";
      // A toggle keeps the focus across a redraw, so Space can flip it again.
      const pressed = layers.contains(doc.activeElement)
        ? doc.activeElement?.getAttribute("data-source")
        : null;
      layers.hidden = !s.layer?.length;
      layers.replaceChildren(...(s.layer ?? []).map(toggle));
      if (pressed)
        [...layers.querySelectorAll("button")]
          .find((b) => b.getAttribute("data-source") === pressed)
          ?.focus();
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
        byId(id).disabled = !open || (id === "new" && Boolean(s.calendar?.readOnly));
      const active = grid.contains(doc.activeElement) ? doc.activeElement : null;
      const scroll = /** @type {HTMLElement | null} */ (grid.querySelector(".scroll"));
      const scrollTop = scroll?.scrollTop;
      const gridTop = grid.scrollTop;
      const eventId = active?.getAttribute("data-id");
      const matchingEvents = (/** @type {string} */ id) =>
        [...grid.querySelectorAll("button.event")].filter(
          (event) => event.getAttribute("data-id") === id,
        );
      const eventIndex = eventId
        ? matchingEvents(eventId).indexOf(/** @type {Element} */ (active))
        : -1;
      const moreIndex = [...grid.querySelectorAll("button.more")].indexOf(
        /** @type {Element} */ (active),
      );
      const focused = grid.contains(doc.activeElement)
        ? doc.activeElement?.getAttribute("data-day")
        : null;
      grid.replaceChildren(
        !open
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
      else if (!moved && active) {
        const target =
          eventId && eventIndex >= 0
            ? matchingEvents(eventId)[eventIndex]
            : moreIndex >= 0
              ? grid.querySelectorAll("button.more")[moreIndex]
              : active === scroll
                ? grid.querySelector(".scroll")
                : null;
        /** @type {HTMLElement | null | undefined} */ (target)?.focus();
      }
      if (!moved) {
        const nextScroll = /** @type {HTMLElement | null} */ (grid.querySelector(".scroll"));
        if (nextScroll && scrollTop !== undefined) nextScroll.scrollTop = scrollTop;
        grid.scrollTop = gridTop;
      }
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
