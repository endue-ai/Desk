// Agent push and pull take the configured destination and strategy without showing dialogs.
import { argument, isAgent } from "./command-input.js";
import { createOps } from "./ops.js";

/** @param {import("./command-input.js").Register} on @param {ReturnType<typeof import("./studio.js").createStudio>} studio @param {() => string} need */
export function registerNetwork(on, { app, actions }, need) {
  on("pull", async ({ strategy = "ff-only" }, invocation) => {
    const cwd = need();
    if (!isAgent(invocation)) {
      await actions.pull();
      return { ok: true };
    }
    if (!["ff-only", "merge", "rebase"].includes(strategy))
      throw new Error("Give a pull strategy.");
    const ops = createOps(app.git, cwd);
    await app.act("Pulled", () => ops.pull({ mode: strategy === "ff-only" ? "ff" : strategy }), {
      propagate: true,
    });
    return { ok: true };
  });

  on("push", async ({ remote }, invocation) => {
    const cwd = need();
    if (!isAgent(invocation)) {
      await actions.push();
      return { ok: true };
    }
    const ops = createOps(app.git, cwd);
    const local = (
      await app.git.run(["symbolic-ref", "--quiet", "HEAD"], { cwd, ok: [1] })
    ).stdout.trim();
    if (!local.startsWith("refs/heads/")) throw new Error("Switch to a branch to push it.");
    const { stdout } = await app.git.run(
      [
        "for-each-ref",
        "--count=1",
        "--format=%(upstream:remotename)%00%(upstream:remoteref)",
        local,
      ],
      { cwd },
    );
    const [upstreamRemote, upstreamRef] = stdout.trim().split("\0");
    const destination =
      remote === undefined ? upstreamRemote : argument(remote, "a configured remote");
    if (!destination) throw new Error("This branch has no upstream. Give a configured remote.");
    const remotes = (await app.git.run(["remote"], { cwd })).stdout.split("\n");
    if (!remotes.includes(destination)) throw new Error("Give a configured remote.");
    const tracked = upstreamRemote === destination && upstreamRef?.startsWith("refs/heads/");
    const refspec = `${local}:${tracked ? upstreamRef : local}`;
    await app.act(
      `Pushed to ${destination}`,
      async () => {
        try {
          await ops.push({ remote: destination, refspec, setUpstream: !upstreamRemote });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/rejected|non-fast-forward|fetch first/iu.test(message))
            throw new Error("Push rejected. Pull first, then try again.");
          throw error;
        }
      },
      { propagate: true },
    );
    return { ok: true };
  });
}
