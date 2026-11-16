// The context menus: what a right click on a commit, a branch, a remote branch, a tag, a stash, a
// remote or a worktree offers, and what dropping one branch on another asks. Each entry calls an
// action; the menus decide only what makes sense where (the current branch can't be deleted, …).

import { WIP } from "./app.js";
import { shortSha } from "./format.js";
import { menu } from "./overlay.js";

/**
 * @typedef {import("./overlay.js").MenuItem} MenuItem
 * @typedef {import("./parse.js").Ref} Ref
 * @typedef {{ copy(text: string): void, explain(sha: string): void, openRepo(path: string): void,
 *   history(path: string): void }} MenuHooks
 */

/**
 * @param {import("./app.js").App} app @param {HTMLElement} layer
 * @param {import("./actions.js").Actions} basic @param {import("./actions-history.js").HistoryActions} history
 * @param {MenuHooks} hooks
 */
export function createMenus(app, layer, basic, history, hooks) {
  const snap = () => /** @type {import("./repo.js").Snapshot} */ (app.get().snapshot);
  const at = (/** @type {MouseEvent} */ e) => ({ x: e.clientX, y: e.clientY });
  const current = () => snap().status.branch;
  /** The commit a ref names, as a commit object for cherry-pick and revert. */
  const commitOf = (/** @type {string} */ sha) => snap().commits.find((c) => c.sha === sha);

  /** @param {MouseEvent} event @param {import("./view-graph.js").Item} item */
  function commitMenu(event, item) {
    if (item.sha === WIP) return wipMenu(event);
    const commit = item.commit;
    if (!commit) return;
    const sha = commit.sha;
    const head = snap().status.oid === sha;
    const branch = current();
    /** @type {MenuItem[]} */
    const items = [
      {
        label: "Check out this commit",
        icon: "target",
        hint: "detached",
        disabled: head,
        run: () =>
          void basic.checkout({
            kind: "tag",
            name: sha,
            full: sha,
            sha,
            upstream: null,
            ahead: 0,
            behind: 0,
            current: false,
            remote: null,
            date: 0,
            subject: "",
            gone: false,
          }),
      },
      { label: "Create a branch here…", icon: "branch", run: () => void history.createBranch(sha) },
      { label: "Create a tag here…", icon: "tag", run: () => void history.createTag(sha) },
      "-",
      {
        label: "Cherry-pick",
        icon: "cherry",
        disabled: head,
        hint: branch ? `onto ${branch}` : undefined,
        run: () => void history.cherryPick(commit),
      },
      { label: "Revert", icon: "revert", run: () => void history.revert(commit) },
      {
        label: `Merge into ${branch ?? "HEAD"}…`,
        icon: "merge",
        disabled: head || !branch,
        run: () => void history.merge(sha),
      },
      {
        label: `Rebase ${branch ?? "HEAD"} onto this…`,
        icon: "branch",
        disabled: head || !branch,
        run: () => void history.rebase(sha),
      },
      {
        label: `Reset ${branch ?? "HEAD"} to here`,
        icon: "reset",
        disabled: head,
        items: [
          { label: "Soft — keep the changes staged", run: () => void history.reset(sha, "soft") },
          {
            label: "Mixed — keep the changes unstaged",
            run: () => void history.reset(sha, "mixed"),
          },
          {
            label: "Hard — throw the changes away",
            danger: true,
            run: () => void history.reset(sha, "hard"),
          },
        ],
      },
      "-",
      { label: "Explain with AI", icon: "sparkle", run: () => hooks.explain(sha) },
      {
        label: "Copy the commit id",
        icon: "copy",
        hint: shortSha(sha),
        run: () => hooks.copy(sha),
      },
      { label: "Copy the message", icon: "copy", run: () => hooks.copy(commit.subject) },
    ];
    menu(layer, at(event), items);
  }

  /** @param {MouseEvent} event */
  function wipMenu(event) {
    const s = snap().status;
    menu(layer, at(event), [
      {
        label: "Stage every change",
        icon: "plus",
        disabled: s.unstaged.length === 0,
        run: () => void basic.stage([]),
      },
      {
        label: "Unstage everything",
        icon: "minus",
        disabled: s.staged.length === 0,
        run: () => void basic.unstage([]),
      },
      { label: "Stash the changes…", icon: "stash", run: () => void basic.stash() },
      "-",
      {
        label: "Discard every unstaged change…",
        icon: "trash",
        danger: true,
        disabled: s.unstaged.length === 0,
        run: () => void basic.discard(s.unstaged),
      },
    ]);
  }

  /** @param {MouseEvent} event @param {Ref} ref */
  function refMenu(event, ref) {
    const branch = current();
    const name = ref.name;
    /** @type {MenuItem[]} */
    let items;
    if (ref.kind === "head") {
      items = [
        {
          label: ref.current ? "Checked out" : `Switch to ${name}`,
          icon: "check",
          disabled: ref.current,
          run: () => void basic.checkout(ref),
        },
        {
          label: `Merge ${name} into ${branch ?? "HEAD"}…`,
          icon: "merge",
          disabled: ref.current || !branch,
          run: () => void history.merge(name),
        },
        {
          label: `Rebase ${branch ?? "HEAD"} onto ${name}…`,
          icon: "branch",
          disabled: ref.current || !branch,
          run: () => void history.rebase(name),
        },
        "-",
        ref.current
          ? { label: "Pull", icon: "pull", disabled: !ref.upstream, run: () => void basic.pull() }
          : null,
        ref.current ? { label: "Push", icon: "push", run: () => void basic.push() } : null,
        {
          label: ref.upstream ? `Tracks ${ref.upstream}…` : "Track a remote branch…",
          icon: "cloud",
          run: () => void history.setUpstream(ref),
        },
        {
          label: "Create a branch from here…",
          icon: "branch",
          run: () => void history.createBranch(ref.sha),
        },
        { label: "Rename…", icon: "edit", run: () => void history.renameBranch(ref) },
        {
          label: "Delete…",
          icon: "trash",
          danger: true,
          disabled: ref.current,
          run: () => void history.deleteBranch(ref),
        },
        "-",
        { label: "Copy the name", icon: "copy", run: () => hooks.copy(name) },
      ].filter(Boolean);
    } else if (ref.kind === "remote") {
      items = [
        {
          label: `Check out as ${name.replace(/^[^/]+\//, "")}`,
          icon: "laptop",
          run: () => void basic.checkout(ref),
        },
        {
          label: `Merge into ${branch ?? "HEAD"}…`,
          icon: "merge",
          disabled: !branch,
          run: () => void history.merge(name),
        },
        {
          label: `Rebase ${branch ?? "HEAD"} onto ${name}…`,
          icon: "branch",
          disabled: !branch,
          run: () => void history.rebase(name),
        },
        "-",
        {
          label: "Delete on the remote…",
          icon: "trash",
          danger: true,
          run: () => void history.deleteRemoteBranch(ref),
        },
        { label: "Copy the name", icon: "copy", run: () => hooks.copy(name) },
      ];
    } else {
      items = [
        {
          label: "Check out the tag",
          icon: "target",
          hint: "detached",
          run: () => void basic.checkout(ref),
        },
        {
          label: "Create a branch from here…",
          icon: "branch",
          run: () => void history.createBranch(ref.sha),
        },
        {
          label: "Push the tag",
          icon: "push",
          disabled: snap().remotes.length === 0,
          run: () => void history.pushTag(ref),
        },
        "-",
        {
          label: "Delete the tag…",
          icon: "trash",
          danger: true,
          run: () => void history.deleteTag(ref),
        },
        { label: "Copy the name", icon: "copy", run: () => hooks.copy(name) },
      ];
    }
    menu(layer, at(event), /** @type {MenuItem[]} */ (items));
  }

  /** @param {MouseEvent} event @param {import("./view-sidebar.js").Entry} entry */
  function sideMenu(event, entry) {
    if (entry.kind === "ref") return refMenu(event, entry.ref);
    if (entry.kind === "stash") {
      const { stash } = entry;
      return menu(layer, at(event), [
        { label: "Apply", icon: "check", run: () => void basic.apply(stash.index) },
        { label: "Pop (apply and drop)", icon: "pop", run: () => void basic.pop(stash.index) },
        "-",
        { label: "Drop…", icon: "trash", danger: true, run: () => void basic.dropStash(stash) },
      ]);
    }
    if (entry.kind === "remote") {
      const { name } = entry;
      const url = snap().remotes.find((r) => r.name === name)?.url ?? "";
      return menu(layer, at(event), [
        {
          label: `Fetch ${name}`,
          icon: "fetch",
          run: () => void app.act(`Fetched ${name}`, () => history.ops().fetchRemote(name)),
        },
        { label: "Copy the URL", icon: "copy", disabled: !url, run: () => hooks.copy(url) },
      ]);
    }
    const { worktree } = entry;
    return menu(layer, at(event), [
      {
        label: "Open in Git Studio",
        icon: "worktree",
        disabled: worktree.path === app.get().repo,
        run: () => hooks.openRepo(worktree.path),
      },
      { label: "Copy the path", icon: "copy", run: () => hooks.copy(worktree.path) },
    ]);
  }

  /**
   * A branch dropped on another (or on a commit): merge or rebase, with the current branch.
   * @param {MouseEvent | { clientX: number, clientY: number }} event @param {string} dragged @param {string} target
   */
  function dropMenu(event, dragged, target) {
    const branch = current();
    /** @type {MenuItem[]} */
    let items;
    if (branch && target === branch) {
      items = [
        {
          label: `Merge ${dragged} into ${branch}…`,
          icon: "merge",
          run: () => void history.merge(dragged),
        },
        {
          label: `Rebase ${branch} onto ${dragged}…`,
          icon: "branch",
          run: () => void history.rebase(dragged),
        },
      ];
    } else if (branch && dragged === branch) {
      items = [
        {
          label: `Rebase ${branch} onto ${target}…`,
          icon: "branch",
          run: () => void history.rebase(target),
        },
        {
          label: `Merge ${target} into ${branch}…`,
          icon: "merge",
          run: () => void history.merge(target),
        },
      ];
    } else {
      items = [
        {
          label: `Switch to ${branch === target ? dragged : target} first: merges and rebases change the branch you are on.`,
          disabled: true,
        },
      ];
    }
    menu(layer, { x: event.clientX, y: event.clientY }, [
      ...items,
      "-",
      { label: "Cancel", icon: "x" },
    ]);
  }

  return { commitMenu, refMenu, sideMenu, dropMenu, wipMenu, commitOf };
}
