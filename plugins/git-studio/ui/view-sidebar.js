// The left side: the repository's branches (local, by remote), tags, stashes and worktrees, each a
// section that folds, with a filter on top. A click shows the commit in the graph, a double click
// switches to the branch, a right click opens its menu, and a branch drags onto another.

import { fill, h, icon } from "./dom.js";
import { relativeTime } from "./format.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./parse.js").Ref} Ref
 * @typedef {{ kind: "ref", ref: Ref } | { kind: "stash", stash: import("./parse.js").Stash } |
 *   { kind: "worktree", worktree: import("./parse.js").Worktree } | { kind: "remote", name: string }} Entry
 * @typedef {{ onReveal?(sha: string): void, onCheckout?(ref: Ref): void,
 *   onMenu?(event: MouseEvent, entry: Entry): void, onDropRef?(ref: string, target: Ref): void,
 *   onStash?(stash: import("./parse.js").Stash): void }} Hooks
 */

/** @param {App} app @param {HTMLElement} host @param {Hooks} [hooks] */
export function createSidebar(app, host, hooks = {}) {
  const folded = new Set(["tags", "worktrees"]);
  const filter = h("input.desk-field.side-filter", {
    type: "search",
    placeholder: "Filter branches, tags…",
    "aria-label": "Filter the sidebar",
    onInput: () => draw(),
  });
  const body = h("div.side-body", { role: "tree", "aria-label": "Repository" });
  host.replaceChildren(h("div.side-search", null, icon("search", 14), filter), body);

  function draw() {
    const { snapshot } = app.get();
    if (!snapshot) {
      fill(body, h("p.side-empty", null, "No repository open"));
      return;
    }
    const words = filter.value.toLowerCase().trim();
    const keep = (/** @type {string} */ name) => words === "" || name.toLowerCase().includes(words);
    const heads = snapshot.refs.filter((r) => r.kind === "head" && keep(r.name));
    const remotes = snapshot.refs.filter((r) => r.kind === "remote" && keep(r.name));
    const tags = snapshot.refs
      .filter((r) => r.kind === "tag" && keep(r.name))
      .sort((a, b) => b.date - a.date);
    const stashes = snapshot.stashes.filter((s) => keep(s.message));
    const trees = snapshot.worktrees.filter((t) => keep(t.path));

    const remoteNames = [
      ...new Set([...snapshot.remotes.map((r) => r.name), ...remotes.map((r) => r.remote ?? "")]),
    ].filter(Boolean);
    fill(
      body,
      section(
        "local",
        "Local",
        "laptop",
        heads.length,
        tree(heads, (ref) => ref.name, "local"),
      ),
      section(
        "remote",
        "Remote",
        "cloud",
        remotes.length,
        remoteNames.map((name) => {
          const mine = remotes.filter((r) => r.remote === name);
          return group(
            `remote:${name}`,
            name,
            "cloud",
            mine.length,
            tree(mine, (ref) => ref.name.slice(name.length + 1), `remote:${name}`),
            { kind: "remote", name },
          );
        }),
      ),
      section(
        "tags",
        "Tags",
        "tag",
        tags.length,
        tags.map((ref) => refRow(ref, ref.name, 1)),
      ),
      section(
        "stashes",
        "Stashes",
        "stash",
        stashes.length,
        stashes.map((stash) =>
          h(
            "div.side-row",
            {
              role: "treeitem",
              "aria-level": 2,
              title: stash.name,
              onClick: () => hooks.onStash?.(stash),
              onContextmenu: (/** @type {MouseEvent} */ e) => {
                e.preventDefault();
                hooks.onMenu?.(e, { kind: "stash", stash });
              },
            },
            icon("stash", 14),
            h("span.side-name", null, stash.message || stash.name),
            h("span.side-meta", null, relativeTime(stash.date)),
          ),
        ),
      ),
      section(
        "worktrees",
        "Worktrees",
        "worktree",
        trees.length,
        trees.map((t) =>
          h(
            "div.side-row",
            {
              role: "treeitem",
              "aria-level": 2,
              title: t.path,
              onContextmenu: (/** @type {MouseEvent} */ e) => {
                e.preventDefault();
                hooks.onMenu?.(e, { kind: "worktree", worktree: t });
              },
            },
            icon("worktree", 14),
            h("span.side-name", null, t.path.split("/").pop() ?? t.path),
            h("span.side-meta", null, t.branch ?? (t.bare ? "bare" : "detached")),
          ),
        ),
      ),
    );
  }

  /**
   * @param {string} id @param {string} title @param {keyof typeof import("./icons.js").ICONS} iconName
   * @param {number} count @param {(HTMLElement | HTMLElement[])[] | HTMLElement[]} children
   */
  function section(id, title, iconName, count, children) {
    const open = !folded.has(id);
    return h(
      "section.side-section",
      { class: open ? "is-open" : "" },
      h(
        "button.desk-row.side-head",
        {
          type: "button",
          "aria-expanded": String(open),
          onClick: () => {
            if (folded.has(id)) folded.delete(id);
            else folded.add(id);
            draw();
          },
        },
        icon(open ? "chevronDown" : "chevronRight", 14),
        icon(iconName, 14),
        h("span.side-title", null, title),
        h("span.side-count", null, count),
      ),
      open ? h("div.side-items", { role: "group" }, ...children.flat()) : null,
    );
  }

  /**
   * A folder inside a section: a remote, or a part of branch names before a slash.
   * @param {string} id @param {string} name @param {"cloud" | "folder"} iconName @param {number} count
   * @param {HTMLElement[]} children @param {Entry} [entry]
   */
  function group(id, name, iconName, count, children, entry) {
    const open = !folded.has(id);
    return h(
      "div.side-group",
      null,
      h(
        "div.side-row.side-folder",
        {
          role: "treeitem",
          "aria-expanded": String(open),
          style: { "--depth": String(id.split("/").length - 1) },
          onClick: () => {
            if (folded.has(id)) folded.delete(id);
            else folded.add(id);
            draw();
          },
          onContextmenu: entry
            ? (/** @type {MouseEvent} */ e) => {
                e.preventDefault();
                hooks.onMenu?.(e, entry);
              }
            : undefined,
        },
        icon(open ? "chevronDown" : "chevronRight", 12),
        icon(iconName === "cloud" ? "cloud" : open ? "folderOpen" : "folder", 14),
        h("span.side-name", null, name),
        h("span.side-count", null, count),
      ),
      open ? children : null,
    );
  }

  /**
   * Refs as a tree on the slashes of their names.
   * @param {Ref[]} refs @param {(ref: Ref) => string} nameOf @param {string} prefix
   * @returns {HTMLElement[]}
   */
  function tree(refs, nameOf, prefix, depth = 1) {
    /** @type {Map<string, Ref[]>} */
    const folders = new Map();
    /** @type {HTMLElement[]} */
    const leaves = [];
    for (const ref of refs) {
      const rest = nameOf(ref)
        .split("/")
        .slice(depth - 1);
      if (rest.length > 1) {
        const key = rest[0] ?? "";
        folders.set(key, [...(folders.get(key) ?? []), ref]);
      } else leaves.push(refRow(ref, rest[0] ?? ref.name, depth));
    }
    const out = [...folders].map(([name, inside]) =>
      group(
        `${prefix}/${name}`,
        name,
        "folder",
        inside.length,
        tree(inside, nameOf, `${prefix}/${name}`, depth + 1),
      ),
    );
    return [...out, ...leaves];
  }

  /** @param {Ref} ref @param {string} label @param {number} depth */
  function refRow(ref, label, depth) {
    const el = h(
      "div.side-row.side-ref",
      {
        role: "treeitem",
        "aria-level": depth + 1,
        "aria-current": ref.current ? "true" : undefined,
        class: ref.current ? "is-current" : "",
        title: ref.subject ? `${ref.name} — ${ref.subject}` : ref.name,
        style: { "--depth": String(depth) },
        draggable: ref.kind === "tag" ? undefined : "true",
        onClick: () => hooks.onReveal?.(ref.sha),
        onDblclick: () => hooks.onCheckout?.(ref),
        onContextmenu: (/** @type {MouseEvent} */ e) => {
          e.preventDefault();
          hooks.onMenu?.(e, { kind: "ref", ref });
        },
        onDragstart: (/** @type {DragEvent} */ e) => {
          e.dataTransfer?.setData("application/x-git-ref", ref.name);
        },
        onDragover: (/** @type {DragEvent} */ e) => {
          if (ref.kind === "tag" || !e.dataTransfer?.types.includes("application/x-git-ref"))
            return;
          e.preventDefault();
          el.classList.add("is-drop");
        },
        onDragleave: () => el.classList.remove("is-drop"),
        onDrop: (/** @type {DragEvent} */ e) => {
          el.classList.remove("is-drop");
          const name = e.dataTransfer?.getData("application/x-git-ref");
          if (name && name !== ref.name) hooks.onDropRef?.(name, ref);
        },
      },
      icon(ref.current ? "check" : ref.kind === "tag" ? "tag" : "branch", 14),
      h("span.side-name", null, label),
      ref.ahead
        ? h(
            "span.side-track.is-ahead",
            { title: `${ref.ahead} to push` },
            icon("arrowUp", 11),
            ref.ahead,
          )
        : null,
      ref.behind
        ? h(
            "span.side-track.is-behind",
            { title: `${ref.behind} to pull` },
            icon("arrowDown", 11),
            ref.behind,
          )
        : null,
      ref.gone ? h("span.side-track.is-gone", { title: "Its upstream is gone" }, "gone") : null,
    );
    return el;
  }

  app.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot) draw();
  });
  draw();
  return { focusFilter: () => filter.focus() };
}
