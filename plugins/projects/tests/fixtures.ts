// Task items as the three sources' connectors bring them in: the item envelope (specs/item/v0) with
// the source's own record whole in `raw`. Jira's is an issue as its REST API and the Atlassian MCP
// server return it, Linear's an issue as its GraphQL API returns it (and one as its MCP server lists
// it, flattened), Asana's a task as its REST API returns it; one more comes from a connector the
// plugin knows nothing about.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskItem } from "../../../packages/bridge/src/index";

export const JIRA = "acme.jira";
export const LINEAR = "acme.linear";
export const ASANA = "acme.asana";
export const OTHER = "acme.todo";
export const GITHUB = "desk.github";

export const jiraIssue = (
  over: Partial<TaskItem> = {},
  fields: Record<string, unknown> = {},
  key = "PAY-12",
): TaskItem => ({
  kind: "task",
  id: "10001",
  source: { connector: JIRA, instance: "work" },
  title: "PAY-12 Card payments time out",
  updatedAt: "2026-10-29T10:00:00+09:00",
  status: "open",
  raw: {
    id: "10001",
    key,
    self: "https://acme.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: "Card payments time out",
      status: {
        name: "In Progress",
        statusCategory: { key: "indeterminate", name: "In Progress" },
      },
      issuetype: { name: "Bug" },
      priority: { name: "Highest" },
      assignee: { displayName: "Ada Lovelace", emailAddress: "ada@acme.test" },
      labels: ["payments", "backend"],
      project: { key: "PAY", name: "Payments" },
      duedate: "2026-11-03",
      customfield_10015: "2026-10-26",
      customfield_10016: 5,
      customfield_10020: [
        { id: 1, name: "PAY Sprint 7", state: "closed" },
        { id: 2, name: "PAY Sprint 8", state: "active" },
      ],
      parent: { key: "PAY-1" },
      created: "2026-10-20T09:00:00.000+0900",
      ...fields,
    },
  },
  ...over,
});

export const linearIssue = (
  over: Partial<TaskItem> = {},
  raw: Record<string, unknown> = {},
): TaskItem => ({
  kind: "task",
  id: "9f1c-uuid",
  source: { connector: LINEAR, instance: "default" },
  title: "Onboarding checklist",
  updatedAt: "2026-10-30T08:00:00+09:00",
  status: "open",
  deepLink: "https://linear.app/acme/issue/ENG-42/onboarding-checklist",
  raw: {
    id: "9f1c-uuid",
    identifier: "ENG-42",
    title: "Onboarding checklist",
    state: { name: "Todo", type: "unstarted" },
    priority: 2,
    priorityLabel: "High",
    assignee: { name: "Mina Park", email: "mina@acme.test" },
    labels: { nodes: [{ name: "onboarding" }, { name: "frontend" }] },
    team: { key: "ENG", name: "Engineering" },
    project: { name: "Q4 Launch" },
    cycle: { number: 12, name: null, startsAt: "2026-10-26T00:00:00Z" },
    dueDate: "2026-11-06",
    estimate: 3,
    url: "https://linear.app/acme/issue/ENG-42",
    createdAt: "2026-10-21T00:00:00.000Z",
    ...raw,
  },
  ...over,
});

/** A Linear issue as Linear's MCP server lists it: names instead of objects. */
export const linearMcpIssue = (): TaskItem => ({
  kind: "task",
  id: "ENG-43",
  source: { connector: "endue.linear-mcp", instance: "default" },
  title: "Ship the release notes",
  updatedAt: "2026-10-30T07:00:00+09:00",
  status: "open",
  raw: {
    id: "ENG-43",
    identifier: "ENG-43",
    status: "In Review",
    statusType: "started",
    priority: { value: 1, name: "Urgent" },
    assignee: "Ada Lovelace",
    labels: ["docs"],
    project: "Q4 Launch",
    team: "Engineering",
    dueDate: "2026-10-28",
    url: "https://linear.app/acme/issue/ENG-43",
  },
});

export const asanaTask = (
  over: Partial<TaskItem> = {},
  raw: Record<string, unknown> = {},
): TaskItem => ({
  kind: "task",
  id: "120000000001",
  source: { connector: ASANA, instance: "default" },
  title: "Book the venue",
  updatedAt: "2026-10-28T12:00:00Z",
  status: "open",
  raw: {
    gid: "120000000001",
    name: "Book the venue",
    notes: "Two rooms, one with a projector.",
    completed: false,
    assignee: { gid: "1", name: "Jun Choi", email: "jun@acme.test" },
    start_on: "2026-11-02",
    due_on: "2026-11-05",
    memberships: [
      { project: { gid: "p1", name: "Offsite" }, section: { gid: "s1", name: "In progress" } },
    ],
    tags: [{ gid: "t1", name: "events" }],
    custom_fields: [
      { gid: "c1", name: "Priority", enum_value: { name: "Low" }, display_value: "Low" },
      { gid: "c2", name: "Story points", number_value: 2, display_value: "2" },
    ],
    permalink_url: "https://app.asana.com/0/p1/120000000001",
    resource_subtype: "default_task",
    created_at: "2026-10-22T03:00:00.000Z",
    ...raw,
  },
  ...over,
});

/** A task from a connector no adapter knows: only the envelope and a couple of common raw names. */
export const otherTask = (over: Partial<TaskItem> = {}): TaskItem => ({
  kind: "task",
  id: "t-1",
  source: { connector: OTHER, instance: "default" },
  title: "Water the plants",
  updatedAt: "2026-10-30T06:00:00+09:00",
  status: "open",
  due: "2026-10-30T18:00:00+09:00",
  priority: 3,
  project: "Home",
  raw: { labels: ["home"], assignee: "mina@acme.test" },
  ...over,
});

/** One of each, plus a finished Jira issue and an unscheduled Linear one. */
export function sample(): TaskItem[] {
  return [
    jiraIssue(),
    jiraIssue(
      { id: "10002", status: "done", updatedAt: "2026-10-27T10:00:00+09:00" },
      {
        summary: "Refund flow copy",
        status: { name: "Done", statusCategory: { key: "done" } },
        priority: { name: "Low" },
        assignee: null,
        labels: [],
        duedate: "2026-10-27",
        customfield_10015: null,
        customfield_10016: null,
        customfield_10020: null,
        parent: null,
      },
      "PAY-9",
    ),
    linearIssue(),
    linearIssue(
      { id: "9f1d-uuid", title: "Clean up flags", deepLink: undefined },
      {
        identifier: "ENG-44",
        title: "Clean up flags",
        state: { name: "Backlog", type: "backlog" },
        priority: 0,
        assignee: null,
        dueDate: null,
        estimate: null,
        cycle: null,
        labels: { nodes: [] },
      },
    ),
    asanaTask(),
    otherTask(),
  ].map((item) => {
    // The raw keeps what the source said; the item drops what is undefined, as JSON would.
    const copy = JSON.parse(JSON.stringify(item)) as TaskItem;
    return copy;
  });
}

/**
 * A GitHub issue or pull request as desk.github brings it in: the envelope its http map makes
 * (plugins/github/plugin.json) and the search record whole in `raw`, from the fixture pages the
 * connector's own tests serve.
 */
type GitHubRecord = Record<string, unknown> & {
  node_id: string;
  state: string;
  title: string;
  updated_at: string;
  created_at: string;
  repository_url: string;
  html_url: string;
  body: string | null;
  milestone: { due_on: string | null } | null;
};

export function githubItem(nodeId: string): TaskItem {
  const dir = join(import.meta.dirname, "../../github/tests/fixtures");
  const pages = ["assigned-1.json", "assigned-2.json", "review-requested.json", "authored.json"];
  const records = pages.flatMap(
    (name) =>
      (JSON.parse(readFileSync(join(dir, name), "utf8")) as { items: GitHubRecord[] }).items,
  );
  const raw = records.find((r) => r.node_id === nodeId);
  if (!raw) throw new Error(`no fixture record ${nodeId}`);
  return JSON.parse(
    JSON.stringify({
      kind: "task",
      id: raw.node_id,
      source: { connector: GITHUB, instance: "work" },
      title: raw.title,
      status: raw.state === "open" ? "open" : "done",
      updatedAt: raw.updated_at,
      createdAt: raw.created_at,
      due: raw.milestone?.due_on ?? undefined,
      project: String(raw.repository_url).split("/repos/")[1],
      deepLink: raw.html_url,
      body: raw.body ?? undefined,
      raw,
    }),
  ) as TaskItem;
}
