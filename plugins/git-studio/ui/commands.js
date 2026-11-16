// Git Studio's commands (endue.git-studio.*): the palette, Eris, agents and the CLI reach the same
// operations as the window's buttons. Each answer is plain data; a failure is an Error in words.
// Operations that throw work away (discard, force push, hard reset) are not commands: they stay
// with the person, behind the window's own questions.

import { WIP } from "./app.js";
import { changeCount } from "./parse-status.js";

/** How many commits and refs endue.git-studio.state hands back. */
const STATE_COMMITS = 15;

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

  /** @param {string} id @param {(args: any) => unknown} handler */
  const on = (id, handler) => commands.on(`endue.git-studio.${id}`, (args) => handler(args ?? {}));

  on("state", () => {
    const s = snap();
    return {
      root: s.root,
      branch: s.status.branch,
      head: s.status.oid,
      upstream: s.status.upstream,
      ahead: s.status.ahead,
      behind: s.status.behind,
      operation: s.operation,
      changes: changeCount(s.status),
      staged: s.status.staged.map((f) => ({ path: f.path, change: f.change })),
      unstaged: s.status.unstaged.map((f) => ({ path: f.path, change: f.change })),
      conflicts: s.status.conflicts.map((c) => ({ path: c.path, label: c.label })),
      branches: s.refs
        .filter((r) => r.kind === "head")
        .map((r) => ({
          name: r.name,
          current: r.current,
          upstream: r.upstream,
          ahead: r.ahead,
          behind: r.behind,
        })),
      tags: s.refs.filter((r) => r.kind === "tag").map((r) => r.name),
      stashes: s.stashes.map((x) => ({ index: x.index, message: x.message })),
      recent: s.commits
        .slice(0, STATE_COMMITS)
        .map((c) => ({ sha: c.sha, subject: c.subject, author: c.author, date: c.date })),
    };
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
  on("pull", async () => {
    need();
    await actions.pull();
    return { ok: true };
  });
  on("push", async () => {
    need();
    await actions.push();
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
