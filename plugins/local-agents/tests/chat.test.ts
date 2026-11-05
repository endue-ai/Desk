import { describe, expect, it } from "vitest";
import { agentById } from "../ui/catalog.js";
import { chatKey } from "../ui/chat.js";
import { CLAUDE_STREAM, CODEX_STREAM, GEMINI_STREAM, GROK_LINES } from "./fixtures";
import { computer, mount } from "./harness";

describe("detection", () => {
  it("asks every catalog program for its version and tells installed, missing and broken apart", async () => {
    const m = await mount({
      script: computer({
        claude: { stdout: CLAUDE_STREAM },
        codex: { stdout: CODEX_STREAM },
        gemini: (call) =>
          call.args[0] === "--version" ? { code: 1, stderr: "node: not found" } : undefined,
      }),
    });
    const agents = m.view.latest().agents;
    expect(agents.map((a) => [a.id, a.state])).toEqual([
      ["claude", "ready"],
      ["codex", "ready"],
      ["gemini", "broken"],
      ["grok", "missing"],
      ["qwen", "missing"],
      ["copilot", "missing"],
      ["cursor", "missing"],
      ["opencode", "missing"],
    ]);
    expect(agents[0]).toMatchObject({ version: "2.0.14", vendor: "Anthropic", guard: "flag" });
    expect(agents[2]?.problem).toBe("gemini --version failed: node: not found.");
    expect(m.view.latest()).toMatchObject({ found: 2, access: "read-only" });
    // The chat starts with the first agent found; compare with the first four.
    expect(m.app.ui).toMatchObject({ chatAgent: "claude", compare: ["claude", "codex"] });
    // Every program was asked once.
    expect(m.programs.calls.filter((c) => c.args[0] === "--version")).toHaveLength(3);
  });

  it("starts with the agent the settings name when it is installed", async () => {
    const m = await mount({ init: { "endue.local-agents.agent": "codex" } });
    expect(m.app.ui.chatAgent).toBe("codex");
  });
});

describe("the chat", () => {
  it("sends a message, streams the answer in, and goes on in the program's own session", async () => {
    const m = await mount();
    const answer = await m.talk.send("What does b.ts export?");
    expect(answer).toMatchObject({
      agent: "claude",
      ending: "done",
      session: "5f1c2b9e-0d4c-4b8e-9a61-3c2e1f0a7b6d",
    });
    const chat = m.view.latest().chat;
    expect(chat.messages.map((msg) => [msg.role, msg.status, msg.text])).toEqual([
      ["user", "done", "What does b.ts export?"],
      ["agent", "done", "Let me look at the file.\n\nIt exports **two** functions."],
    ]);
    expect(chat.messages[1]?.tools).toEqual([{ name: "Read", detail: "/a/b.ts" }]);
    expect(chat.messages[1]?.meta).toMatch(/1,234 tokens · \$0\.012/);
    // A message was drawn while it was running.
    expect(
      m.view.models.some((vm) => vm.chat.messages.some((msg) => msg.status === "running")),
    ).toBe(true);
    await m.talk.send("And the second?");
    const calls = m.programs.asked("claude");
    expect(calls[1]?.args).toEqual(
      expect.arrayContaining(["--resume", "5f1c2b9e-0d4c-4b8e-9a61-3c2e1f0a7b6d"]),
    );
    expect(calls[1]?.args.at(-1)).toBe("And the second?");
  });

  it("writes the earlier turns into the prompt for a program that cannot resume", async () => {
    const m = await mount({ script: computer({ gemini: { stdout: GEMINI_STREAM } }) });
    expect(m.app.ui.chatAgent).toBe("gemini");
    await m.talk.send("First question");
    await m.talk.send("Second question");
    const last = m.programs.asked("gemini").at(-1)?.args.at(-1) ?? "";
    expect(last).toContain("Me: First question");
    expect(last).toContain("Gemini CLI: Hello there.");
    expect(last.endsWith("Second question")).toBe(true);
  });

  it("keeps the conversation in the store and reads it back, an unfinished answer as stopped", async () => {
    const m = await mount();
    await m.talk.send("Remember me");
    const kept = m.store[chatKey("claude")] as { session: string; messages: unknown[] };
    expect(kept.session).toBe("5f1c2b9e-0d4c-4b8e-9a61-3c2e1f0a7b6d");
    expect(kept.messages).toHaveLength(2);
    const stored = {
      ...kept,
      messages: [
        ...kept.messages,
        { id: "x", role: "agent", text: "half", at: 1, status: "running" },
      ],
    };
    const again = await mount({ store: { [chatKey("claude")]: stored } });
    const messages = again.view.latest().chat.messages;
    expect(messages.map((msg) => msg.status)).toEqual(["done", "done", "stopped"]);
  });

  it("starts over with no session, and passes the model the person picked", async () => {
    const m = await mount();
    await m.talk.send("one");
    await m.talk.setModel("opus", undefined);
    await m.talk.newChat(undefined);
    expect(m.view.latest().chat).toMatchObject({ messages: [], session: "" });
    await m.talk.send("two");
    const args = m.programs.asked("claude").at(-1)?.args ?? [];
    expect(args).not.toContain("--resume");
    await expect(m.talk.setModel("two words", undefined)).rejects.toThrow(/no spaces/);
  });

  it("talks to another agent, one answer at a time each", async () => {
    const m = await mount({
      script: computer({ claude: { hang: true }, codex: { stdout: CODEX_STREAM } }),
    });
    const pending = m.talk.send("slow");
    await m.settle();
    await expect(m.talk.send("again")).rejects.toThrow(/still answering/);
    await m.talk.useAgent("codex");
    expect(await m.talk.send("quick")).toMatchObject({ agent: "codex", answer: "Three files." });
    expect(m.talk.stopChat("claude")).toBe(true);
    expect(await pending).toMatchObject({ ending: "stopped" });
  });

  it("says how to install an agent that is missing", async () => {
    const m = await mount();
    await expect(m.talk.send("hi", "gemini")).rejects.toThrow(
      "Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli",
    );
    await expect(m.talk.send("hi", "nobody")).rejects.toThrow(/No agent called nobody/);
  });
});

describe("read-only access", () => {
  const grok = () => computer({ grok: { stdout: GROK_LINES } });

  it("asks once before running a program nothing holds read-only, and not when the person declines", async () => {
    const declined = await mount({ script: grok(), picks: ["cancel"] });
    await expect(declined.talk.send("hi")).rejects.toMatchObject({ code: "cancelled" });
    expect(declined.programs.asked("grok")).toHaveLength(0);
    const agreed = await mount({ script: grok(), picks: ["run"] });
    await agreed.talk.send("hi");
    await agreed.talk.send("again");
    expect(agreed.picked).toHaveLength(1);
    expect(agreed.picked[0]).toMatchObject({
      title: "Grok CLI cannot be held read-only. Run it anyway?",
    });
    expect(agreed.programs.asked("grok")).toHaveLength(2);
  });

  it("does not ask with access agent, nor pass the read-only flags", async () => {
    const m = await mount({
      script: computer({ grok: { stdout: GROK_LINES }, claude: { stdout: CLAUDE_STREAM } }),
      init: { "endue.local-agents.access": "agent" },
    });
    await m.talk.send("hi", "grok");
    await m.talk.send("hi", "claude");
    expect(m.picked).toHaveLength(0);
    expect(m.programs.asked("claude")[0]?.args).not.toContain("--permission-mode");
  });

  it("runs in the folder the settings name, for the time they allow", async () => {
    const m = await mount({
      script: computer({ claude: { hang: true } }),
      init: { "endue.local-agents.folder": "~/work", "endue.local-agents.timeout": 1 },
    });
    const claude = agentById("claude");
    if (!claude) throw new Error("catalog");
    expect(m.app.question(claude, "x")).toMatchObject({
      cwd: "~/work",
      timeoutMs: 1000,
      readOnly: true,
    });
  });
});
