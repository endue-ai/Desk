import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { mount, ROOT, repository, z } from "./harness";

const DIRTY = z(
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +1 -2",
  "1 M. N... 100644 100644 100644 1 2 staged.js",
  "1 .M N... 100644 100644 100644 1 2 unstaged.js",
  "? new.txt",
);

const manifest = () =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8")) as PluginManifest;

describe("endue.git.state, for agents (ADR 0088)", () => {
  it("answers the repository a path is in as data", async () => {
    const { host, git } = await mount({
      script: repository({ "status --porcelain": { stdout: DIRTY } }),
    });
    const state = await host.command("endue.git.state", { path: "~/Project/Desk/src" });
    expect(git.calls[0]?.args).toEqual(["rev-parse", "--show-toplevel"]);
    expect(state).toEqual({
      root: ROOT,
      name: "Desk",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 2,
      head: "1111111111111111111111111111111111111111",
      staged: [{ path: "staged.js", change: "modified" }],
      unstaged: [{ path: "unstaged.js", change: "modified" }],
      untracked: ["new.txt"],
      conflicts: [],
      stashes: [],
      recent: [{ sha: "1111111", subject: "Initial commit" }],
    });
  });

  it("reads the open repository again without a path, and says when none is open", async () => {
    const { host, git } = await mount({ script: repository() });
    await expect(host.command("endue.git.state")).rejects.toThrow("No repository is open");
    await host.command("endue.git.status", { path: ROOT });
    const reads = git.of("status").length;
    const state = (await host.command("endue.git.state")) as { root: string; staged: unknown[] };
    expect(state.root).toBe(ROOT);
    expect(state.staged).toEqual([]);
    expect(git.of("status")).toHaveLength(reads + 1);
  });

  it("offers agents the state and the operations, the irreversible ones marked", () => {
    const commands = manifest().contributes?.commands ?? [];
    const agent = commands.filter((c) => c.agent).map((c) => c.id.replace("endue.git.", ""));
    expect(agent).toEqual([
      "state",
      "stage",
      "unstage",
      "discard",
      "commit",
      "fetch",
      "pull",
      "push",
      "checkout",
    ]);
    const marked = (flag: "readOnly" | "irreversible") =>
      commands.filter((c) => c[flag]).map((c) => c.id);
    expect(marked("readOnly")).toEqual(["endue.git.state"]);
    expect(marked("irreversible")).toEqual(["endue.git.discard", "endue.git.push"]);
    // A person runs them bare from the palette: no args are ever required.
    for (const c of commands) expect(c.args?.required, c.id).toBeUndefined();
  });
});
