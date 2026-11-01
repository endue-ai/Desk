import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin, type PluginContext } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createRunner, explain, GIT_ENV, GIT_FLAGS, GIT_SCOPE, GitError } from "../ui/run.js";
import { fakeGit, type Handlers } from "./harness";

/** A runner on a test host whose git is the scripted one (or the handlers given). */
async function runner(options: { script?: Parameters<typeof fakeGit>[0]; handlers?: Handlers }) {
  const git = fakeGit(options.script ?? (() => ({ stdout: "" })));
  const host = createTestHost({
    pluginId: "endue.git",
    handlers: { ...git.handlers, ...options.handlers },
  });
  git.attach(host);
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
  const run = createRunner(ctx.bridge, { onBusy: (n) => busy.push(n) });
  return { host, git, run, busy, ctx };
}

const b64 = (...bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("createRunner", () => {
  it("runs git without a shell, with the fixed flags, env and scope, and gathers both streams", async () => {
    const { host, run, busy } = await runner({
      script: ({ args }) =>
        args[0] === "status" ? { stdout: "## main\n", stderr: "warning: x\n" } : undefined,
    });
    const outcome = await run.run(["status", "-sb"], { cwd: "~/repo" });
    expect(outcome).toEqual({ code: 0, signal: null, stdout: "## main\n", stderr: "warning: x\n" });
    expect(host.calls.find((c) => c.method === "proc.spawn")?.params).toEqual({
      command: "git",
      args: [...GIT_FLAGS, "status", "-sb"],
      cwd: "~/repo",
      env: { ...GIT_ENV },
      scope: { ...GIT_SCOPE, commands: ["git"] },
    });
    expect(GIT_ENV.GIT_TERMINAL_PROMPT).toBe("0");
    expect(busy).toEqual([1, 0]);
    expect(run.running()).toBe(0);
  });

  it("keeps output that arrives before the spawn answer names its process", async () => {
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
    const outcome = await run.run(["rev-parse", "HEAD"]);
    expect(outcome.stdout).toBe("first");
  });

  it("decodes base64 chunks together, so a character split across two still reads right", async () => {
    const { host, run } = await runner({
      handlers: {
        "proc.spawn": () => {
          setTimeout(() => {
            const out = (data: string) =>
              host.emit({
                event: "proc.output",
                data: { procId: "p", stream: "stdout", data, encoding: "base64" },
              });
            out(b64(0x63, 0x61, 0x66, 0xc3));
            out(b64(0xa9));
            host.emit({ event: "proc.exit", data: { procId: "p", code: 0 } });
          }, 0);
          return { procId: "p" };
        },
      },
    });
    expect((await run.run(["show"])).stdout).toBe("café");
  });

  it("a non-zero exit is a GitError in git's own words, unless the code is allowed", async () => {
    const { run } = await runner({
      script: ({ args }) =>
        args[0] === "rev-parse"
          ? { code: 128, stderr: "fatal: not a git repository (or any parent)\nhint: try again\n" }
          : { code: 1, stdout: "differs\n" },
    });
    const error = await run.run(["rev-parse", "--show-toplevel"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitError);
    expect((error as GitError).message).toBe("not a git repository (or any parent)");
    expect((error as GitError).outcome.code).toBe(128);
    expect(await run.run(["diff", "--quiet"], { ok: [1] })).toMatchObject({ code: 1 });
    expect(explain(["push"], { code: 1, signal: null, stdout: "", stderr: "" })).toBe(
      "git push exited with 1.",
    );
    expect(explain(["push"], { code: null, signal: "term", stdout: "", stderr: "" })).toBe(
      "git push was ended by term.",
    );
  });

  it("a timeout kills the process and says how long it waited; timeoutMs 0 waits", async () => {
    const { git, run } = await runner({ script: () => ({ hang: true }) });
    const error = await run.run(["fetch"], { timeoutMs: 50 }).catch((e: unknown) => e);
    expect((error as GitError).message).toBe("git fetch took longer than 0.05 s.");
    expect(git.killed[0]).toEqual({ procId: "p1", signal: "term" });
    const pending = run.run(["pull"], { timeoutMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(run.running()).toBe(1);
    run.cancel();
    const cancelled = await pending.catch((e: unknown) => e);
    expect((cancelled as GitError).cancelled).toBe(true);
    expect((cancelled as GitError).message).toBe("Cancelled.");
    expect(run.running()).toBe(0);
  });

  it("asks once for the grant when it is missing, and reports a refusal in words", async () => {
    let denied = true;
    const { host, run, git } = await runner({
      handlers: {
        "proc.spawn": (params, caller) => {
          if (denied) {
            denied = false;
            throw new StubError("permission_denied", "no grant", params.scope);
          }
          return git.handlers["proc.spawn"]?.(params, caller) ?? { procId: "x" };
        },
        "perm.request": () => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission: GIT_SCOPE,
            duration: "session",
            grantedAt: "2026-10-31T00:00:00Z",
          },
        }),
      },
    });
    await run.run(["status"], { cwd: "~/repo" });
    expect(host.calls.filter((c) => c.method === "perm.request").map((c) => c.params)).toEqual([
      { permission: { ...GIT_SCOPE, commands: ["git"] }, reason: "To run git in ~/repo" },
    ]);
    expect(host.calls.filter((c) => c.method === "proc.spawn")).toHaveLength(2);

    const refused = await runner({
      handlers: {
        "proc.spawn": () => {
          throw new StubError("permission_denied", "no grant");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(refused.run.run(["status"])).rejects.toThrow("Not allowed to run git.");

    const unsupported = await runner({
      handlers: {
        "proc.spawn": () => {
          throw new StubError("unsupported", "not served");
        },
      },
    });
    await expect(unsupported.run.run(["status"])).rejects.toThrow(
      "This desk cannot run programs yet: proc.spawn is unsupported.",
    );
  });
});
