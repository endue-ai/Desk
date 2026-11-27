// Git Studio's commands (endue.git-studio.*): the palette, Eris, agents and the CLI reach the same
// operations as the window's buttons. Each answer is plain data; a failure is an Error in words.

import { WIP } from "./app.js";
import { registerNetwork } from "./commands-network.js";
import { registerReads } from "./commands-read.js";
import { registerWrites } from "./commands-write.js";
import { findCommits } from "./history.js";
import { changeCount } from "./parse-status.js";

/** How many commits endue.git-studio.state hands back. */
const STATE_COMMITS = 15;
/** How many branches and tags it names, and how many files of each kind: an agent reads the answer
 * whole, and a brain cuts a long one, so the counts say what the lists leave out. */
const STATE_REFS = 30;
const STATE_FILES = 100;
/** How many commits endue.git-studio.log answers: when none is asked for, and at most. */
const LOG_COMMITS = 50;
const LOG_MAX = 200;

/** @param {ReturnType<typeof import("./studio.js").createStudio>} studio @param {import("@endue-ai/plugin-sdk").PluginCommands} commands */
export function registerCommands(studio, commands) {
  const { app, actions, history, extra, center, toolbar } = studio;
  const need = () => {
    const repo = app.get().repo;
    if (!repo) throw new Error("No repository is open in Git Studio.");
    return repo;
  };
  const snap = () => {
    need();
    const s = app.get().snapshot;
    if (!s) throw new Error("The repository is still being read.");
    return s;
  };

  /** @type {import("./command-input.js").Register} */
  const on = (id, handler) =>
    commands.on(`endue.git-studio.${id}`, (args, invocation) => handler(args ?? {}, invocation));

  registerReads(on, app, need);
  registerNetwork(on, studio, need);
  registerWrites(on, studio, need);

  on("state", () => {
    const s = snap();
    const heads = s.refs.filter((r) => r.kind === "head");
    const tags = s.refs.filter((r) => r.kind === "tag");
    const file = (/** @type {{ path: string, change: string }} */ f) => ({
      path: f.path,
      change: f.change,
    });
    return {
      root: s.root,
      branch: s.status.branch,
      head: s.status.oid,
      upstream: s.status.upstream,
      ahead: s.status.ahead,
      behind: s.status.behind,
      operation: s.operation,
      changes: changeCount(s.status),
      recent: s.commits.slice(0, STATE_COMMITS).map(commitData),
      staged: s.status.staged.slice(0, STATE_FILES).map(file),
      unstaged: s.status.unstaged.slice(0, STATE_FILES).map(file),
      conflicts: s.status.conflicts.map((c) => ({ path: c.path, label: c.label })),
      stashes: s.stashes.map((x) => ({ index: x.index, sha: x.sha, message: x.message })),
      branchCount: heads.length,
      // The current branch first: it is the one a question is most often about.
      branches: [...heads.filter((r) => r.current), ...heads.filter((r) => !r.current)]
        .slice(0, STATE_REFS)
        .map((r) => ({
          name: r.name,
          current: r.current,
          upstream: r.upstream,
          ahead: r.ahead,
          behind: r.behind,
        })),
      tagCount: tags.length,
      tags: tags.slice(0, STATE_REFS).map((r) => r.name),
    };
  });
  /** @typedef {{ query?: string, mode?: "text" | "code" | "path", author?: string, limit?: number }} Find */
  on("log", async (/** @type {Find} */ args) => {
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? LOG_COMMITS), 1), LOG_MAX);
    const found = await findCommits(app.git, need(), { ...args, limit });
    return { commits: found.commits.map(commitData), more: found.more };
  });
  on("refresh", async () => {
    need();
    await app.refresh();
    return { ok: true };
  });
  on("fetch", async () => {
    need();
    await actions.fetch();
    return { ok: true };
  });

  /** Commit what is staged, with a message given (agents) or written in the window (the palette). */
  on(
    "commit",
    async (
      /** @type {{ message?: string, amend?: boolean, signOff?: boolean, all?: boolean }} */ args,
    ) => {
      const s = snap();
      if (args.all) await actions.stage([]);
      if (!args.message) {
        await app.select(WIP);
        studio.wip.focus();
        return { committed: null, waiting: "Write the message in the composer." };
      }
      if (!args.amend && (app.get().snapshot?.status.staged.length ?? s.status.staged.length) === 0)
        throw new Error("Nothing is staged to commit.");
      const ok = await actions.commit({
        message: args.message,
        amend: args.amend === true,
        signOff: args.signOff === true,
        push: false,
      });
      if (!ok) throw new Error("The commit did not go through: the status bar says why.");
      return { committed: app.get().snapshot?.status.oid ?? null };
    },
  );
  on("stage", async (/** @type {{ paths?: string[] }} */ args) => {
    need();
    await actions.stage(args.paths ?? []);
    return { staged: app.get().snapshot?.status.staged.map((f) => f.path) ?? [] };
  });

  on(
    "branch",
    async (/** @type {{ name?: string, start?: string, checkout?: boolean }} */ args) => {
      need();
      if (!args.name) return history.createBranch(args.start ?? null).then(() => ({ asked: true }));
      const ops = history.ops();
      if (!(await ops.validBranch(args.name)))
        throw new Error(`"${args.name}" is not a valid branch name.`);
      await app.act(`Created ${args.name}`, () =>
        ops.createBranch(String(args.name), args.start ?? "HEAD", {
          checkout: args.checkout !== false,
        }),
      );
      return { branch: args.name };
    },
  );
  on("switch", async (/** @type {{ ref: string }} */ args) => {
    const s = snap();
    const ref = s.refs.find((r) => r.name === args.ref);
    if (!ref) throw new Error(`No branch or tag named ${args.ref}.`);
    await actions.checkout(ref);
    return { branch: app.get().snapshot?.status.branch ?? null };
  });

  on("search", (/** @type {{ query?: string, mode?: "text" | "code" | "path" }} */ args) => {
    need();
    const query = args.query ?? "";
    const mode = args.mode ?? "text";
    toolbar.setSearch(query);
    app.set({ query, searchMode: mode, deep: null });
    if (!query) toolbar.focusSearch();
    return { query, mode };
  });
  on("history", (/** @type {{ path: string }} */ args) => {
    need();
    extra.history(args.path);
    return { path: args.path };
  });
  on("blame", (/** @type {{ path: string }} */ args) => {
    need();
    extra.blame(args.path);
    return { path: args.path };
  });
  on("graph", () => {
    need();
    center.back();
    return { ok: true };
  });
}

/** A commit as a command answers it. */
const commitData = (/** @type {import("./parse.js").Commit} */ c) => ({
  sha: c.sha,
  subject: c.subject,
  author: c.author,
  date: c.date,
});
