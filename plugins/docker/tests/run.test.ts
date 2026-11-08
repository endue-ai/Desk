import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin, type PluginContext } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { NOT_RUNNING } from "../ui/errors.js";
import {
  createRunner,
  DOCKER_ENV,
  DOCKER_SCOPE,
  DockerError,
  FALLBACK_PATH,
  lines,
} from "../ui/run.js";
import { DAEMON_DOWN } from "./fixtures";
import { fakeDocker, type Handlers, type Script } from "./harness";

/** A runner on a test host whose docker is the scripted one (or the handlers given). */
async function runner(
  options: { script?: Script; handlers?: Handlers; context?: string; path?: string } = {},
) {
  const docker = fakeDocker(options.script ?? (() => ({ stdout: "" })));
  const host = createTestHost({
    pluginId: "endue.docker",
    handlers: { ...docker.handlers, ...options.handlers },
  });
  docker.attach(host);
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
  if (!ctx) throw new Error("no ctx");
  const busy: number[] = [];
  const run = createRunner(ctx.bridge, {
    onBusy: (n) => busy.push(n),
    context: () => options.context ?? "",
    path: () => options.path ?? "",
  });
  return { host, docker, run, busy };
}

const b64 = (...bytes: number[]) => btoa(String.fromCharCode(...bytes));
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createRunner.run", () => {
  it("runs docker without a shell, with the context flag, env and scope, and gathers both streams", async () => {
    const { host, run, busy } = await runner({
      context: "build",
      script: () => ({ stdout: "out\n", stderr: "warn\n" }),
    });
    expect(await run.run(["ps", "-a"], { cwd: "/" })).toEqual({
      code: 0,
      signal: null,
      stdout: "out\n",
      stderr: "warn\n",
    });
    expect(host.calls.find((c) => c.method === "proc.spawn")?.params).toEqual({
      command: "docker",
      args: ["--context", "build", "ps", "-a"],
      cwd: "/",
      env: { ...DOCKER_ENV },
      scope: { ...DOCKER_SCOPE, commands: ["docker"] },
    });
    expect(DOCKER_SCOPE).toEqual({ permission: "proc:spawn", commands: ["docker"] });
    expect(busy).toEqual([1, 0]);
  });

  it("decodes a character split across two base64 chunks", async () => {
    const { host, run } = await runner({
      handlers: {
        "proc.spawn": () => {
          setTimeout(() => {
            // "한" is ED 95 9C in UTF-8.
            host.emit({
              event: "proc.output",
              data: { procId: "x", stream: "stdout", data: b64(0xed, 0x95), encoding: "base64" },
            });
            host.emit({
              event: "proc.output",
              data: { procId: "x", stream: "stdout", data: b64(0x9c), encoding: "base64" },
            });
            host.emit({ event: "proc.exit", data: { procId: "x", code: 0 } });
          }, 0);
          return { procId: "x" };
        },
      },
    });
    expect((await run.run(["logs"])).stdout).toBe("한");
  });

  it("keeps output that arrives before the spawn answer", async () => {
    const { host, run } = await runner({
      handlers: {
        "proc.spawn": () => {
          host.emit({
            event: "proc.output",
            data: { procId: "early", stream: "stdout", data: "first", encoding: "utf8" },
          });
          host.emit({ event: "proc.exit", data: { procId: "early", code: 0 } });
          return { procId: "early" };
        },
      },
    });
    expect((await run.run(["version"])).stdout).toBe("first");
  });

  it("explains a failure in plain words, unless the exit code is allowed", async () => {
    const { run } = await runner({
      script: () => ({ stderr: DAEMON_DOWN, code: 1, stdout: "{}" }),
    });
    const error = await run.run(["ps"]).catch((e) => e);
    expect(error).toBeInstanceOf(DockerError);
    expect(error.message).toBe(NOT_RUNNING);
    expect(error.kind).toBe("daemon");
    expect((await run.run(["version"], { ok: [1] })).stdout).toBe("{}");
  });

  it("asks for the grant once when it is missing, then runs", async () => {
    let tries = 0;
    const { host, run } = await runner({
      handlers: {
        "proc.spawn": () => {
          tries += 1;
          if (tries === 1) throw new StubError("permission_denied", "no grant");
          setTimeout(() => host.emit({ event: "proc.exit", data: { procId: "p", code: 0 } }), 0);
          return { procId: "p" };
        },
        "perm.request": () => ({ granted: true }),
      },
    });
    await run.run(["ps"]);
    expect(tries).toBe(2);
    expect(host.calls.find((c) => c.method === "perm.request")?.params).toMatchObject({
      permission: { permission: "proc:spawn", commands: ["docker"] },
      reason: "To run docker",
    });
  });

  it("says what is wrong when the desk cannot run docker", async () => {
    const refused = (code: "unsupported" | "not_found" | "permission_denied") =>
      runner({
        handlers: {
          "proc.spawn": () => {
            throw new StubError(code, code);
          },
          "perm.request": () => ({ granted: false }),
        },
      }).then(({ run }) => run.run(["ps"]).catch((e) => e));
    expect(await refused("unsupported")).toMatchObject({
      kind: "unsupported",
      message: expect.stringMatching(/cannot run programs/),
    });
    expect(await refused("not_found")).toMatchObject({
      kind: "missing",
      message: expect.stringMatching(/not on PATH/),
    });
    expect(await refused("permission_denied")).toMatchObject({
      kind: "denied",
      message: "Not allowed to run docker.",
    });
  });

  it("looks where docker is usually installed when the desk's PATH misses it, and keeps looking there", async () => {
    const paths: Array<string | undefined> = [];
    const { host, run } = await runner({
      handlers: {
        "proc.spawn": (params) => {
          paths.push(params.env?.PATH);
          if (params.env?.PATH !== FALLBACK_PATH)
            throw new StubError("not_found", "docker: no such program");
          const procId = `p${paths.length}`;
          setTimeout(() => host.emit({ event: "proc.exit", data: { procId, code: 0 } }), 0);
          return { procId };
        },
      },
    });
    await run.run(["ps"]);
    await run.run(["images"]);
    expect(paths).toEqual([undefined, FALLBACK_PATH, FALLBACK_PATH]);
    expect(FALLBACK_PATH).toContain("/Applications/Docker.app/Contents/Resources/bin");
  });

  it("runs docker on the PATH the settings give, and says so when it is not there either", async () => {
    const paths: Array<string | undefined> = [];
    const { run } = await runner({
      path: "/opt/tools/bin:/usr/bin",
      handlers: {
        "proc.spawn": (params) => {
          paths.push(params.env?.PATH);
          throw new StubError("not_found", "docker: no such program");
        },
      },
    });
    await expect(run.run(["ps"])).rejects.toThrow(/set endue.docker.path/);
    expect(paths).toEqual(["/opt/tools/bin:/usr/bin"]);
  });

  it("ends a run that takes too long with term, and a cancel ends every run", async () => {
    const { run, docker } = await runner({ script: () => ({ hang: true }) });
    await expect(run.run(["pull", "nginx"], { timeoutMs: 20 })).rejects.toThrow(
      "docker pull took longer than 0.02 s.",
    );
    expect(docker.killed).toEqual([{ procId: "p1", signal: "term" }]);
    const pending = run.run(["pull", "nginx"], { timeoutMs: 0 });
    await wait();
    run.cancel();
    await expect(pending).rejects.toMatchObject({ cancelled: true, message: "Cancelled." });
  });
});

describe("createRunner.stream", () => {
  it("hands over lines as they arrive, and how it ended", async () => {
    const { run, docker } = await runner({ script: () => ({ hang: true }) });
    const got: string[] = [];
    let ended: unknown;
    const handle = await run.stream(["logs", "-f", "web"], {
      onLine: (stream, line) => got.push(`${stream}:${line}`),
      onExit: (outcome) => {
        ended = outcome;
      },
    });
    await wait();
    docker.write(handle.procId, "one\ntw");
    docker.write(handle.procId, "o\r\nthree");
    docker.write(handle.procId, "oops\n", "stderr");
    docker.exit(handle.procId, 1);
    await wait();
    expect(got).toEqual(["stdout:one", "stdout:two", "stderr:oops", "stdout:three"]);
    expect(ended).toEqual({ code: 1, signal: null, stdout: "", stderr: "oops" });
    expect(run.running()).toBe(0);
  });

  it("stops with term, once", async () => {
    const { run, docker } = await runner({ script: () => ({ hang: true }) });
    const handle = await run.stream(["events"], { onLine: () => {} });
    await handle.stop();
    await wait();
    await handle.stop();
    expect(docker.killed).toEqual([{ procId: handle.procId, signal: "term" }]);
  });
});

describe("lines", () => {
  it("cuts a runaway line instead of keeping it all", () => {
    const split = lines();
    const out = split.push("x".repeat(70 * 1024), "utf8");
    expect(out).toHaveLength(1);
    expect(out[0]?.length).toBe(64 * 1024);
    expect(split.end()).toBeUndefined();
  });
});
