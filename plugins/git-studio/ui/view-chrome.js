// The window's frame: the toolbar (repository, branch, undo, the remote operations, branch and
// stash, search, AI), the status bar, and the welcome page that opens a repository.

import { fill, h, icon } from "./dom.js";
import { nameOf } from "./repo.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {"repo" | "branch" | "undo" | "redo" | "fetch" | "pull" | "push" | "new-branch" | "stash"
 *   | "pop" | "ai" | "sidebar" | "refresh" | "search"} ToolAction
 * @typedef {"text" | "code" | "path"} SearchMode
 * @typedef {{ onTool(action: ToolAction, event: MouseEvent): void, onOpen(path: string): void,
 *   onSearch(query: string, mode: SearchMode): void, onJump?(step: number): void }} Hooks
 */

const PLACEHOLDERS = Object.freeze({
  text: "Search commits  ( / )",
  code: "Text added or removed…",
  path: "Part of a file path…",
});

/** @param {App} app @param {HTMLElement} host @param {Hooks} hooks */
export function createToolbar(app, host, hooks) {
  /** @param {ToolAction} action @param {keyof typeof import("./icons.js").ICONS} iconName @param {string} label @param {string} [title] */
  const tool = (action, iconName, label, title) =>
    h(
      "button.desk-btn.desk-btn-quiet.tool",
      {
        type: "button",
        title: title ?? label,
        dataset: { action },
        onClick: (/** @type {MouseEvent} */ e) => hooks.onTool(action, e),
      },
      icon(iconName, 18),
      h("span.tool-label", null, label),
    );
  const repoButton = h("button.desk-btn.desk-btn-quiet.picker", {
    type: "button",
    onClick: (/** @type {MouseEvent} */ e) => hooks.onTool("repo", e),
  });
  const branchButton = h("button.desk-btn.desk-btn-quiet.picker", {
    type: "button",
    onClick: (/** @type {MouseEvent} */ e) => hooks.onTool("branch", e),
  });
  const pullBadge = h("span.tool-badge", { hidden: true });
  const pushBadge = h("span.tool-badge", { hidden: true });
  const search = /** @type {HTMLInputElement} */ (
    h("input.desk-field.tool-search", {
      type: "search",
      placeholder: "Search commits  ( / )",
      "aria-label": "Search commits",
      onInput: () => hooks.onSearch(search.value, /** @type {SearchMode} */ (mode.value)),
      onKeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          hooks.onJump?.(e.shiftKey ? -1 : 1);
        }
      },
    })
  );
  const mode = /** @type {HTMLSelectElement} */ (
    h(
      "select.desk-field.tool-mode",
      {
        "aria-label": "What to search",
        onChange: () => {
          search.placeholder = PLACEHOLDERS[/** @type {SearchMode} */ (mode.value)];
          hooks.onSearch(search.value, /** @type {SearchMode} */ (mode.value));
        },
      },
      h("option", { value: "text" }, "Message, author, id"),
      h("option", { value: "code" }, "Code changes"),
      h("option", { value: "path" }, "File path"),
    )
  );
  const count = h("span.tool-count", { "aria-live": "polite" });
  const pull = tool("pull", "pull", "Pull");
  pull.append(pullBadge);
  const push = tool("push", "push", "Push");
  push.append(pushBadge);
  host.replaceChildren(
    h(
      "div.tool-group.pickers",
      null,
      repoButton,
      h("span.tool-sep", null, icon("chevronRight", 14)),
      branchButton,
    ),
    h(
      "div.tool-group",
      null,
      tool("undo", "undo", "Undo", "Undo the last change to HEAD"),
      tool("redo", "redo", "Redo"),
    ),
    h("div.tool-group", null, tool("fetch", "fetch", "Fetch"), pull, push),
    h(
      "div.tool-group",
      null,
      tool("new-branch", "branch", "Branch", "Create a branch here"),
      tool("stash", "stash", "Stash"),
      tool("pop", "pop", "Pop", "Apply the latest stash and drop it"),
    ),
    h("div.tool-spacer"),
    h(
      "div.tool-search-wrap",
      null,
      mode,
      h("span.tool-search-box", null, icon("search", 14), search, count),
    ),
    h(
      "div.tool-group",
      null,
      tool("ai", "sparkle", "AI", "AI: commit message, explain, summarize"),
      tool("refresh", "refresh", "Refresh"),
    ),
  );

  function draw() {
    const { snapshot, repo } = app.get();
    fill(
      repoButton,
      icon("repo", 16),
      h(
        "span.picker-text",
        null,
        h("small", null, "repository"),
        h("b", null, repo ? nameOf(repo) : "Open…"),
      ),
      icon("chevronDown", 14),
    );
    const status = snapshot?.status;
    const branch = status
      ? (status.branch ?? `detached at ${(status.oid ?? "").slice(0, 7)}`)
      : "—";
    fill(
      branchButton,
      icon("branch", 16),
      h("span.picker-text", null, h("small", null, "branch"), h("b", null, branch)),
      icon("chevronDown", 14),
    );
    pullBadge.hidden = !status?.behind;
    pullBadge.textContent = String(status?.behind ?? "");
    pushBadge.hidden = !status?.ahead;
    pushBadge.textContent = String(status?.ahead ?? "");
    for (const el of host.querySelectorAll("button.tool")) {
      /** @type {HTMLButtonElement} */ (el).disabled =
        !snapshot && /** @type {HTMLElement} */ (el).dataset.action !== "refresh";
    }
  }
  app.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot || state.repo !== previous.repo) draw();
  });
  draw();
  return {
    focusSearch: () => search.focus(),
    setSearch: (/** @type {string} */ q) => {
      search.value = q;
    },
    /** `3 of 12`, `none`, or nothing while there is no query. */
    setCount: (/** @type {string} */ text) => {
      count.textContent = text;
    },
  };
}

/** @param {App} app @param {HTMLElement} host */
export function createStatusbar(app, host) {
  function draw() {
    const { snapshot, notice, busy, loading, error } = app.get();
    const s = snapshot?.status;
    fill(
      host,
      h("span.sb-item", null, icon("repo", 13), snapshot?.root ?? "No repository"),
      s
        ? h(
            "span.sb-item",
            null,
            icon("branch", 13),
            s.branch ?? "detached",
            s.upstream ? h("span.sb-dim", null, ` → ${s.upstream}`) : null,
            s.ahead ? h("span.sb-ahead", null, ` ↑${s.ahead}`) : null,
            s.behind ? h("span.sb-behind", null, ` ↓${s.behind}`) : null,
          )
        : null,
      snapshot?.operation
        ? h("span.sb-item.sb-warn", null, icon("alert", 13), `${snapshot.operation} in progress`)
        : null,
      h("span.sb-spacer"),
      error
        ? h("span.sb-item.sb-danger", null, error)
        : notice
          ? h("span.sb-item", { class: `sb-${notice.tone}` }, notice.text)
          : null,
      busy || loading
        ? h("span.sb-item.sb-busy", null, h("span.spinner"), busy ? "Running git…" : "Reading…")
        : null,
      snapshot
        ? h(
            "span.sb-item.sb-dim",
            null,
            `${snapshot.commits.length}${snapshot.more ? "+" : ""} commits`,
          )
        : null,
    );
  }
  app.subscribe(draw);
  draw();
}

/** The page shown while no repository is open: a path to type and the recent ones. */
export function welcome(/** @type {App} */ app, /** @type {(path: string) => void} */ onOpen) {
  const { recent, error } = app.get();
  const field = h("input.desk-field.welcome-field", {
    type: "text",
    placeholder: "/path/to/a/repository",
    "aria-label": "Repository folder",
    spellcheck: "false",
  });
  const form = h(
    "form.welcome-form",
    {
      onSubmit: (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        const path = /** @type {HTMLInputElement} */ (field).value.trim();
        if (path) onOpen(path);
      },
    },
    field,
    h("button.desk-btn.desk-btn-primary", { type: "submit" }, icon("folderOpen", 16), "Open"),
  );
  return h(
    "div.welcome",
    null,
    h(
      "div.welcome-card",
      null,
      h("div.welcome-mark", null, icon("merge", 34)),
      h("h1", null, "Git Studio"),
      h(
        "p.desk-muted",
        null,
        "The commit graph, staging, diffs, conflicts and history of a repository, in one window.",
      ),
      form,
      error ? h("p.welcome-error", { role: "alert" }, error) : null,
      recent.length
        ? h(
            "div.welcome-recent",
            null,
            h("h2", null, "Recent"),
            ...recent.map((path) =>
              h(
                "button.desk-row.welcome-repo",
                { type: "button", onClick: () => onOpen(path) },
                icon("repo", 16),
                h("span", null, h("b", null, nameOf(path)), h("small.desk-muted", null, path)),
              ),
            ),
          )
        : null,
    ),
  );
}
