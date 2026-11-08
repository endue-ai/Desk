// desk-universal-view's presentations as DOM: each turns its model (../universal) into nodes. Entries
// come from `make`, which the element owns (focus, keys, clicks); the rest is plain markup.
import type {
  AgentModel,
  CalendarModel,
  ChatDay,
  KanbanColumn,
  TextSection,
  TimelineModel,
  UniversalRow,
} from "../universal";
import { element } from "./base";

/** What a presentation asks of the element. */
export interface Drawing {
  /** The focusable node of one row, registered for keys and clicks. */
  make(row: UniversalRow, tag?: string): HTMLElement;
  /** Start a new lane: a board's column, for the left and right arrows. */
  lane(): void;
}

/** A span with a class and its text, or null when there is no text. */
function span(className: string, text: string): HTMLElement | null {
  if (!text) return null;
  const node = element("span", { class: className });
  node.textContent = text;
  return node;
}

function add(parent: HTMLElement, ...nodes: Array<Node | null>): HTMLElement {
  for (const node of nodes) if (node) parent.append(node);
  return parent;
}

function tags(row: UniversalRow): HTMLElement | null {
  if (row.tags.length === 0) return null;
  const box = element("span", { class: "tags" });
  for (const tag of row.tags) add(box, span("tag", tag));
  return box;
}

function badge(row: UniversalRow): HTMLElement | null {
  const node = span("badge", row.status);
  node?.setAttribute("data-tone", row.tone);
  return node;
}

function markdown(source: string): HTMLElement | null {
  if (!source) return null;
  const node = element("desk-markdown");
  (node as HTMLElement & { source: string }).source = source;
  return node;
}

const titleOf = (row: UniversalRow) => row.title || row.text.split("\n")[0] || "Untitled";

/** One row per entry: its title, a detail line, tags and status. */
export function drawList(rows: UniversalRow[], d: Drawing): HTMLElement {
  const list = element("div", { role: "list", class: "list" });
  for (const row of rows) {
    const node = d.make(row);
    add(node, span("entry-title", titleOf(row)), span("entry-detail", row.detail), tags(row));
    add(node, badge(row));
    list.append(node);
  }
  return list;
}

/** Days in order, each with its rows and their times; the now-line between past and ahead. */
export function drawTimeline(model: TimelineModel, d: Drawing): HTMLElement {
  const root = element("div", { class: "timeline" });
  const nowLine = () => element("div", { role: "separator", "aria-label": "Now" });
  for (const [index, day] of model.days.entries()) {
    const heading = add(element("div", { class: "day" }), document.createTextNode(day.label));
    if (day.today) heading.setAttribute("data-today", "");
    const list = element("div", { role: "list", "aria-label": day.label });
    for (const [at, item] of day.rows.entries()) {
      if (model.now?.day === index && model.now.index === at) list.append(nowLine());
      const node = d.make(item.row);
      if (item.past) node.setAttribute("data-past", "");
      if (item.current) node.setAttribute("data-current", "");
      const time = item.until ? `${item.time}–${item.until}` : item.time;
      add(node, span("time", time), span("entry-title", titleOf(item.row)));
      add(node, span("entry-detail", item.row.detail), tags(item.row), badge(item.row));
      list.append(node);
    }
    if (model.now?.day === index && model.now.index === day.rows.length) list.append(nowLine());
    root.append(heading, list);
  }
  if (model.undated.length > 0) {
    root.append(add(element("div", { class: "day" }), document.createTextNode("No date")));
    root.append(drawList(model.undated, d));
  }
  return root;
}

/** The period's title and its Previous, Today and Next buttons; then the grid of days. */
export function drawCalendar(
  model: CalendarModel,
  d: Drawing,
  go: (anchor: string) => void,
): HTMLElement {
  const root = element("div", { class: "calendar-view" });
  const head = element("div", { class: "head" });
  const title = element("h3", { class: "title", "aria-live": "polite" });
  title.textContent = model.title;
  const nav = element("div", { class: "nav" });
  for (const [label, anchor] of [
    ["Previous", model.prev],
    ["Today", model.today],
    ["Next", model.next],
  ] as const) {
    const button = element("button", { type: "button", "data-go": label.toLowerCase() });
    button.textContent = label;
    button.addEventListener("click", () => go(anchor));
    nav.append(button);
  }
  head.append(title, nav);
  const grid = element("div", { class: "calendar", "data-columns": String(model.columns) });
  for (const name of model.weekdays) add(grid, span("weekday", name));
  for (const cell of model.cells) {
    const box = element("div", { role: "list", class: "cell", "aria-label": cell.label });
    if (!cell.inPeriod) box.setAttribute("data-outside", "");
    if (cell.today) box.setAttribute("data-today", "");
    add(box, span("number", String(cell.number)));
    for (const entry of cell.entries) {
      const node = d.make(entry.row);
      if (entry.row.allDay) node.setAttribute("data-all-day", "");
      if (entry.continues) node.setAttribute("data-continues", "");
      add(node, span("time", entry.time), span("entry-title", titleOf(entry.row)));
      box.append(node);
    }
    grid.append(box);
  }
  root.append(head, grid);
  if (model.undated > 0)
    add(root, span("summary", `${model.undated} without a date are not shown.`));
  return root;
}

/** Hooks for dragging a card to another column. */
export interface Dragging {
  start(row: UniversalRow): void;
  drop(group: string): void;
}

/** A column per group with its cards; cards drag between columns. */
export function drawKanban(columns: KanbanColumn[], d: Drawing, drag: Dragging): HTMLElement {
  const board = element("div", { class: "board" });
  for (const column of columns) {
    d.lane();
    const box = element("div", {
      role: "group",
      class: "column",
      "aria-label": column.title,
      "data-group": column.group,
    });
    const head = element("div", { class: "column-title" });
    add(head, span("name", column.title), span("summary", String(column.rows.length)));
    const list = element("div", { role: "list" });
    for (const row of column.rows) {
      const card = d.make(row);
      card.setAttribute("draggable", "true");
      card.addEventListener("dragstart", () => drag.start(row));
      add(card, span("entry-title", titleOf(row)), span("entry-detail", row.detail));
      add(card, tags(row), span("author", row.author));
      if (row.status && row.status !== row.group.toLowerCase()) add(card, badge(row));
      list.append(card);
    }
    box.addEventListener("dragover", (event) => {
      event.preventDefault();
      box.setAttribute("data-over", "");
    });
    box.addEventListener("dragleave", () => box.removeAttribute("data-over"));
    box.addEventListener("drop", (event) => {
      event.preventDefault();
      box.removeAttribute("data-over");
      drag.drop(column.group);
    });
    board.append(add(box, head, list));
  }
  return board;
}

/** Each entry a section: its title as a heading, its text as Markdown. */
export function drawText(sections: TextSection[], d: Drawing): HTMLElement {
  const root = element("div", { role: "list", class: "text" });
  for (const section of sections) {
    const node = d.make(section.row, "section");
    if (section.heading) add(node, add(element("h2"), document.createTextNode(section.heading)));
    add(node, markdown(section.markdown));
    root.append(node);
  }
  return root;
}

/** Messages by day; the person's own on the other side; the author once per run. */
export function drawChat(days: ChatDay[], d: Drawing): HTMLElement {
  const root = element("div", { role: "list", class: "chat", "aria-live": "polite" });
  for (const day of days) {
    if (day.label)
      root.append(add(element("div", { class: "day" }), document.createTextNode(day.label)));
    for (const message of day.messages) {
      const node = d.make(message.row);
      if (message.mine) node.setAttribute("data-mine", "");
      if (message.first && !message.mine) add(node, span("author", message.row.author));
      add(node, markdown(message.row.text || message.row.title), span("time", message.time));
      root.append(node);
    }
  }
  return root;
}

/** The run's state and its steps: each with its status, time, duration and text. */
export function drawAgent(model: AgentModel, d: Drawing): HTMLElement {
  const root = element("div", { class: "agent", "data-tone": model.tone });
  const head = element("div", { class: "agent-head" });
  const state = span("badge", model.tone);
  state?.setAttribute("data-tone", model.tone);
  add(head, state, span("summary", model.summary));
  const list = element("div", { role: "list", "aria-live": "polite" });
  for (const step of model.steps) {
    const node = d.make(step.row);
    node.setAttribute("data-tone", step.tone);
    const status = span("badge", step.status);
    status?.setAttribute("data-tone", step.tone);
    const when = [step.time, step.duration].filter(Boolean).join(" · ");
    add(node, status, span("entry-title", titleOf(step.row)), span("time", when));
    add(node, markdown(step.row.text));
    list.append(node);
  }
  root.append(head, list);
  return root;
}
