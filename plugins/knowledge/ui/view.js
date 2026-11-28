// The knowledge base's page: a bar (views, search, filters, sync, notes), the filters, the graph or
// a note with the days below, the selection's details, and the page that asks to connect before
// anything is read. Wide windows show filters | graph | details side by side; a narrow one (the
// desk first opens a window at 400×263) keeps the graph and shows the filters and the details over
// it, the filters when asked, the details while something is picked.

import { dot, el, fill } from "./dom.js";
import { AGENT_NAMES, AGENT_TOKENS, AGENTS } from "./kinds.js";
import { readable } from "./model.js";
import { drawDays, drawPanel } from "./panel.js";
import { drawRail } from "./rail.js";
import { createStage } from "./stage.js";

/**
 * @typedef {{ connect(): void, sync(): void, select(id: string | null): void, focus(name: string): void,
 *   mode(m: string): void, search(text: string): void, filter(name: string, value: any): void,
 *   writeNotes(): Promise<any>, openNote(id: string): Promise<void> }} Actions
 */

const MODES = [
  ["graph", "Graph"],
  ["local", "Around"],
  ["note", "Note"],
];

const WORDS = {
  off: "endue can read the sessions Claude Code and Codex keep on this computer and link them by the files, tickets, pull requests and branches they share. It reads the folders the agents use, never changes them, keeps only what you asked and the last answer with secrets masked, and sends nothing anywhere.",
  loading: "Opening the knowledge base…",
  reading: "Reading agent sessions. The first read takes a few seconds.",
  ready: "No sessions yet.",
};

/** Mount the page in `root`; `render` draws each screen the controller hands over. */
export function createView(/** @type {HTMLElement} */ root, /** @type {Actions} */ actions) {
  const tabs = MODES.map(([mode, label]) =>
    el(
      "button",
      {
        type: "button",
        class: "desk-tab",
        role: "tab",
        dataset: { mode },
        onclick: () => actions.mode(mode),
      },
      label,
    ),
  );
  const search = /** @type {HTMLInputElement} */ (
    el("input", {
      type: "search",
      class: "desk-field",
      id: "kb-search",
      placeholder: "Find a ticket, file or session",
      "aria-label": "Find a ticket, file or session",
      autocomplete: "off",
    })
  );
  search.addEventListener("input", () => actions.search(search.value));
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && search.value.trim()) actions.focus(search.value.trim());
    if (event.key === "Escape") {
      search.value = "";
      actions.search("");
    }
  });
  const chip = el("span", { class: "desk-badge count", role: "status" });
  const filters = el(
    "button",
    {
      type: "button",
      class: "desk-btn desk-btn-quiet filters",
      "aria-expanded": "false",
      onclick: () => toggleFilters(),
    },
    "Filters",
  );
  const syncButton = el(
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet sync", onclick: () => actions.sync() },
    "Sync",
  );
  const notesButton = el(
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet notes", onclick: () => void writeAll() },
    "Write notes",
  );
  const rail = el("aside", { class: "rail", id: "kb-filters", "aria-label": "Filters" });
  const canvas = /** @type {HTMLCanvasElement} */ (
    el("canvas", { "aria-label": "Knowledge graph" })
  );
  const legend = el("div", { class: "legend", "aria-hidden": "true" });
  const note = el("desk-markdown", { class: "note" });
  const noteBox = el("div", { class: "note-box", hidden: true }, note);
  const empty = el("div", { class: "empty", hidden: true });
  const days = el("div", { class: "days", "aria-label": "Sessions by day" });
  const panel = el("aside", { class: "panel", "aria-live": "polite", "aria-label": "Details" });
  const stage = createStage(canvas, {
    pick: (id) => actions.select(id),
    around: (id) => {
      actions.select(id);
      actions.mode("local");
    },
  });
  const page = el(
    "div",
    { class: "kb" },
    el(
      "header",
      { class: "desk-bar top" },
      el("strong", { class: "desk-bar-title" }, "Knowledge"),
      el("div", { class: "desk-tabs", role: "tablist", "aria-label": "View" }, ...tabs),
      chip,
      el("div", { class: "desk-bar-spacer" }),
      search,
      filters,
      syncButton,
      notesButton,
    ),
    el(
      "div",
      { class: "body" },
      rail,
      el(
        "main",
        { class: "center" },
        el("div", { class: "stage" }, canvas, legend, noteBox, empty),
        days,
      ),
      panel,
    ),
  );
  root.replaceChildren(page);
  /** @type {any} */
  let last;

  function toggleFilters(/** @type {boolean | undefined} */ open) {
    const shown = open ?? !page.classList.contains("show-filters");
    page.classList.toggle("show-filters", shown);
    filters.setAttribute("aria-expanded", String(shown));
  }

  async function writeAll() {
    chip.textContent = "Writing notes…";
    try {
      const done = await actions.writeNotes();
      chip.textContent = `${done.written} notes in ${done.folder}`;
    } catch (error) {
      chip.textContent = `Notes not written: ${error instanceof Error ? error.message : error}`;
    }
  }

  function drawEmpty(/** @type {any} */ s) {
    const off = s.status === "off";
    empty.hidden = !(off || s.status === "loading" || (s.status !== "ready" && !s.scene));
    if (empty.hidden) return;
    const text =
      s.status === "error"
        ? s.message || "The agent sessions could not be read."
        : (WORDS[/** @type {keyof typeof WORDS} */ (s.status)] ?? "");
    fill(empty, [
      el("h1", {}, off ? "Build a knowledge base from your agent sessions" : "Knowledge"),
      el("p", {}, text),
      off &&
        el(
          "button",
          { type: "button", class: "desk-btn desk-btn-primary", onclick: () => actions.connect() },
          "Read agent sessions",
        ),
      s.status === "error" &&
        el(
          "button",
          { type: "button", class: "desk-btn", onclick: () => actions.sync() },
          "Try again",
        ),
    ]);
  }

  return {
    render(/** @type {any} */ s) {
      last = s;
      for (const tab of tabs)
        tab.setAttribute("aria-selected", String(tab.dataset.mode === s.mode));
      const sessions = Object.values(s.counts.agents).reduce(
        (/** @type {number} */ a, b) => a + Number(b),
        0,
      );
      chip.textContent =
        s.status === "ready"
          ? `${sessions} sessions`
          : s.status === "reading"
            ? "Reading…"
            : s.status === "error"
              ? "Not read"
              : "";
      chip.hidden = !chip.textContent;
      if (search.value.trim() !== s.query) search.value = s.query;
      syncButton.hidden = s.status === "off" || s.status === "loading";
      notesButton.hidden = s.status !== "ready";
      page.classList.toggle("has-selection", Boolean(s.panel));
      drawRail(rail, s, actions);
      drawPanel(panel, s, actions);
      drawDays(days, s.days);
      drawEmpty(s);
      // Until there is something to draw, the page is the words above alone: no filters or details.
      page.classList.toggle("is-empty", !empty.hidden);
      fill(
        legend,
        AGENTS.filter((a) => s.counts.agents[a]).map((a) =>
          el("span", {}, dot(AGENT_TOKENS[a]), AGENT_NAMES[a]),
        ),
      );
      noteBox.hidden = s.mode !== "note" || !s.note;
      if (!noteBox.hidden) /** @type {any} */ (note).source = readable(s.note.markdown);
      stage.show({
        scene: s.scene,
        only: s.only,
        selected: s.selected,
        marked: s.marked,
        fitKey: s.fitKey,
      });
    },
    retheme() {
      stage.retheme();
      if (last) this.render(last);
    },
  };
}
