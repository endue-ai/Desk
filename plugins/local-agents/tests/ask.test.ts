import { describe, expect, it } from "vitest";
import { ask } from "../ui/ask.js";
import { agentById } from "../ui/catalog.js";
import { CLAUDE_ERROR, CLAUDE_STREAM, GEMINI_STREAM } from "./fixtures";

type Runner = Parameters<typeof ask>[0];
type Out = { stdout?: string; stderr?: string; code?: number; hang?: boolean };

/** A runner whose program answers each start from `answers`, in order. */
function scripted(...answers: Out[]) {
  const starts: string[][] = [];
  const runner: Runner = {
    start: async (_command, args, options) => {
      starts.push(args);
      const out = answers.shift() ?? {};
      let stop = () => {};
      const done = new Promise<{
        code: number | null;
        signal: string | null;
        stderr: string;
        timedOut: boolean;
        stopped: boolean;
      }>((resolve) => {
        stop = () =>
          resolve({ code: null, signal: "term", stderr: "", timedOut: false, stopped: true });
        setTimeout(() => {
          for (const line of (out.stdout ?? "").split("\n"))
            if (line) options.onLine("stdout", line);
          for (const line of (out.stderr ?? "").split("\n"))
            if (line) options.onLine("stderr", line);
          if (!out.hang)
            resolve({
              code: out.code ?? 0,
              signal: null,
              stderr: out.stderr ?? "",
              timedOut: false,
              stopped: false,
            });
        }, 0);
      });
      return { procId: `p${starts.length}`, done, stop: async () => stop() };
    },
  };
  return { runner, starts };
}

const claude = agentById("claude");
const gemini = agentById("gemini");
if (!claude || !gemini) throw new Error("catalog");

describe("ask", () => {
  it("streams the reply as it grows and ends with the answer and the command it ran", async () => {
    const { runner } = scripted({ stdout: CLAUDE_STREAM });
    const seen: string[] = [];
    const result = await ask(
      runner,
      { agent: claude, prompt: "What is in b.ts?", readOnly: true },
      { onUpdate: (reply) => seen.push(reply.text) },
    ).done;
    expect(seen.at(-1)).toBe("Let me look at the file.\n\nIt exports **two** functions.");
    expect(result).toMatchObject({ ending: "done", error: "", answer: seen.at(-1) });
    expect(result.line).toBe(
      "claude -p --output-format stream-json --verbose --permission-mode plan <prompt>",
    );
  });

  it("asks again without the session when the program cannot resume it, with the turns in the prompt", async () => {
    const { runner, starts } = scripted(
      { code: 1, stderr: "No conversation found with session ID: old" },
      { stdout: CLAUDE_STREAM },
    );
    const result = await ask(runner, {
      agent: claude,
      prompt: "And then?",
      session: "old",
      readOnly: true,
      history: [{ role: "user", text: "Start" }],
    }).done;
    expect(result.ending).toBe("done");
    expect(starts[0]).toEqual(expect.arrayContaining(["--resume", "old", "And then?"]));
    expect(starts[1]).not.toContain("--resume");
    expect(starts[1]?.at(-1)).toContain("Me: Start");
  });

  it("asks for plain text when the version does not know the output flags, and remembers it", async () => {
    const plain = new Set<string>();
    const { runner, starts } = scripted(
      { code: 1, stderr: "Unknown arguments: output-format, outputFormat" },
      { stdout: "plain words\n" },
      { stdout: "again\n" },
    );
    const first = await ask(runner, { agent: gemini, prompt: "hi", readOnly: true }, { plain })
      .done;
    expect(first).toMatchObject({ ending: "done", answer: "plain words" });
    expect(starts[0]).toContain("--output-format");
    expect(starts[1]).toEqual(["--prompt=hi"]);
    expect(plain.has("gemini")).toBe(true);
    await ask(runner, { agent: gemini, prompt: "hi", readOnly: true }, { plain }).done;
    expect(starts[2]).toEqual(["--prompt=hi"]);
  });

  it("fails with the program's own error, its last stderr line, or its exit code", async () => {
    const fatal = scripted({ stdout: CLAUDE_ERROR, code: 1 });
    expect(
      await ask(fatal.runner, { agent: claude, prompt: "x", readOnly: true }).done,
    ).toMatchObject({
      ending: "failed",
      error: "Invalid API key · Please run /login",
    });
    const stderr = scripted({ code: 2, stderr: "first\nGEMINI_API_KEY is not set" });
    expect(
      await ask(stderr.runner, { agent: gemini, prompt: "x", readOnly: true }).done,
    ).toMatchObject({
      error: "Gemini CLI: GEMINI_API_KEY is not set",
    });
    const code = scripted({ code: 9 });
    expect(
      (await ask(code.runner, { agent: gemini, prompt: "x", readOnly: true }).done).error,
    ).toBe("Gemini CLI exited with code 9.");
  });

  it("keeps a streamed answer even when the program then exits badly, without a second try", async () => {
    const { runner, starts } = scripted({
      stdout: GEMINI_STREAM,
      code: 1,
      stderr: "Unknown argument",
    });
    const result = await ask(runner, { agent: gemini, prompt: "x", readOnly: true }).done;
    expect(result).toMatchObject({ ending: "failed", answer: "Hello there." });
    expect(starts).toHaveLength(1);
  });

  it("stops", async () => {
    const { runner } = scripted({ hang: true });
    const asked = ask(runner, { agent: claude, prompt: "x", readOnly: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    asked.stop();
    expect(await asked.done).toMatchObject({ ending: "stopped", error: "Stopped." });
  });
});
