// What the person's clicks do: each action reads what it needs from the app's state, asks when the
// step is hard to undo (discard, force push), runs the operation through app.act (said, then the
// repository read again), and offers the next step when git refuses (no upstream, no fast-forward).

import { h } from "./dom.js";
import { createOps } from "./ops.js";
import { ask, confirm } from "./overlay.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./parse-status.js").FileChange} FileChange
 */

/** @param {App} app @param {HTMLElement} layer */
export function createActions(app, layer) {
  const ops = () => createOps(app.git, /** @type {string} */ (app.get().repo));
  const snap = () => /** @type {import("./repo.js").Snapshot} */ (app.get().snapshot);
  const code = (/** @type {string} */ text) => h("code", null, text);

  const actions = {
    ops,
    stage: (/** @type {string[]} */ paths) =>
      app.act(
        paths.length
          ? `Staged ${paths.length === 1 ? paths[0] : `${paths.length} files`}`
          : "Staged every change",
        () => ops().stage(paths),
        { quiet: paths.length > 0 },
      ),
    unstage: (/** @type {string[]} */ paths) =>
      app.act("Unstaged", () => ops().unstage(paths, { born: snap().status.oid !== null }), {
        quiet: paths.length > 0,
      }),

    /** Throw changes away after asking: untracked files are deleted. */
    async discard(/** @type {FileChange[]} */ files) {
      if (files.length === 0) return;
      const untracked = files.filter((f) => f.change === "?").map((f) => f.path);
      const tracked = files.filter((f) => f.change !== "?").map((f) => f.path);
      const one = files.length === 1 ? /** @type {FileChange} */ (files[0]) : null;
      const ok = await confirm(layer, {
        title: one ? "Discard this change?" : `Discard ${files.length} changes?`,
        icon: "trash",
        danger: true,
        body: h(
          "span",
          null,
          one ? code(one.path) : "Every unstaged change",
          untracked.length
            ? " — untracked files are deleted."
            : " goes back to its last committed state.",
          " This cannot be undone.",
        ),
        confirm: "Discard",
      });
      if (ok) await app.act("Discarded", () => ops().discard({ tracked, untracked }));
    },

    /** Commit the composer's draft; push after it when asked. Resolves whether it committed. */
    async commit(
      /** @type {{ message: string, amend: boolean, signOff: boolean, push: boolean }} */ draft,
    ) {
      let ok = false;
      await app.act(draft.amend ? "Amended the last commit" : "Committed", async () => {
        const sha = await ops().commit({
          message: draft.message,
          amend: draft.amend,
          signOff: draft.signOff,
        });
        ok = true;
        app.set({ selected: sha });
      });
      if (ok && draft.push) await actions.push();
      return ok;
    },
    amendMessage: async (/** @type {boolean} */ on) =>
      on
        ? ops()
            .lastMessage()
            .catch(() => null)
        : null,

    fetch: () => app.act("Fetched every remote", () => ops().fetch()),

    /** Pull fast-forward; when the branches went apart, ask how to bring them together. */
    async pull() {
      const s = snap().status;
      if (!s.upstream) return app.say("This branch has no upstream to pull from.", "danger");
      try {
        await ops().pull({ mode: "ff" });
        app.say(`Pulled ${s.upstream}`, "success");
        await app.refresh();
        return;
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!/fast-forward|diverg/i.test(text)) {
          app.say(text, "danger");
          await app.refresh();
          return;
        }
      }
      const answer = await ask(layer, {
        title: "The branches went apart",
        icon: "merge",
        body: h(
          "span",
          null,
          code(s.branch ?? "HEAD"),
          ` and `,
          code(s.upstream),
          " both have commits the other lacks.",
        ),
        fields: [
          {
            name: "mode",
            label: "Bring them together by",
            kind: "select",
            value: "rebase",
            options: [
              { value: "rebase", label: "Rebasing my commits on top (a straight line)" },
              { value: "merge", label: "Merging (a merge commit)" },
            ],
          },
        ],
        confirm: "Pull",
      });
      if (answer)
        await app.act("Pulled", () =>
          ops().pull({ mode: /** @type {"rebase" | "merge"} */ (answer.mode) }),
        );
    },

    /** Push; without an upstream ask where to, and when the remote moved offer a force with lease. */
    async push() {
      const s = snap().status;
      if (!s.branch) return app.say("Switch to a branch to push it.", "danger");
      if (!s.upstream) {
        const remotes = snap().remotes;
        if (remotes.length === 0)
          return app.say("This repository has no remote to push to.", "danger");
        const answer = await ask(layer, {
          title: "Push a new branch",
          icon: "push",
          body: h("span", null, code(s.branch), " has no upstream yet."),
          fields: [
            {
              name: "remote",
              label: "Remote",
              kind: "select",
              value: remotes[0]?.name,
              options: remotes.map((r) => ({ value: r.name, label: `${r.name} — ${r.url}` })),
            },
          ],
          confirm: "Push and track",
        });
        if (!answer) return;
        await app.act(`Pushed ${s.branch} to ${answer.remote}`, () =>
          ops().push({ remote: String(answer.remote), branch: s.branch ?? "", setUpstream: true }),
        );
        return;
      }
      try {
        await ops().push();
        app.say(`Pushed to ${s.upstream}`, "success");
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!/rejected|non-fast-forward|fetch first/i.test(text)) app.say(text, "danger");
        else {
          const force = await confirm(layer, {
            title: "The remote has commits you don't",
            icon: "alert",
            danger: true,
            body: h(
              "span",
              null,
              code(s.upstream),
              " moved since you last pulled. Pull first, or replace it with your branch (",
              code("--force-with-lease"),
              ": only if nobody pushed since your last fetch).",
            ),
            confirm: "Force push",
            cancel: "Keep the remote",
          });
          if (force) await app.act("Force-pushed with lease", () => ops().push({ force: true }));
        }
      }
      await app.refresh();
    },

    /** Stash every change after asking for a name. */
    async stash() {
      const answer = await ask(layer, {
        title: "Stash the changes",
        icon: "stash",
        fields: [
          { name: "message", label: "Name", placeholder: "What these changes are", value: "" },
          { name: "untracked", label: "Include untracked files", kind: "check", value: true },
          { name: "keep", label: "Keep the staged changes in place", kind: "check", value: false },
        ],
        confirm: "Stash",
      });
      if (answer)
        await app.act("Stashed", () =>
          ops().stashPush({
            message: String(answer.message || ""),
            untracked: answer.untracked === true,
            keepIndex: answer.keep === true,
          }),
        );
    },
    pop: (index = 0) => {
      if (snap().stashes.length === 0) return app.say("There is no stash to pop.");
      return app.act("Applied the stash and dropped it", () => ops().stashPop(index));
    },
    apply: (index = 0) => app.act("Applied the stash", () => ops().stashApply(index)),
    async dropStash(/** @type {import("./parse.js").Stash} */ stash) {
      const ok = await confirm(layer, {
        title: "Drop this stash?",
        icon: "trash",
        danger: true,
        body: h("span", null, code(stash.name), ` ${stash.message}. This cannot be undone.`),
        confirm: "Drop",
      });
      if (ok) await app.act("Dropped the stash", () => ops().stashDrop(stash.index));
    },

    /** Switch to a branch; a remote one switches to its local branch, made to track it if needed. */
    checkout(/** @type {import("./parse.js").Ref} */ ref) {
      const local = ref.kind === "remote" ? ref.name.replace(/^[^/]+\//, "") : ref.name;
      const hasLocal =
        ref.kind === "remote" && snap().refs.some((r) => r.kind === "head" && r.name === local);
      const spec = hasLocal
        ? { ref: local }
        : { ref: ref.name, remote: ref.kind === "remote", detach: ref.kind === "tag" };
      return app.act(ref.kind === "tag" ? `Checked out ${ref.name}` : `Switched to ${local}`, () =>
        ops().checkout(spec),
      );
    },
  };
  return actions;
}

/** @typedef {ReturnType<typeof createActions>} Actions */
