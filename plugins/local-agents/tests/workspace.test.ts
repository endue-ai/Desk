// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src";
import { AGENTS } from "../ui/catalog.js";
import { createView } from "../ui/view.js";
import { mount } from "./harness";

async function workspace(options: Parameters<typeof mount>[0] = {}) {
  const html = readFileSync(`${import.meta.dirname}/../ui/index.html`, "utf8");
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  let actions: Record<string, (...args: unknown[]) => unknown> = {};
  const view = createView(document, (action, ...args) => actions[action]?.(...args));
  const m = await mount({ ...options, also: view });
  actions = m.actions;
  m.app.show("chat");
  const host = document.querySelector("desk-agent-session");
  expect(host?.shadowRoot, "the plugin Chat tab uses the reader").toBeTruthy();
  return { ...m, root: host!.shadowRoot! };
}
it("opens every catalog agent in one workspace and asks for native history only on demand", async () => {
  const saved = Object.fromEntries(
    AGENTS.slice(0, -1).map((a) => [
      `chat.${a.id}`,
      { messages: [{ id: "a", role: "agent", text: `Notes for ${a.id}`, at: 1 }] },
    ]),
  );
  const calls: string[] = [];
  const m = await workspace({
    store: saved,
    handlers: {
      "agents.list": () => {
        calls.push("list");
        return { agents: [] };
      },
      "agents.sessions": () => {
        throw Error("An unlisted agent was read");
      },
    },
  });
  expect(calls).toEqual([]);
  for (const a of AGENTS) {
    const row = [...m.root.querySelectorAll<HTMLButtonElement>("[data-session-key]")].find(
      (b) => b.dataset.agent === a.id,
    );
    expect(row, a.id).toBeTruthy();
    row!.click();
    await m.settle();
    expect(m.root.querySelector("h2")?.textContent).toBeTruthy();
    if (a !== AGENTS.at(-1))
      expect(m.root.querySelector("desk-markdown")?.shadowRoot?.textContent).toContain(
        `Notes for ${a.id}`,
      );
  }
  document.querySelector<HTMLButtonElement>("[data-native-history]")!.click();
  await m.settle();
  expect(calls).toEqual(["list"]);
  expect(m.programs.calls.filter((c) => c.args[0] !== "--version")).toHaveLength(0);
});
it("keeps writes and drafts attached to their target", async () => {
  const m = await workspace();
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input")!;
  const select = async (agent: string) => {
    m.root.querySelector<HTMLButtonElement>(`[data-session-key][data-agent="${agent}"]`)!.click();
    await m.settle();
  };
  input.value = "First draft";
  input.dispatchEvent(new Event("input"));
  await select(AGENTS[1]!.id);
  expect(input.value).toBe("");
  input.value = "Second draft";
  input.dispatchEvent(new Event("input"));
  await select(AGENTS[0]!.id);
  expect(input.value).toBe("First draft");
  expect(m.programs.calls.filter((c) => c.args[0] !== "--version")).toHaveLength(0);
});

it("keeps a saved chat readable when optional native access is refused", async () => {
  const refused = new StubError("permission_denied", "Not granted");
  const calls: string[] = [];
  const m = await workspace({
    store: {
      "chat.claude": {
        messages: [{ id: "stored", role: "agent", text: "The outline is ready.", at: 1 }],
      },
    },
    handlers: {
      "agents.list": () => {
        calls.push("list");
        throw refused;
      },
      "perm.request": () => {
        calls.push("request");
        return { granted: false };
      },
      "agents.sessions": () => {
        calls.push("sessions");
        throw Error("Unlisted source");
      },
    },
  });
  const before = m.programs.calls.length;
  document.querySelector<HTMLButtonElement>("[data-native-history]")?.click();
  await m.settle();
  expect(calls).toEqual(["list", "request"]);
  expect(m.root.querySelector("desk-markdown")?.shadowRoot?.textContent).toContain(
    "The outline is ready.",
  );
  expect(m.programs.calls).toHaveLength(before);
});

it("limits native reads to listed agents and keeps the native draft after cancelled and failed writes", async () => {
  const id = "claude" as const,
    sessionId = "10000000-0000-4000-8000-000000000001";
  const session = {
    agent: id,
    id: sessionId,
    title: "Native outline",
    updatedAt: "2026-01-06T12:00:00Z",
    archived: false,
    imported: false,
    size: 100,
  };
  const reads: string[] = [],
    writes: unknown[] = [];
  const m = await workspace({
    init: { "endue.local-agents.access": "agent" },
    picks: ["cancel", "send"],
    handlers: {
      "agents.list": () => ({
        agents: [
          {
            id,
            name: "Writer",
            vendor: "",
            program: "writer",
            sessions: 1,
            archived: 0,
            imported: 0,
            running: 0,
          },
        ],
      }),
      "agents.sessions": ({ agent, from }) => {
        reads.push(agent);
        return { sessions: from === "local" ? [session] : [], total: from === "local" ? 1 : 0 };
      },
      "agents.transcript": ({ agent }) => {
        reads.push(agent);
        return {
          session,
          messages: [{ role: "user", text: "Review the notebook." }],
          truncated: false,
        };
      },
      "agents.ask": (params) => {
        writes.push(params);
        throw new StubError("unsupported", "Program unavailable");
      },
    },
  });
  document.querySelector<HTMLButtonElement>("[data-native-history]")?.click();
  await m.settle();
  m.root.querySelector<HTMLButtonElement>("[data-native-id]")?.click();
  await m.settle();
  expect(reads).toHaveLength(4);
  expect(new Set(reads)).toEqual(new Set([id]));
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input")!;
  input.value = "Keep this draft";
  const submit = document.querySelector<HTMLButtonElement>("#chat-send")!;
  submit.click();
  await m.settle();
  expect(writes).toEqual([]);
  expect(input.value).toBe("Keep this draft");
  submit.click();
  await m.settle();
  expect(writes).toEqual([
    expect.objectContaining({ agent: id, sessionId, access: "agent", prompt: "Keep this draft" }),
  ]);
  expect(input.value).toBe("Keep this draft");
  expect(m.programs.calls.filter((c) => c.args[0] !== "--version")).toHaveLength(0);
});

it("starts a new conversation on its native source and continues the session the program returned", async () => {
  const agent = "claude" as const;
  const session = {
    agent,
    id: "outline",
    title: "Native outline",
    updatedAt: "2026-01-06T12:00:00Z",
    archived: false,
    imported: false,
    size: 100,
  };
  const next = { ...session, id: "translation", title: "Translate the outline" };
  const run = {
    agent,
    runId: "run-1",
    caller: "endue.local-agents",
    prompt: next.title,
    cwd: "/example",
    access: "read-only" as const,
    state: "running" as const,
    startedAt: next.updatedAt,
    text: "",
    tools: 0,
  };
  let finished = false;
  const writes: unknown[] = [];
  const m = await workspace({
    handlers: {
      "agents.list": () => ({
        agents: [
          {
            id: agent,
            name: "Writing agent",
            vendor: "",
            program: "writer",
            sessions: 1,
            archived: 0,
            imported: 0,
            running: 0,
          },
        ],
      }),
      "agents.sessions": ({ from }) => {
        const sessions = from === "local" ? (finished ? [next, session] : [session]) : [];
        return { sessions, total: sessions.length };
      },
      "agents.transcript": ({ sessionId }) => ({
        session: sessionId === next.id ? next : session,
        messages: [{ role: "user", text: sessionId === next.id ? next.title : session.title }],
        truncated: false,
      }),
      "agents.ask": (params) => {
        writes.push(params);
        return { run };
      },
    },
  });
  document.querySelector<HTMLButtonElement>("[data-native-history]")?.click();
  await m.settle();
  m.root.querySelector<HTMLButtonElement>("[data-native-id]")?.click();
  await m.settle();
  const fresh = [...document.querySelectorAll<HTMLButtonElement>("#chat-bar button")].find(
    (b) => b.textContent === "New conversation",
  );
  expect(fresh).toBeDefined();
  fresh?.click();
  await m.settle();
  expect(m.root.querySelector("h2")?.textContent).toBe("New conversation");
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input")!;
  input.value = next.title;
  const send = document.querySelector<HTMLButtonElement>("#chat-send")!;
  send.click();
  await m.settle();
  expect(writes[0]).toMatchObject({ agent, prompt: next.title, access: "read-only" });
  expect(writes[0]).not.toHaveProperty("sessionId");
  expect(send.textContent).toBe("Stop");
  finished = true;
  m.host.emit({
    event: "agents.run",
    data: {
      agent,
      runId: run.runId,
      kind: "done",
      run: { ...run, sessionId: next.id, state: "done" },
    },
  });
  await m.settle();
  expect(m.view.latest().native.selected?.nativeId).toBe(next.id);
  input.value = "Continue";
  send.click();
  await m.settle();
  expect(writes[1]).toMatchObject({ agent, sessionId: next.id, prompt: "Continue" });
  expect(m.programs.calls.filter((c) => c.args[0] !== "--version")).toHaveLength(0);
});
