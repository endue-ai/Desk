// @vitest-environment jsdom
// The DOM on the plugin's own index.html: what each of the six views draws from the screens the
// plugin makes, that a source's words only ever reach it as text, the toolbar, the details, the
// keys, and drops on columns, lanes and days.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Screen } from "../ui/present.js";
import { createView } from "../ui/view.js";
import { JIRA, jiraIssue, sample } from "./fixtures";
import { mount } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const PAY12 = `${JIRA}/work#10001`;
const $ = <T extends Element = HTMLElement>(selector: string) => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};
/** The value, or a failed test when there is none. */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];

function actions() {
  return {
    select: vi.fn(),
    open: vi.fn(),
    key: vi.fn(),
    command: vi.fn(),
    sort: vi.fn(),
    drop: vi.fn(),
    connect: vi.fn(),
  };
}

/** The screens the plugin makes for each view, over the sample and a title written as markup. */
async function screens() {
  const items = [
    ...sample(),
    jiraIssue({ id: "666" }, { summary: '<img src=x onerror="alert(1)">' }, "PAY-66"),
  ];
  const m = await mount({ items });
  const out: Record<string, Screen> = {};
  for (const view of ["kanban", "swimlane", "list", "table", "timeline", "calendar"]) {
    m.app.setView(view);
    out[view] = m.view.last();
  }
  m.app.open(PAY12);
  out.detail = m.view.last();
  return out;
}

beforeEach(() => {
  document.body.innerHTML =
    /<body>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
});

describe("the six views", () => {
  it("draw the board, the lanes, the list, the table, the timeline and the calendar", async () => {
    const s = await screens();
    const view = createView(document, actions());
    view.render(must(s.kanban));
    expect(all(".column h2").map((h) => h.textContent)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
    ]);
    expect(all(".card").length).toBe(7);
    expect($('[data-view="kanban"]').getAttribute("aria-selected")).toBe("true");
    expect($("#group-control").hidden).toBe(true);
    view.render(must(s.swimlane));
    expect(all(".lane-title h3").map((h) => h.textContent)).toEqual([
      "Ada Lovelace",
      "Jun Choi",
      "Mina Park",
      "Unassigned",
    ]);
    expect(all(".cell[data-lane]").length).toBe(16);
    expect($("#group-control").hidden).toBe(false);
    view.render(must(s.list));
    expect(all(".row").length).toBe(7);
    view.render(must(s.table));
    expect(all(".db th button").map((b) => b.textContent)).toEqual([
      "Key",
      "Title",
      "Status",
      "Assignee",
      "Priority",
      "Due",
      "Source",
    ]);
    expect($(".db tfoot td").textContent).toBe("7 tasks · estimate 15");
    view.render(must(s.timeline));
    expect(all(".tline").length).toBeGreaterThan(0);
    expect($("#period").hidden).toBe(false);
    expect($("#zoom").hidden).toBe(false);
    view.render(must(s.calendar));
    expect(all(".day").length).toBe(35);
    expect($(".day.today .date").textContent).toBe("30");
    expect($("#period-title").textContent).toBe("October 2026");
    expect($("#zoom").hidden).toBe(true);
  });

  it("puts a source's words in as text, never as markup", async () => {
    const s = await screens();
    const view = createView(document, actions());
    for (const name of ["kanban", "list", "table", "timeline"]) {
      view.render(must(s[name]));
      expect(document.querySelector("img"), name).toBeNull();
      expect(document.body.textContent).toContain('<img src=x onerror="alert(1)">');
    }
  });

  it("shows the open work's details with what its connector lets the person change", async () => {
    const s = await screens();
    const a = actions();
    const view = createView(document, a);
    view.render(must(s.detail));
    expect($("#detail").hidden).toBe(false);
    expect($("#detail-title").textContent).toBe("Card payments time out");
    const status = $<HTMLSelectElement>('#detail [data-field="status"]');
    expect(status.disabled).toBe(false);
    expect([...status.options].map((o) => o.value)).toEqual(["In Progress", "Done"]);
    status.value = "Done";
    status.dispatchEvent(new Event("change", { bubbles: true }));
    expect(a.command).toHaveBeenCalledWith("endue.projects.move", { status: "Done" });
    const due = $<HTMLInputElement>('#detail [data-field="due"]');
    expect(due.value).toBe("2026-11-03");
    due.value = "";
    due.dispatchEvent(new Event("change", { bubbles: true }));
    expect(a.command).toHaveBeenCalledWith("endue.projects.update", { due: null });
    $("#detail .original").click();
    expect(a.command).toHaveBeenCalledWith("endue.projects.open-original", {});
    $("#detail .close").click();
    expect(a.open).toHaveBeenCalledWith(null);
  });
});

describe("the toolbar, the keys and drops", () => {
  it("runs the plugin's commands from the toolbar", async () => {
    const s = await screens();
    const a = actions();
    createView(document, a).render(must(s.list));
    $('[data-view="calendar"]').click();
    expect(a.command).toHaveBeenCalledWith("endue.projects.view", { view: "calendar" });
    const group = $<HTMLSelectElement>("#group");
    group.value = "priority";
    group.dispatchEvent(new Event("change"));
    expect(a.command).toHaveBeenCalledWith("endue.projects.group", { by: "priority" });
    const search = $<HTMLInputElement>("#search");
    search.value = "venue";
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(a.command).toHaveBeenCalledWith("endue.projects.search", { text: "venue" });
    const source = $<HTMLSelectElement>("#source");
    expect([...source.options].map((o) => o.textContent)).toEqual([
      "All sources",
      "acme.todo",
      "Asana",
      "Jira · work",
      "Linear",
    ]);
  });

  it("opens a card on a click and walks with the keys, leaving chords to the desk", async () => {
    const s = await screens();
    const a = actions();
    createView(document, a).render(must(s.kanban));
    must(all(".card")[0]).click();
    expect(a.open).toHaveBeenCalledWith(must(s.kanban).order[0]);
    const body = $("#body");
    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      body.dispatchEvent(event);
      return event;
    };
    expect(press({ key: "j" }).defaultPrevented).toBe(true);
    expect(a.key).toHaveBeenCalledWith("j");
    press({ key: "ArrowRight", shiftKey: true });
    expect(a.key).toHaveBeenCalledWith("Shift+ArrowRight");
    press({ key: "4" });
    expect(a.command).toHaveBeenCalledWith("endue.projects.view", { view: "table" });
    press({ key: "]" });
    expect(a.command).toHaveBeenCalledWith("endue.projects.go", { to: "next" });
    expect(press({ key: "k", metaKey: true }).defaultPrevented).toBe(false);
  });

  it("turns a drag onto a column, a lane's cell or a day into a drop", async () => {
    const s = await screens();
    const a = actions();
    const view = createView(document, a);
    const drag = (from: Element, to: Element) => {
      from.dispatchEvent(new Event("dragstart", { bubbles: true }));
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      to.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
      to.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    };
    const card = (key: string) => must(all(".card").find((c) => c.dataset.key === key));
    view.render(must(s.kanban));
    drag(card(PAY12), must(all('[data-drop="column"]')[3]));
    expect(a.drop).toHaveBeenLastCalledWith({ key: PAY12, column: 3 });
    view.render(must(s.swimlane));
    drag(card(PAY12), must(all('[data-drop="cell"]')[5]));
    expect(a.drop).toHaveBeenLastCalledWith({ key: PAY12, column: 1, lane: 1 });
    view.render(must(s.calendar));
    drag(card(`${JIRA}/work#10002`), $('[data-date="2026-10-29"]'));
    expect(a.drop).toHaveBeenLastCalledWith({ key: `${JIRA}/work#10002`, date: "2026-10-29" });
  });

  it("offers to connect a source when there is none", async () => {
    const m = await mount({ items: [] });
    const a = actions();
    createView(document, a).render(m.view.last());
    expect($(".empty p").textContent).toContain("Connect Jira, Linear or Asana");
    $("[data-connect]").click();
    expect(a.connect).toHaveBeenCalled();
  });
});
