// The month view: six weeks as an ARIA grid. Each day is a grid cell the arrow keys move between
// (Home and End go to the week's ends, Enter or Space adds an event on it); it lists its events, all-day
// and long ones first, and "+n more" opens the day.
import { banner, monthGrid } from "./calendar/layout.js";
import { eventButton, h } from "./dom.js";
import { dayText, wallText } from "./format.js";
import { DAY } from "./ical/values.js";

/**
 * @typedef {import("./calendar.js").CalendarState} CalendarState
 * @typedef {import("./view.js").Actions} Actions
 */

/** Events a month cell lists before "+n more". */
const PER_CELL = 3;

/**
 * @param {Document} doc
 * @param {HTMLElement} grid the element the view draws into
 * @param {Actions} actions
 */
export function createMonth(doc, grid, actions) {
  /** The day the grid's focus is on. */
  let focusDay = 0;
  const event = (
    /** @type {CalendarState} */ s,
    /** @type {import("./calendar/model.js").Occurrence} */ occ,
  ) => eventButton(doc, s.locale, occ, actions.edit, banner(occ) ? "banner" : "");
  const weekdays = (
    /** @type {CalendarState} */ s,
    /** @type {number} */ from,
    /** @type {"short" | "long"} */ width,
  ) =>
    Array.from({ length: 7 }, (_, i) => wallText(s.locale, (from + i) * DAY, { weekday: width }));

  /** @param {CalendarState} s */
  function render(s) {
    const weeks = monthGrid(s.occurrences, s.anchor, s.weekStart, s.today);
    const first = weeks[0]?.[0]?.day ?? s.span.from;
    if (focusDay < s.span.from || focusDay >= s.span.to) focusDay = s.anchor;
    const long = weekdays(s, first, "long");
    const head = h(
      doc,
      "tr",
      {},
      weekdays(s, first, "short").map((d, i) =>
        h(doc, "th", { scope: "col", abbr: long[i], text: d }),
      ),
    );
    const rows = weeks.map((week) =>
      h(
        doc,
        "tr",
        {},
        week.map(({ day, inMonth, today, events }) => {
          const shown = events.length > PER_CELL + 1 ? events.slice(0, PER_CELL) : events;
          const more = events.length - shown.length;
          const cell = h(
            doc,
            "td",
            {
              role: "gridcell",
              tabindex: day === focusDay ? 0 : -1,
              "data-day": day,
              class: [inMonth ? "" : "outside", today ? "today" : ""].join(" ").trim() || undefined,
              "aria-current": today ? "date" : undefined,
              "aria-label": `${dayText(s.locale, day)}${events.length ? `, ${events.length} event${events.length > 1 ? "s" : ""}` : ""}`,
            },
            [
              h(doc, "span", {
                class: "date",
                "aria-hidden": "true",
                text: wallText(s.locale, day * DAY, { day: "numeric" }),
              }),
              h(doc, "ul", { class: "events" }, [
                ...shown.map((occ) => h(doc, "li", {}, [event(s, occ)])),
                more > 0 && h(doc, "li", {}, [moreButton(day, more)]),
              ]),
            ],
          );
          cell.addEventListener("click", () => actions.compose({ day }));
          cell.addEventListener("focus", () => {
            focusDay = day;
          });
          return cell;
        }),
      ),
    );
    const table = h(
      doc,
      "table",
      { class: "month", role: "grid", "aria-labelledby": "cal-title" },
      [h(doc, "thead", {}, [head]), h(doc, "tbody", {}, rows)],
    );
    table.addEventListener("keydown", (key) => monthKey(/** @type {KeyboardEvent} */ (key), s));
    return table;
  }

  const moreButton = (/** @type {number} */ day, /** @type {number} */ count) => {
    const button = h(doc, "button", { type: "button", class: "more", text: `+${count} more` });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.goto(day);
      actions.show("day");
    });
    return button;
  };

  /** Arrow keys move between days, Home and End to the week's ends, Enter adds an event there. */
  function monthKey(/** @type {KeyboardEvent} */ event, /** @type {CalendarState} */ s) {
    const target = /** @type {HTMLElement} */ (event.target);
    if (
      target.getAttribute("role") !== "gridcell" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const day = Number(target.getAttribute("data-day"));
    const offset = (day - s.span.from) % 7;
    const to =
      event.key in moves
        ? day + moves[/** @type {keyof typeof moves} */ (event.key)]
        : event.key === "Home"
          ? day - offset
          : event.key === "End"
            ? day - offset + 6
            : undefined;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions.compose({ day });
      return;
    }
    if (to === undefined) return;
    event.preventDefault();
    focusDay = to;
    if (to < s.span.from || to >= s.span.to) return actions.goto(to);
    const next = /** @type {HTMLElement | null} */ (
      grid.querySelector(`[data-day="${to}"][role="gridcell"]`)
    );
    if (!next) return actions.goto(to);
    target.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }

  return {
    render,
    /** The day to focus when the grid is drawn again. */
    focusDay: () => focusDay,
  };
}
