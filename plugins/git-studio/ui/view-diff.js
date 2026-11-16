// The diff of one file in the centre: unified or side by side, changed words marked, light syntax
// colours. On the working copy each hunk stages, unstages or discards itself, and lines picked in
// the gutter go alone; the file's own buttons do the whole file. Prev and next walk the file list.

import { drawHunk } from "./diff-hunk.js";
import { button, fill, h, icon } from "./dom.js";
import { splitPath } from "./format.js";
import { parseDiff } from "./parse-diff.js";
import { loadDiff } from "./repo.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./repo.js").DiffTarget} DiffTarget
 * @typedef {import("./parse-diff.js").DiffFile} DiffFile
 * @typedef {import("./parse-diff.js").Hunk} Hunk
 * @typedef {"stage" | "unstage" | "discard"} PatchOp
 * @typedef {{ onBack(): void, onPatch(patch: string, op: PatchOp, what: string): Promise<void>,
 *   onFile(op: PatchOp, target: DiffTarget): Promise<void>, onHistory?(path: string): void,
 *   onBlame?(path: string): void }} Hooks
 */

const LIMIT = 4000;

/** @param {App} app @param {HTMLElement} host @param {Hooks} hooks */
export function createDiffView(app, host, hooks) {
  /** @type {DiffTarget | null} */
  let target = null;
  /** @type {DiffTarget[]} */
  let siblings = [];
  /** @type {DiffFile | null} */
  let file = null;
  let mode = /** @type {"unified" | "split"} */ ("unified");
  let ignoreSpace = false;
  let full = false;
  /** Chosen line indexes by hunk index. @type {Map<number, Set<number>>} */
  let chosen = new Map();
  let seq = 0;

  const head = h("div.diff-head");
  const body = h("div.diff-body", { tabindex: 0 });
  host.replaceChildren(h("div.diff", null, head, body));

  /** Show `next`, with `list` the files prev and next walk through. */
  async function show(/** @type {DiffTarget} */ next, /** @type {DiffTarget[]} */ list = siblings) {
    const same =
      target && next.path === target.path && next.kind === target.kind && next.sha === target.sha;
    target = next;
    siblings = list;
    if (!same) {
      chosen = new Map();
      full = false;
    }
    await load();
  }

  async function load() {
    const repo = app.get().repo;
    if (!target || !repo) return;
    const mine = ++seq;
    drawHead();
    if (!file) fill(body, h("p.diff-empty", null, "Loading…"));
    try {
      const text = await loadDiff(app.git, repo, target, { ignoreSpace });
      if (mine !== seq) return;
      file = parseDiff(text)[0] ?? null;
      drawHead();
      drawBody();
    } catch (error) {
      fill(body, h("p.diff-empty", null, error instanceof Error ? error.message : String(error)));
    }
  }

  function drawHead() {
    if (!target) return;
    const { dir, base } = splitPath(target.path);
    const at = siblings.findIndex((t) => t.path === target?.path && t.kind === target?.kind);
    const label =
      target.kind === "commit"
        ? `in ${(target.sha ?? "").slice(0, 7)}`
        : target.kind === "staged"
          ? "Staged"
          : target.untracked
            ? "Untracked"
            : "Unstaged";
    const wip = target.kind !== "commit";
    fill(
      head,
      button({
        label: "Back to the graph",
        icon: "arrowLeft",
        kind: "desk-btn-quiet",
        hideLabel: true,
        onClick: () => hooks.onBack(),
      }),
      h(
        "div.diff-title",
        null,
        h(
          "span.diff-path",
          { title: target.origPath ? `${target.origPath} → ${target.path}` : target.path },
          target.origPath ? h("span.file-dir", null, `${target.origPath} → `) : null,
          h("span.file-dir", null, dir),
          h("b", null, base),
        ),
        h("span.diff-badge", { class: `is-${target.kind}` }, label),
        file
          ? h(
              "span.diff-stat",
              null,
              h("span.stat-add", null, `+${file.added}`),
              " ",
              h("span.stat-del", null, `−${file.removed}`),
            )
          : null,
      ),
      h("span.desk-bar-spacer"),
      siblings.length > 1
        ? h(
            "span.diff-nav",
            null,
            button({
              label: "Previous file",
              icon: "arrowUp",
              kind: "desk-btn-quiet",
              hideLabel: true,
              disabled: at <= 0,
              onClick: () => go(-1),
            }),
            h("span.desk-muted", null, `${at + 1} / ${siblings.length}`),
            button({
              label: "Next file",
              icon: "arrowDown",
              kind: "desk-btn-quiet",
              hideLabel: true,
              disabled: at >= siblings.length - 1,
              onClick: () => go(1),
            }),
          )
        : null,
      h(
        "div.desk-tabs.mini-tabs",
        { role: "tablist", "aria-label": "Diff layout" },
        modeTab("unified", "unified", "Unified"),
        modeTab("split", "split", "Side by side"),
      ),
      h(
        "button.desk-btn.desk-btn-quiet.mini",
        {
          type: "button",
          "aria-pressed": String(ignoreSpace),
          title: "Ignore changes in white space",
          onClick: () => {
            ignoreSpace = !ignoreSpace;
            void load();
          },
        },
        ignoreSpace ? icon("check", 12) : null,
        "Ignore space",
      ),
      hooks.onHistory && target.kind !== "staged"
        ? button({
            label: "History",
            icon: "history",
            kind: "desk-btn-quiet",
            hideLabel: true,
            title: "The file's history",
            onClick: () => hooks.onHistory?.(target?.path ?? ""),
          })
        : null,
      hooks.onBlame && !target.untracked
        ? button({
            label: "Blame",
            icon: "user",
            kind: "desk-btn-quiet",
            hideLabel: true,
            title: "Who changed each line",
            onClick: () => hooks.onBlame?.(target?.path ?? ""),
          })
        : null,
      wip && target.kind === "unstaged"
        ? h(
            "button.desk-btn.desk-btn-quiet.mini.is-danger",
            { type: "button", onClick: () => void fileOp("discard") },
            icon("trash", 12),
            "Discard file",
          )
        : null,
      wip
        ? h(
            "button.desk-btn.desk-btn-primary.mini",
            {
              type: "button",
              onClick: () => void fileOp(target?.kind === "staged" ? "unstage" : "stage"),
            },
            icon(target.kind === "staged" ? "minus" : "plus", 12),
            target.kind === "staged" ? "Unstage file" : "Stage file",
          )
        : null,
    );
  }

  /** @param {"unified" | "split"} value @param {"unified" | "split"} iconName @param {string} label */
  function modeTab(value, iconName, label) {
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
          drawHead();
          drawBody();
        },
      },
      icon(iconName, 14),
    );
  }

  async function fileOp(/** @type {PatchOp} */ op) {
    if (!target) return;
    await hooks.onFile(op, target);
  }

  function go(/** @type {number} */ step) {
    const at = siblings.findIndex((t) => t.path === target?.path && t.kind === target?.kind);
    const next = siblings[at + step];
    if (next) void show(next);
  }

  function drawBody() {
    if (!target) return;
    if (!file)
      return fill(
        body,
        h("p.diff-empty", null, ignoreSpace ? "Only white space changed." : "No changes to show."),
      );
    if (file.binary)
      return fill(
        body,
        h("p.diff-empty", null, icon("file", 18), "A binary file: its bytes changed."),
      );
    if (file.hunks.length === 0)
      return fill(
        body,
        h(
          "p.diff-empty",
          null,
          file.status === "renamed" ? "Renamed without changes." : "Only the file's mode changed.",
        ),
      );
    const total = file.hunks.reduce((n, hk) => n + hk.lines.length, 0);
    const out = [];
    let drawn = 0;
    for (const [index, hunk] of file.hunks.entries()) {
      if (!full && drawn > LIMIT) break;
      out.push(hunkView(/** @type {DiffFile} */ (file), hunk, index));
      drawn += hunk.lines.length;
    }
    if (!full && drawn < total)
      out.push(
        h(
          "div.diff-more",
          null,
          h("p.desk-muted", null, `${total - drawn} more lines are not shown.`),
          h(
            "button.desk-btn",
            {
              type: "button",
              onClick: () => {
                full = true;
                drawBody();
              },
            },
            "Show the whole diff",
          ),
        ),
      );
    fill(body, ...out);
    body.classList.toggle("is-split", mode === "split");
  }

  /** @param {DiffFile} diff @param {Hunk} hunk @param {number} index */
  function hunkView(diff, hunk, index) {
    return drawHunk({
      diff,
      hunk,
      mode,
      kind: target?.kind ?? "commit",
      picked: chosen.get(index) ?? new Set(),
      onToggle: (line) => {
        const set = chosen.get(index) ?? new Set();
        if (set.has(line)) set.delete(line);
        else set.add(line);
        chosen.set(index, set);
        drawBody();
      },
      onClear: () => {
        chosen.delete(index);
        drawBody();
      },
      onAct: (op, patch, what) => {
        chosen.delete(index);
        void hooks.onPatch(patch, op, what).then(load);
      },
    });
  }

  app.subscribe((state, previous) => {
    if (
      state.snapshot !== previous.snapshot &&
      target &&
      target.kind !== "commit" &&
      app.get().center === "diff"
    )
      void load();
  });
  return { show, reload: load, target: () => target };
}
