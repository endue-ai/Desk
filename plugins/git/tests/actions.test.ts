import { describe, expect, it } from "vitest";
import { type GitCall, mount, type Reply, ROOT, repository, z } from "./harness";

const HEAD = [
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +0 -0",
];
const DIRTY = z(
  ...HEAD,
  "1 M. N... 100644 100644 100644 1 2 staged.js",
  "1 .M N... 100644 100644 100644 1 2 unstaged.js",
  "? new.txt",
  "? other.txt",
);
const NO_UPSTREAM = z(HEAD[0] ?? "", "# branch.head feature");
const DETACHED = z(HEAD[0] ?? "", "# branch.head (detached)");
const INITIAL = z(
  "# branch.oid (initial)",
  "# branch.head main",
  "1 A. N... 000000 100644 100644 0 1 a.js",
);

/** A repository whose status is `status`, with extra replies. */
const repo = (status: string, table: Record<string, Reply | ((c: GitCall) => Reply)> = {}) =>
  repository({ "status --porcelain": { stdout: status }, ...table });

const open = async (options: Parameters<typeof mount>[0]) => {
  const mounted = await mount(options);
  await mounted.host.command("endue.git.status", { path: ROOT });
  return mounted;
};

describe("stage and unstage", () => {
  it("stage a path, the selection, a section or everything, then refresh", async () => {
    const { host, view, git, app } = await open({ script: repo(DIRTY) });
    await host.command("endue.git.stage", { path: "unstaged.js" });
    expect(git.of("add").at(-1)).toEqual(["add", "-A", "--", "unstaged.js"]);
    expect(git.of("status")).toHaveLength(2);
    expect(view.said.at(-1)).toBe("Staged unstaged.js.");

    view.selected = { kind: "section", section: "untracked" };
    await app.stage();
    expect(git.of("add").at(-1)).toEqual(["add", "--", "new.txt", "other.txt"]);
    view.selected = { kind: "section", section: "unstaged" };
    await app.stage();
    expect(git.of("add").at(-1)).toEqual(["add", "-u"]);
    await app.stageAll();
    expect(git.of("add").at(-1)).toEqual(["add", "-A"]);
    expect(view.said.at(-1)).toBe("Staged everything.");

    view.selected = undefined;
    await expect(host.command("endue.git.stage")).rejects.toThrow("Select a file to stage.");
    view.selected = { kind: "hunk", path: "x", index: 0 };
    await app.stage();
    expect(view.said.at(-1)).toMatch(/^Staging part of a file needs git to read a patch/);
  });

  it("unstage restores the index from HEAD, or removes the entry before the first commit", async () => {
    const { host, git, app } = await open({ script: repo(DIRTY) });
    await host.command("endue.git.unstage", { path: "staged.js" });
    expect(git.of("restore").at(-1)).toEqual(["restore", "--staged", "--", "staged.js"]);
    await app.unstageAll();
    expect(git.of("restore").at(-1)).toEqual(["restore", "--staged", "--", "."]);

    const fresh = await open({ script: repo(INITIAL) });
    await fresh.host.command("endue.git.unstage", { path: "a.js" });
    expect(fresh.git.of("rm").at(-1)).toEqual(["rm", "--cached", "-q", "-r", "--", "a.js"]);
  });
});

describe("discard", () => {
  it("asks first, then restores a tracked file or deletes an untracked one", async () => {
    const asked: unknown[] = [];
    let answer = "no";
    const { host, view, git } = await open({
      script: repo(DIRTY),
      commands: {
        "desk.palette.pick": (args) => {
          asked.push(args);
          return answer;
        },
      },
    });
    await host.command("endue.git.discard", { path: "unstaged.js" });
    expect(asked).toEqual([
      {
        title: "Discard the changes to unstaged.js?",
        items: [
          { id: "yes", label: "Discard them" },
          { id: "no", label: "Keep everything as it is" },
        ],
      },
    ]);
    expect(git.of("restore")).toEqual([]);

    answer = "yes";
    await host.command("endue.git.discard", { path: "unstaged.js" });
    expect(git.of("restore").at(-1)).toEqual(["restore", "--worktree", "--", "unstaged.js"]);
    expect(view.said.at(-1)).toBe("Discarded the changes to unstaged.js.");

    await host.command("endue.git.discard", { path: "new.txt" });
    expect(asked.at(-1)).toMatchObject({ title: "Delete new.txt?" });
    expect(git.of("clean").at(-1)).toEqual(["clean", "-fdq", "--", "new.txt"]);
  });

  it("with confirm off it does not ask; without the palette it refuses", async () => {
    const quiet = await open({ script: repo(DIRTY), init: { "endue.git.confirm": false } });
    await quiet.host.command("endue.git.discard", { path: "unstaged.js" });
    expect(quiet.ran("desk.palette.pick")).toEqual([]);
    expect(quiet.git.of("restore")).toHaveLength(1);

    const mute = await open({
      script: repo(DIRTY),
      commands: {
        "desk.palette.pick": () => {
          throw new Error("off");
        },
      },
    });
    await expect(mute.host.command("endue.git.discard", { path: "unstaged.js" })).rejects.toThrow(
      "Cannot ask: the palette is off.",
    );
    expect(mute.git.of("restore")).toEqual([]);
  });
});

describe("commit", () => {
  const committed = repo(DIRTY, { "rev-parse --short HEAD": { stdout: "abc1234\n" } });

  it("with a message it commits at once and says the new sha", async () => {
    const { host, view, git } = await open({ script: committed });
    await expect(
      host.command("endue.git.commit", { message: "feat: thing\r\n\r\nbody\n\n" }),
    ).resolves.toBe("abc1234");
    expect(git.of("commit").at(-1)).toEqual([
      "commit",
      "-q",
      "--cleanup=strip",
      "-m",
      "feat: thing\n\nbody\n",
    ]);
    expect(view.said.at(-1)).toBe("Committed abc1234.");
    expect(view.editors).toEqual([]);
  });

  it("sign-off comes from the settings or the arguments; amend passes --amend", async () => {
    const { host, git } = await open({ script: committed, init: { "endue.git.sign-off": true } });
    await host.command("endue.git.commit", { message: "x" });
    expect(git.of("commit").at(-1)).toContain("--signoff");
    await host.command("endue.git.commit", { message: "x", signOff: false, amend: true });
    expect(git.of("commit").at(-1)).toEqual([
      "commit",
      "-q",
      "--cleanup=strip",
      "--amend",
      "-m",
      "x\n",
    ]);
  });

  it("refuses an empty message and a commit with nothing staged", async () => {
    const { host } = await open({ script: committed });
    await expect(host.command("endue.git.commit", { message: "  \n" })).rejects.toThrow(
      "The commit message is empty.",
    );
    const clean = await open({ script: repository() });
    await expect(clean.host.command("endue.git.commit", { message: "x" })).rejects.toThrow(
      "Nothing is staged to commit.",
    );
  });

  it("without a message the editor opens; Mod+Enter commits, Escape cancels", async () => {
    const { host, view, git, app, settle } = await open({
      script: repo(DIRTY, {
        "rev-parse --short HEAD": { stdout: "abc1234\n" },
        "log -1 --format=%B": { stdout: "old subject\n\nold body\n\n" },
      }),
    });
    const pending = host.command("endue.git.commit");
    await settle();
    expect(view.editors.at(-1)).toEqual({ amend: false, signOff: false, staged: 1, message: "" });
    expect(view.shown.at(-1)).toBe("commit");
    await app.submitCommit("feat: typed", { amend: false, signOff: true });
    await expect(pending).resolves.toBe("abc1234");
    expect(git.of("commit").at(-1)).toEqual([
      "commit",
      "-q",
      "--cleanup=strip",
      "--signoff",
      "-m",
      "feat: typed\n",
    ]);
    expect(view.editors.at(-1)).toBeNull();
    expect(view.shown.at(-1)).toBe("status");

    const amending = host.command("endue.git.commit", { amend: true });
    await settle();
    expect(view.editors.at(-1)).toMatchObject({
      amend: true,
      message: "old subject\n\nold body\n",
    });
    await app.cancelCommit();
    await expect(amending).rejects.toThrow("cancelled");
    expect(view.shown.at(-1)).toBe("status");
  });

  it("an empty message in the editor keeps it open and says why", async () => {
    const { host, view, app, settle } = await open({ script: committed });
    void host.command("endue.git.commit").catch(() => {});
    await settle();
    await app.submitCommit("   ", { amend: false, signOff: false });
    expect(view.said.at(-1)).toBe("The commit message is empty.");
    expect(view.editors.at(-1)).not.toBeNull();
    await app.cancelCommit();
  });
});

describe("fetch, pull and push", () => {
  it("fetch prunes, pull fast-forwards or rebases, and a long run can be cancelled", async () => {
    const { host, git, view, app } = await open({
      script: repo(DIRTY, { fetch: { hang: true } }),
    });
    const fetching = host.command("endue.git.fetch");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(git.of("fetch")).toEqual([["fetch", "--prune"]]);
    expect(view.said.at(-1)).toBe("Fetching…");
    await app.cancel();
    await expect(fetching).rejects.toThrow("Cancelled.");
    expect(git.killed.at(-1)).toMatchObject({ signal: "term" });

    await host.command("endue.git.pull");
    expect(git.of("pull").at(-1)).toEqual(["pull", "--ff-only"]);
    const rebasing = await open({ script: repo(DIRTY), init: { "endue.git.pull-rebase": true } });
    await rebasing.host.command("endue.git.pull");
    expect(rebasing.git.of("pull").at(-1)).toEqual(["pull", "--rebase"]);
    expect(rebasing.view.said.at(-1)).toBe("Pulled.");
  });

  it("push goes to the upstream, or sets one on the only remote", async () => {
    const { host, git, view } = await open({ script: repo(DIRTY) });
    await host.command("endue.git.push");
    expect(git.of("push").at(-1)).toEqual(["push"]);
    expect(view.said.at(-1)).toBe("Pushed main.");

    const first = await open({ script: repo(NO_UPSTREAM) });
    await first.host.command("endue.git.push");
    expect(first.git.of("push").at(-1)).toEqual(["push", "-u", "origin", "HEAD"]);
    expect(first.view.said.at(-1)).toBe("Pushed feature to origin and set it as the upstream.");

    const detached = await open({ script: repo(DETACHED) });
    await expect(detached.host.command("endue.git.push")).rejects.toThrow(
      "HEAD is detached: switch to a branch before pushing.",
    );
  });

  it("a force push asks and then uses --force-with-lease, never --force", async () => {
    const asked: unknown[] = [];
    const { host, git } = await open({
      script: repo(DIRTY),
      commands: {
        "desk.palette.pick": (args) => {
          asked.push(args);
          return "yes";
        },
      },
    });
    await host.command("endue.git.push", { force: true });
    expect(asked[0]).toMatchObject({ title: "Force-push main?" });
    expect(git.of("push").at(-1)).toEqual(["push", "--force-with-lease"]);
  });
});

describe("switch branch and open a file", () => {
  const REFS = [
    "main\x1f1111111\x1forigin/main",
    "feature/x\x1f2222222\x1f",
    "origin/HEAD\x1f1111111\x1f",
    "origin/main\x1f1111111\x1f",
    "origin/topic\x1f3333333\x1f",
    "",
  ].join("\n");

  it("offers every branch; an existing one is switched to, a remote one tracked, a new one created", async () => {
    let choice = "feature/x";
    const asked: unknown[] = [];
    const { host, git, view } = await open({
      script: repo(DIRTY, { "for-each-ref": { stdout: REFS } }),
      commands: {
        "desk.palette.pick": (args) => {
          asked.push(args);
          return choice;
        },
      },
    });
    await host.command("endue.git.checkout");
    expect(git.of("for-each-ref").at(-1)).toEqual([
      "for-each-ref",
      "--format=%(refname:short)%1f%(objectname:short)%1f%(upstream:short)",
      "refs/heads",
      "refs/remotes",
    ]);
    expect(asked[0]).toEqual({
      title: "Switch to which branch?",
      items: [
        { id: "main", label: "main", detail: "1111111 → origin/main" },
        { id: "feature/x", label: "feature/x", detail: "2222222" },
        { id: "origin/main", label: "origin/main", detail: "1111111" },
        { id: "origin/topic", label: "origin/topic", detail: "3333333" },
      ],
      free: true,
      placeholder: "a branch name, new or existing",
    });
    expect(git.of("switch").at(-1)).toEqual(["switch", "-q", "feature/x"]);
    expect(view.said.at(-1)).toBe("Switched to feature/x.");

    choice = "origin/topic";
    await host.command("endue.git.checkout");
    expect(git.of("switch").at(-1)).toEqual(["switch", "-q", "--track", "origin/topic"]);

    await host.command("endue.git.checkout", { ref: "brand-new" });
    expect(git.of("check-ref-format").at(-1)).toEqual([
      "check-ref-format",
      "--branch",
      "brand-new",
    ]);
    expect(git.of("switch").at(-1)).toEqual(["switch", "-q", "-c", "brand-new"]);
    expect(view.said.at(-1)).toBe("Created and switched to brand-new.");
  });

  it("visit opens the selected file through the desk's files policy", async () => {
    const { host, view, ran } = await open({ script: repo(DIRTY) });
    view.selected = { kind: "file", section: "unstaged", path: "src/unstaged.js" };
    await host.command("endue.git.visit");
    expect(ran("desk.files.open")).toEqual([{ path: `${ROOT}/src/unstaged.js` }]);
    view.selected = { kind: "section", section: "staged" };
    await expect(host.command("endue.git.visit")).rejects.toThrow("Select a file to open.");
  });
});
