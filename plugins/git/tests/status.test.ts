import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { LOG_FORMAT } from "../ui/parse-log.js";
import { RECENT_FORMAT, STASH_FORMAT } from "../ui/parse-status.js";
import { CLEAN_STATUS, type GitCall, mount, ROOT, repository, z } from "./harness";

const DIRTY = z(
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +1 -2",
  "1 M. N... 100644 100644 100644 1 2 staged.js",
  "1 .M N... 100644 100644 100644 1 2 unstaged.js",
  "? new.txt",
);

const log = (sha: string, parent: string, refs = "") =>
  `${sha}\x1f${parent}\x1fAda\x1f2026-10-30T09:00:00Z\x1f${refs}\x1fcommit ${sha}\x1e\n`;

describe("Git: status", () => {
  it("opens the repository a path is in and shows its status", async () => {
    const { host, view, git, store, params } = await mount({
      script: repository({ "status --porcelain": { stdout: DIRTY } }),
    });
    await expect(host.command("endue.git.status", { path: "~/Project/Desk/src" })).resolves.toBe(
      ROOT,
    );
    expect(git.calls.slice(0, 4).map((c: GitCall) => [c.args, c.cwd])).toEqual([
      [["rev-parse", "--show-toplevel"], "~/Project/Desk/src"],
      [["status", "--porcelain=v2", "--branch", "-z"], ROOT],
      [["stash", "list", `--format=${STASH_FORMAT}`], ROOT],
      [["log", "-n", "10", `--format=${RECENT_FORMAT}`], ROOT],
    ]);
    expect(view.headers.at(-1)).toEqual({
      repo: { root: ROOT, name: "Desk" },
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 2,
      oid: "1111111111111111111111111111111111111111",
    });
    const status = view.statuses.at(-1);
    expect(status?.status.staged.map((e) => e.path)).toEqual(["staged.js"]);
    expect(status?.status.unstaged.map((e) => e.path)).toEqual(["unstaged.js"]);
    expect(status?.status.untracked).toEqual(["new.txt"]);
    expect(status?.recent).toEqual([
      { sha: "1111111", subject: "Initial commit", refs: ["HEAD -> main", "origin/main"] },
    ]);
    expect(view.shown.at(-1)).toBe("status");
    expect(view.hints.at(-1)).toMatch(/^s stage/);
    expect(store.recent).toEqual([ROOT]);
    expect(host.state).toEqual({ root: ROOT, view: "status" });
    expect(params("store.set").at(-1)).toEqual({ key: "recent", value: [ROOT] });
  });

  it("a folder that is not a repository is said in words", async () => {
    const { host, view } = await mount({
      script: repository({
        "rev-parse --show-toplevel": {
          code: 128,
          stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
        },
      }),
    });
    await expect(host.command("endue.git.status", { path: "~/Documents" })).rejects.toThrow(
      "Not a Git repository: ~/Documents.",
    );
    expect(view.said.at(-1)).toBe("Not a Git repository: ~/Documents.");
    expect(view.headers.at(-1)?.repo).toBeNull();
  });

  it("without a path it offers the recent repositories, with room to type one", async () => {
    const picks: unknown[] = [];
    const { host, store } = await mount({
      store: { recent: ["/Users/me/a", "/Users/me/b"] },
      commands: {
        "desk.palette.pick": (args) => {
          picks.push(args);
          return "/Users/me/b";
        },
      },
      script: repository({ "rev-parse --show-toplevel": { stdout: "/Users/me/b\n" } }),
    });
    await expect(host.command("endue.git.status")).resolves.toBe("/Users/me/b");
    expect(picks).toEqual([
      {
        title: "Git: which repository?",
        items: [
          { id: "/Users/me/a", label: "a", detail: "/Users/me/a" },
          { id: "/Users/me/b", label: "b", detail: "/Users/me/b" },
        ],
        free: true,
        placeholder: "a folder path",
      },
    ]);
    expect(store.recent).toEqual(["/Users/me/b", "/Users/me/a"]);

    const cancelled = await mount();
    await expect(cancelled.host.command("endue.git.status")).resolves.toBeNull();
    expect(cancelled.git.calls).toEqual([]);
  });

  it("when the desk cannot run programs yet, the status line says so", async () => {
    const { host, view } = await mount({
      handlers: {
        "proc.spawn": () => {
          throw new StubError("unsupported", "proc.spawn is not served");
        },
      },
    });
    await expect(host.command("endue.git.status", { path: ROOT })).rejects.toThrow(
      "This desk cannot run programs yet: proc.spawn is unsupported.",
    );
    expect(view.said.at(-1)).toBe("This desk cannot run programs yet: proc.spawn is unsupported.");
  });
});

describe("the log and diff views", () => {
  const withLog = (count = 200) =>
    repository({
      [`log --topo-order --max-count=${count}`]: ({ args }) => ({
        stdout: args.some((a) => a.startsWith("--skip"))
          ? log("a", "")
          : log("c", "b", "HEAD -> main, origin/main") + log("b", "a"),
      }),
    });

  it("Git: log lays the commits out as a graph and is a desk buffer", async () => {
    const { host, view, git, ran } = await mount({ script: withLog() });
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.log");
    expect(git.of("log").at(-1)).toEqual([
      "log",
      "--topo-order",
      "--max-count=200",
      `--format=${LOG_FORMAT}`,
      "HEAD",
      "--",
    ]);
    const model = view.logs.at(-1);
    expect(model?.commits.map((c) => c.sha)).toEqual(["c", "b"]);
    expect(model?.commits[0]?.refs.map((r) => r.kind)).toEqual(["branch", "remote"]);
    expect(model?.rows.map((r) => r.lane)).toEqual([0, 0]);
    expect(model?.more).toBe(false);
    expect(ran("desk.buffers.open")).toEqual([{ name: "git log: Desk" }]);
    expect(view.shown.at(-1)).toBe("log");
    expect(host.state).toEqual({ root: ROOT, view: "log" });
  });

  it("more appends with --skip and all branches asks for --all", async () => {
    const { host, view, git, app } = await mount({
      script: withLog(2),
      init: { "endue.git.log-count": 2 },
    });
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.log");
    expect(view.logs.at(-1)?.more).toBe(true);
    await app.more();
    expect(git.of("log").at(-1)).toContain("--skip=2");
    expect(view.logs.at(-1)?.commits.map((c) => c.sha)).toEqual(["c", "b", "a"]);
    await app.toggleAll();
    expect(git.of("log").at(-1)).toContain("--all");
    expect(view.logs.at(-1)?.all).toBe(true);
  });

  it("Git: diff shows the staged set, a file, or a commit, and refuses an untracked file", async () => {
    const { host, view, git, ran } = await mount({
      script: repository({
        diff: { stdout: "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n" },
        show: { stdout: "" },
      }),
    });
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.diff", { staged: true });
    expect(git.of("diff").at(-1)).toEqual(["diff", "--cached", "-U3", "--"]);
    expect(view.diffs.at(-1)).toMatchObject({ title: "staged", target: { staged: true } });
    expect(view.diffs.at(-1)?.files[0]?.hunks[0]?.lines).toHaveLength(2);
    expect(ran("desk.buffers.open")).toEqual([{ name: "git diff: staged" }]);

    view.selected = { kind: "file", section: "unstaged", path: "x.js" };
    await host.command("endue.git.diff");
    expect(git.of("diff").at(-1)).toEqual(["diff", "-U3", "--", "x.js"]);
    expect(view.diffs.at(-1)?.title).toBe("unstaged x.js");
    expect(ran("desk.buffers.update")).toEqual([
      { id: "endue.git:1", name: "git diff: unstaged x.js" },
    ]);

    view.selected = { kind: "commit", sha: "abcdef0123456789" };
    await host.command("endue.git.diff");
    expect(git.of("show").at(-1)).toEqual(["show", "--format=", "-U3", "abcdef0123456789", "--"]);
    expect(view.diffs.at(-1)?.title).toBe("abcdef0");

    view.selected = { kind: "file", section: "untracked", path: "new.txt" };
    await expect(host.command("endue.git.diff")).rejects.toThrow(
      "An untracked file has no diff: stage it.",
    );
  });

  it("the desk's buffer requests switch the view, and a closed buffer falls back to status", async () => {
    const { host, view } = await mount({ script: withLog() });
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.log");
    await host.command("desk.buffers.show", { buffer: "endue.git:surface" });
    expect(view.shown.at(-1)).toBe("status");
    await host.command("desk.buffers.show", { buffer: "endue.git:1" });
    expect(view.shown.at(-1)).toBe("log");
    await host.command("desk.buffers.closed", { buffer: "endue.git:1" });
    expect(view.shown.at(-1)).toBe("status");
  });

  it("refresh reloads the status and the view on screen", async () => {
    const { host, view, git } = await mount({ script: withLog() });
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.log");
    const before = git.calls.length;
    await host.command("endue.git.refresh");
    expect(git.calls.slice(before).map((c) => c.args[0])).toEqual([
      "status",
      "stash",
      "log",
      "remote",
      "log",
    ]);
    expect(view.logs).toHaveLength(2);
  });

  it("a reload of the surface opens the saved repository and view again", async () => {
    const { view, git } = await mount({
      script: withLog(),
      state: { root: ROOT, view: "log" },
    });
    expect(git.calls[0]?.args).toEqual(["rev-parse", "--show-toplevel"]);
    expect(view.headers.at(-1)?.repo?.root).toBe(ROOT);
    expect(view.shown.at(-1)).toBe("log");
  });

  it("the clean status reads as clean", () => {
    expect(CLEAN_STATUS).toContain("# branch.head main");
  });
});
