// The merge conflict tool: ours and theirs side by side (their lines aligned, scrolling together),
// each conflict taken from either side or both with a click, and the output below, where every
// conflict shows what it became or asks to be chosen; the output can also be edited by hand. Mark
// resolved writes it through git and stages it.

import { compose, createConflicts, hasMarkers, resolveChunk } from "./conflict.js";
import { button, fill, h, icon } from "./dom.js";
import { splitPath } from "./format.js";

/**
 * @typedef {import("./conflict.js").ConflictFile} ConflictFile
 * @typedef {import("./conflict.js").ConflictChunk} ConflictChunk
 * @typedef {import("./conflict.js").Choice} Choice
 * @typedef {{ onBack(): void, onSaved(path: string): Promise<void>,
 *   onAi?(file: ConflictFile, chunk: ConflictChunk): Promise<string[] | null>, labels(): { ours: string, theirs: string } }} Hooks
 */

/** @param {import("./app.js").App} app @param {HTMLElement} host @param {Hooks} hooks */
export function createConflictView(app, host, hooks) {
  /** @type {ConflictFile | null} */
  let file = null;
  /** @type {Map<number, Choice>} */
  let choices = new Map();
  /** @type {Map<number, string[]>} */
  let custom = new Map();
  let editing = false;
  const head = h("div.cf-head");
  const ours = h("div.cf-pane.is-ours");
  const theirs = h("div.cf-pane.is-theirs");
  const output = h("div.cf-output-body");
  const outputHead = h("div.cf-output-head");
  const editor = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.cf-editor", { spellcheck: "false", "aria-label": "The resolved file" })
  );
  host.replaceChildren(
    h(
      "div.cf",
      null,
      head,
      h("div.cf-sides", null, ours, theirs),
      h("div.cf-output", null, outputHead, output),
    ),
  );
  let syncing = false;
  for (const [a, b] of [
    [ours, theirs],
    [theirs, ours],
  ]) {
    a.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      b.scrollTop = a.scrollTop;
      requestAnimationFrame(() => {
        syncing = false;
      });
    });
  }

  const conflicts = () =>
    /** @type {ConflictChunk[]} */ ((file?.chunks ?? []).filter((c) => c.kind === "conflict"));
  const resolvedCount = () =>
    conflicts().filter((c) => choices.has(c.index) || custom.has(c.index)).length;

  async function open(/** @type {string} */ path) {
    const repo = app.get().repo;
    if (!repo) return;
    fill(head, h("span.desk-muted", null, "Reading the conflict…"));
    try {
      file = await createConflicts(app.git, repo).load(path);
      choices = new Map();
      custom = new Map();
      editing = false;
      draw();
    } catch (error) {
      fill(
        head,
        button({
          label: "Back",
          icon: "arrowLeft",
          kind: "desk-btn-quiet",
          hideLabel: true,
          onClick: hooks.onBack,
        }),
        h("span.diff-empty", null, error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** Toggle one side of a conflict: ours, theirs, both, or back to unchosen. */
  function take(/** @type {number} */ index, /** @type {"ours" | "theirs"} */ side) {
    custom.delete(index);
    const now = choices.get(index);
    const other = side === "ours" ? "theirs" : "ours";
    /** @type {Choice | undefined} */
    let next;
    if (now === side) next = undefined;
    else if (now === other) next = side === "ours" ? "both-theirs-first" : "both";
    else if (now === "both" || now === "both-theirs-first") next = other;
    else next = side;
    if (next) choices.set(index, next);
    else choices.delete(index);
    draw();
  }

  function draw() {
    if (!file) return;
    const labels = hooks.labels();
    const { dir, base } = splitPath(file.path);
    const total = conflicts().length;
    const done = resolvedCount();
    const text = editing ? editor.value : compose(file, choices, custom);
    const ready = file.binary ? false : editing ? !hasMarkers(text) : done === total;
    fill(
      head,
      button({
        label: "Back to the graph",
        icon: "arrowLeft",
        kind: "desk-btn-quiet",
        hideLabel: true,
        onClick: hooks.onBack,
      }),
      h("span.cf-icon", null, icon("conflict", 16)),
      h("span.diff-path", null, h("span.file-dir", null, dir), h("b", null, base)),
      h(
        "span.cf-progress",
        { class: ready ? "is-done" : "" },
        file.binary ? "binary" : `${done} of ${total} resolved`,
      ),
      h("span.desk-bar-spacer"),
      file.binary
        ? null
        : h(
            "button.desk-btn.desk-btn-quiet.mini",
            { type: "button", onClick: () => all("ours") },
            "Take all ours",
          ),
      file.binary
        ? null
        : h(
            "button.desk-btn.desk-btn-quiet.mini",
            { type: "button", onClick: () => all("theirs") },
            "Take all theirs",
          ),
      hooks.onAi && !file.binary
        ? h(
            "button.desk-btn.desk-btn-quiet.mini.cf-ai",
            { type: "button", onClick: () => void suggestAll() },
            icon("sparkle", 12),
            "Resolve with AI",
          )
        : null,
      h(
        "button.desk-btn.desk-btn-primary.mini",
        {
          type: "button",
          disabled: !ready,
          title: ready ? "Write the result and stage it" : "Resolve every conflict first",
          onClick: () => void save(),
        },
        icon("check", 12),
        "Mark resolved",
      ),
    );
    if (file.binary) return drawBinary(labels);
    drawSide(ours, "ours", labels.ours);
    drawSide(theirs, "theirs", labels.theirs);
    fill(
      outputHead,
      h("span.cf-pane-title", null, "Output"),
      h(
        "span.desk-muted",
        null,
        editing
          ? "Editing by hand: conflict markers left in are refused."
          : "What the file becomes",
      ),
      h("span.desk-bar-spacer"),
      h(
        "button.desk-btn.desk-btn-quiet.mini",
        {
          type: "button",
          "aria-pressed": String(editing),
          onClick: () => {
            if (!editing)
              editor.value = compose(/** @type {ConflictFile} */ (file), choices, custom);
            editing = !editing;
            draw();
          },
        },
        icon("edit", 12),
        editing ? "Back to choosing" : "Edit by hand",
      ),
    );
    if (editing) {
      if (editor.parentElement !== output) fill(output, editor);
      editor.oninput = () => draw();
      return;
    }
    const rows = [];
    for (const chunk of file.chunks) {
      if (chunk.kind === "same") {
        for (const line of chunk.lines) rows.push(h("div.cf-line", null, line || " "));
        continue;
      }
      const lines = custom.get(chunk.index) ?? resolveChunk(chunk, choices.get(chunk.index));
      if (lines) {
        const from = custom.has(chunk.index) ? "is-custom" : `is-${choices.get(chunk.index)}`;
        rows.push(
          h(
            "div.cf-chosen",
            { class: from },
            ...lines.map((line) => h("div.cf-line", null, line || " ")),
            lines.length === 0 ? h("div.cf-line.desk-muted", null, "(nothing)") : null,
          ),
        );
      } else {
        rows.push(
          h(
            "div.cf-open",
            null,
            h("span", null, icon("alert", 14), `Conflict ${chunk.index + 1}`),
            h(
              "button.desk-btn.mini",
              { type: "button", onClick: () => take(chunk.index, "ours") },
              "Ours",
            ),
            h(
              "button.desk-btn.mini",
              { type: "button", onClick: () => take(chunk.index, "theirs") },
              "Theirs",
            ),
            h(
              "button.desk-btn.mini",
              {
                type: "button",
                onClick: () => {
                  choices.set(chunk.index, "both");
                  draw();
                },
              },
              "Both",
            ),
            h(
              "button.desk-btn.desk-btn-quiet.mini",
              {
                type: "button",
                onClick: () => {
                  choices.set(chunk.index, "none");
                  draw();
                },
              },
              "Neither",
            ),
            hooks.onAi
              ? h(
                  "button.desk-btn.desk-btn-quiet.mini.cf-ai",
                  { type: "button", onClick: () => void suggest(chunk) },
                  icon("sparkle", 12),
                  "AI",
                )
              : null,
          ),
        );
      }
    }
    fill(output, ...rows);
  }

  /** @param {HTMLElement} pane @param {"ours" | "theirs"} side @param {string} label */
  function drawSide(pane, side, label) {
    if (!file) return;
    const top = pane.scrollTop;
    const rows = [
      h(
        "div.cf-pane-head",
        null,
        h("span.cf-dot"),
        h("span.cf-pane-title", null, side === "ours" ? "Ours" : "Theirs"),
        h("span.desk-muted", null, label),
      ),
    ];
    for (const chunk of file.chunks) {
      if (chunk.kind === "same") {
        for (const line of chunk.lines) rows.push(h("div.cf-line.is-same", null, line || " "));
        continue;
      }
      const mine = chunk[side];
      const height = Math.max(chunk.ours.length, chunk.theirs.length);
      const choice = choices.get(chunk.index);
      const taken = choice === side || choice === "both" || choice === "both-theirs-first";
      rows.push(
        h(
          "div.cf-block",
          { class: taken ? "is-taken" : "" },
          h(
            "button.desk-row.cf-take",
            {
              type: "button",
              "aria-pressed": String(taken),
              onClick: () => take(chunk.index, side),
            },
            h("span.cf-box", null, taken ? icon("check", 12) : null),
            `Conflict ${chunk.index + 1}`,
            h("span.desk-muted", null, taken ? " · taken" : " · take"),
          ),
          ...mine.map((line) => h("div.cf-line", null, line || " ")),
          ...Array.from({ length: height - mine.length }, () => h("div.cf-line.is-pad", null, " ")),
        ),
      );
    }
    fill(pane, ...rows);
    pane.scrollTop = top;
  }

  /** @param {{ ours: string, theirs: string }} labels */
  function drawBinary(labels) {
    if (!file) return;
    const path = file.path;
    const conflicts = createConflicts(app.git, /** @type {string} */ (app.get().repo));
    const pick = (/** @type {"ours" | "theirs" | "delete"} */ side) =>
      void app
        .act(side === "delete" ? `Deleted ${path}` : `Took ${side} for ${path}`, () =>
          conflicts.take(path, side),
        )
        .then(() => hooks.onSaved(path));
    fill(
      ours,
      h(
        "div.cf-binary",
        null,
        h("p", null, "This file can't be merged line by line. Keep one side whole:"),
        h(
          "button.desk-btn",
          { type: "button", onClick: () => pick("ours") },
          `Keep ours (${labels.ours})`,
        ),
        h(
          "button.desk-btn",
          { type: "button", onClick: () => pick("theirs") },
          `Keep theirs (${labels.theirs})`,
        ),
        h(
          "button.desk-btn.desk-btn-quiet",
          { type: "button", onClick: () => pick("delete") },
          "Delete the file",
        ),
      ),
    );
    fill(theirs);
    fill(output);
    fill(outputHead);
  }

  function all(/** @type {"ours" | "theirs"} */ side) {
    custom = new Map();
    for (const chunk of conflicts()) choices.set(chunk.index, side);
    draw();
  }

  async function suggest(/** @type {ConflictChunk} */ chunk) {
    if (!file || !hooks.onAi) return;
    const lines = await hooks.onAi(file, chunk);
    if (lines) {
      custom.set(chunk.index, lines);
      choices.delete(chunk.index);
      draw();
    }
  }
  async function suggestAll() {
    for (const chunk of conflicts())
      if (!choices.has(chunk.index) && !custom.has(chunk.index)) await suggest(chunk);
  }

  async function save() {
    if (!file) return;
    const text = editing ? editor.value : compose(file, choices, custom);
    const path = file.path;
    const target = file;
    await app.act(`Resolved ${path}`, () =>
      createConflicts(app.git, /** @type {string} */ (app.get().repo)).save(target, text),
    );
    await hooks.onSaved(path);
  }

  return { open, file: () => file };
}
