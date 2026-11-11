// What the terminal sends its process, in order and one call at a time (#160): keys typed in one
// burst reach the shell as typed however the bridge carries calls that overlap, and a process the
// core no longer has ends the tab instead of taking keys nobody sees the answer to.
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { mount, scope } from "./harness";

/** proc.write and proc.resize answered only when the test says so, each in turn. */
function held() {
  const waiting: Array<() => void> = [];
  const answer = () =>
    new Promise<Record<string, never>>((resolve) => waiting.push(() => resolve({})));
  return {
    handlers: { "proc.write": answer, "proc.resize": answer },
    /** Answer the call on its way. */
    next() {
      waiting.shift()?.();
    },
    get pending() {
      return waiting.length;
    },
  };
}

const writes = (calls: unknown[]) => calls.map((p) => (p as { data: string }).data);
/** Let the page and the host trade messages while some calls stay unanswered. */
const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("what the terminal types", () => {
  it("goes one write at a time, in order; what is typed meanwhile follows as one write", async () => {
    const bridge = held();
    const { app, params } = await mount({ handlers: bridge.handlers });
    for (const key of ["e", "c", "h", "o", " ", "h", "i", "\r"]) app.input("t-1", key);
    await tick();
    expect(writes(params("proc.write"))).toEqual(["e"]);
    expect(bridge.pending).toBe(1);

    bridge.next();
    await tick();
    expect(writes(params("proc.write"))).toEqual(["e", "cho hi\r"]);
    expect(bridge.pending).toBe(1);
    app.input("t-1", "l");
    app.input("t-1", "s");
    bridge.next();
    await tick();
    expect(writes(params("proc.write"))).toEqual(["e", "cho hi\r", "ls"]);
    expect(params("proc.write").at(-1)).toEqual({
      procId: "p1",
      data: "ls",
      encoding: "utf8",
      scope: scope("zsh"),
    });
  });

  it("a resize keeps its place between the writes, and only the last size waits", async () => {
    const bridge = held();
    const { app, host } = await mount({ handlers: bridge.handlers });
    app.input("t-1", "a");
    app.resize("t-1", 100, 30);
    app.resize("t-1", 120, 40);
    app.input("t-1", "b");
    for (let i = 0; i < 4; i++) {
      bridge.next();
      await tick();
    }
    const sent = host.calls
      .filter((c) => c.method === "proc.write" || c.method === "proc.resize")
      .map((c) => {
        const p = c.params as { data?: string; size?: { cols: number } };
        return p.data ?? p.size?.cols;
      });
    expect(sent).toEqual(["a", 120, "b"]);
  });

  it("a write that fails is said, and the next one still goes", async () => {
    let n = 0;
    const { app, params, view, settle } = await mount({
      handlers: {
        "proc.write": () => {
          n += 1;
          if (n === 1) throw new StubError("io_error", "the pipe broke");
          return {};
        },
      },
    });
    app.input("t-1", "a");
    app.input("t-1", "b");
    await settle();
    expect(writes(params("proc.write"))).toEqual(["a", "b"]);
    expect(view.statuses).toContain("Could not write to zsh: io_error.");
  });
});

describe("a process the core no longer has", () => {
  it("ends its tab when the window comes back: no keys go to it, and Enter starts a shell", async () => {
    const first = await mount();
    await first.settle();
    // The shell ended while the window was closed, so its exit never reached the page.
    const gone = () => {
      throw new StubError("not_found", "endue.terminal has no process p1");
    };
    const again = await mount({
      state: first.host.state,
      handlers: { "proc.resize": gone, "proc.write": gone },
    });
    await again.settle();
    expect(again.view.ended).toEqual([{ id: "t-1", text: "zsh ended." }]);
    expect(await again.host.command("endue.terminal.sessions")).toMatchObject([
      { session: "t-1", running: false, exit: "zsh ended." },
    ]);
    again.app.input("t-1", "x");
    again.app.input("t-1", "\r");
    await again.settle();
    expect(again.params("proc.write")).toEqual([]);
    expect(again.params("proc.spawn")).toHaveLength(1);
    expect(again.view.lines.at(-1)).toEqual({ id: "t-1", text: "zsh ended. Starting zsh again." });
  });

  it("found out by a write ends the tab the same way", async () => {
    const { app, view, params, settle } = await mount({
      handlers: {
        "proc.write": () => {
          throw new StubError("not_found", "endue.terminal has no process p1");
        },
      },
    });
    app.input("t-1", "a");
    await settle();
    app.input("t-1", "b");
    await settle();
    expect(writes(params("proc.write"))).toEqual(["a"]);
    expect(view.ended).toEqual([{ id: "t-1", text: "zsh ended." }]);
    expect(view.statuses).not.toContain("Could not write to zsh: not_found.");
  });
});
