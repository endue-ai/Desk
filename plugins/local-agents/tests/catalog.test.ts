import { describe, expect, it } from "vitest";
import {
  AGENTS,
  agentById,
  COMMANDS,
  isValue,
  promptArg,
  versionOf,
  withTranscript,
} from "../ui/catalog.js";
import { VERSIONS } from "./fixtures";

const args = (id: string, ask: Partial<Parameters<(typeof AGENTS)[number]["args"]>[0]> = {}) => {
  const agent = agentById(id);
  if (!agent) throw new Error(id);
  return agent.args({ prompt: "hello", readOnly: true, ...ask });
};

describe("the catalog", () => {
  it("knows Claude, OpenAI's Codex, Gemini, Grok and four more, each its own program", () => {
    expect(AGENTS.map((a) => [a.id, a.vendor, a.command])).toEqual([
      ["claude", "Anthropic", "claude"],
      ["codex", "OpenAI", "codex"],
      ["gemini", "Google", "gemini"],
      ["grok", "xAI", "grok"],
      ["qwen", "Alibaba", "qwen"],
      ["copilot", "GitHub", "copilot"],
      ["cursor", "Cursor", "cursor-agent"],
      ["opencode", "SST", "opencode"],
    ]);
    expect(new Set(COMMANDS).size).toBe(AGENTS.length);
    for (const agent of AGENTS) expect(agent.install.length, agent.id).toBeGreaterThan(5);
  });

  it("asks each program in its non-interactive mode, read-only where it has a flag for it", () => {
    expect(args("claude")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "plan",
      "hello",
    ]);
    expect(args("codex")).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "hello",
    ]);
    expect(args("gemini")).toEqual(["--output-format", "stream-json", "--prompt=hello"]);
    expect(args("grok")).toEqual(["--prompt=hello"]);
    expect(args("cursor")).toEqual(["-p", "--output-format", "stream-json", "hello"]);
    expect(args("opencode")).toEqual(["run", "hello"]);
    // With access agent, no read-only flag.
    expect(args("claude", { readOnly: false })).not.toContain("--permission-mode");
    expect(args("codex", { readOnly: false })).not.toContain("--sandbox");
  });

  it("never passes a flag that widens what a program may do", () => {
    const widening = /dangerously|yolo|full-auto|allow-all|bypass|--force|approval-mode/;
    for (const agent of AGENTS)
      for (const readOnly of [true, false])
        for (const plain of [true, false])
          for (const arg of agent.args({ prompt: "p", readOnly, plain, session: "s1", model: "m" }))
            expect(arg, agent.id).not.toMatch(widening);
  });

  it("resumes a session, picks a model and falls back to plain text as each program spells it", () => {
    expect(args("claude", { session: "abc-1", model: "opus" })).toEqual(
      expect.arrayContaining(["--model", "opus", "--resume", "abc-1"]),
    );
    expect(args("codex", { session: "0199a", model: "gpt-5" }).slice(-3)).toEqual([
      "resume",
      "0199a",
      "hello",
    ]);
    expect(args("codex", { model: "gpt-5" })).toEqual(expect.arrayContaining(["--model", "gpt-5"]));
    expect(args("claude", { plain: true })).toEqual(["-p", "--permission-mode", "plan", "hello"]);
    expect(args("codex", { plain: true })).toContain("--color");
    expect(args("gemini", { plain: true })).toEqual(["--prompt=hello"]);
    // A session or model that could be read as an option is left out.
    expect(args("claude", { session: "--evil", model: "-x" })).toEqual(args("claude"));
  });

  it("hands a prompt over as one argument no program reads as an option", () => {
    expect(promptArg("--help me")).toBe(" --help me");
    expect(promptArg("a\0b")).toBe("ab");
    expect(promptArg("x".repeat(200_000))).toHaveLength(100_000);
    expect(args("claude", { prompt: "-rf" }).at(-1)).toBe(" -rf");
    expect(args("gemini", { prompt: "--yolo" }).at(-1)).toBe("--prompt= --yolo");
  });

  it("checks model names and session ids", () => {
    expect(
      ["opus", "gpt-5", "gemini-2.5-pro", "anthropic/claude-sonnet-4", "a:b@c"].every(isValue),
    ).toBe(true);
    expect(["", "-x", "two words", "a\nb", 5, "x".repeat(200)].some(isValue)).toBe(false);
  });

  it("reads each program's version line", () => {
    expect(Object.fromEntries(Object.entries(VERSIONS).map(([k, v]) => [k, versionOf(v)]))).toEqual(
      {
        claude: "2.0.14",
        codex: "0.46.0",
        gemini: "0.9.0",
        grok: "1.0.1",
        qwen: "0.0.14",
        copilot: "0.0.339",
        "cursor-agent": "2025.09.18-7ae6800",
        opencode: "0.14.1",
      },
    );
    expect(versionOf("\n  weird build\n")).toBe("weird build");
  });

  it("writes the earlier turns into the prompt for a program that cannot resume", () => {
    const turns = [
      { role: "user" as const, text: "Hi" },
      { role: "agent" as const, text: "Hello." },
    ];
    expect(withTranscript([], "Next?", "Gemini CLI")).toBe("Next?");
    const text = withTranscript(turns, "Next?", "Gemini CLI");
    expect(text).toContain("Me: Hi\n\nGemini CLI: Hello.");
    expect(text.endsWith("Next?")).toBe(true);
    // The latest turns that fit, oldest first.
    const many = Array.from({ length: 50 }, (_, i) => ({
      role: "user" as const,
      text: `${i} ${"x".repeat(500)}`,
    }));
    const cut = withTranscript(many, "Q", "A", 2_000);
    expect(cut).toContain("Me: 49");
    expect(cut).not.toContain("Me: 0 ");
  });
});
