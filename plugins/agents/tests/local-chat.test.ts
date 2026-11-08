import { describe, expect, it } from "vitest";
import { type LocalAgentRunData, StubError } from "../../../packages/bridge/src/index";
import type { TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { localSessions, run } from "./fixtures";
import { mount, settle } from "./harness";

const AGENTS = { permission: "agents:manage" };
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
});
