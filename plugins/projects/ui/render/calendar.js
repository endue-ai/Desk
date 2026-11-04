// The calendar: the month's weeks as rows of days, each day holding the work due on it as compact
// cards (four, then "+n more"). Every day is a drop target that names its date; view.js turns a
// drop into a new due date.
import { WEEKDAYS } from "../layout/dates.js";
import { card, h } from "./dom.js";

/**
 * @typedef {ReturnType<typeof import("../layout/calendar.js").calendarOf>} Month
 * @typedef {import("./dom.js").CardContext} CardContext
 */

/** How many cards a day shows before "+n more". */
export const PER_DAY = 4;

/** @param {Document} doc @param {Month} m @param {CardContext} c */
export function renderCalendar(doc, m, c) {
  const head = h(
    doc,
    "div",
    { class: "weekdays", "aria-hidden": "true" },
    m.weekdays.map((d) => h(doc, "span", { text: WEEKDAYS[d] ?? "" })),
  );
  const weeks = m.weeks.map((week) =>
    h(
      doc,
      "div",
      { class: "week", role: "row" },
      week.map((cell) => {
        const shown = cell.works.slice(0, PER_DAY);
        const more = cell.works.length - shown.length;
        return h(
          doc,
          "div",
          {
            class: `day${cell.inMonth ? "" : " out"}${cell.today ? " today" : ""}${cell.weekend ? " weekend" : ""}`,
            role: "gridcell",
            "data-drop": "day",
            "data-date": cell.date,
            "aria-label": `${cell.date}: ${cell.works.length} ${cell.works.length === 1 ? "task" : "tasks"}`,
          },
          [
            h(doc, "span", { class: "date", text: String(Number(cell.date.slice(8))) }),
            ...shown.map((w) => {
              const el = card(doc, w, c, true);
              if (cell.late.has(w.key)) el.classList.add("late");
              return el;
            }),
            more > 0
              ? h(doc, "span", {
                  class: "more",
                  title: cell.works
                    .slice(PER_DAY)
                    .map((w) => w.title)
                    .join("\n"),
                  text: `+${more} more`,
                })
              : null,
          ],
        );
      }),
    ),
  );
  return h(doc, "div", { class: "calendar" }, [
    head,
    h(doc, "div", { class: "weeks", role: "grid", "aria-label": m.title }, weeks),
    m.unscheduled ? h(doc, "p", { class: "notes", text: `${m.unscheduled} without dates` }) : null,
  ]);
}
