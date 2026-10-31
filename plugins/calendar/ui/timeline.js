// The week and day views, and the agenda. A week or a day is a row of all-day events over columns of
// time, with overlapping events side by side and a line at the current time; a click on a column
// adds an event at that half hour. The agenda lists the days that have events.
import { agenda as agendaDays, banner, dayBlocks } from "./calendar/layout.js";
import { eventButton, h } from "./dom.js";
import { dayText, timeText, wallText, whenText } from "./format.js";
import { DAY, HOUR } from "./ical/values.js";

/**
 * @typedef {import("./calendar.js").CalendarState} CalendarState
 * @typedef {import("./view.js").Actions} Actions
 * @typedef {import("./calendar/model.js").Occurrence} Occurrence
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createTimeline(doc, actions) {
  let scrolledFor = "";
  const eventButtonOf = (
    /** @type {CalendarState} */ s,
    /** @type {Occurrence} */ occ,
    /** @type {string} */ extra,
    withTime = true,
  ) => eventButton(doc, s.locale, occ, actions.edit, extra, withTime);

  /** @param {CalendarState} s */
  function columns(s) {
    const days = Array.from({ length: s.span.to - s.span.from }, (_, i) => s.span.from + i);
    const head = h(doc, "div", { class: "row head", "aria-hidden": "true" }, [
      h(doc, "div", { class: "gutter" }),
      ...days.map((day) =>
        h(doc, "div", { class: day === s.today ? "col today" : "col" }, [
          h(doc, "span", { text: wallText(s.locale, day * DAY, { weekday: "short" }) }),
          h(doc, "b", { text: wallText(s.locale, day * DAY, { day: "numeric" }) }),
        ]),
      ),
    ]);
    const allDay = h(doc, "div", { class: "row all-day" }, [
      h(doc, "div", { class: "gutter", text: "All day" }),
      ...days.map((day) => {
        const col = h(
          doc,
          "div",
          { class: "col", role: "group", "aria-label": `${dayText(s.locale, day)}, all day` },
          s.occurrences
            .filter((o) => banner(o) && o.startWall < (day + 1) * DAY && o.endWall > day * DAY)
            .map((o) => eventButtonOf(s, o, "banner")),
        );
        col.addEventListener("click", () => actions.compose({ day, allDay: true }));
        return col;
      }),
    ]);
    const hours = h(
      doc,
      "div",
      { class: "hours", "aria-hidden": "true" },
      Array.from({ length: 24 }, (_, hour) =>
        h(doc, "div", { class: "hour", text: hour ? timeText(s.locale, hour * HOUR) : "" }),
      ),
    );
    const body = h(doc, "div", { class: "scroll", tabindex: 0, "aria-label": "Times of day" }, [
      hours,
      ...days.map((day) => {
        const col = h(
          doc,
          "div",
          {
            class: day === s.today ? "col today" : "col",
            role: "group",
            "aria-label": dayText(s.locale, day),
          },
          dayBlocks(s.occurrences, day).map((b) => {
            const button = eventButtonOf(
              s,
              b.occ,
              ["block", b.continued ? "continued" : "", b.continues ? "continues" : ""]
                .join(" ")
                .trim(),
              true,
            );
            button.style.top = `${(b.top / 1440) * 100}%`;
            button.style.height = `${(b.height / 1440) * 100}%`;
            button.style.left = `${(b.col / b.cols) * 100}%`;
            button.style.width = `${100 / b.cols}%`;
            const when = h(doc, "span", { class: "when", text: whenText(s.locale, b.occ) });
            if (b.height >= 45) button.append(when);
            return button;
          }),
        );
        if (day === s.today) {
          const now = h(doc, "div", { class: "now", "aria-hidden": "true" });
          now.style.top = `${((s.now - day * DAY) / DAY) * 100}%`;
          col.append(now);
        }
        col.addEventListener("click", (event) => {
          const rect = col.getBoundingClientRect();
          const minute = Math.floor((((event.clientY - rect.top) / rect.height) * 1440) / 30) * 30;
          actions.compose({ day, minute: Math.max(0, Math.min(minute, 1410)) });
        });
        return col;
      }),
    ]);
    const view = h(doc, "div", { class: `columns days-${days.length}` }, [head, allDay, body]);
    const key = `${s.mode}:${s.span.from}`;
    if (key !== scrolledFor) {
      scrolledFor = key;
      queueMicrotask(() => {
        body.scrollTop = (body.scrollHeight / 24) * Math.max(0, Math.min(23, s.dayStart));
      });
    }
    return view;
  }

  /** @param {CalendarState} s */
  function agenda(s) {
    const days = agendaDays(s.occurrences, s.span.from, s.span.to);
    if (days.length === 0)
      return h(doc, "p", { class: "empty", text: "Nothing on the calendar for the next 30 days." });
    return h(
      doc,
      "div",
      { class: "agenda" },
      days.map(({ day, events }) =>
        h(doc, "section", { "aria-labelledby": `day-${day}` }, [
          h(doc, "h2", {
            id: `day-${day}`,
            class: day === s.today ? "today" : undefined,
            text: dayText(s.locale, day),
          }),
          h(
            doc,
            "ul",
            {},
            events.map((occ) => {
              const button = eventButtonOf(s, occ, "row", false);
              button.prepend(h(doc, "span", { class: "when", text: whenText(s.locale, occ) }));
              if (occ.location)
                button.append(h(doc, "span", { class: "where", text: occ.location }));
              return h(doc, "li", {}, [button]);
            }),
          ),
        ]),
      ),
    );
  }

  return { columns, agenda };
}
