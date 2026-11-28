import { describe, expect, it } from "vitest";
import { buildGraph } from "../ui/graph.js";
import { indexNote, noteFor, noteName, noteworthy } from "../ui/notes.js";
import { sample, session } from "./fixtures";

describe("notes", () => {
  const graph = buildGraph(sample(), { hub: 20 });

  it("writes a ticket's note: front matter, sessions, files, links to other notes", () => {
    const note = noteFor(graph, "ticket:ACME-2001");
    expect(note?.path).toBe("~/.desk/knowledge/ACME-2001.md");
    const md = note?.markdown ?? "";
    expect(md).toContain('kind: ticket\nkey: "ACME-2001"\nsessions: 2\nclaude: 1\ncodex: 1');
    expect(md).toContain("# ACME-2001");
    expect(md).toContain(
      "- 2026-11-04 · Codex · [Review the explorer](file:///home/me/.claude/projects/x/b.jsonl)",
    );
    expect(md).toContain("`~/work/desk/plugins/explorer/ui/tree.js` (file) · 2 sessions");
    expect(md).toContain("[[pr-github.com-example-desk-9001|desk#9001]]");
    expect(noteFor(graph, "ticket:ACME-2001")?.markdown).toBe(md);
  });

  it("names notes safely and keeps titles from breaking Markdown", () => {
    const pr = graph.entities.get("pr:github.com/example/desk#9001");
    expect(pr && noteName(pr)).toBe("pr-github.com-example-desk-9001");
    const weird = buildGraph([
      session("claude:z", "[evil](javascript:x) | ok", [
        { kind: "ticket", key: "ACME-9", rel: "on", where: "branch" },
      ]),
    ]);
    const md = noteFor(weird, "ticket:ACME-9")?.markdown ?? "";
    expect(md).not.toContain("[evil]");
    expect(
      noteName({
        id: "x",
        kind: "memory",
        key: "~/../../etc/passwd",
        label: "",
        sessions: new Set(),
        df: 1,
        idf: 1,
        hub: false,
      }),
    ).toBe("memory-etc-passwd");
  });

  it("notes a session and indexes the noteworthy things", () => {
    expect(noteFor(graph, "codex:b")?.markdown).toContain("## Touched");
    const noted = noteworthy(graph);
    expect(
      noted.every((e) =>
        ["ticket", "requirement", "pr", "issue", "adr", "memory"].includes(e.kind),
      ),
    ).toBe(true);
    const index = indexNote(graph, noted).markdown;
    expect(index).toContain("## Tickets\n\n- [[ACME-2001|ACME-2001]] · 2 sessions");
    expect(noteFor(graph, "nothing")).toBeUndefined();
  });
});
