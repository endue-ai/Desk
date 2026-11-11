// GitHub issues and pull requests as desk.github brings them in, read from the fixture pages the
// connector's own tests serve. Apart from fixtures.ts because it reads files: fixtures.ts also loads
// in the browser, on the runtime's e2e page for this plugin.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskItem } from "../../../packages/bridge/src/index";
import { GITHUB } from "./fixtures";

/**
 * A GitHub issue or pull request as desk.github brings it in: the envelope its http map makes
 * (plugins/github/plugin.json) and the search record whole in `raw`.
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
