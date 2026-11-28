// Agent-session items as desk.agent-sessions writes them (specs/item/v0/agent-session.schema.json),
// made up: two tickets worked by Claude Code and Codex, a subagent, requirement IDs,
// acceptance criteria and a branch every session shares.
import type {
  AgentSessionFields,
  AgentSessionLink,
  RecordItem,
} from "../../../packages/bridge/src/index";

export const SCHEMA = "https://endue.ai/specs/item/v0/agent-session.schema.json";
export const SOURCE = { connector: "desk.agent-sessions", instance: "default" } as const;

type Link = Omit<AgentSessionLink, "count"> & { count?: number };

export function session(
  id: string,
  title: string,
  links: Link[],
  extra: Partial<AgentSessionFields> & { day?: number; body?: string } = {},
): RecordItem {
  const [agent, sessionId] = id.split(":") as [AgentSessionFields["agent"], string];
  const day = String(extra.day ?? 1).padStart(2, "0");
  const { day: _day, body, ...fields } = extra;
  return {
    id,
    source: { ...SOURCE },
    kind: "record",
    title,
    updatedAt: `2026-11-${day}T10:00:00Z`,
    createdAt: `2026-11-${day}T09:00:00Z`,
    deepLink: `file:///home/me/.claude/projects/x/${sessionId}.jsonl`,
    body: body ?? `${title}\n\n---\n\nDone.`,
    schema: SCHEMA,
    fields: {
      agent,
      sessionId,
      subagent: false,
      file: `~/.claude/projects/x/${sessionId}.jsonl`,
      startedAt: `2026-11-${day}T09:00:00Z`,
      repo: "~/work/desk",
      turns: 2,
      links: links.map((l) => ({ count: 1, ...l })),
      ...fields,
    } as unknown as Record<string, unknown>,
  };
}

const TREE = "~/work/desk/plugins/explorer/ui/tree.js";
const MAIN = "~/work/desk/plugins/explorer/ui/main.js";
const repo: Link = { kind: "repo", key: "~/work/desk", rel: "in" };
const main: Link = { kind: "branch", key: "~/work/desk@main", rel: "on" };

/** 24 sessions: enough for hubs (the repository and the main branch are on every one). */
export function sample(): RecordItem[] {
  const items = [
    session(
      "claude:a",
      "Explorer icons",
      [
        repo,
        main,
        { kind: "ticket", key: "ACME-2001", rel: "on", where: "branch" },
        { kind: "ticket", key: "ACME-2001", rel: "mentioned", where: "prompt" },
        { kind: "file", key: TREE, rel: "edited", count: 4 },
        { kind: "pr", key: "github.com/example/desk#9001", rel: "opened" },
        { kind: "ticket", key: "AC-1", rel: "mentioned", where: "prompt" },
        { kind: "ticket", key: "RQ-09", rel: "mentioned", where: "answer" },
      ],
      { branch: "feat/ACME-2001-icons", day: 3 },
    ),
    session(
      "claude:a1",
      "Check the icon set",
      [repo, main, { kind: "file", key: TREE, rel: "read" }],
      { subagent: true, parent: "claude:a", day: 3 },
    ),
    session(
      "codex:b",
      "Review the explorer",
      [
        repo,
        main,
        { kind: "ticket", key: "ACME-2001", rel: "mentioned", where: "prompt" },
        { kind: "file", key: TREE, rel: "edited" },
        { kind: "file", key: MAIN, rel: "edited" },
        { kind: "adr", key: "ADR-0088@~/work/desk", rel: "cites", where: "answer" },
      ],
      { day: 4 },
    ),
    session(
      "claude:c",
      "Updater channel",
      [
        repo,
        main,
        { kind: "ticket", key: "ACME-2002", rel: "mentioned", where: "prompt" },
        { kind: "file", key: MAIN, rel: "read" },
        { kind: "memory", key: "~/.claude/projects/-work-desk/memory/updater.md", rel: "wrote" },
      ],
      { day: 5 },
    ),
  ];
  for (let i = 0; i < 20; i++)
    items.push(
      session(
        `claude:filler-${i}`,
        `Chore ${i}`,
        [repo, main, { kind: "file", key: `~/work/desk/f${i}.js`, rel: "edited" }],
        { day: 6 },
      ),
    );
  return items;
}
