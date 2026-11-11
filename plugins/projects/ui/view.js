// The DOM for the projects plugin: the toolbar (views, search, grouping, source, done, period), the
// body the current view draws (render/), the details beside it and a status live region. Cards are
// dragged between columns, lanes and days; the keys walk the work in the view's order. Single
// letters inside the body are the plugin's own (j k, arrows, Enter, Escape, 1 to 6, / [ ] t o);
// chords are never prevented, so they reach the desk's keymap.

import { USES } from "./present.js";
import { renderKanban, renderSwimlane } from "./render/board.js";
import { renderCalendar } from "./render/calendar.js";
import { renderDetail } from "./render/detail.js";
import { h } from "./render/dom.js";
import { renderList, renderTable } from "./render/list.js";
import { renderTimeline } from "./render/timeline.js";
import { createStrip } from "./strip.js";

/**
 * @typedef {import("./present.js").Screen} Screen
 * @typedef {{
 *   select(key: string): unknown, open(key: string | null): unknown, key(name: string): unknown,
 *   command(id: string, args?: Record<string, unknown>): unknown, sort(field: string): unknown,
 *   drop(at: { key: string, column?: number, lane?: number, date?: string }): unknown,
 *   connect(): unknown,
 * }} Actions
 */

/** Letters pressed on the body, and the command each runs. */
export const LETTER_COMMANDS = /** @type {Record<string, [string, Record<string, unknown>]>} */ ({
  "[": ["endue.projects.go", { to: "previous" }],
  "]": ["endue.projects.go", { to: "next" }],
  t: ["endue.projects.go", { to: "today" }],
  o: ["endue.projects.open-original", {}],
});
const WALK = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "Enter",
  "Escape",
  "j",
  "k",
];
const GO_VIEWS = ["kanban", "swimlane", "list", "table", "timeline", "calendar"];

/** @param {Document} doc @param {Actions} actions */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const body = byId("body");
  const views = byId("views");
  const search = /** @type {HTMLInputElement} */ (byId("search"));
  const group = /** @type {HTMLSelectElement} */ (byId("group"));
  const source = /** @type {HTMLSelectElement} */ (byId("source"));
  const done = /** @type {HTMLInputElement} */ (byId("done"));
  const zoom = /** @type {HTMLSelectElement} */ (byId("zoom"));
  const detail = byId("detail");
  const status = byId("status");
  const strip = createStrip(views);
  /** @type {Screen | null} */
  let last = null;
  /** The card being dragged; DataTransfer is not trusted to carry it. */
  let dragging = "";

  const run = (/** @type {string} */ id, /** @type {Record<string, unknown>} */ args = {}) =>
    actions.command(id, args);

  views.addEventListener("click", (event) => {
    const tab = /** @type {HTMLElement} */ (event.target).closest("[data-view]");
    if (tab instanceof HTMLElement) run("endue.projects.view", { view: tab.dataset.view });
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      run("endue.projects.search", { text: search.value });
    } else if (event.key === "Escape" && search.value !== "") {
      event.preventDefault();
      search.value = "";
      run("endue.projects.search", { text: "" });
    }
  });
  group.addEventListener("change", () => run("endue.projects.group", { by: group.value }));
  source.addEventListener("change", () =>
    run("endue.projects.source", source.value ? { source: source.value } : {}),
  );
  done.addEventListener("change", () => run("endue.projects.show-done", { on: done.checked }));
  zoom.addEventListener("change", () => run("endue.projects.zoom", { zoom: zoom.value }));
  byId("prev").addEventListener("click", () => run("endue.projects.go", { to: "previous" }));
  byId("next").addEventListener("click", () => run("endue.projects.go", { to: "next" }));
  byId("today").addEventListener("click", () => run("endue.projects.go", { to: "today" }));
  byId("refresh").addEventListener("click", () => run("endue.projects.refresh"));

  body.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const sort = target.closest("[data-sort]");
    if (sort instanceof HTMLElement && sort.dataset.sort)
      return void actions.sort(sort.dataset.sort);
    if (target.closest("[data-connect]")) return void actions.connect();
    const item = target.closest("[data-key]");
    if (item instanceof HTMLElement && item.dataset.key) actions.open(item.dataset.key);
  });
  body.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/** @type {HTMLElement} */ (event.target).closest("input, select, textarea")) return;
    const name = event.shiftKey && event.key.startsWith("Arrow") ? `Shift+${event.key}` : event.key;
    if (WALK.includes(event.key) || name.startsWith("Shift+Arrow")) {
      event.preventDefault();
      void actions.key(name);
    } else if (/^[1-6]$/.test(event.key)) {
      event.preventDefault();
      run("endue.projects.view", { view: GO_VIEWS[Number(event.key) - 1] });
    } else if (event.key === "/") {
      event.preventDefault();
      focus("search");
    } else if (LETTER_COMMANDS[event.key]) {
      event.preventDefault();
      const [id, args] = LETTER_COMMANDS[event.key] ?? ["", {}];
      run(id, args);
    }
  });
  detail.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || /** @type {HTMLElement} */ (event.target).closest("select"))
      return;
    event.preventDefault();
    actions.open(null);
  });

  // Drag a card onto a column, a lane's cell or a day.
  body.addEventListener("dragstart", (event) => {
    const card = /** @type {HTMLElement} */ (event.target).closest?.("[data-key][draggable]");
    if (!(card instanceof HTMLElement) || !card.dataset.key) return;
    dragging = card.dataset.key;
    event.dataTransfer?.setData("text/plain", dragging);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  const dropTarget = (/** @type {Event} */ event) => {
    const zone = /** @type {HTMLElement} */ (event.target).closest?.("[data-drop]");
    return dragging && zone instanceof HTMLElement ? zone : null;
  };
  body.addEventListener("dragover", (event) => {
    const zone = dropTarget(event);
    if (!zone) return;
    event.preventDefault();
    for (const over of body.querySelectorAll(".drop-over"))
      if (over !== zone) over.classList.remove("drop-over");
    zone.classList.add("drop-over");
  });
  body.addEventListener("dragleave", (event) => {
    const zone = dropTarget(event);
    if (
      zone &&
      !zone.contains(/** @type {Node | null} */ (/** @type {DragEvent} */ (event).relatedTarget))
    )
      zone.classList.remove("drop-over");
  });
  body.addEventListener("drop", (event) => {
    const zone = dropTarget(event);
    if (!zone) return;
    event.preventDefault();
    const key = dragging;
    dragging = "";
    const { column, lane, date } = zone.dataset;
    void actions.drop({
      key,
      ...(column !== undefined ? { column: Number(column) } : {}),
      ...(lane !== undefined ? { lane: Number(lane) } : {}),
      ...(date !== undefined ? { date } : {}),
    });
  });
  body.addEventListener("dragend", () => {
    dragging = "";
    for (const el of body.querySelectorAll(".dragging, .drop-over"))
      el.classList.remove("dragging", "drop-over");
  });

  /** The toolbar as the screen says; with no source connected, only the views and refresh. */
  const toolbar = (/** @type {Screen} */ s) => {
    const idle = s.unconnected;
    views.replaceChildren(
      ...s.views.map((v, i) =>
        h(doc, "button", {
          type: "button",
          class: "desk-tab",
          role: "tab",
          "data-view": v.name,
          "aria-selected": v.name === s.view ? "true" : "false",
          title: `${v.title} (${i + 1})`,
          text: v.title,
        }),
      ),
    );
    strip.show();
    if (doc.activeElement !== search) search.value = s.search;
    group.replaceChildren(
      ...s.groups.map((g) => h(doc, "option", { value: g.name, text: g.title })),
    );
    group.value = s.group;
    byId("group-control").hidden = !USES.group.has(s.view);
    source.replaceChildren(
      h(doc, "option", { value: "", text: "All sources" }),
      ...s.sources.map((x) => h(doc, "option", { value: x.key, text: x.title })),
    );
    source.value = s.source ?? "";
    source.hidden = s.sources.length < 2;
    byId("filters").hidden = idle;
    done.checked = s.showDone;
    byId("period").hidden = idle || !USES.period.has(s.view);
    zoom.hidden = s.view !== "timeline";
    zoom.value = s.zoom;
    byId("period-title").textContent = s.period;
  };

  /** The body of the current view. */
  const draw = (/** @type {Screen} */ s) => {
    const c = { today: s.today, selected: s.selected, draggable: true };
    if (s.empty) {
      return h(doc, "div", { class: "empty" }, [
        h(doc, "p", { text: s.empty.text }),
        s.empty.connect
          ? h(doc, "button", {
              type: "button",
              class: "desk-btn desk-btn-primary",
              "data-connect": true,
              text: "Connect a source",
            })
          : null,
      ]);
    }
    const b = s.body;
    if (b.kind === "kanban") return renderKanban(doc, b, c);
    if (b.kind === "swimlane") return renderSwimlane(doc, b, c);
    if (b.kind === "list") return renderList(doc, b, { ...c, draggable: false });
    if (b.kind === "table") return renderTable(doc, b, { ...c, draggable: false });
    if (b.kind === "timeline") return renderTimeline(doc, b, { ...c, draggable: false });
    return renderCalendar(doc, b, c);
  };

  /** The element that shows a piece of work, by its key. */
  const shown = (/** @type {string | null | undefined} */ key) =>
    key
      ? [...body.querySelectorAll("[data-key]")].find(
          (el) => el instanceof HTMLElement && el.dataset.key === key,
        )
      : undefined;

  /** @param {"body" | "detail" | "search"} where */
  function focus(where) {
    if (where === "search") return search.focus();
    if (where === "detail" && !detail.hidden) return detail.focus();
    const selected = shown(last?.selected);
    (selected instanceof HTMLElement ? selected : body).focus();
  }

  return {
    /** @param {Screen} s */
    render(s) {
      const kept = { top: body.scrollTop, left: body.scrollLeft };
      const focused = body.contains(doc.activeElement) && doc.activeElement !== body;
      const inDetail = detail.contains(doc.activeElement);
      toolbar(s);
      body.dataset.view = s.view;
      body.setAttribute("aria-busy", s.loading ? "true" : "false");
      body.replaceChildren(draw(s));
      body.scrollTop = kept.top;
      body.scrollLeft = kept.left;
      renderDetail(doc, detail, s.detail, { command: run, close: () => actions.open(null) });
      if (inDetail && !detail.hidden) detail.focus();
      const moved = s.selected !== last?.selected;
      last = s;
      const selected = shown(s.selected);
      if (selected instanceof HTMLElement) {
        if (moved) selected.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        if (focused || moved) selected.focus({ preventScroll: true });
      }
    },
    /** @param {string} text */
    status(text) {
      status.textContent = text;
    },
    focus,
  };
}
