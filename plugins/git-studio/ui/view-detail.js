// The right panel for a commit: its message, author and committer, id and parents, the refs on it,
// the actions it offers, and the files it changes as a list or a folder tree, each opening its diff.

import { button, fill, h, icon } from "./dom.js";
import {
  authorColor,
  changeWord,
  chartColor,
  fullDate,
  initials,
  plural,
  relativeTime,
  shortSha,
  splitPath,
} from "./format.js";
import { refPill, refsByCommit } from "./refs.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./repo.js").CommitDetail} CommitDetail
 * @typedef {import("./parse.js").ChangedFile} ChangedFile
 * @typedef {{ onFile?(file: ChangedFile, detail: CommitDetail): void,
 *   onAction?(action: string, detail: CommitDetail): void, onCopy?(text: string): void }} Hooks
 */

/** `Authored 3 hours ago · Nov 17, 2026, 11:02`, or only the date when that is what "ago" says. */
export function when(/** @type {string} */ role, /** @type {number} */ date) {
  const relative = relativeTime(date);
  const full = fullDate(date);
  return full.startsWith(relative) ? `${role} ${full}` : `${role} ${relative} · ${full}`;
}

/** @param {App} app @param {HTMLElement} host @param {Hooks} [hooks] */
export function createDetail(app, host, hooks = {}) {
  let mode = /** @type {"list" | "tree"} */ ("list");

  function draw() {
    const { detail, selected, snapshot } = app.get();
    if (!snapshot || !selected)
      return fill(
        host,
        h(
          "div.panel-empty",
          null,
          icon("commit", 28),
          h("p", null, "Select a commit to see it here"),
        ),
      );
    if (!detail || detail.sha !== selected)
      return fill(host, h("div.panel-empty", null, h("p.desk-muted", null, "Loading…")));
    const refs = refsByCommit(snapshot.refs).get(detail.sha) ?? [];
    const added = detail.files.reduce((n, f) => n + (f.added ?? 0), 0);
    const removed = detail.files.reduce((n, f) => n + (f.removed ?? 0), 0);
    const sameCommitter =
      detail.committer === detail.author && detail.committerEmail === detail.email;
    fill(
      host,
      h(
        "div.detail",
        null,
        h(
          "div.detail-bar",
          null,
          h(
            "span.detail-kind",
            null,
            icon(detail.parents.length > 1 ? "merge" : "commit", 14),
            detail.parents.length > 1 ? "Merge commit" : "Commit",
          ),
          h(
            "button.desk-btn.desk-btn-quiet.sha-chip",
            {
              type: "button",
              title: `Copy ${detail.sha}`,
              onClick: () => hooks.onCopy?.(detail.sha),
            },
            shortSha(detail.sha),
            icon("copy", 12),
          ),
        ),
        h("h2.detail-summary", null, detail.summary),
        detail.body ? h("pre.detail-body", null, detail.body) : null,
        refs.length
          ? h(
              "div.detail-refs",
              null,
              refs.map((r) => refPill(r, 0)),
            )
          : null,
        person("Authored", detail.author, detail.email, detail.date),
        sameCommitter
          ? null
          : person("Committed", detail.committer, detail.committerEmail, detail.committerDate),
        h(
          "div.detail-parents",
          null,
          h("span.desk-muted", null, detail.parents.length > 1 ? "Parents" : "Parent"),
          detail.parents.length === 0 ? h("span.desk-muted", null, "none (root commit)") : null,
          ...detail.parents.map((p) =>
            h(
              "button.desk-btn.desk-btn-quiet.sha-chip",
              { type: "button", onClick: () => void app.select(p) },
              shortSha(p),
            ),
          ),
        ),
        h(
          "div.detail-actions",
          null,
          button({
            label: "Explain",
            icon: "sparkle",
            kind: "desk-btn-quiet",
            title: "Explain this commit with AI",
            onClick: () => hooks.onAction?.("explain", detail),
          }),
          button({
            label: "Cherry-pick",
            icon: "cherry",
            kind: "desk-btn-quiet",
            onClick: () => hooks.onAction?.("cherry-pick", detail),
          }),
          button({
            label: "Revert",
            icon: "revert",
            kind: "desk-btn-quiet",
            onClick: () => hooks.onAction?.("revert", detail),
          }),
          button({
            label: "More",
            icon: "more",
            kind: "desk-btn-quiet",
            hideLabel: true,
            onClick: () => hooks.onAction?.("menu", detail),
          }),
        ),
        h(
          "div.files-head",
          null,
          h("span.files-title", null, plural(detail.files.length, "file"), " changed"),
          h("span.stat-add", null, `+${added}`),
          h("span.stat-del", null, `−${removed}`),
          h("span.desk-bar-spacer"),
          h(
            "div.desk-tabs.mini-tabs",
            { role: "tablist", "aria-label": "File view" },
            tab("list", "list", "As a list"),
            tab("tree", "tree", "As a tree"),
          ),
        ),
        h(
          "div.files",
          { role: "list" },
          mode === "list" ? detail.files.map((f) => fileRow(f, detail, false)) : fileTree(detail),
        ),
      ),
    );
  }

  /** @param {"list" | "tree"} value @param {"list" | "tree"} iconName @param {string} label */
  function tab(value, iconName, label) {
    return h(
      "button.desk-tab",
      {
        type: "button",
        role: "tab",
        title: label,
        "aria-label": label,
        "aria-selected": String(mode === value),
        onClick: () => {
          mode = value;
          draw();
        },
      },
      icon(iconName, 14),
    );
  }

  /** @param {string} role @param {string} name @param {string} email @param {number} date */
  function person(role, name, email, date) {
    return h(
      "div.person",
      null,
      h(
        "span.avatar",
        { style: { "--avatar": chartColor(authorColor(email || name)) } },
        initials(name),
      ),
      h(
        "div.person-text",
        null,
        h("div.person-name", null, name, h("span.person-email", null, email ? ` <${email}>` : "")),
        h("div.person-when", { title: fullDate(date) }, when(role, date)),
      ),
    );
  }

  /** @param {ChangedFile} file @param {CommitDetail} detail @param {boolean} short */
  function fileRow(file, detail, short, depth = 0) {
    const { dir, base } = splitPath(file.path);
    const total = (file.added ?? 0) + (file.removed ?? 0);
    return h(
      "div.file-row",
      {
        role: "listitem",
        tabindex: 0,
        style: { "--depth": String(depth) },
        title: file.origPath ? `${file.origPath} → ${file.path}` : file.path,
        onClick: () => hooks.onFile?.(file, detail),
        onKeydown: (/** @type {KeyboardEvent} */ e) => {
          if (e.key === "Enter") hooks.onFile?.(file, detail);
        },
      },
      h("span.change", { class: `is-${file.change}`, title: changeWord(file.change) }, file.change),
      h(
        "span.file-path",
        null,
        short ? null : h("span.file-dir", null, dir),
        h("span.file-base", null, base),
      ),
      file.added === null
        ? h("span.desk-muted.file-bin", null, "binary")
        : h(
            "span.file-stat",
            { title: `+${file.added} −${file.removed}` },
            h(
              "span.bar",
              null,
              h("span.bar-add", { style: { flex: String(file.added ?? 0) } }),
              h("span.bar-del", { style: { flex: String(file.removed ?? 0) } }),
              total === 0 ? h("span.bar-none") : null,
            ),
          ),
    );
  }

  /** The files under folders, the folders with one child folded into their names. @param {CommitDetail} detail */
  function fileTree(detail) {
    /** @typedef {{ dirs: Map<string, Folder>, files: ChangedFile[] }} Folder */
    /** @type {Folder} */
    const root = { dirs: new Map(), files: [] };
    for (const file of detail.files) {
      const parts = file.path.split("/");
      parts.pop();
      let at = root;
      for (const part of parts) {
        let next = at.dirs.get(part);
        if (!next) {
          next = { dirs: new Map(), files: [] };
          at.dirs.set(part, next);
        }
        at = next;
      }
      at.files.push(file);
    }
    /** @param {Folder} folder @param {number} depth @returns {HTMLElement[]} */
    const walk = (folder, depth) => {
      const out = [];
      for (let [name, inside] of folder.dirs) {
        while (inside.files.length === 0 && inside.dirs.size === 1) {
          const [[child, deeper]] = /** @type {[string, Folder][]} */ ([...inside.dirs]);
          name = `${name}/${child}`;
          inside = deeper;
        }
        out.push(
          h(
            "div.file-row.is-folder",
            { style: { "--depth": String(depth) } },
            icon("folderOpen", 14),
            h("span.file-path", null, name),
          ),
        );
        out.push(...walk(inside, depth + 1));
      }
      for (const file of folder.files) out.push(fileRow(file, detail, true, depth));
      return out;
    };
    return walk(root, 0);
  }

  app.subscribe((state, previous) => {
    if (
      state.detail !== previous.detail ||
      state.selected !== previous.selected ||
      state.snapshot !== previous.snapshot
    ) {
      if (state.selected !== "~wip") draw();
    }
  });
  return { draw };
}
