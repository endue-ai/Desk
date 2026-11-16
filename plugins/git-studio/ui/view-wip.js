// The right panel for the work in progress: conflicts, unstaged and staged files (a click shows
// the diff, the row's buttons stage, unstage or discard), and the composer that commits them. The
// composer is drawn once and only its counts change, so a refresh never loses what is being typed.

import { button, fill, h, icon } from "./dom.js";
import { changeWord, plural, splitPath } from "./format.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./parse-status.js").FileChange} FileChange
 * @typedef {{ staged: boolean, file: FileChange }} WipFile
 * @typedef {{
 *   onStage(paths: string[]): void, onUnstage(paths: string[]): void, onDiscard(files: FileChange[]): void,
 *   onFile(file: WipFile): void, onResolve(path: string): void,
 *   onCommit(draft: { message: string, amend: boolean, signOff: boolean, push: boolean }): Promise<boolean>,
 *   onAmend(on: boolean): Promise<string | null>, onAi(): Promise<string | null>, onStash(): void,
 *   onMenu(event: MouseEvent, file: WipFile): void,
 * }} Hooks
 */

export const SUMMARY_LIMIT = 72;

/** @param {App} app @param {HTMLElement} host @param {Hooks} hooks */
export function createWip(app, host, hooks) {
  const lists = h("div.wip-lists");
  const summary = /** @type {HTMLInputElement} */ (
    h("input.desk-field.composer-summary", {
      type: "text",
      placeholder: "Summary (required)",
      "aria-label": "Commit summary",
      maxlength: 200,
    })
  );
  const body = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.composer-body", {
      rows: 4,
      placeholder: "Description",
      "aria-label": "Commit description",
    })
  );
  const counter = h("span.composer-count");
  const amend = /** @type {HTMLInputElement} */ (
    h("input.desk-check", { type: "checkbox", id: "gs-amend" })
  );
  const signOff = /** @type {HTMLInputElement} */ (
    h("input.desk-check", { type: "checkbox", id: "gs-signoff" })
  );
  const aiButton = button({
    label: "Write with AI",
    icon: "sparkle",
    kind: "desk-btn-quiet",
    title: "Write the message from the staged changes",
    onClick: () => void writeWithAi(),
  });
  aiButton.classList.add("composer-ai");
  const commitButton = /** @type {HTMLButtonElement} */ (
    h("button.desk-btn.desk-btn-primary.composer-commit", {
      type: "button",
      onClick: () => void commit(false),
    })
  );
  const pushButton = /** @type {HTMLButtonElement} */ (
    h(
      "button.desk-btn.composer-push",
      { type: "button", title: "Commit, then push", onClick: () => void commit(true) },
      icon("push", 14),
      "Commit & Push",
    )
  );
  const composer = h(
    "form.composer",
    { onSubmit: (/** @type {SubmitEvent} */ e) => e.preventDefault() },
    h(
      "div.composer-head",
      null,
      h("span.composer-title", null, icon("commit", 14), "Commit"),
      aiButton,
    ),
    h("div.composer-summary-wrap", null, summary, counter),
    body,
    h(
      "div.composer-options",
      null,
      h("label", { for: "gs-amend" }, amend, "Amend last commit"),
      h("label", { for: "gs-signoff" }, signOff, "Sign off"),
    ),
    h("div.composer-actions", null, commitButton, pushButton),
  );
  host.replaceChildren(h("div.wip", null, lists, composer));

  const update = () => {
    const length = summary.value.length;
    counter.textContent = String(SUMMARY_LIMIT - length);
    counter.classList.toggle("is-over", length > SUMMARY_LIMIT);
    const staged = app.get().snapshot?.status.staged.length ?? 0;
    const ready = summary.value.trim() !== "" && (staged > 0 || amend.checked);
    commitButton.disabled = !ready;
    pushButton.disabled = !ready;
    fill(
      commitButton,
      icon("check", 14),
      amend.checked ? "Amend commit" : staged ? `Commit ${plural(staged, "file")}` : "Commit",
    );
  };
  summary.addEventListener("input", update);
  composer.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!commitButton.disabled) void commit(false);
    }
  });
  amend.addEventListener("change", async () => {
    const message = await hooks.onAmend(amend.checked);
    if (message !== null && summary.value.trim() === "") setMessage(message);
    update();
  });

  /** @param {string} message */
  function setMessage(message) {
    const at = message.indexOf("\n");
    summary.value = at < 0 ? message : message.slice(0, at);
    body.value = at < 0 ? "" : message.slice(at + 1).replace(/^\n+/, "");
    update();
  }

  async function writeWithAi() {
    aiButton.classList.add("is-busy");
    try {
      const message = await hooks.onAi();
      if (message) setMessage(message);
    } finally {
      aiButton.classList.remove("is-busy");
    }
  }

  async function commit(/** @type {boolean} */ push) {
    const message = body.value.trim()
      ? `${summary.value.trim()}\n\n${body.value.trim()}`
      : summary.value.trim();
    commitButton.disabled = true;
    const ok = await hooks.onCommit({
      message,
      amend: amend.checked,
      signOff: signOff.checked,
      push,
    });
    if (ok) {
      summary.value = "";
      body.value = "";
      amend.checked = false;
    }
    update();
  }

  function draw() {
    const snapshot = app.get().snapshot;
    if (!snapshot) return;
    const { staged, unstaged, conflicts } = snapshot.status;
    fill(
      lists,
      h(
        "div.wip-head",
        null,
        h(
          "div",
          null,
          h("h2", null, "Working copy"),
          h(
            "p.desk-muted",
            null,
            snapshot.status.branch ? `On ${snapshot.status.branch}` : "Detached HEAD",
            snapshot.operation ? ` · ${snapshot.operation} in progress` : "",
          ),
        ),
        button({
          label: "Stash all",
          icon: "stash",
          kind: "desk-btn-quiet",
          onClick: () => hooks.onStash(),
          disabled: staged.length + unstaged.length === 0,
        }),
      ),
      conflicts.length
        ? section(
            "Conflicts",
            "is-conflict",
            conflicts.length,
            null,
            conflicts.map((c) =>
              h(
                "div.wip-row.is-conflict",
                { title: `${c.path}: ${c.label}` },
                h("span.change.is-U", null, "!"),
                h(
                  "span.file-path",
                  null,
                  h("span.file-dir", null, splitPath(c.path).dir),
                  h("span.file-base", null, splitPath(c.path).base),
                ),
                h("span.wip-label", null, c.label),
                h(
                  "button.desk-btn.desk-btn-primary.wip-resolve",
                  { type: "button", onClick: () => hooks.onResolve(c.path) },
                  "Resolve",
                ),
              ),
            ),
          )
        : null,
      section(
        "Unstaged files",
        "",
        unstaged.length,
        unstaged.length
          ? h(
              "div.wip-bulk",
              null,
              h(
                "button.desk-btn.desk-btn-quiet.mini",
                { type: "button", onClick: () => hooks.onDiscard(unstaged) },
                "Discard all",
              ),
              h(
                "button.desk-btn.mini",
                { type: "button", onClick: () => hooks.onStage([]) },
                icon("plus", 12),
                "Stage all",
              ),
            )
          : null,
        unstaged.map((file) => row({ staged: false, file })),
      ),
      section(
        "Staged files",
        "is-staged",
        staged.length,
        staged.length
          ? h(
              "button.desk-btn.mini",
              { type: "button", onClick: () => hooks.onUnstage([]) },
              icon("minus", 12),
              "Unstage all",
            )
          : null,
        staged.map((file) => row({ staged: true, file })),
      ),
    );
    update();
  }

  /** @param {string} title @param {string} cls @param {number} count @param {HTMLElement | null} actions @param {HTMLElement[]} rows */
  function section(title, cls, count, actions, rows) {
    return h(
      "section.wip-section",
      { class: cls },
      h(
        "div.wip-section-head",
        null,
        h("span.wip-section-title", null, title),
        h("span.side-count", null, count),
        h("span.desk-bar-spacer"),
        actions,
      ),
      rows.length
        ? h("div.wip-rows", { role: "list" }, ...rows)
        : h("p.wip-none", null, title.startsWith("Staged") ? "Nothing staged yet" : "No changes"),
    );
  }

  /** @param {WipFile} item */
  function row(item) {
    const { file, staged } = item;
    const { dir, base } = splitPath(file.path);
    return h(
      "div.wip-row",
      {
        role: "listitem",
        tabindex: 0,
        title: file.origPath ? `${file.origPath} → ${file.path}` : file.path,
        onClick: () => hooks.onFile(item),
        onKeydown: (/** @type {KeyboardEvent} */ e) => {
          if (e.key === "Enter") hooks.onFile(item);
          else if (e.key === " ") {
            e.preventDefault();
            (staged ? hooks.onUnstage : hooks.onStage)([file.path]);
          }
        },
        onContextmenu: (/** @type {MouseEvent} */ e) => {
          e.preventDefault();
          hooks.onMenu(e, item);
        },
      },
      h(
        "span.change",
        { class: `is-${file.change}`, title: changeWord(file.change) },
        file.change === "?" ? "U" : file.change,
      ),
      h("span.file-path", null, h("span.file-dir", null, dir), h("span.file-base", null, base)),
      h(
        "span.wip-actions",
        null,
        staged
          ? null
          : h(
              "button.desk-icon-btn.mini-icon",
              {
                type: "button",
                title: "Discard changes",
                "aria-label": `Discard ${file.path}`,
                onClick: (/** @type {MouseEvent} */ e) => {
                  e.stopPropagation();
                  hooks.onDiscard([file]);
                },
              },
              icon("trash", 14),
            ),
        h(
          "button.desk-icon-btn.mini-icon.is-stage",
          {
            type: "button",
            title: staged ? "Unstage" : "Stage",
            "aria-label": `${staged ? "Unstage" : "Stage"} ${file.path}`,
            onClick: (/** @type {MouseEvent} */ e) => {
              e.stopPropagation();
              (staged ? hooks.onUnstage : hooks.onStage)([file.path]);
            },
          },
          icon(staged ? "minus" : "plus", 14),
        ),
      ),
    );
  }

  app.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot) draw();
  });
  draw();
  return {
    draw,
    setMessage,
    focus: () => summary.focus(),
    message: () => ({ summary: summary.value, body: body.value }),
  };
}
