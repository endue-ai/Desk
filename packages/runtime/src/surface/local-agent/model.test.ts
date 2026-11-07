import type { LocalAgent, LocalAgentRun } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { localText } from "./copy";
import { ago, folderOf, importLine, programLine, runsOf, tabCount, tabLabel } from "./model";

const CLAUDE: LocalAgent = {
  id: "claude",
  name: "Claude Code",
  vendor: "Anthropic",
  sessions: 12,
  archived: 3,
  imported: 2,
  running: 0,
};
const NOW = Date.parse("2026-11-05T10:00:00Z");

describe("a local agent's screen, without the DOM", () => {
  it("counts each tab from the agent", () => {
    expect([
      tabCount(CLAUDE, "local"),
      tabCount(CLAUDE, "archive"),
      tabCount(CLAUDE, "desk"),
    ]).toEqual([12, 3, 2]);
    expect(tabCount(undefined, "local")).toBe(0);
    expect(tabLabel("ko", CLAUDE, "archive")).toBe("아카이브 3");
  });

  it("shows a folder by its last two parts, on any system", () => {
    expect(folderOf("/Users/you/work/atlas")).toBe("work/atlas");
    expect(folderOf("C:\\Users\\you\\code\\lumen")).toBe("code/lumen");
    expect(folderOf(undefined)).toBe("");
  });

  it("says how long ago", () => {
    expect(ago("en", "2026-11-05T09:59:40Z", NOW)).toBe("just now");
    expect(ago("en", "2026-11-05T09:48:00Z", NOW)).toBe("12 min ago");
    expect(ago("ko", "2026-11-05T07:00:00Z", NOW)).toBe("3시간 전");
    expect(ago("en", "2026-11-01T10:00:00Z", NOW)).toBe("4 d ago");
    expect(ago("en", "not a time", NOW)).toBe("");
  });

  it("says where the program runs from, or that the desk only reads its sessions", () => {
    expect(
      programLine("en", { ...CLAUDE, program: "/usr/local/bin/claude", version: "2.4.1" }),
    ).toBe("Anthropic · v2.4.1 · /usr/local/bin/claude");
    expect(programLine("en", CLAUDE)).toBe(`Anthropic · ${localText("en", "noProgram")}`);
  });

  it("says what an import did", () => {
    expect(importLine("en", { imported: 3, unchanged: 1, failed: 0 })).toBe(
      "Imported 3 into the desk · 1 already up to date",
    );
    expect(importLine("ko", { imported: 0, unchanged: 2, failed: 1 })).toBe(
      "0개를 데스크로 가져왔습니다 · 2개는 그대로입니다 · 1개는 읽지 못했습니다",
    );
  });

  it("puts the runs going on before the ones that ended", () => {
    const run = (runId: string, state: LocalAgentRun["state"], agent = "claude") =>
      ({ runId, state, agent }) as LocalAgentRun;
    const runs = [run("run-3", "done"), run("run-2", "running"), run("run-1", "running", "codex")];
    expect(runsOf(runs, "claude").map((r) => r.runId)).toEqual(["run-2", "run-3"]);
  });
});
