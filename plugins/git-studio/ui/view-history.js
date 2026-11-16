// A file's history in the centre: the commits that changed it (across renames) on the left, the
// diff the selected one made to it on the right, with a way to that commit in the graph and to the
// file's blame at that commit.

import { button, fill, h, icon } from "./dom.js";
import {
  authorColor,
  chartColor,
  fullDate,
  initials,
  plural,
  relativeTime,
  shortSha,
  splitPath,
} from "./format.js";
import { fileHistory } from "./history.js";
import { createDiffView } from "./view-diff.js";

/**
 * @typedef {import("./history.js").FileCommit} FileCommit
 * @typedef {{ onBack(): void, onReveal(sha: string): void, onBlame(path: string, rev: string | null): void }} Hooks
 */

/** @param {import("./app.js").App} app @param {HTMLElement} host @param {Hooks} hooks */
export function createHistoryView(app, host, hooks) {
  const head = h("div.hist-head");
  const list = h("div.hist-list", {
    role: "listbox",
    tabindex: 0,
    "aria-label": "Commits that changed the file",
  });
  const diffHost = h("div.hist-diff");
  host.replaceChildren(h("div.hist", null, head, h("div.hist-body", null, list, diffHost)));
  const diff = createDiffView(app, diffHost, {
    onBack: () => hooks.onBack(),
    onPatch: async () => {},
    onFile: async () => {},
    onBlame: (path) => hooks.onBlame(path, selected),
  });
  /** @type {FileCommit[]} */
  let commits = [];
  let path = "";
  /** @type {string | null} */
  let selected = null;

  async function open(/** @type {string} */ file) {
    const repo = app.get().repo;
    if (!repo) return;
    path = file;
    commits = [];
    selected = null;
    drawHead();
    fill(list, h("p.diff-empty", null, "Reading the history…"));
    try {
      commits = await fileHistory(app.git, repo, file);
      drawHead();
      drawList();
      const first = commits[0];
      if (first) choose(first);
      else fill(diffHost, h("p.diff-empty", null, "No commit has this file yet."));
    } catch (error) {
      fill(list, h("p.diff-empty", null, error instanceof Error ? error.message : String(error)));
    }
  }

  function drawHead() {
    const { dir, base } = splitPath(path);
    const renames = commits.filter((c) => c.origPath).length;
    fill(
      head,
      button({
        label: "Back to the graph",
        icon: "arrowLeft",
        kind: "desk-btn-quiet",
        hideLabel: true,
        onClick: () => hooks.onBack(),
      }),
      h("span.hist-icon", null, icon("history", 16)),
      h("span.diff-path", null, h("span.file-dir", null, dir), h("b", null, base)),
      commits.length
        ? h(
            "span.desk-muted",
            null,
            `${plural(commits.length, "commit")}${renames ? ` · renamed ${plural(renames, "time")}` : ""}`,
          )
        : null,
      h("span.desk-bar-spacer"),
      button({
        label: "Blame",
        icon: "user",
        kind: "desk-btn-quiet",
        title: "Who changed each line now",
        onClick: () => hooks.onBlame(path, null),
      }),
    );
  }

  function drawList() {
    fill(
      list,
      ...commits.map((c) =>
        h(
          "div.hist-row",
          {
            role: "option",
            "aria-selected": String(c.sha === selected),
            onClick: () => choose(c),
            onDblclick: () => hooks.onReveal(c.sha),
          },
          h(
            "span.avatar.small",
            { style: { "--avatar": chartColor(authorColor(c.email || c.author)) } },
            initials(c.author),
          ),
          h(
            "span.hist-text",
            null,
            h("span.hist-summary", null, c.subject),
            h(
              "span.hist-meta",
              { title: fullDate(c.date) },
              `${c.author} · ${relativeTime(c.date)}`,
            ),
            c.origPath
              ? h("span.hist-rename", null, icon("arrowLeft", 11), ` from ${c.origPath}`)
              : null,
          ),
          h(
            "span.hist-side",
            null,
            h("span.change", { class: `is-${c.change}` }, c.change),
            h(
              "button.desk-btn.desk-btn-quiet.sha-chip",
              {
                type: "button",
                title: "Show in the graph",
                onClick: (/** @type {MouseEvent} */ e) => {
                  e.stopPropagation();
                  hooks.onReveal(c.sha);
                },
              },
              shortSha(c.sha),
            ),
          ),
        ),
      ),
    );
  }

  function choose(/** @type {FileCommit} */ commit) {
    selected = commit.sha;
    drawList();
    void diff.show(
      {
        kind: "commit",
        path: commit.path,
        ...(commit.origPath ? { origPath: commit.origPath } : {}),
        sha: commit.sha,
        parent: commit.parents[0] ?? null,
      },
      [],
    );
  }

  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const at = commits.findIndex((c) => c.sha === selected);
    const next =
      commits[Math.max(0, Math.min(commits.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) choose(next);
  });

  return { open };
}
