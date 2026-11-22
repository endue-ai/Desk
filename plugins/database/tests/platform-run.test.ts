// PG-102: how the runner stops a program on each system, and the search path it tries when a
// program is not found. On Windows every signal the core sends ends the child (there is no SIGINT
// for a process without a console), so the runner sends one kill there; elsewhere SIGINT, then
// SIGKILL after the grace. Runs on any system: the platform is a parameter.
import { describe, expect, it } from "vitest";
import { searchPath } from "../ui/clients.js";
import { createRunner, GRACE_MS } from "../ui/run.js";

type Listener = (event: unknown) => void;

/** A bridge whose program runs until it is killed; it records the calls. */
function fakeBridge(missingWithoutPath = false) {
  let listener: Listener = () => {};
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const bridge = {
    onEvent: (l: Listener) => {
      listener = l;
      return () => {};
    },
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "proc.spawn") {
        const env = params.env as Record<string, string>;
        if (missingWithoutPath && !env.PATH)
          throw Object.assign(new Error("no"), { code: "not_found" });
        return { procId: "p-1" };
      }
      if (method === "proc.kill")
        queueMicrotask(() =>
          listener({ event: "proc.exit", data: { procId: "p-1", code: 1, signal: null } }),
        );
      return {};
    },
  };
  return { bridge, calls };
}

const invocation = (command: string) => ({
  command,
  args: ["--format=custom"],
  env: {},
  nonce: "",
  statements: [],
  maxRows: 0,
  stopAfter: 0,
});

/** Timers run by hand: what was set, and with what delay. */
function manualTimers() {
  const set: Array<{ fn: () => void; ms: number }> = [];
  return {
    set,
    setTimer: (fn: () => void, ms: number) => {
      set.push({ fn, ms });
      return set.length;
    },
    clearTimer: () => {},
  };
}

describe("stopping a program on each system", () => {
  it("stops a program on Windows with one kill", async () => {
    const { bridge, calls } = fakeBridge();
    const timers = manualTimers();
    const runner = createRunner(bridge as never, { platform: "windows", ...timers });
    const control = new AbortController();
    const done = runner.run(invocation("pg_dump"), { signal: control.signal });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    control.abort();
    const outcome = await done;
    expect(outcome.cancelled).toBe(true);
    const kills = calls.filter((c) => c.method === "proc.kill").map((c) => c.params.signal);
    expect(kills).toEqual(["kill"]);
    expect(timers.set.filter((t) => t.ms === GRACE_MS)).toEqual([]);
  });

  it("sends SIGINT, then SIGKILL after the grace, on macOS and Linux", async () => {
    for (const platform of ["mac", "linux"] as const) {
      const { bridge, calls } = fakeBridge();
      const timers = manualTimers();
      const runner = createRunner(bridge as never, { platform, ...timers });
      const control = new AbortController();
      const done = runner.run(invocation("pg_dump"), { signal: control.signal });
      await new Promise((r) => setTimeout(r, 0));
      control.abort();
      expect(calls.filter((c) => c.method === "proc.kill").map((c) => c.params.signal)).toEqual([
        "int",
      ]);
      expect(timers.set.map((t) => t.ms)).toEqual([GRACE_MS]);
      await done;
    }
  });

  it("tries the Windows search path, `;`-separated, when pg_dump is not on the desk's PATH", async () => {
    const { bridge, calls } = fakeBridge(true);
    const path = searchPath("windows", []);
    const runner = createRunner(bridge as never, { platform: "windows", searchPath: () => path });
    const control = new AbortController();
    const done = runner.run(invocation("pg_dump"), { signal: control.signal });
    await new Promise((r) => setTimeout(r, 0));
    control.abort();
    await done;
    const spawns = calls.filter((c) => c.method === "proc.spawn");
    expect(spawns.map((c) => (c.params.env as Record<string, string>).PATH)).toEqual([
      undefined,
      path,
    ]);
    expect(path.split(";")[0]).toBe("C:\\Program Files\\PostgreSQL\\19\\bin");
    // The program keeps its bare name: the core adds .exe through PATHEXT (ADR 0260 grants by name).
    expect(spawns.map((c) => c.params.command)).toEqual(["pg_dump", "pg_dump"]);
  });
});
