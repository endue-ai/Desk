import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin, type PluginContext } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { AGENT_ENV, createRunner, FALLBACK_PATH, lines, SCOPE } from "../ui/run.js";
import { fakePrograms, type Handlers, type Script } from "./harness";

/** A runner on a test host whose programs are the scripted ones (or the handlers given). */
async function runner(options: { script?: Script; handlers?: Handlers; path?: string } = {}) {
  const programs = fakePrograms(options.script ?? (() => ({ stdout: "ok\n" })));
  const host = createTestHost({
    pluginId: "endue.local-agents",
    handlers: { ...programs.handlers, ...options.handlers },
  });
  programs.attach(host);
  let ctx: PluginContext | undefined;
  await defineUiPlugin(
    {
      mount(c) {
        ctx = c;
      },
    },
    host.transport,
  );
  await host.settle();
  if (!ctx) throw new Error("not mounted");
  const run = createRunner(ctx.bridge, { path: () => options.path ?? "" });
  return { host, programs, run };
}

describe("the runner", () => {
  it("runs a catalog program without a shell, in the scope of every catalog program", async () => {
    const { host, run, programs } = await runner({ script: () => ({ stdout: "2.0.14\n" }) });
    const outcome = await run.run("claude", ["--version"], { cwd: "/work" });
    expect(outcome).toMatchObject({ code: 0, stdout: "2.0.14", timedOut: false, stopped: false });
    expect(programs.calls[0]).toMatchObject({
      command: "claude",
      args: ["--version"],
      cwd: "/work",
    });
    const spawn = host.calls.find((c) => c.method === "proc.spawn")?.params as unknown as Record<
      string,
      unknown
    >;
    expect(spawn.scope).toEqual({ permission: "proc:spawn", commands: [...SCOPE.commands] });
    expect(spawn.env).toEqual(AGENT_ENV);
  });

  it("hands output over line by line, stdout and stderr apart, and the stderr tail at the end", async () => {
    const seen: string[] = [];
    const { run, programs } = await runner({ script: () => ({ hang: true }) });
    const handle = await run.start("codex", ["exec"], {
      onLine: (stream, line) => seen.push(`${stream}:${line}`),
    });
    programs.write(handle.procId, '{"a":1}\n{"b"');
    programs.write(handle.procId, ":2}\r\nlast");
    programs.write(handle.procId, "warn\n", "stderr");
    programs.exit(handle.procId, 3);
    const outcome = await handle.done;
    expect(seen).toEqual(['stdout:{"a":1}', 'stdout:{"b":2}', "stderr:warn", "stdout:last"]);
    expect(outcome).toMatchObject({ code: 3, stderr: "warn" });
  });

  it("stops a program, and kills one that takes longer than its time", async () => {
    const { run, programs } = await runner({ script: () => ({ hang: true }) });
    const handle = await run.start("gemini", [], { onLine: () => {} });
    await handle.stop();
    expect(await handle.done).toMatchObject({ stopped: true, signal: "term" });
    const slow = await run.start("gemini", [], { onLine: () => {}, timeoutMs: 5 });
    expect(await slow.done).toMatchObject({ timedOut: true });
    expect(programs.killed).toEqual([handle.procId, slow.procId]);
  });

  it("looks where programs are usually installed when the desk's PATH misses one, and keeps looking there", async () => {
    const paths: Array<string | undefined> = [];
    const { host, run } = await runner({
      handlers: {
        "proc.spawn": (params) => {
          paths.push(params.env?.PATH);
          if (params.env?.PATH !== FALLBACK_PATH)
            throw new StubError("not_found", "no such program");
          const procId = `p${paths.length}`;
          setTimeout(() => host.emit({ event: "proc.exit", data: { procId, code: 0 } }), 0);
          return { procId };
        },
      },
    });
    await run.run("claude", ["--version"]);
    await run.run("claude", ["-p", "x"]);
    expect(paths).toEqual([undefined, FALLBACK_PATH, FALLBACK_PATH]);
    expect(FALLBACK_PATH).toContain("/opt/homebrew/bin");
  });

  it("says how to fix a missing program, a desk that cannot run programs and a refusal", async () => {
    const refused = async (code: "unsupported" | "not_found" | "invalid_params", path = "") => {
      const { run } = await runner({
        path,
        handlers: {
          "proc.spawn": () => {
            throw new StubError(code, "refused");
          },
        },
      });
      return run.run("grok", ["--version"]).catch((e) => e);
    };
    expect(await refused("not_found", "/opt/bin")).toMatchObject({
      kind: "missing",
      message: expect.stringMatching(/grok is not on PATH.*Settings › Local agents › Path/),
    });
    expect(await refused("unsupported")).toMatchObject({ kind: "unsupported" });
    expect(await refused("invalid_params")).toMatchObject({ kind: "failed" });
  });

  it("asks once for the grant when several spawns are refused at once, then runs them", async () => {
    let granted = false;
    const asks: unknown[] = [];
    const { host, run } = await runner({
      handlers: {
        "proc.spawn": (params) => {
          if (!granted) throw new StubError("permission_denied", "no grant", params.scope);
          const procId = `p-${params.command}`;
          setTimeout(() => host.emit({ event: "proc.exit", data: { procId, code: 0 } }), 0);
          return { procId };
        },
        "perm.request": (params) => {
          asks.push(params);
          granted = true;
          return { granted: true };
        },
      },
    });
    const outcomes = await Promise.all([
      run.run("claude", []),
      run.run("codex", []),
      run.run("gemini", []),
    ]);
    expect(outcomes.map((o) => o.code)).toEqual([0, 0, 0]);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ permission: { permission: "proc:spawn" } });
  });

  it("says so when the person does not grant it", async () => {
    const { run } = await runner({
      handlers: {
        "proc.spawn": (params) => {
          throw new StubError("permission_denied", "no grant", params.scope);
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(run.run("claude", [])).rejects.toMatchObject({
      kind: "denied",
      message: "Not allowed to run agent programs.",
    });
  });
});

describe("lines", () => {
  it("splits utf8 and base64 chunks, a character split across chunks too", () => {
    const split = lines();
    const bytes = new TextEncoder().encode("한글\nnext");
    const b64 = (part: Uint8Array) => btoa(String.fromCharCode(...part));
    expect(split.push(b64(bytes.slice(0, 2)), "base64")).toEqual([]);
    expect(split.push(b64(bytes.slice(2)), "base64")).toEqual(["한글"]);
    expect(split.end()).toBe("next");
    expect(split.end()).toBeUndefined();
  });
});
