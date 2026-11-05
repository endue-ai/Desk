import { describe, expect, it } from "vitest";
import {
  type AgentEvent,
  answerOf,
  apply,
  describe as detailOf,
  emptyReply,
  plainText,
  reader,
} from "../ui/parse.js";
import {
  CLAUDE_ERROR,
  CLAUDE_STREAM,
  CODEX_OLD,
  CODEX_STREAM,
  CURSOR_STREAM,
  GEMINI_JSON,
  GEMINI_STREAM,
  GROK_LINES,
  PLAIN,
} from "./fixtures";

type Format = Parameters<typeof reader>[0];

/** A whole output read line by line into a reply, as a run reads it. */
function read(format: Format, stdout: string) {
  const r = reader(format);
  const reply = emptyReply();
  const events: AgentEvent[] = [];
  for (const line of stdout.split("\n")) events.push(...r.line(line));
  events.push(...r.end());
  for (const event of events) apply(reply, event);
  return { reply, events };
}

describe("the readers", () => {
  it("read Claude Code's stream-json: session, text blocks, tools, cost", () => {
    const { reply } = read("claude", CLAUDE_STREAM);
    expect(reply.session).toBe("5f1c2b9e-0d4c-4b8e-9a61-3c2e1f0a7b6d");
    expect(reply.model).toBe("claude-sonnet-4-5");
    expect(reply.text).toBe("Let me look at the file.\n\nIt exports **two** functions.");
    expect(reply.final).toBe("It exports **two** functions.");
    expect(reply.tools).toEqual([{ name: "Read", detail: "/a/b.ts" }]);
    expect(reply.usage).toEqual({ input: 1200, output: 34, cost: 0.0123 });
    expect(reply.fatal).toBe("");
  });

  it("take a Claude result that is an error as the run's failure", () => {
    const { reply } = read("claude", CLAUDE_ERROR);
    expect(reply.fatal).toBe("Invalid API key · Please run /login");
    expect(answerOf(reply)).toBe("");
  });

  it("read Codex's thread and item events, and the older msg events", () => {
    const now = read("codex", CODEX_STREAM).reply;
    expect(now).toMatchObject({
      session: "0199a213-81c0-7800-8aa1-bbab2a035a53",
      text: "Three files.",
      tools: [{ name: "Run", detail: "bash -lc ls" }],
      usage: { input: 2400, output: 12 },
    });
    const old = read("codex", CODEX_OLD).reply;
    expect(old).toMatchObject({
      session: "c-old-1",
      model: "gpt-5",
      text: "Old codex says hi.",
      final: "Old codex says hi.",
      tools: [{ name: "Run", detail: "bash -lc ls" }],
    });
  });

  it("join Gemini's deltas, and read its one-object json format too", () => {
    const { reply } = read("gemini", GEMINI_STREAM);
    expect(reply).toMatchObject({
      session: "g-1",
      model: "gemini-2.5-pro",
      text: "Hello there.",
      tools: [{ name: "read_file", detail: "/x" }],
      usage: { input: 80, output: 10 },
    });
    expect(read("gemini", GEMINI_JSON).reply.text).toBe("From the json format.");
    const failed = read(
      "gemini",
      `${JSON.stringify({ type: "result", status: "error", error: { message: "quota" } })}\n`,
    );
    expect(failed.reply.fatal).toBe("quota");
  });

  it("read Grok's chat messages and Cursor's stream", () => {
    const grok = read("grok", GROK_LINES).reply;
    expect(grok.text).toBe("The readme is one heading.");
    expect(grok.tools).toEqual([{ name: "view_file", detail: "README.md" }]);
    const cursor = read("claude", CURSOR_STREAM).reply;
    expect(cursor).toMatchObject({ session: "cur-1", text: "Cursor read it." });
    expect(cursor.tools).toEqual([{ name: "read", detail: "src/main.ts" }]);
  });

  it("take plain output as text without escape sequences, and unknown lines as text", () => {
    expect(read("text", PLAIN).reply.text).toBe("Plain answer\nsecond line\n");
    expect(answerOf(read("text", PLAIN).reply)).toBe("Plain answer\nsecond line");
    // A structured reader keeps a line that is not JSON: a newer program still says something.
    expect(read("claude", "not json at all\n").reply.text).toBe("not json at all\n");
    // A JSON line of a shape no reader knows says nothing.
    expect(read("codex", '{"model":"gpt-5"}\n').events).toEqual([]);
  });

  it("keep warnings apart from the failure, and only the latest few", () => {
    const reply = emptyReply();
    for (let i = 0; i < 8; i++)
      apply(reply, { kind: "error", message: `Reconnecting ${i}`, fatal: false });
    expect(reply.problems).toEqual([
      "Reconnecting 3",
      "Reconnecting 4",
      "Reconnecting 5",
      "Reconnecting 6",
      "Reconnecting 7",
    ]);
    expect(reply.fatal).toBe("");
  });
});

describe("plainText and describe", () => {
  it("drop CSI and OSC sequences and control characters, keep newlines and tabs", () => {
    expect(plainText("\u001b[31mred\u001b[0m\tx\u001b]0;title\u0007y\r\n")).toBe("red\txy\n");
  });

  it("say what a tool worked on, on one short line", () => {
    expect(detailOf({ command: ["bash", "-lc", "ls  -la"] })).toBe("bash -lc ls -la");
    expect(detailOf({ file_path: "/a" })).toBe("/a");
    expect(detailOf({ description: "Find\nthe tests" })).toBe("Find the tests");
    expect(detailOf("x".repeat(200))).toHaveLength(120);
    expect(detailOf(undefined)).toBe("");
  });
});
