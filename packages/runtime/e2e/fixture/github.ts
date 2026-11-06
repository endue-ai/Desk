// desk.github as the views page lists it under ?github=1: its `work` instance connected, and the
// fixture search pages its own tests serve (plugins/github/tests/fixtures) as the task items its
// http map makes (plugins/github/plugin.json): the record whole in raw, one item per node_id.
import type { ConnectorInfo, TaskItem } from "@endue-ai/bridge";
import assigned1 from "../../../../plugins/github/tests/fixtures/assigned-1.json";
import assigned2 from "../../../../plugins/github/tests/fixtures/assigned-2.json";
import authored from "../../../../plugins/github/tests/fixtures/authored.json";
import review from "../../../../plugins/github/tests/fixtures/review-requested.json";

export const GITHUB = "desk.github";

export const github: ConnectorInfo = {
  id: GITHUB,
  title: "GitHub",
  auth: { kind: "token", title: "Personal access token" },
  instanceSettings: {
    token: {
      kind: "string",
      title: "Personal access token",
      description: "A token that reads your issues and pull requests.",
      secret: true,
      required: true,
    },
  },
  resources: [{ kind: "task" }],
  instances: [
    {
      connector: GITHUB,
      instance: "work",
      title: "Work",
      settings: {},
      status: { state: "connected", lastSyncAt: "2026-10-30T08:45:00+09:00" },
    },
  ],
};

type GitHubRecord = (typeof assigned1.items)[number];

export function githubItems(): TaskItem[] {
  const records = [assigned1, assigned2, review, authored].flatMap(
    (page) => page.items as GitHubRecord[],
  );
  const byId = new Map<string, TaskItem>();
  for (const raw of records)
    byId.set(raw.node_id, {
      kind: "task",
      id: raw.node_id,
      source: { connector: GITHUB, instance: "work" },
      title: raw.title,
      status: "open",
      updatedAt: raw.updated_at,
      createdAt: raw.created_at,
      ...(raw.milestone?.due_on ? { due: raw.milestone.due_on } : {}),
      project: raw.repository_url.split("/repos/")[1],
      deepLink: raw.html_url,
      ...(raw.body ? { body: raw.body } : {}),
      raw: raw as unknown as Record<string, unknown>,
    });
  return [...byId.values()];
}
