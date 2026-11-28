import { describe, expect, it } from "vitest";
import { buildGraph, labelOf, repositories } from "../ui/graph.js";
import { DEFAULTS } from "../ui/kinds.js";
import { alike, around, resolve, search, sessionsOf, together, visible } from "../ui/query.js";
import { sample, session } from "./fixtures";

const filters = (over = {}) => ({
  agents: { claude: true, codex: true, hermes: true },
  kinds: {},
  subagents: true,
  orphans: false,
  shared: DEFAULTS.shared,
  repo: "",
  ...over,
});

/** A hub here is on more than a fifth of the 24 sessions: the repository and the main branch. */
const HUB = { hub: 20 };

describe("buildGraph", () => {
  const graph = buildGraph(sample(), HUB);

  it("keeps sessions of the agent-session schema and links them to what they touched", () => {
    const other = {
      ...sample()[0],
      id: "other",
      schema: "https://schemas.example.com/deploy.json",
    };
    expect(buildGraph([...sample(), other]).n).toBe(24);
    expect(graph.n).toBe(24);
    expect(
      [
        ...(graph.entities.get("file:~/work/desk/plugins/explorer/ui/tree.js")?.sessions ?? []),
      ].sort(),
    ).toEqual(["claude:a", "claude:a1", "codex:b"]);
    expect(graph.sessions.get("claude:a")?.children).toEqual(["claude:a1"]);
  });

  it("tells project tickets (seen in branch names) from requirement IDs and drops ignored prefixes", () => {
    expect(graph.projects).toEqual(new Set(["ACME"]));
    expect(graph.entities.get("ticket:ACME-2001")?.df).toBe(2);
    expect(graph.entities.get("ticket:ACME-2002")?.kind).toBe("ticket");
    expect(graph.entities.get("requirement:RQ-09")?.kind).toBe("requirement");
    expect([...graph.entities.keys()].some((id) => id.includes("AC-1"))).toBe(false);
    expect(buildGraph(sample(), { ignore: "" }).entities.has("requirement:AC-1")).toBe(true);
    expect(buildGraph(sample()).entities.get("ticket:ACME-2001")?.hub).toBe(true);
  });

  it("weighs a link by its relation and where a mention was, keeping the strongest", () => {
    const a = graph.sessions.get("claude:a");
    const ticket = a?.links.find((l) => l.entity === "ticket:ACME-2001");
    expect(ticket?.w).toBe(0.9);
    expect(a?.links.find((l) => l.entity.startsWith("pr:"))?.w).toBe(1);
  });

  it("makes the repository and the branch every session shares hubs, rare things not", () => {
    expect(graph.entities.get("repo:~/work/desk")?.hub).toBe(true);
    expect(graph.entities.get("branch:~/work/desk@main")?.hub).toBe(true);
    expect(graph.entities.get("ticket:ACME-2001")?.hub).toBe(false);
    const rare = graph.entities.get("ticket:ACME-2002");
    const common = graph.entities.get("ticket:ACME-2001");
    expect(rare && common && rare.idf > common.idf).toBe(true);
    expect(buildGraph(sample().slice(0, 4)).entities.get("repo:~/work/desk")?.hub).toBe(false);
  });

  it("labels things the way a person names them", () => {
    expect(labelOf("file", "~/work/desk/plugins/a.js")).toBe("a.js");
    expect(labelOf("pr", "git.example.com/group/sub/repo#12")).toBe("repo#12");
    expect(labelOf("adr", "ADR-0088@~/work/desk")).toBe("ADR 0088 · desk");
    expect(labelOf("branch", "~/work/desk@feat/x")).toBe("feat/x");
    expect(labelOf("memory", "~/.claude/projects/p/memory/git.md")).toBe("git");
    expect(repositories(graph)).toEqual([{ key: "~/work/desk", label: "desk", sessions: 24 }]);
  });
});

describe("queries", () => {
  const graph = buildGraph(sample(), HUB);

  it("draws things shared by enough sessions, never hubs, and a subagent's edge to its parent", () => {
    const drawn = visible(graph, filters());
    expect(drawn.nodes.has("ticket:ACME-2001")).toBe(true);
    expect(drawn.nodes.has("ticket:ACME-2002")).toBe(false);
    expect(drawn.nodes.has("branch:~/work/desk@main")).toBe(false);
    expect(drawn.nodes.has("claude:filler-1")).toBe(false);
    expect(drawn.edges).toContainEqual(["claude:a1", "claude:a", true]);
    const one = visible(graph, filters({ shared: 1, orphans: true }));
    expect(one.nodes.has("ticket:ACME-2002") && one.nodes.has("claude:filler-1")).toBe(true);
    const codexOnly = visible(graph, filters({ agents: { claude: false, codex: true } }));
    expect([...codexOnly.nodes].every((id) => !id.startsWith("claude:"))).toBe(true);
  });

  it("finds what lies around a node", () => {
    const drawn = visible(graph, filters());
    const near = around(drawn, "ticket:ACME-2001", 1);
    expect([...near.nodes].sort()).toEqual(["claude:a", "codex:b", "ticket:ACME-2001"]);
  });

  it("ranks what came up together by link weight and rarity", () => {
    const top = together(graph, "ticket:ACME-2001").map((t) => t.entity.id);
    expect(top.slice(0, 2)).toEqual([
      "file:~/work/desk/plugins/explorer/ui/tree.js",
      "pr:github.com/example/desk#9001",
    ]);
    expect(top).not.toContain("repo:~/work/desk");
    expect(sessionsOf(graph, "ticket:ACME-2001").map((s) => s.id)).toEqual(["codex:b", "claude:a"]);
  });

  it("finds sessions alike through the rare things they share", () => {
    const like = alike(graph, "codex:b").map((s) => s.session.id);
    expect(like[0]).toBe("claude:a");
    expect(like).not.toContain("claude:filler-1");
  });

  it("resolves keys, ids, session ids and the ends of paths", () => {
    expect(resolve(graph, "acme-2001")).toBe("ticket:ACME-2001");
    expect(resolve(graph, "plugins/explorer/ui/tree.js")).toBe(
      "file:~/work/desk/plugins/explorer/ui/tree.js",
    );
    expect(resolve(graph, "b")).toBe("codex:b");
    expect(resolve(graph, "tree.js")).toBeUndefined();
  });

  it("searches names, an exact key first", () => {
    const found = search(graph, "acme-2001");
    expect(found.entities[0]?.id).toBe("ticket:ACME-2001");
    expect(
      search(graph, "explorer", { kinds: ["session"] })
        .sessions.map((s) => s.id)
        .sort(),
    ).toEqual(["claude:a", "codex:b"]);
    expect(search(graph, "explorer", { kinds: ["file"] }).sessions).toEqual([]);
  });

  it("leaves out a parent that is filtered away", () => {
    const g = buildGraph([session("claude:x", "x", [], { subagent: true, parent: "codex:gone" })]);
    expect(visible(g, filters({ orphans: true })).edges).toEqual([]);
  });
});
