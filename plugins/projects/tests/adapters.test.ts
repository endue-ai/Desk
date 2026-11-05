// The adapters: each source's record, as its connector keeps it in `raw`, becomes the same Work.
import { describe, expect, it } from "vitest";
import { categoryOfName, rankOfName } from "../ui/adapters/common.js";
import { adapterOf, workOf } from "../ui/adapters/index.js";
import {
  ASANA,
  asanaTask,
  JIRA,
  jiraIssue,
  LINEAR,
  linearIssue,
  linearMcpIssue,
  otherTask,
} from "./fixtures";

describe("the Jira adapter", () => {
  it("reads an issue as Jira's REST API and MCP server return it", () => {
    const w = workOf(jiraIssue());
    expect(w).toMatchObject({
      key: `${JIRA}/work#10001`,
      system: "jira",
      ref: "PAY-12",
      title: "Card payments time out",
      url: "https://acme.atlassian.net/browse/PAY-12",
      status: "In Progress",
      category: "doing",
      type: "Bug",
      priority: 1,
      priorityName: "Highest",
      assignee: { name: "Ada Lovelace", email: "ada@acme.test" },
      labels: ["payments", "backend"],
      project: "Payments",
      sprint: "PAY Sprint 8",
      parent: "PAY-1",
      start: "2026-10-26",
      due: "2026-11-03",
      estimate: 5,
    });
  });

  it("files Backlog and Won't Do by their names, not Jira's category", () => {
    const backlog = jiraIssue({}, { status: { name: "Backlog", statusCategory: { key: "new" } } });
    const wont = jiraIssue({}, { status: { name: "Won't Do", statusCategory: { key: "done" } } });
    expect(workOf(backlog).category).toBe("backlog");
    expect(workOf(wont).category).toBe("cancelled");
  });

  it("is recognized by its raw even under a connector of another name", () => {
    const item = jiraIssue({ source: { connector: "endue.atl", instance: "default" } });
    expect(adapterOf(item)?.system).toBe("jira");
    const plain = { ...jiraIssue(), source: { connector: "acme.tracker", instance: "default" } };
    expect(adapterOf(plain)?.system).toBe("jira");
  });

  it("keeps the connector's deep link over the one it builds", () => {
    const item = jiraIssue({ deepLink: "https://jira.acme.test/browse/PAY-12" });
    expect(workOf(item).url).toBe("https://jira.acme.test/browse/PAY-12");
  });
});

describe("the Linear adapter", () => {
  it("reads an issue as Linear's GraphQL API returns it", () => {
    expect(workOf(linearIssue())).toMatchObject({
      system: "linear",
      ref: "ENG-42",
      url: "https://linear.app/acme/issue/ENG-42/onboarding-checklist",
      status: "Todo",
      category: "todo",
      priority: 2,
      priorityName: "High",
      assignee: { name: "Mina Park", email: "mina@acme.test" },
      labels: ["onboarding", "frontend"],
      project: "Q4 Launch",
      sprint: "Cycle 12",
      due: "2026-11-06",
      estimate: 3,
    });
  });

  it("reads one as Linear's MCP server lists it, flattened", () => {
    expect(workOf(linearMcpIssue())).toMatchObject({
      system: "linear",
      ref: "ENG-43",
      url: "https://linear.app/acme/issue/ENG-43",
      status: "In Review",
      category: "doing",
      priority: 1,
      priorityName: "Urgent",
      assignee: { name: "Ada Lovelace" },
      labels: ["docs"],
      project: "Q4 Launch",
      due: "2026-10-28",
    });
  });

  it("maps every workflow state type, and priority 0 to none", () => {
    const types = {
      triage: "backlog",
      backlog: "backlog",
      unstarted: "todo",
      started: "doing",
      completed: "done",
      canceled: "cancelled",
    };
    for (const [type, category] of Object.entries(types))
      expect(workOf(linearIssue({}, { state: { name: type, type } })).category, type).toBe(
        category,
      );
    const none = workOf(
      linearIssue({ priority: 2 }, { priority: 0, priorityLabel: "No priority" }),
    );
    expect(none.priority).toBeNull();
    expect(none.priorityName).toBeUndefined();
  });
});

describe("the Asana adapter", () => {
  it("reads a task as Asana's REST API returns it: its section is its status", () => {
    expect(workOf(asanaTask())).toMatchObject({
      key: `${ASANA}/default#120000000001`,
      system: "asana",
      ref: "",
      title: "Book the venue",
      url: "https://app.asana.com/0/p1/120000000001",
      status: "In progress",
      category: "doing",
      priority: 4,
      priorityName: "Low",
      assignee: { name: "Jun Choi", email: "jun@acme.test" },
      labels: ["events"],
      project: "Offsite",
      start: "2026-11-02",
      due: "2026-11-05",
      estimate: 2,
      body: "Two rooms, one with a projector.",
    });
  });

  it("says done when the task is completed, whatever its section", () => {
    const done = workOf(asanaTask({}, { completed: true }));
    expect(done.category).toBe("done");
    const noSection = workOf(asanaTask({}, { memberships: [], completed: true }));
    expect(noSection).toMatchObject({ status: "Done", category: "done" });
    const milestone = workOf(
      asanaTask(
        {},
        { resource_subtype: "milestone", due_on: null, due_at: "2026-11-09T09:00:00.000Z" },
      ),
    );
    expect(milestone).toMatchObject({ type: "Milestone", due: "2026-11-09" });
  });
});

describe("other connectors", () => {
  it("show as the envelope says, with the common raw names", () => {
    expect(workOf(otherTask())).toMatchObject({
      system: "other",
      ref: "",
      status: "To do",
      category: "todo",
      priority: 3,
      project: "Home",
      due: "2026-10-30",
      labels: ["home"],
      assignee: { email: "mina@acme.test" },
    });
    expect(workOf(otherTask({ status: "done" }))).toMatchObject({
      status: "Done",
      category: "done",
    });
    expect(workOf(otherTask({ raw: { status: "Waiting on review" } }))).toMatchObject({
      status: "Waiting on review",
      category: "doing",
    });
  });

  it("an adapter that a raw surprises leaves the envelope", () => {
    const strange = linearIssue({ source: { connector: LINEAR, instance: "default" } }, {});
    Object.defineProperty(strange.raw as object, "state", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });
    expect(workOf(strange)).toMatchObject({
      system: "other",
      title: "Onboarding checklist",
      category: "todo",
    });
  });
});

describe("words every tracker uses", () => {
  it("name a status's category and a priority's rank", () => {
    expect(
      ["Backlog", "To Do", "In Review", "Done", "Cancelled", "Mystery"].map((n) =>
        categoryOfName(n),
      ),
    ).toEqual(["backlog", "todo", "doing", "done", "cancelled", "todo"]);
    expect(
      ["Highest", "High", "Medium", "Low", "Lowest", "None", "P2"].map((n) => rankOfName(n)),
    ).toEqual([1, 2, 3, 4, 4, null, 2]);
  });
});
