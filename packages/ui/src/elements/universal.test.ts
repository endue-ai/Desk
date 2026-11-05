import type { UniversalData } from "@endue-ai/bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { type DeskUniversalViewSpec, defineElements } from "./index";
import { focused, press, queryAll, reset } from "./test-dom";
import { universalCss } from "./universal-css";

defineElements();

const board: UniversalData = {
  title: "Launch",
  map: { group: "column" },
  entries: [
    { id: "t1", title: "Write the spec", column: "done", start: "2026-11-02", tags: ["spec"] },
    { id: "t2", title: "Build the element", column: "doing", start: "2026-11-04T09:00:00+09:00" },
    { id: "t3", title: "Ship", column: "todo", owner: "Mina" },
    { id: "t4", title: "Docs", column: "todo", start: "2026-11-05T14:00:00+09:00" },
  ],
};

function mount(view: DeskUniversalViewSpec, data: UniversalData | null = board) {
  const element = document.createElement("desk-universal-view");
  element.setAttribute("time-zone", "Asia/Seoul");
  element.setAttribute("locale", "en-US");
  element.setAttribute("now", "2026-11-04T10:00:00+09:00");
  element.view = view;
  element.data = data;
  document.body.append(element);
  const root = element.shadowRoot as unknown as Element;
  const all = (cls: string) => queryAll(root, (el) => el.getAttribute("class") === cls);
  const entries = () => all("entry");
  const titles = () =>
    entries().map((el) => all("entry-title").find((t) => el.contains(t))?.textContent);
  const status = () => all("status")[0] as HTMLElement;
  const tabs = () => queryAll(root, (el) => el.getAttribute("role") === "tab");
  return { element, root, all, entries, titles, status, tabs };
}

describe("desk-universal-view", () => {
  beforeEach(reset);

  it("draws a board: a column per group in the options' order, cards that select", () => {
    const { element, all, entries, root } = mount({
      type: "kanban",
      source: { asset: "board.yaml" },
      options: { groups: ["todo", "doing", "done", "later"] },
    });
    const columns = queryAll(root, (el) => el.getAttribute("class") === "column");
    expect(columns.map((c) => c.getAttribute("aria-label"))).toEqual([
      "todo",
      "doing",
      "done",
      "later",
    ]);
    expect(all("name").map((n) => n.textContent)).toEqual(["todo", "doing", "done", "later"]);
    expect(entries().map((e) => e.getAttribute("data-key"))).toEqual(["t3", "t4", "t2", "t1"]);
    expect(all("title")[0]?.textContent).toBe("Launch");
    const onSelect = vi.fn();
    element.addEventListener("desk-select", onSelect);
    entries()[2]?.click();
    expect(onSelect.mock.calls[0]?.[0].detail.entry).toBe(board.entries[1]);
    expect(focused()).toBe(entries()[2]);
  });

  it("moves a card with Shift and the arrows, unless the page cancels the move", () => {
    const { element, entries } = mount({
      type: "kanban",
      source: { asset: "board.yaml" },
      options: { groups: ["todo", "doing", "done"] },
    });
    const moves = vi.fn();
    element.addEventListener("desk-move", moves);
    element.focus();
    expect(focused()?.getAttribute("data-key")).toBe("t3");
    expect(press("ArrowRight", { shiftKey: true })).toBe(true);
    expect(moves.mock.calls[0]?.[0].detail).toMatchObject({ from: "todo", to: "doing" });
    expect(element.data?.entries[2]).toMatchObject({ id: "t3", column: "doing" });
    expect(board.entries[2]).toMatchObject({ column: "todo" });
    expect(focused()?.getAttribute("data-key")).toBe("t3");
    expect(entries().map((e) => e.getAttribute("data-key"))).toEqual(["t4", "t2", "t3", "t1"]);

    element.addEventListener("desk-move", (event) => event.preventDefault());
    press("ArrowRight", { shiftKey: true });
    expect(element.data?.entries[2]).toMatchObject({ column: "doing" });
  });

  it("walks a board with the arrows: down a column, across to the nearest column with cards", () => {
    const { element } = mount({
      type: "kanban",
      source: { asset: "board.yaml" },
      options: { groups: ["todo", "empty", "doing", "done"] },
    });
    element.focus();
    const key = () => focused()?.getAttribute("data-key");
    press("ArrowDown");
    expect(key()).toBe("t4");
    press("ArrowRight");
    expect(key()).toBe("t2");
    press("ArrowRight");
    expect(key()).toBe("t1");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(key()).toBe("t3");
    press("End");
    expect(key()).toBe("t4");
  });

  it("drags a card to another column", () => {
    const { element, root, entries } = mount({ type: "kanban", source: { asset: "b.yaml" } });
    const done = queryAll(root, (el) => el.getAttribute("data-group") === "done")[0] as HTMLElement;
    entries()[0]?.dispatchEvent(new Event("dragstart", { bubbles: true }));
    done.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(element.data?.entries[0]).toMatchObject({ id: "t1", column: "done" });
  });

  it("switches presentations from its tabs and says so", () => {
    const { element, tabs, entries, titles } = mount({
      type: "list",
      types: ["list", "timeline", "calendar"],
      source: { asset: "board.yaml" },
    });
    expect(tabs().map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([
      ["List", "true"],
      ["Timeline", "false"],
      ["Calendar", "false"],
    ]);
    expect(titles()).toEqual(["Write the spec", "Build the element", "Ship", "Docs"]);
    const onType = vi.fn();
    element.addEventListener("desk-type", onType);
    tabs()[1]?.click();
    expect(onType.mock.calls[0]?.[0].detail).toEqual({ type: "timeline" });
    expect(element.type).toBe("timeline");
    // The timeline: dated rows by day, the undated one after them.
    expect(titles()).toEqual(["Write the spec", "Build the element", "Docs", "Ship"]);
    expect(entries()[1]?.hasAttribute("data-past")).toBe(true);
  });

  it("draws a timeline's days, times and now-line", () => {
    const { root, all } = mount({ type: "timeline", source: { asset: "board.yaml" } });
    expect(all("day").map((d) => d.textContent)).toEqual([
      "Mon, Nov 2",
      "Wed, Nov 4",
      "Thu, Nov 5",
      "No date",
    ]);
    expect(all("time").map((t) => t.textContent)).toEqual(["All day", "09:00", "14:00"]);
    const line = queryAll(root, (el) => el.getAttribute("role") === "separator");
    expect(line.map((l) => l.getAttribute("aria-label"))).toEqual(["Now"]);
  });

  it("draws a calendar month and steps between periods", () => {
    const { element, root, all } = mount({ type: "calendar", source: { asset: "board.yaml" } });
    expect(all("title").map((t) => t.textContent)).toEqual(["Launch", "November 2026"]);
    const cell = (label: string) =>
      queryAll(root, (el) => el.getAttribute("aria-label") === label)[0] as HTMLElement;
    expect(cell("Wed, Nov 4")?.hasAttribute("data-today")).toBe(true);
    expect(cell("Wed, Nov 4")?.textContent).toContain("09:00Build the element");
    expect(all("summary").map((s) => s.textContent)).toEqual(["1 without a date are not shown."]);
    const ranges = vi.fn();
    element.addEventListener("desk-range", ranges);
    queryAll(root, (el) => el.getAttribute("data-go") === "next")[0]?.click();
    expect(ranges.mock.calls[0]?.[0].detail).toEqual({ anchor: "2026-12-01", range: "month" });
    expect(all("title")[1]?.textContent).toBe("December 2026");
    queryAll(root, (el) => el.getAttribute("data-go") === "today")[0]?.click();
    expect(all("title")[1]?.textContent).toBe("November 2026");
  });

  it("draws a chat with the person's messages marked and a composer that sends", () => {
    const chat: UniversalData = {
      entries: [
        { author: "Mina", text: "Ship **Friday**?", start: "2026-11-04T09:12:00+09:00" },
        { author: "me", text: "Yes", start: "2026-11-04T09:14:00+09:00" },
      ],
    };
    const { element, root, entries, all } = mount(
      { type: "chat", source: { asset: "c.yaml" }, send: { command: "example.chat.send" } },
      chat,
    );
    expect(entries().map((e) => e.hasAttribute("data-mine"))).toEqual([false, true]);
    expect(all("author").map((a) => a.textContent)).toEqual(["Mina"]);
    const markdown = queryAll(root, (el) => el.localName === "desk-markdown");
    expect((markdown[0] as unknown as { source: string }).source).toBe("Ship **Friday**?");
    const box = queryAll(root, (el) => el.localName === "textarea")[0] as HTMLTextAreaElement;
    expect(box.getAttribute("placeholder")).toBe("Write a message");
    const sent = vi.fn();
    element.addEventListener("desk-send", sent);
    box.value = "  On it  ";
    box.focus();
    expect(press("Enter")).toBe(true);
    expect(sent.mock.calls[0]?.[0].detail).toEqual({ text: "On it" });
    expect(box.value).toBe("");
    element.draft = "Put back";
    expect([box.value, element.draft]).toEqual(["Put back", "Put back"]);
    box.value = "";
    press("Enter");
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("hides the composer without a send command or the compose attribute", () => {
    const { element, all } = mount({ type: "agent", source: { asset: "a.yaml" } }, { entries: [] });
    const compose = all("compose")[0] as HTMLElement;
    expect(compose.hidden).toBe(true);
    element.setAttribute("compose", "");
    expect(compose.hidden).toBe(false);
    // Laid out as flex, a hidden part still hides: the shadow sheet says so (#472).
    expect(universalCss).toMatch(/\[hidden\] \{\s*display: none !important;/);
  });

  it("draws an agent's run: its state, each step's status and duration", () => {
    const run: UniversalData = {
      entries: [
        {
          title: "Plan",
          status: "done",
          start: "2026-11-04T09:59:00+09:00",
          end: "2026-11-04T09:59:02+09:00",
        },
        { title: "Search mail", status: "running", start: "2026-11-04T09:58:00+09:00" },
        { title: "Reply", status: "pending", text: "Waiting for the search" },
      ],
    };
    const { all, entries } = mount({ type: "agent", source: { asset: "a.yaml" } }, run);
    expect(all("summary").map((s) => s.textContent)).toEqual(["Done 1 of 3"]);
    expect(all("badge").map((b) => [b.textContent, b.getAttribute("data-tone")])).toEqual([
      ["running", "running"],
      ["done", "done"],
      ["running", "running"],
      ["pending", "pending"],
    ]);
    expect(all("time").map((t) => t.textContent)).toEqual(["09:59 · 2 s", "09:58 · 2 min"]);
    expect(entries().map((e) => e.getAttribute("data-tone"))).toEqual([
      "done",
      "running",
      "pending",
    ]);
  });

  it("draws text as sections with headings over Markdown", () => {
    const doc: UniversalData = {
      entries: [{ title: "Start here", text: "# Hello\nRead *this*." }, { text: "More." }],
    };
    const { root } = mount({ type: "text", source: { asset: "t.yaml" } }, doc);
    const headings = queryAll(root, (el) => el.localName === "h2" && !el.hasAttribute("class"));
    expect(headings.map((h) => h.textContent)).toEqual(["Start here"]);
    expect(queryAll(root, (el) => el.localName === "section")).toHaveLength(2);
  });

  it("says when it is loading, failed or empty instead of drawing nothing", () => {
    const { element, status, all } = mount(
      { type: "list", source: { asset: "l.yaml" }, empty: "No tasks." },
      null,
    );
    element.setAttribute("state", "loading");
    expect([status().textContent, status().getAttribute("data-state")]).toEqual([
      "Loading…",
      "loading",
    ]);
    expect((all("body")[0] as HTMLElement).hidden).toBe(true);
    element.setAttribute("state", "error");
    element.setAttribute("message", "403 from tasks.example.com");
    expect(status().textContent).toBe("403 from tasks.example.com");
    element.setAttribute("state", "ready");
    expect([status().textContent, status().getAttribute("data-state")]).toEqual([
      "No tasks.",
      "empty",
    ]);
    element.data = board;
    expect(status().hidden).toBe(true);
    expect((all("body")[0] as HTMLElement).hidden).toBe(false);
  });

  it("keeps the focused entry focused when its data changes", () => {
    const { element } = mount({ type: "list", source: { asset: "l.yaml" } });
    element.focus();
    press("ArrowDown");
    press("ArrowDown");
    expect(focused()?.getAttribute("data-key")).toBe("t3");
    element.data = { ...board, entries: [{ id: "t0", title: "New" }, ...board.entries] };
    expect(focused()?.getAttribute("data-key")).toBe("t3");
    expect(element.entryOf(focused())?.title).toBe("Ship");
  });
});
