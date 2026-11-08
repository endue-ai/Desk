import { describe, expect, it } from "vitest";
import { ago, buildCards, endueCard, hueOf, localCard } from "../ui/cards.js";
import { foldRun } from "../ui/sides.js";
import { agentOf, conversationOf } from "../ui/studio-api.js";
import { endueAgents, endueConversations, localAgents, localSessions, NOW, run } from "./fixtures";
import { pick } from "./harness";

// The adapter's shapes, as studio-api.js hands them over; Miso's role came with her facets.
const endue = () =>
  endueAgents().map((a) => agentOf(a.id === "ag_miso" ? { ...a, role: "Keeps my calendar" } : a));
const conversations = () => endueConversations().map(conversationOf);

describe("one card model for endue and local agents", () => {
  it("gives an endue agent its source badge, role, handle and presence from its conversations", () => {
    const miso = pick(endue(), 0);
    const ria = pick(endue(), 1);
    expect(endueCard(miso, conversations())).toMatchObject({
      key: "endue:ag_miso",
      source: "endue",
      name: "Miso",
      role: "Keeps my calendar",
      handle: "@miso",
      badge: "endue",
      initial: "M",
      presence: "working",
      status: "Working · calendar.search",
      lastActivity: "2026-11-07T08:58:00Z",
      runnable: true,
    });
    // A disabled agent is paused whatever its conversations say, and has no role until read.
    expect(endueCard(ria, conversations())).toMatchObject({
      presence: "paused",
      status: "Paused",
      role: "",
      runnable: false,
    });
    // Waiting for the person, with no run going on.
    const waiting = conversations().filter((c) => c.id === "cnv_wait");
    expect(endueCard(miso, waiting)).toMatchObject({ presence: "waiting", status: "Needs you" });
    // Archived by endue AI: offline.
    expect(endueCard(agentOf({ ...miso, status: "archived" }), [])).toMatchObject({
      presence: "offline",
    });
  });

  it("gives a local agent the Local badge, its vendor and whether the desk can ask it", () => {
    const claude = pick(localAgents(), 0);
    const codex = pick(localAgents(), 1);
    expect(localCard(claude, { lastSession: "2026-11-07T08:30:00.000Z" })).toMatchObject({
      key: "local:claude",
      source: "local",
      name: "Claude Code",
      role: "Anthropic · on this computer",
      handle: "/opt/homebrew/bin/claude",
      badge: "Local",
      presence: "online",
      status: "Online · 2.1.3",
      lastActivity: "2026-11-07T08:30:00.000Z",
      runnable: true,
    });
    // Codex's sessions are there but its program is not: offline, read only.
    expect(localCard(codex)).toMatchObject({
      presence: "offline",
      status: "Offline · program not found",
      runnable: false,
    });
    // A run going on makes it work, however the core's count lags.
    expect(localCard(claude, { runs: [run()] })).toMatchObject({
      presence: "working",
      status: "Working · 1 run",
    });
  });

  it("sorts working first, then waiting, online, paused and offline, then the most recent, then by name", () => {
    const sessions = localSessions();
    const cards = buildCards({
      endue: [...endue(), agentOf({ id: "ag_bora", slug: "bora", name: "Bora", status: "active" })],
      conversations: conversations().filter((c) => c.id !== "cnv_run"),
      local: localAgents(),
      runs: [],
      lastSessions: {
        claude: sessions.claude?.[0]?.updatedAt,
        codex: sessions.codex?.[0]?.updatedAt,
      },
    });
    expect(cards.map((c) => [c.name, c.presence])).toEqual([
      ["Miso", "waiting"],
      ["Claude Code", "online"],
      ["Bora", "online"],
      ["Ria", "paused"],
      ["Codex", "offline"],
    ]);
    // Keys never collide across the sources.
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });

  it("keeps an agent's colour and says the last activity for people", () => {
    expect(hueOf("ag_miso")).toBe(hueOf("ag_miso"));
    expect(hueOf("ag_miso")).toBeGreaterThanOrEqual(1);
    expect(hueOf("ag_miso")).toBeLessThanOrEqual(8);
    expect(ago("2026-11-07T08:59:40.000Z", NOW)).toBe("just now");
    expect(ago("2026-11-07T08:30:00.000Z", NOW)).toBe("30 min ago");
    expect(ago("2026-11-07T06:00:00.000Z", NOW)).toBe("3 h ago");
    expect(ago("2026-11-05T09:00:00.000Z", NOW)).toBe("2 d ago");
    expect(ago(undefined, NOW)).toBe("");
  });

  it("folds each agents.run step into the runs, as the core keeps them", () => {
    let runs = foldRun([], { runId: "run-7", agent: "claude", kind: "started", run: run() });
    runs = foldRun(runs, { runId: "run-7", agent: "claude", kind: "text", text: "First" });
    runs = foldRun(runs, { runId: "run-7", agent: "claude", kind: "tool", tool: "Read" });
    runs = foldRun(runs, {
      runId: "run-7",
      agent: "claude",
      kind: "text",
      text: "Second",
      sessionId: "s-1",
    });
    expect(runs[0]).toMatchObject({
      text: "First\n\nSecond",
      tools: 1,
      sessionId: "s-1",
      state: "running",
    });
    // A step of a run nobody started here waits for its start.
    expect(foldRun(runs, { runId: "run-9", agent: "codex", kind: "text", text: "x" })).toBe(runs);
    const done = run({ state: "done", text: "All of it", endedAt: "2026-11-07T09:01:00.000Z" });
    runs = foldRun(runs, { runId: "run-7", agent: "claude", kind: "done", run: done });
    expect(runs).toEqual([done]);
  });
});
