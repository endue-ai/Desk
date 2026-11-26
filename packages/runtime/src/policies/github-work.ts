/** GitHub work from the local connector index. */
import type { BridgeClient, TaskItem, TaskStatus } from "@endue-ai/bridge";
import type { Commands } from "../commands";

const SOURCE = "desk.github";
const KINDS = ["issue", "pull-request"] as const;
type WorkKind = (typeof KINDS)[number];
interface WorkQuery {
  kind?: WorkKind;
  repo?: string;
  status?: TaskStatus;
  limit?: number;
}

function kindOf(item: TaskItem): WorkKind {
  if (item.raw?.pull_request || /\/pull\/\d+(?:[?#]|$)/u.test(item.deepLink ?? ""))
    return "pull-request";
  return "issue";
}

const summarize = (item: TaskItem, kind: WorkKind) => ({
  id: item.id,
  source: item.source.instance,
  kind,
  title: item.title,
  repo: item.project ?? null,
  status: item.status,
  updatedAt: item.updatedAt,
  url: item.deepLink ?? null,
});

async function work(bridge: BridgeClient, args: WorkQuery) {
  const limit = args.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Use a limit from 1 to 200.");
  const repo = args.repo?.trim().toLowerCase();
  const rows: ReturnType<typeof summarize>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bridge.call("data.query", {
      scope: { permission: "data:read", kinds: ["task"], sources: [SOURCE] },
      query: {
        kinds: ["task"],
        sources: [SOURCE],
        limit: 200,
        sort: [{ field: "updatedAt", dir: "desc" }],
        ...(args.status ? { where: [{ field: "status", op: "eq", value: args.status }] } : {}),
        ...(cursor ? { cursor } : {}),
      },
    });
    for (const item of page.items) {
      if (item.kind !== "task" || item.source.connector !== SOURCE) continue;
      if (args.status && item.status !== args.status) continue;
      if (repo && item.project?.toLowerCase() !== repo) continue;
      const kind = kindOf(item);
      if (args.kind && kind !== args.kind) continue;
      if (rows.length === limit) return { work: rows, more: true };
      rows.push(summarize(item, kind));
    }
    cursor = page.cursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error("Could not advance through the GitHub index.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { work: rows, more: false };
}

export function installGithubWork(commands: Commands, bridge: BridgeClient): void {
  commands.define("endue.github.work", {
    owner: SOURCE,
    title: "Read synced GitHub work",
    agent: {
      description:
        "Read the enabled GitHub connector's local index of assigned issues and pull requests, including review requests. Optionally filter by issue or pull-request, repository owner/name, or task status.",
      readOnly: true,
      args: {
        type: "object",
        properties: {
          kind: { type: "string", enum: KINDS },
          repo: { type: "string", minLength: 1, maxLength: 256 },
          status: { type: "string", enum: ["open", "done", "cancelled"] },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
    },
    run: (args) => work(bridge, (args ?? {}) as WorkQuery),
  });
}
