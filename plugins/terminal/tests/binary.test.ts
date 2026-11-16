// Mouse reports in the X10 (normal) encoding reach the program (#319). A program that turns on
// mouse 1000, 1002 or 1003 without SGR's 1006, as every ncurses program does with macOS's own
// terminfo (kmous=\E[M), gets its reports from xterm.js's onBinary, not onData: before this the
// terminal heard only onData, so every click and wheel was dropped. They go to the PTY as their
// bytes (base64), in order with the keys around them.
import { describe, expect, it } from "vitest";
import { createPipes } from "../ui/pipe.js";
import { wireProgram } from "../ui/wire.js";
import { mount, scope } from "./harness";
import { emulator, press, written } from "./xterm";

describe("mouse reports in the X10 encoding", () => {
  it("come from xterm.js as binary, and the terminal hands them on as such", async () => {
    const term = emulator();
    const inputs: Array<{ id: string; data: unknown }> = [];
    wireProgram(
      term,
      "t-1",
      {
        input: (id, data) => inputs.push({ id, data }),
        osc: () => {},
        retitle: () => {},
        bell: () => {},
      },
      () => {},
    );
    await written(term, "\x1b[?1000h");
    expect(press(term)).toBe(true);
    // With SGR's encoding on, the same press is text (onData), which the view already sends.
    await written(term, "\x1b[?1006h");
    press(term);
    expect(inputs).toEqual([{ id: "t-1", data: { binary: "\x1b[M *%" } }]);
    term.dispose();
  });

  it("are written to the PTY as their bytes, after the keys typed before them", async () => {
    const { app, params, settle } = await mount();
    app.input("t-1", "q");
    app.input("t-1", { binary: "\x1b[M *%" });
    // Column 223: past 95 the report holds a byte above 0x7f, which is not UTF-8 text.
    app.input("t-1", { binary: "\x1b[M\xff!!" });
    app.input("t-1", "x");
    await settle();
    expect(params("proc.write")).toEqual([
      { procId: "p1", data: "q", encoding: "utf8", scope: scope("zsh") },
      {
        procId: "p1",
        data: btoa("\x1b[M *%\x1b[M\xff!!"),
        encoding: "base64",
        scope: scope("zsh"),
      },
      { procId: "p1", data: "x", encoding: "utf8", scope: scope("zsh") },
    ]);
  });

  it("never merge with text: each write keeps one encoding", async () => {
    const calls: Array<{ method: string; params: { data?: string; encoding?: string } }> = [];
    const answers: Array<() => void> = [];
    const bridge = {
      call: (method: string, params: unknown) => {
        calls.push({ method, params: params as { data?: string; encoding?: string } });
        return new Promise<unknown>((resolve) => answers.push(() => resolve({})));
      },
    };
    const pipes = createPipes(bridge, () => {});
    const s = scope("zsh");
    pipes.write("p1", s, "a");
    pipes.write("p1", s, "b");
    pipes.write("p1", s, { binary: "\x1b[M !!" });
    pipes.write("p1", s, "c");
    pipes.write("p1", s, "d");
    for (let i = 0; i < 4; i++) {
      answers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(calls.map(({ params }) => [params.encoding, params.data])).toEqual([
      ["utf8", "a"],
      ["utf8", "b"],
      ["base64", btoa("\x1b[M !!")],
      ["utf8", "cd"],
    ]);
  });
});
