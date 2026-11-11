import { describe, expect, it } from "vitest";
import { type ErrorCode, StubError } from "../../../packages/bridge/src/index";
import {
  agentChips,
  board,
  bucketOf,
  emptyText,
  endueRows,
  filterCards,
  localRows,
  sourceChips,
  statusChips,
} from "../ui/home.js";
import { conversationOf } from "../ui/studio-api.js";
import { endueConversations, localSessions, NOW, run } from "./fixtures";
import { mount, pick } from "./harness";

const ALL = { source: "all", status: "all", query: "" } as const;
const names = (list: Array<{ name: string }>) => list.map((c) => c.name);

describe("the Home", () => {
  it("filters the cards by source and status, and searches their names, roles and handles", async () => {
    const { home } = await mount();
    const { cards } = home();
    expect(names(cards)).toEqual(["Miso", "Claude Code", "Ria", "Codex"]);
    expect(names(filterCards(cards, { ...ALL, source: "endue" }))).toEqual(["Miso", "Ria"]);
    expect(names(filterCards(cards, { ...ALL, source: "local" }))).toEqual([
      "Claude Code",
      "Codex",
    ]);
    expect(names(filterCards(cards, { ...ALL, status: "offline" }))).toEqual(["Codex"]);
    // Every word must match, in any case, anywhere in the name, role, handle, badge or status.
    expect(names(filterCards(cards, { ...ALL, query: "MISO" }))).toEqual(["Miso"]);
    expect(names(filterCards(cards, { ...ALL, query: "anthropic computer" }))).toEqual([
      "Claude Code",
    ]);
    expect(names(filterCards(cards, { ...ALL, query: "@ria" }))).toEqual(["Ria"]);
    expect(names(filterCards(cards, { ...ALL, query: "local offline" }))).toEqual(["Codex"]);
    expect(filterCards(cards, { ...ALL, query: "nobody here" })).toEqual([]);

    // Each chip counts what it would show under the other filters.
    expect(sourceChips(cards, ALL).map((c) => [c.id, c.count])).toEqual([
      ["all", 4],
      ["endue", 2],
      ["local", 2],
    ]);
    expect(statusChips(cards, { ...ALL, source: "local" }).map((c) => [c.id, c.count])).toEqual([
      ["all", 2],
      ["online", 1],
      ["offline", 1],
    ]);
  });

  it("the controller's filters and search reach the view", async () => {
    const { app, home } = await mount();
    app.filter({ source: "local", query: "codex" });
    expect(home().cards.map((c) => c.key)).toEqual(["local:codex"]);
    expect(home().filters).toEqual({ source: "local", status: "all", query: "codex" });
    app.filter({ source: "all", query: "" });
    expect(home().cards).toHaveLength(4);
  });

  it("builds Waiting, Active, Failed and Done from endue conversations and local sessions and runs", async () => {
    const { home } = await mount();
    const { cards } = home();
    const endue = endueRows(endueConversations().map(conversationOf), cards);
    const sessions = localSessions();
    const going = run({ sessionId: sessions.claude?.[0]?.id });
    const failed = run({
      runId: "run-3",
      agent: "codex",
      sessionId: sessions.codex?.[0]?.id,
      state: "failed",
      error: "codex exited 1",
      startedAt: "2026-11-06T18:00:00.000Z",
      endedAt: "2026-11-06T18:01:00.000Z",
    });
    const fresh = run({
      runId: "run-8",
      prompt: "Write the changelog",
      state: "done",
      text: "Done.",
      endedAt: "2026-11-07T08:40:00.000Z",
    });
    const local = localRows(sessions, [going, fresh, failed], cards);
    const columns = board([...endue, ...local], [], NOW);
    const column = (at: number) => pick(columns, at);
    const titles = (at: number) => column(at).rows.map((r) => r.title);

    expect(columns.map((c) => [c.id, c.label, c.count])).toEqual([
      ["waiting", "Waiting", 1],
      ["active", "Active", 2],
      ["failed", "Failed", 2],
      ["done", "Done", 3],
    ]);
    expect(titles(0)).toEqual(["Lunch with Joon"]);
    // A session's time is its last run's when that is newer.
    expect(titles(1)).toEqual(["Fix the flaky upload test", "Plan next week"]);
    expect(titles(2)).toEqual(["Rename the crate", "Refund for order 1182"]);
    expect(titles(3)).toEqual(["Write the changelog", "Explain the bridge", "Weekly report"]);
    expect(column(0).attention).toBe(true);
    expect(column(1).attention).toBe(false);

    expect(pick(column(1).rows, 0)).toMatchObject({
      source: "local",
      runId: "run-7",
      sessionId: sessions.claude?.[0]?.id,
      at: "2026-11-07T08:59:00.000Z",
    });
    expect(pick(column(1).rows, 1)).toMatchObject({
      source: "endue",
      preview: "Using calendar.search",
      count: 4,
      conversationId: "cnv_run",
    });
    expect(pick(column(2).rows, 0).preview).toBe("Failed: codex exited 1");
    expect(pick(column(2).rows, 1).preview).toBe("Failed: MODEL_UNAVAILABLE");
    // Done is grouped by day.
    expect(column(3).groups?.map((g) => [g.label, g.rows.length])).toEqual([
      ["Today", 1],
      ["This week", 1],
      ["Earlier", 1],
    ]);

    // Agent chips keep only the agents chosen; none chosen keeps all.
    const chips = agentChips([...endue, ...local], cards);
    expect(chips.map((c) => [c.id, c.count])).toEqual([
      ["endue:ag_miso", 3],
      ["local:claude", 3],
      ["endue:ag_ria", 1],
      ["local:codex", 1],
    ]);
    const onlyRia = board([...endue, ...local], ["endue:ag_ria"], NOW);
    expect(onlyRia.map((c) => c.count)).toEqual([0, 0, 1, 0]);
  });

  it("the controller reads every running and waiting conversation, and toggles agent chips", async () => {
    const { app, home, params } = await mount();
    expect(params("studio.conversations.list")).toEqual([
      { limit: 50, scope: { permission: "studio:manage" } },
      { limit: 50, running: true, scope: { permission: "studio:manage" } },
      { limit: 50, awaitingInput: true, scope: { permission: "studio:manage" } },
    ]);
    expect(home().board.map((c) => c.count)).toEqual([1, 1, 1, 4]);
    app.boardAgent("endue:ag_miso");
    expect(home().boardAgents).toEqual(["endue:ag_miso"]);
    expect(home().board.map((c) => c.count)).toEqual([1, 1, 0, 1]);
    app.boardAgent("endue:ag_miso");
    expect(home().boardAgents).toEqual([]);
    expect(bucketOf("2026-11-07T08:59:00.000Z", NOW)).toBe("Today");
  });

  it("says why the endue side is empty: signed out, offline, or a desk without studio.*", async () => {
    // ErrorCode gains signed_out and offline with #547; the stub passes any code through.
    const refuse = (code: string, message: string) => ({
      "studio.agents.list": () => {
        throw new StubError(code as ErrorCode, message);
      },
    });

    const signedOut = await mount({
      studio: refuse("signed_out", "Sign in to endue to manage your agents."),
    });
    expect(signedOut.last().sides.endue).toEqual({
      state: "signed-out",
      text: "Sign in to see your endue agents.",
      action: "sign-in",
    });
    // The local side still shows its cards.
    expect(names(signedOut.home().cards)).toEqual(["Claude Code", "Codex"]);

    const offline = await mount({
      studio: refuse("offline", "endue AI did not answer within 15 s."),
    });
    expect(offline.last().sides.endue).toMatchObject({ state: "offline", action: "retry" });
    expect(offline.last().sides.endue.text).toContain("did not answer within 15 s.");

    const none = await mount({ studio: refuse("unsupported", "studio.agents.list is not served") });
    expect(none.last().sides.endue).toEqual({
      state: "unavailable",
      text: "This desk does not reach endue agents yet.",
    });
  });

  it("an empty grid says why: a search is asked to be cleared, a chip with no agent is not", async () => {
    const signedOut = await mount({
      studio: {
        "studio.agents.list": () => {
          throw new StubError("signed_out" as ErrorCode, "Sign in");
        },
      },
    });
    // The endue chip with nobody signed in: no search to clear.
    signedOut.app.filter({ source: "endue" });
    expect(signedOut.home().cards).toEqual([]);
    expect(signedOut.home().empty).toBe("Sign in to see your endue agents.");
    signedOut.app.filter({ source: "local", query: "gemini" });
    expect(signedOut.home().empty).toBe(
      "No agent matches “gemini”. Clear the search or pick another chip.",
    );

    const { home } = await mount();
    const { cards } = home();
    expect(emptyText([], ALL)).toBe(
      "No agents yet. Make an endue agent, or install Claude Code or Codex on this computer.",
    );
    expect(emptyText(cards, { ...ALL, source: "local", status: "paused" })).toBe(
      "No local agent is paused. Pick another chip.",
    );
    expect(emptyText(cards, { ...ALL, status: "waiting" })).toBe(
      "No agent needs you. Pick another chip.",
    );
    const local = cards.filter((c) => c.source === "local");
    expect(emptyText(local, { ...ALL, source: "endue" })).toBe(
      "You have no endue agents yet. Make your first one with New agent.",
    );
    expect(
      emptyText(
        cards.filter((c) => c.source === "endue"),
        { ...ALL, source: "local" },
      ),
    ).toBe(
      "No agent programs on this computer yet. Claude Code and Codex show here once installed.",
    );
    // Only a search is ever asked to be cleared.
    for (const filters of [
      { ...ALL, source: "endue" as const },
      { ...ALL, status: "paused" as const },
    ])
      expect(emptyText(local, filters)).not.toContain("Clear the search");
  });
});
