// The plugin on the SDK's test host: loading every task through the adapters, the six views and
// what the store keeps, following the index, and changes going to the connectors' commands.
import { describe, expect, it } from "vitest";
import type { Item } from "../../../packages/bridge/src/index";
import { ASANA, JIRA, LINEAR, linearIssue, otherTask, sample } from "./fixtures";
import { CONNECTORS, denied, installed, mount, READ } from "./harness";

const PAY12 = `${JIRA}/work#10001`;
const ENG42 = `${LINEAR}/default#9f1c-uuid`;
const VENUE = `${ASANA}/default#120000000001`;

describe("loading", () => {
  it("reads every task, through the adapters, onto the Kanban board", async () => {
    const m = await mount();
    const screen = m.view.last();
    expect(screen.view).toBe("kanban");
    expect(screen.count).toBe(6);
    if (screen.body.kind !== "kanban") throw new Error("not the board");
    expect(screen.body.columns.map((c) => c.title)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
    ]);
    expect(m.params("data.query")[0]).toEqual({
      query: { kinds: ["task"], limit: 500 },
      scope: READ,
    });
    expect(m.params("data.subscribe")).toEqual([{ query: { kinds: ["task"] }, scope: READ }]);
    expect(screen.sources.map((s) => s.title)).toEqual([
      "acme.todo",
      "Asana",
      "Jira · work",
      "Linear",
    ]);
  });

  it("pages through the index and stops at 2000 tasks, saying so", async () => {
    const many: Item[] = Array.from({ length: 2100 }, (_, i) =>
      otherTask({ id: `t-${i}`, title: `Task ${i}` }),
    );
    const m = await mount({ items: many });
    expect(m.params("data.query")).toHaveLength(4);
    expect(m.app.works()).toHaveLength(2000);
    expect(m.view.said()).toBe("Showing the first 2000 tasks.");
  });

  it("asks once for a refused read, then says it is not allowed", async () => {
    const m = await mount({
      handlers: {
        "data.query": () => {
          throw denied("data:read");
        },
      },
      grants: [],
    });
    expect(m.params("perm.request")).toHaveLength(1);
    expect(m.view.said()).toBe("Not allowed to read tasks.");
  });

  it("names the installed task connectors and leads to connecting one when no source is connected", async () => {
    const handlers = installed(
      ["desk.github", "GitHub", ["task"]],
      ["desk.calendar", "Calendar", ["event"]],
    );
    const m = await mount({ items: [], handlers });
    expect(m.view.last().empty).toEqual({
      text: "No tasks yet. Connect GitHub to see your tasks here.",
      connect: true,
    });
    // Never a sentence it could not stand behind: nothing until connector.list answered.
    for (const screen of m.view.screens) expect(screen.empty?.text ?? "").not.toMatch(/installed/);
    expect(m.params("connector.list")).toContainEqual({ scope: CONNECTORS });
    await m.app.connect();
    expect(m.view.said()).toBe("Connect GitHub from the desk's connectors first.");
    const ok = await mount({
      items: [],
      handlers,
      commands: { "desk.connectors.open": () => ({ ok: true }) },
    });
    await ok.app.command("endue.projects.connect", {});
    expect(ok.ran("desk.connectors.open")).toEqual([{ kinds: ["task"] }]);
  });

  it("says no installed connector brings tasks, and offers no Connect", async () => {
    const m = await mount({
      items: [],
      handlers: installed(["desk.calendar", "Calendar", ["event"]]),
      commands: { "desk.connectors.open": () => ({ ok: true }) },
    });
    expect(m.view.last().empty).toEqual({
      text: "No installed connector brings tasks yet.",
      connect: false,
    });
    await expect(m.app.command("endue.projects.connect", {})).rejects.toThrow(
      "No installed connector brings tasks yet.",
    );
    expect(m.view.said()).toBe("No installed connector brings tasks yet.");
    expect(m.ran("desk.connectors.open")).toEqual([]);
  });
});

describe("the views", () => {
  it("draws each of the six over the same work, and the store keeps the choice", async () => {
    const m = await mount();
    const kinds: Record<string, string> = {};
    for (const view of ["kanban", "swimlane", "list", "table", "timeline", "calendar"]) {
      m.app.setView(view);
      kinds[view] = m.view.last().body.kind;
    }
    expect(kinds).toEqual({
      kanban: "kanban",
      swimlane: "swimlane",
      list: "list",
      table: "table",
      timeline: "timeline",
      calendar: "calendar",
    });
    await m.settle();
    expect(m.store.view).toMatchObject({ view: "calendar" });
    const again = await mount({ store: m.store });
    expect(again.view.last().view).toBe("calendar");
    expect(() => m.app.setView("gantt")).toThrow("gantt is not a view");
  });

  it("opens in the view the setting names until the person picks another", async () => {
    const m = await mount({ settings: { view: "table" } });
    expect(m.view.last().view).toBe("table");
  });

  it("groups, searches, filters by source and hides finished work", async () => {
    const m = await mount();
    m.app.setView("list");
    m.app.setGroup("project");
    const titles = () => {
      const b = m.view.last().body;
      return b.kind === "list" ? b.groups.map((g) => g.title) : [];
    };
    expect(titles()).toEqual(["Home", "Offsite", "Payments", "Q4 Launch"]);
    m.app.setSearch("venue");
    expect(m.view.last().count).toBe(1);
    m.app.setSearch("");
    m.app.setSource(`${LINEAR}/default`);
    expect(m.view.last().count).toBe(2);
    expect(() => m.app.setSource("acme.nothing/default")).toThrow("not a connected source");
    m.app.setSource(null);
    m.app.setShowDone(false);
    expect(m.view.last().count).toBe(5);
  });

  it("sorts the database view by a heading: ascending, descending, then off", async () => {
    const m = await mount();
    m.app.setView("table");
    expect(m.app.sortBy("due")).toEqual({ field: "due", dir: "asc" });
    const refs = () => {
      const b = m.view.last().body;
      return b.kind === "table" ? b.rows.map((w) => w.ref || w.title) : [];
    };
    expect(refs()[0]).toBe("PAY-9");
    expect(m.app.sortBy("due")).toEqual({ field: "due", dir: "desc" });
    expect(refs()[0]).toBe("ENG-42");
    expect(m.app.sortBy("due")).toBeNull();
  });

  it("moves the timeline and the calendar to today, or a period back or ahead", async () => {
    const m = await mount();
    m.app.setView("calendar");
    expect(m.app.go("next")).toBe("November 2026");
    expect(m.app.go("today")).toBe("October 2026");
    m.app.setView("timeline");
    m.app.setZoom("week");
    expect(m.view.last().period).toBe("Oct 26 – Nov 8");
    expect(() => m.app.go("yesterday")).toThrow("Go where?");
  });

  it("walks the work with the keys and opens it with Enter", async () => {
    const m = await mount();
    await m.app.key("j");
    const first = m.view.last().order[0];
    expect(m.view.last().selected).toBe(first);
    await m.app.key("Enter");
    expect(m.view.last().detail?.work.key).toBe(first);
    expect(m.view.focused.at(-1)).toBe("detail");
    await m.app.key("Escape");
    expect(m.view.last().detail).toBeNull();
  });
});

describe("following the index", () => {
  it("adds, changes and removes work as the connectors sync", async () => {
    const m = await mount();
    m.index.upsert(
      linearIssue(
        { id: "new" },
        { identifier: "ENG-50", title: "Fresh", state: { name: "In Progress", type: "started" } },
      ),
    );
    await m.settle();
    expect(m.app.works().some((w) => w.ref === "ENG-50")).toBe(true);
    m.app.open(ENG42);
    m.index.remove({ connector: LINEAR, instance: "default" }, "9f1c-uuid");
    await m.settle();
    expect(m.app.works().some((w) => w.key === ENG42)).toBe(false);
    expect(m.view.last().detail).toBeNull();
  });
});

describe("changes through the connectors' commands", () => {
  it("a card dropped on a column moves to that status, and the connector's sync agrees", async () => {
    const m = await mount();
    const body = m.view.last().body;
    if (body.kind !== "kanban") throw new Error("not the board");
    await m.app.drop({ key: PAY12, column: body.columns.findIndex((c) => c.title === "Done") });
    await m.settle();
    expect(m.ran(`${JIRA}.task.move`)).toEqual([{ instance: "work", id: "10001", status: "Done" }]);
    expect(m.app.works().find((w) => w.key === PAY12)).toMatchObject({
      status: "Done",
      category: "done",
    });
    expect(m.view.statuses).toContain("Moved PAY-12 to Done.");
  });

  it("a refused move is undone and said", async () => {
    const m = await mount({
      commands: {
        [`${JIRA}.task.move`]: () => {
          throw new Error("transition not allowed");
        },
      },
    });
    await m.app.key("Home");
    const before = m.app.works().find((w) => w.key === PAY12)?.status;
    const body = m.view.last().body;
    if (body.kind !== "kanban") throw new Error("not the board");
    await m.app.drop({ key: PAY12, column: 0 });
    expect(m.app.works().find((w) => w.key === PAY12)?.status).toBe(before);
    expect(m.view.said()).toMatch(/^Could not move the task: .*transition not allowed\.$/);
  });

  it("a connector without the action is said, and nothing runs", async () => {
    const m = await mount();
    await m.app.drop({ key: VENUE, column: 0 });
    expect(m.view.said()).toBe("Asana cannot move tasks: it provides no acme.asana.task.move.");
    expect(m.app.works().find((w) => w.key === VENUE)?.status).toBe("In progress");
    m.app.open(ENG42);
    expect(m.view.last().detail).toMatchObject({ canMove: true, canUpdate: false });
  });

  it("Shift+arrows move the selected card to the next column", async () => {
    const m = await mount();
    m.app.select(PAY12);
    await m.app.key("Shift+ArrowRight");
    expect(m.ran(`${JIRA}.task.move`)).toEqual([{ instance: "work", id: "10001", status: "Done" }]);
  });

  it("a card dropped into another swimlane changes its person through task.update", async () => {
    const m = await mount();
    m.app.setView("swimlane");
    m.app.setGroup("assignee");
    const body = m.view.last().body;
    if (body.kind !== "swimlane") throw new Error("not the swimlanes");
    const lane = body.lanes.findIndex((l) => l.title === "Unassigned");
    const column = body.columns.findIndex((c) => c.title === "In Progress");
    await m.app.drop({ key: PAY12, column, lane });
    expect(m.ran(`${JIRA}.task.update`)).toEqual([
      { instance: "work", id: "10001", assignee: null },
    ]);
    expect(m.ran(`${JIRA}.task.move`)).toEqual([]);
    m.app.setGroup("project");
    await m.app.drop({ key: PAY12, column, lane: 0 });
    expect(m.view.said()).toBe("Moving between lanes cannot change the project.");
  });

  it("a card dropped on a calendar day moves its due date and its start with it", async () => {
    const m = await mount();
    m.app.setView("calendar");
    await m.app.drop({ key: PAY12, date: "2026-11-05" });
    expect(m.ran(`${JIRA}.task.update`)).toEqual([
      { instance: "work", id: "10001", due: "2026-11-05", start: "2026-10-28" },
    ]);
    expect(m.app.works().find((w) => w.key === PAY12)).toMatchObject({
      due: "2026-11-05",
      start: "2026-10-28",
    });
  });

  it("agents name the work and the change; a bad change is refused with a sentence", async () => {
    const m = await mount();
    const source = { connector: JIRA, instance: "work" };
    expect(await m.host.command("endue.projects.show", { source, id: "10001" })).toBe(PAY12);
    expect(m.view.last().detail?.work.ref).toBe("PAY-12");
    await expect(m.host.command("endue.projects.update", { due: "next week" })).rejects.toThrow(
      "due is a date (YYYY-MM-DD) or null.",
    );
    expect(await m.host.command("endue.projects.update", { priority: 2 })).toEqual({ priority: 2 });
    expect(
      await m.host.command("endue.projects.move", { source, id: "10001", status: "In Review" }),
    ).toBe("In Review");
    expect(m.ran(`${JIRA}.task.move`).at(-1)).toEqual({
      instance: "work",
      id: "10001",
      status: "In Review",
    });
    await expect(m.host.command("endue.projects.show", { source, id: "nope" })).rejects.toThrow(
      "There is no task nope.",
    );
  });

  it("opens the original issue on the web through shell.open", async () => {
    const m = await mount();
    m.app.open(PAY12);
    expect(await m.host.command("endue.projects.open-original", {})).toBe(
      "https://acme.atlassian.net/browse/PAY-12",
    );
    expect(m.params("shell.open").at(-1)).toMatchObject({
      target: "https://acme.atlassian.net/browse/PAY-12",
    });
    expect(sample()).toHaveLength(6);
  });
});
