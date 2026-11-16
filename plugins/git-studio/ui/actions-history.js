// The history actions a person starts from a menu, a drag or the toolbar: each asks what it needs
// (a name, a mode, a yes for what rewrites or deletes), runs through app.act, and says what happens
// next when git stops half way (conflicts) or refuses (a branch that is not merged).

import { h } from "./dom.js";
import { shortSha } from "./format.js";
import { createHistoryOps } from "./ops-history.js";
import { ask, confirm } from "./overlay.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./parse.js").Ref} Ref
 */

/** @param {App} app @param {HTMLElement} layer */
export function createHistoryActions(app, layer) {
  const ops = () => createHistoryOps(app.git, /** @type {string} */ (app.get().repo));
  const snap = () => /** @type {import("./repo.js").Snapshot} */ (app.get().snapshot);
  const code = (/** @type {string} */ text) => h("code", null, text);
  const current = () => snap().status.branch;
  const messageOf = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
  /** Redo's stack: where HEAD was before each undo. @type {string[]} */
  const redo = [];

  /** Run an operation that may stop on conflicts; say so plainly when it does. */
  async function mayConflict(
    /** @type {string} */ done,
    /** @type {() => Promise<unknown>} */ work,
  ) {
    /** @type {unknown} */
    let failure = null;
    try {
      await work();
    } catch (error) {
      failure = error;
    }
    await app.refresh();
    // git says CONFLICT on stdout, so the repository's state is what tells.
    const stopped = (snap().status.conflicts.length ?? 0) > 0;
    if (stopped) app.say("Stopped on conflicts: resolve them, then Continue.", "danger");
    else if (failure) app.say(messageOf(failure), "danger");
    else app.say(done, "success");
  }

  const actions = {
    ops,
    /** A new branch at `sha` (the selection, or HEAD), switched to unless asked not to. */
    async createBranch(/** @type {string | null} */ sha = null) {
      const start = sha ?? snap().status.oid ?? "HEAD";
      const answer = await ask(layer, {
        title: "Create a branch",
        icon: "branch",
        body: h("span", null, "From ", code(shortSha(start)), "."),
        fields: [
          { name: "name", label: "Name", placeholder: "feature/my-change", mono: true },
          { name: "checkout", label: "Switch to it", kind: "check", value: true },
        ],
        confirm: "Create branch",
        check: (v) => (String(v.name).trim() === "" ? "Give the branch a name." : null),
      });
      if (!answer) return;
      const name = String(answer.name).trim().replace(/\s+/g, "-");
      if (!(await ops().validBranch(name)))
        return app.say(`“${name}” is not a valid branch name.`, "danger");
      await app.act(`Created ${name}`, () =>
        ops().createBranch(name, start, { checkout: answer.checkout === true }),
      );
    },

    async renameBranch(/** @type {Ref} */ ref) {
      const answer = await ask(layer, {
        title: "Rename the branch",
        icon: "edit",
        fields: [{ name: "name", label: "New name", value: ref.name, mono: true }],
        confirm: "Rename",
      });
      const name = String(answer?.name ?? "").trim();
      if (!answer || !name || name === ref.name) return;
      if (!(await ops().validBranch(name)))
        return app.say(`“${name}” is not a valid branch name.`, "danger");
      await app.act(`Renamed ${ref.name} to ${name}`, () => ops().renameBranch(ref.name, name));
    },

    /** Delete a local branch; when git says it is not merged, ask again before forcing. */
    async deleteBranch(/** @type {Ref} */ ref) {
      if (ref.current)
        return app.say("Switch to another branch before deleting this one.", "danger");
      const ok = await confirm(layer, {
        title: "Delete this branch?",
        icon: "trash",
        danger: true,
        body: h(
          "span",
          null,
          code(ref.name),
          " is removed from this repository; its commits stay while another branch has them.",
        ),
        confirm: "Delete",
      });
      if (!ok) return;
      try {
        await ops().deleteBranch(ref.name);
        app.say(`Deleted ${ref.name}`, "success");
      } catch (error) {
        if (!/not fully merged/i.test(messageOf(error))) app.say(messageOf(error), "danger");
        else if (
          await confirm(layer, {
            title: "Not merged yet",
            icon: "alert",
            danger: true,
            body: h(
              "span",
              null,
              code(ref.name),
              " has commits no other branch has. Delete it anyway? Its commits stay in the reflog for a while.",
            ),
            confirm: "Delete anyway",
          })
        )
          await ops()
            .deleteBranch(ref.name, { force: true })
            .then(
              () => app.say(`Deleted ${ref.name}`, "success"),
              (e) => app.say(messageOf(e), "danger"),
            );
      }
      await app.refresh();
    },

    async deleteRemoteBranch(/** @type {Ref} */ ref) {
      const remote = ref.remote ?? "origin";
      const branch = ref.name.slice(remote.length + 1);
      const ok = await confirm(layer, {
        title: "Delete the remote branch?",
        icon: "cloud",
        danger: true,
        body: h("span", null, code(branch), " is deleted on ", code(remote), " for everyone."),
        confirm: "Delete on remote",
      });
      if (ok) await app.act(`Deleted ${ref.name}`, () => ops().deleteRemoteBranch(remote, branch));
    },

    async setUpstream(/** @type {Ref} */ ref) {
      const remotes = snap().refs.filter((r) => r.kind === "remote");
      if (remotes.length === 0) return app.say("There is no remote branch to track.", "danger");
      const answer = await ask(layer, {
        title: "Track a remote branch",
        icon: "cloud",
        fields: [
          {
            name: "upstream",
            label: `Upstream of ${ref.name}`,
            kind: "select",
            value: ref.upstream ?? `origin/${ref.name}`,
            options: remotes.map((r) => ({ value: r.name, label: r.name })),
          },
        ],
        confirm: "Track",
      });
      if (answer)
        await app.act(`${ref.name} tracks ${answer.upstream}`, () =>
          ops().setUpstream(ref.name, String(answer.upstream)),
        );
    },

    async createTag(/** @type {string} */ sha) {
      const answer = await ask(layer, {
        title: "Create a tag",
        icon: "tag",
        body: h("span", null, "On ", code(shortSha(sha)), "."),
        fields: [
          { name: "name", label: "Name", placeholder: "v1.2.0", mono: true },
          { name: "message", label: "Message (makes an annotated tag)", placeholder: "Optional" },
        ],
        confirm: "Create tag",
        check: (v) => (String(v.name).trim() === "" ? "Give the tag a name." : null),
      });
      if (answer)
        await app.act(`Tagged ${answer.name}`, () =>
          ops().createTag(String(answer.name).trim(), sha, String(answer.message ?? "")),
        );
    },
    async deleteTag(/** @type {Ref} */ ref) {
      const ok = await confirm(layer, {
        title: "Delete this tag?",
        icon: "trash",
        danger: true,
        body: h("span", null, code(ref.name), " is deleted here; a copy on a remote stays."),
        confirm: "Delete",
      });
      if (ok) await app.act(`Deleted the tag ${ref.name}`, () => ops().deleteTag(ref.name));
    },
    pushTag: (/** @type {Ref} */ ref) =>
      app.act(`Pushed ${ref.name}`, () =>
        ops().pushTag(snap().remotes[0]?.name ?? "origin", ref.name),
      ),

    /** Merge `ref` into the current branch, asking how. */
    async merge(/** @type {string} */ ref) {
      const into = current();
      if (!into) return app.say("Switch to a branch to merge into it.", "danger");
      const answer = await ask(layer, {
        title: `Merge into ${into}`,
        icon: "merge",
        body: h("span", null, code(ref), " comes into ", code(into), "."),
        fields: [
          {
            name: "mode",
            label: "How",
            kind: "select",
            value: "auto",
            options: [
              { value: "auto", label: "Fast-forward when possible, else a merge commit" },
              { value: "no-ff", label: "Always a merge commit" },
              { value: "ff-only", label: "Fast-forward only" },
              { value: "squash", label: "Squash into staged changes (commit them yourself)" },
            ],
          },
        ],
        confirm: "Merge",
      });
      if (answer)
        await mayConflict(`Merged ${ref} into ${into}`, () =>
          ops().merge(ref, { mode: /** @type {"auto"} */ (answer.mode) }),
        );
    },

    async rebase(/** @type {string} */ onto) {
      const branch = current();
      if (!branch) return app.say("Switch to a branch to rebase it.", "danger");
      const ok = await confirm(layer, {
        title: `Rebase ${branch}`,
        icon: "branch",
        body: h(
          "span",
          null,
          "The commits of ",
          code(branch),
          " are replayed on top of ",
          code(onto),
          ". They get new ids: a branch already pushed needs a force push after.",
        ),
        confirm: "Rebase",
      });
      if (ok) await mayConflict(`Rebased ${branch} onto ${onto}`, () => ops().rebase(onto));
    },

    async cherryPick(
      /** @type {import("./repo.js").CommitDetail | import("./parse.js").Commit} */ commit,
    ) {
      const mainline = commit.parents.length > 1 ? 1 : 0;
      await mayConflict(`Cherry-picked ${shortSha(commit.sha)}`, () =>
        ops().cherryPick(commit.sha, { mainline }),
      );
    },
    async revert(
      /** @type {import("./repo.js").CommitDetail | import("./parse.js").Commit} */ commit,
    ) {
      const ok = await confirm(layer, {
        title: "Revert this commit?",
        icon: "revert",
        body: h(
          "span",
          null,
          "A new commit undoes ",
          code(shortSha(commit.sha)),
          " on ",
          code(current() ?? "HEAD"),
          ".",
        ),
        confirm: "Revert",
      });
      if (ok)
        await mayConflict(`Reverted ${shortSha(commit.sha)}`, () =>
          ops().revert(commit.sha, { mainline: commit.parents.length > 1 ? 1 : 0 }),
        );
    },

    /** Move the current branch to `sha`; hard says what it throws away. */
    async reset(/** @type {string} */ sha, /** @type {"soft" | "mixed" | "hard"} */ mode) {
      const branch = current() ?? "HEAD";
      const words = {
        soft: "Commits after it come back as staged changes.",
        mixed: "Commits after it come back as unstaged changes.",
        hard: "Commits after it and every uncommitted change are thrown away.",
      };
      const ok = await confirm(layer, {
        title: `Reset ${branch} here (${mode})?`,
        icon: "reset",
        danger: mode === "hard",
        body: h(
          "span",
          null,
          code(branch),
          " moves to ",
          code(shortSha(sha)),
          ". ",
          words[mode],
          " Undo can bring the branch back.",
        ),
        confirm: `Reset (${mode})`,
      });
      if (ok) await app.act(`Reset ${branch} to ${shortSha(sha)}`, () => ops().reset(sha, mode));
    },

    /** Continue, skip or abort the operation in progress. */
    async proceed(/** @type {"continue" | "skip" | "abort"} */ how) {
      const op = snap().operation;
      if (!op) return;
      if (
        how === "abort" &&
        !(await confirm(layer, {
          title: `Abort the ${op}?`,
          icon: "x",
          danger: true,
          body: "Everything goes back to how it was before it started.",
          confirm: "Abort",
        }))
      )
        return;
      await mayConflict(
        how === "abort"
          ? `Aborted the ${op}`
          : `${op} ${how === "skip" ? "skipped a commit" : "continued"}`,
        () => ops().proceed(op, how),
      );
    },

    /** Take back the last move of HEAD (a commit, reset, merge, rebase, checkout) from the reflog. */
    async undo() {
      const log = await ops()
        .reflog(2)
        .catch(() => []);
      const [now, before] = log;
      if (!now || !before) return app.say("Nothing to undo.");
      const moved = /^checkout: moving from (\S+) to (\S+)$/.exec(now.message);
      if (moved) {
        const back = moved[1] ?? "";
        const ok = await confirm(layer, {
          title: "Undo the switch?",
          icon: "undo",
          body: h("span", null, "Switch back to ", code(back), "."),
          confirm: "Undo",
        });
        if (ok) await app.act(`Switched back to ${back}`, () => ops().switchTo(back));
        return;
      }
      const ok = await confirm(layer, {
        title: "Undo the last change?",
        icon: "undo",
        body: h(
          "span",
          null,
          "Last: ",
          code(now.message),
          ". HEAD goes back to ",
          code(shortSha(before.sha)),
          "; uncommitted changes stay.",
        ),
        confirm: "Undo",
      });
      if (!ok) return;
      redo.push(now.sha);
      await app.act(`Undid “${now.message}”`, () => ops().reset(before.sha, "keep"));
    },
    async redo() {
      const sha = redo.pop();
      if (!sha) return app.say("Nothing to redo.");
      await app.act(`Redid: HEAD is at ${shortSha(sha)} again`, () => ops().reset(sha, "keep"));
    },
  };
  return actions;
}

/** @typedef {ReturnType<typeof createHistoryActions>} HistoryActions */
