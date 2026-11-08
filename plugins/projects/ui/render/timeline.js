// The timeline: a scale of days along the top, then, per group, one line per piece of work with its
// name on the left and its bar on the right, placed by percent of the span. A milestone is a mark on
// its day; a cut bar has a square end where the span cuts it; today is a line across.
import { shortDate } from "../layout/dates.js";
import { h } from "./dom.js";

/**
 * @typedef {ReturnType<typeof import("../layout/timeline.js").timelineOf>} Timeline
 * @typedef {import("./dom.js").CardContext} CardContext
 */

const pct = (/** @type {number} */ n, /** @type {number} */ of) => `${(n / of) * 100}%`;

/** The line across the tracks at today, when today is in the span. */
function todayLine(/** @type {Document} */ doc, /** @type {Timeline} */ t) {
  if (t.todayAt === null) return null;
  const line = h(doc, "span", { class: "today-line", "aria-hidden": "true" });
  line.style.left = pct(t.todayAt + 0.5, t.days);
  return line;
}

/** @param {Document} doc @param {Timeline} t @param {CardContext} c */
export function renderTimeline(doc, t, c) {
  const ticks = h(
    doc,
    "div",
    { class: "ticks", "aria-hidden": "true" },
    // A quarter has no room for every day's number: one a week, at the week's first day.
    t.scale.map((tick, i) =>
      h(
        doc,
        "span",
        {
          class: `tick${tick.weekend ? " weekend" : ""}${tick.today ? " today" : ""}`,
          title: tick.date,
        },
        [
          tick.month ? h(doc, "b", { text: tick.month }) : null,
          t.days <= 45 || i % 7 === 0 ? tick.label : "",
        ],
      ),
    ),
  );
  ticks.style.setProperty("--days", String(t.days));
  const groups = t.rows.map((row) =>
    h(doc, "section", { class: "trow", "aria-label": row.title }, [
      h(doc, "h3", { class: "tgroup", text: `${row.title} · ${row.bars.length}` }),
      ...row.bars.map((bar) => {
        const w = bar.work;
        const when = `${shortDate(w.start, c.today) || "?"} – ${shortDate(w.due, c.today) || "?"}`;
        const el = h(
          doc,
          "span",
          {
            class: `bar ${w.category}${bar.milestone ? " milestone" : ""}${bar.cutStart ? " cut-start" : ""}${bar.cutEnd ? " cut-end" : ""}${bar.late ? " late" : ""}`,
            title: `${w.ref ? `${w.ref} ` : ""}${w.title}: ${when}`,
          },
          [h(doc, "span", { class: "bar-text", text: bar.milestone ? "" : w.title })],
        );
        el.style.left = pct(bar.left, t.days);
        el.style.width = bar.milestone ? "" : pct(bar.span, t.days);
        return h(
          doc,
          "div",
          {
            class: "tline",
            "data-key": w.key,
            tabindex: "-1",
            "aria-current": c.selected === w.key ? "true" : undefined,
            "aria-label": `${w.ref ? `${w.ref} ` : ""}${w.title}, ${w.status}, ${when}`,
          },
          [
            h(doc, "span", { class: "tname", title: w.title }, [
              w.ref ? h(doc, "span", { class: "ref", text: w.ref }) : null,
              w.title,
            ]),
            h(doc, "div", { class: "track" }, [el, todayLine(doc, t)]),
          ],
        );
      }),
    ]),
  );
  const notes = [
    t.unscheduled ? `${t.unscheduled} without dates` : "",
    t.outside ? `${t.outside} outside this span` : "",
  ].filter(Boolean);
  return h(doc, "div", { class: "timeline" }, [
    h(doc, "div", { class: "scale" }, [h(doc, "span", { class: "tcorner" }), ticks]),
    ...(groups.length
      ? groups
      : [h(doc, "p", { class: "placeholder", text: "Nothing is scheduled in this span." })]),
    notes.length ? h(doc, "p", { class: "notes", text: notes.join(" · ") }) : null,
  ]);
}
