import { describe, expect, it } from "vitest";
import { type LocalAgentRunData, StubError } from "../../../packages/bridge/src/index";
import type { TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { chatTurns } from "../ui/view-chat.js";
import { localSessions, run, transcript } from "./fixtures";
import { localHandlers, mount, settle } from "./harness";

const AGENTS = { permission: "agents:manage" };
const names = (list: Array<{ name: string }>) => list.map((c) => c.name);
const SESSION = localSessions().claude?.[0]?.id ?? "";

/** One step of a run, as the core sends it to holders of agents:manage. */
const step = (host: TestHost, data: Partial<LocalAgentRunData> & Pick<LocalAgentRunData, "kind">) =>
  host.emit({ event: "agents.run", data: { runId: "run-7", agent: "claude", ...data } });

describe("chatting with a local agent", () => {
  it("reads a session's history from agents.transcript, and the next message resumes it", async () => {
    const { app, host, chat, params } = await mount();
    app.studio("local:claude");
    await app.chat("claude").open(SESSION);
    await settle(host);
    expect(params("agents.transcript")).toEqual([
      { agent: "claude", sessionId: SESSION, limit: 200, scope: AGENTS },
    ]);
    expect(chat()).toMatchObject({
      sessionId: SESSION,
      title: "Fix the flaky upload test",
      phase: "idle",
    });
    expect(chat().messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Why does the upload test fail now and then?"],
      ["tool", "Read"],
      ["assistant", "It races the clock: the timeout is 10 ms."],
    ]);

    await app.chat("claude").send("Make it wait for the upload instead");
    await settle(host);
    expect(params("agents.ask")).toEqual([
      {
        agent: "claude",
        prompt: "Make it wait for the upload instead",
        access: "read-only",
        sessionId: SESSION,
        scope: AGENTS,
      },
    ]);
  });

  it("builds the reply from the run's streamed agents.run steps, and the end closes it", async () => {
    const { app, host, chat, params } = await mount();
    app.studio("local:claude");
    await app.chat("claude").send("Explain the bridge");
    await settle(host);
    // A new session: no sessionId, and the home folder is not sent as cwd.
    expect(params("agents.ask")).toEqual([
      { agent: "claude", prompt: "Explain the bridge", access: "read-only", scope: AGENTS },
    ]);
    expect(chat()).toMatchObject({ phase: "running", runId: "run-7" });
    step(host, { kind: "started", run: run({ prompt: "Explain the bridge" }) });
    step(host, { kind: "text", text: "The bridge carries", sessionId: "s-new" });
    step(host, { kind: "tool", tool: "Read", detail: "specs/bridge/v0" });
    step(host, { kind: "text", text: "every call." });
    // Another agent's steps and another run's steps are not this chat's.
    step(host, { agent: "codex", kind: "text", text: "no" });
    step(host, { runId: "run-9", kind: "text", text: "no" });
    await settle(host);
    expect(chat().messages.at(-1)).toMatchObject({
      role: "assistant",
      state: "streaming",
      text: "The bridge carries\n\nevery call.",
      tools: [{ name: "Read", detail: "specs/bridge/v0" }],
    });
    const done = run({
      state: "done",
      text: "The bridge carries\n\nevery call.",
      sessionId: "s-new",
    });
    step(host, { kind: "done", run: done });
    await settle(host);
    expect(chat().messages.at(-1)?.state).toBe("done");
    expect(chat()).toMatchObject({ phase: "idle", sessionId: "s-new" });
    expect(chat().runId).toBeUndefined();
    // The run's end reads the agent's sessions again: the new one shows in Sessions.
    expect(params("agents.sessions").length).toBeGreaterThan(2);
  });

  it("keeps the steps that arrive before agents.ask answers", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const { app, host, chat } = await mount({
      local: {
        "agents.ask": async ({ prompt }) => {
          await gate;
          return { run: run({ prompt }) };
        },
      },
    });
    app.studio("local:claude");
    const sent = app.chat("claude").send("Quick one");
    // agents.ask has not answered: settle would wait for it, so let a few ticks pass instead.
    const ticks = () => new Promise((done) => setTimeout(done, 5));
    await ticks();
    step(host, { kind: "text", text: "Early words" });
    await ticks();
    expect(chat().phase).toBe("sending");
    release();
    await sent;
    await settle(host);
    expect(chat().messages.at(-1)).toMatchObject({ text: "Early words", state: "streaming" });
  });

  it("keeps the final answer after a tool even when only the terminal event carries it", async () => {
    const { app, host, chat } = await mount();
    app.studio("local:claude");
    await app.chat("claude").send("Check the heading");
    step(host, { kind: "tool", tool: "Read", detail: "outline.txt" });
    step(host, { kind: "done", run: run({ state: "done", text: "The heading is ready." }) });
    await settle(host);
    expect(chat().messages.at(-1)?.parts).toEqual([
      { role: "tool", name: "Read", text: "outline.txt" },
      { role: "assistant", text: "The heading is ready." },
    ]);
  });

  it("Stop ends the run through agents.stop", async () => {
    const { app, host, chat, params } = await mount();
    app.studio("local:claude");
    await app.chat("claude").send("Run every test");
    await settle(host);
    await app.chat("claude").stop();
    await settle(host);
    expect(params("agents.stop")).toEqual([{ runId: "run-7", scope: AGENTS }]);
    expect(chat()).toMatchObject({ phase: "idle" });
    expect(chat().messages.at(-1)?.state).toBe("stopped");
  });

  it("replays the selected run's steps and completion while opening its history", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = localSessions().claude![0]!;
    const current = run({ sessionId: session.id, text: "First line" });
    const { app, host, chat } = await mount({
      local: {
        "agents.transcript": async () => {
          await wait;
          return { session, messages: transcript(), truncated: false };
        },
      },
    });
    app.studio("local:claude");
    const opening = app.chat("claude").open(session.id, current);
    step(host, { runId: "other", kind: "text", text: "Unrelated" });
    step(host, { kind: "tool", tool: "Read", detail: "outline.txt" });
    step(host, { kind: "text", text: "Last line" });
    step(host, {
      kind: "done",
      run: { ...current, state: "done", text: "First line\n\nLast line" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    await opening;
    await settle(host);
    expect(chat()).toMatchObject({ phase: "idle", outcome: "done" });
    expect(chat().runId).toBeUndefined();
    expect(chat().messages.at(-1)).toMatchObject({
      text: "First line\n\nLast line",
      parts: [
        { role: "assistant", text: "First line" },
        { role: "tool", name: "Read", text: "outline.txt" },
        { role: "assistant", text: "Last line" },
      ],
    });
  });

  it("cannot stop another agent's run with the same session identifier", async () => {
    const { app, host, chat, params } = await mount({
      local: { "agents.runs": () => ({ runs: [run({ agent: "codex", sessionId: SESSION })] }) },
    });
    app.studio("local:claude");
    app.local("claude", "open", { id: SESSION });
    await settle(host);
    expect(chat().phase).toBe("idle");
    await app.chat("claude").stop();
    expect(params("agents.stop")).toEqual([]);
  });

  it("shows the joined run once when the history file already contains its reply", async () => {
    const session = localSessions().claude![0]!;
    const current = run({
      sessionId: session.id,
      prompt: "Read the heading",
      text: "Heading ready",
    });
    const { app, chat } = await mount({
      local: {
        "agents.transcript": () => ({
          session,
          messages: [
            { role: "user", text: current.prompt, at: current.startedAt },
            { role: "assistant", text: current.text },
          ],
          truncated: false,
        }),
      },
    });
    app.studio("local:claude");
    await app.chat("claude").open(session.id, current);
    expect(chatTurns(chat().messages).map((m) => m.text)).toEqual([current.prompt, current.text]);
  });

  it("prepends older history without discarding a newly completed exchange", async () => {
    const session = localSessions().claude![0]!;
    const messages = Array.from({ length: 205 }, (_, i) => ({
      role: "user" as const,
      text: `Entry ${i}`,
    }));
    const { app, host, chat } = await mount({
      local: {
        "agents.transcript": ({ limit = 200 }) => ({
          session,
          messages: messages.slice(-limit),
          truncated: limit < messages.length,
        }),
      },
    });
    app.studio("local:claude");
    const current = app.chat("claude");
    await current.open(session.id);
    await current.send("Add one entry");
    step(host, {
      kind: "done",
      run: run({ sessionId: session.id, state: "done", text: "Entry added." }),
    });
    await settle(host);
    await current.older();
    expect(chat().messages[0]?.text).toBe("Entry 0");
    expect(
      chat()
        .messages.slice(-2)
        .map((m) => m.text),
    ).toEqual(["Add one entry", "Entry added."]);
    expect(chat().messages).toHaveLength(207);
  });

  it("a message that may change files waits for the person's yes (ADR 0099)", async () => {
    const refused = await mount({ answer: false });
    refused.app.studio("local:claude");
    const no = refused.app.chat("claude");
    no.setAccess("agent");
    no.setFolder("~/code/desk");
    expect(await no.send("Fix the test")).toBe(false);
    expect(refused.approvals).toEqual([
      { prompt: "Fix the test", folder: "~/code/desk", agent: "claude" },
    ]);
    expect(refused.methods("agents.ask")).toEqual([]);
    expect(refused.chat().error).toBe("Not sent: changes were not allowed.");

    const allowed = await mount({ answer: true });
    allowed.app.studio("local:claude");
    const yes = allowed.app.chat("claude");
    yes.setAccess("agent");
    yes.setFolder("~/code/desk");
    await yes.send("Fix the test");
    await settle(allowed.host);
    expect(allowed.params("agents.ask")).toEqual([
      {
        agent: "claude",
        prompt: "Fix the test",
        access: "agent",
        cwd: "~/code/desk",
        scope: AGENTS,
      },
    ]);
    // A read-only message goes without a question.
    step(allowed.host, { kind: "done", run: run({ state: "done", sessionId: "s-2" }) });
    await settle(allowed.host);
    yes.setAccess("read-only");
    expect(await yes.send("And explain it")).toBe(true);
    expect(allowed.approvals).toHaveLength(1);
  });

  it("asks for agents:manage once when it is refused, then tries again", async () => {
    let granted = false;
    const { last, params } = await mount({
      local: {
        "agents.list": () => {
          if (!granted) throw new StubError("permission_denied", "refused");
          return { agents: [] };
        },
        "perm.request": () => {
          granted = true;
          return { granted: true };
        },
      },
    });
    expect(params("perm.request")).toEqual([expect.objectContaining({ permission: AGENTS })]);
    expect(last().sides.local.state).toBe("ready");
  });

  it("one Allow once shows the local agents: the Home's other calls do not ask again", async () => {
    // As the core keeps an "Allow once": it allows the next call, then it is spent.
    let once = 0;
    const gate = <T>(answer: () => T) => {
      if (once === 0) throw new StubError("permission_denied", "refused");
      once--;
      return answer();
    };
    const fixtures = localHandlers() as Record<string, (params: never) => unknown>;
    const local = Object.fromEntries(
      ["agents.list", "agents.runs", "agents.sessions"].map((method) => [
        method,
        (params: never) => gate(() => fixtures[method]?.(params)),
      ]),
    );
    const m = await mount({
      local: {
        ...local,
        "perm.request": () => {
          once = 1;
          return {
            granted: true,
            grant: {
              grantId: "g-1",
              permission: { permission: "agents:manage" as const },
              duration: "once" as const,
              grantedAt: "2026-11-07T09:00:00Z",
            },
          };
        },
      },
    });
    expect(m.params("perm.request")).toHaveLength(1);
    expect(m.last().sides.local.state).toBe("ready");
    expect(names(m.home().cards.filter((c) => c.source === "local"))).toEqual([
      "Claude Code",
      "Codex",
    ]);
    // The person's next look (Refresh) asks again.
    await m.app.refresh();
    await settle(m.host);
    expect(m.params("perm.request")).toHaveLength(2);
  });
});

it("preserves a live turn when opening local Studio, including early tool and text order", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { app, host, chat } = await mount({
    local: {
      "agents.ask": async ({ prompt }) => {
        await gate;
        return { run: run({ prompt }) };
      },
    },
  });
  app.studio("local:claude");
  const sent = app.chat("claude").send("Review the outline");
  await new Promise((resolve) => setTimeout(resolve, 5));
  step(host, { kind: "tool", tool: "Read", detail: "outline.txt" });
  step(host, { kind: "text", text: "One heading is missing." });
  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  await sent;
  await settle(host);
  step(host, { kind: "done", run: run({ state: "done", text: "One heading is missing." }) });
  await settle(host);
  expect(chat().messages.at(-1)).toMatchObject({
    state: "done",
    parts: [
      { role: "tool", name: "Read", text: "outline.txt" },
      { role: "assistant", text: "One heading is missing." },
    ],
  });
});
