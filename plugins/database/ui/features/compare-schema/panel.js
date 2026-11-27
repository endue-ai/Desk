// The comparison's panel (PG-53): the two sides, how far the reading is (with Cancel), the objects on
// one side only and the ones that differ, each with a box that puts it in the script, the chosen
// object's DDL on both sides, and the script for the chosen direction with what it will not write,
// Run, Dry run and Open in console. Nothing runs from here but on Run. A long list shows its first
// SHOWN objects of each group.

import { el } from "../../dom.js";
import { t as messageText } from "../../strings/index.js";

/**
 * @typedef {import("./controller.js").SchemaState} SchemaState
 * @typedef {import("./diff.js").Item} Item
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

export const SHOWN = 1_000;
const n = (/** @type {number} */ v) => v.toLocaleString("en-US");

/** What the status line says. */
export function statusOf(/** @type {SchemaState} */ s) {
  if (s.status === "reading" || s.status === "comparing") {
    const { done, total, what } = s.progress;
    const share = total ? ` (${Math.floor((done / total) * 100)}%)` : "";
    return `${s.status === "reading" ? "Reading" : "Comparing"}${what ? ` ${what}` : ""}${share}…`;
  }
  if (s.status === "failed" || s.status === "cancelled") return s.error;
  if (s.items.length === 0)
    return messageText("features.compareSchema.panel.noDifferenceObjectsAreTheSame", {
      value: String(n(s.same)),
    });
  const count = (/** @type {string} */ k) => s.items.filter((i) => i.state === k).length;
  return messageText("features.compareSchema.panel.onlyOnTheLeftOnlyOn", {
    value: String(n(count("left"))),
    value2: String(n(count("right"))),
    value3: String(n(count("differs"))),
    value4: String(n(s.same)),
  });
}

/** @param {Document} doc @param {SchemaState} s @param {Act} act @param {{ id: string }} buffer */
export function schemaComparePanel(doc, s, act, buffer) {
  const id = buffer.id;
  const button = (
    /** @type {string} */ action,
    /** @type {string} */ label,
    cls = "",
    off = false,
  ) => {
    const b = el(
      doc,
      "button",
      {
        type: "button",
        class: `desk-btn ${cls}`.trim(),
        "data-key": `ctl:${action}`,
        ...(off ? { disabled: true } : {}),
      },
      label,
    );
    b.addEventListener("click", () => act(action, id));
    return b;
  };
  const busy = s.status === "reading" || s.status === "comparing";
  const head = el(
    doc,
    "div",
    { class: "sc-head" },
    el(
      doc,
      "div",
      { class: "sc-sides" },
      el(
        doc,
        "p",
        {},
        messageText("features.compareSchema.panel.left", { label: String(s.left.label) }),
      ),
      el(
        doc,
        "p",
        {},
        messageText("features.compareSchema.panel.right", { label: String(s.right.label) }),
      ),
    ),
    el(
      doc,
      "div",
      { class: "sc-actions" },
      busy
        ? button("schemaCompareCancel", "Cancel")
        : button("schemaCompareRefresh", "Compare again", "desk-btn-quiet"),
    ),
  );
  const parts = [
    head,
    el(doc, "p", { class: "sc-status", role: "status", "data-part": "status" }, statusOf(s)),
  ];
  if (s.notes.length)
    parts.push(
      el(
        doc,
        "div",
        { class: "desk-callout", "data-tone": "warning", "data-part": "notes" },
        el(
          doc,
          "div",
          { class: "desk-callout-body" },
          el(
            doc,
            "p",
            { class: "desk-callout-title" },
            messageText("features.compareSchema.panel.notReadFromTheFolder"),
          ),
          el(doc, "ul", {}, ...s.notes.slice(0, 20).map((t) => el(doc, "li", {}, t))),
        ),
      ),
    );
  if (s.status === "done" && s.items.length)
    parts.push(body(doc, s, act, id), ...script(doc, s, button));
  return el(doc, "div", { class: "sc", "data-part": "schema-compare" }, ...parts);
}

/** The list of objects and the chosen one's DDL on both sides. */
function body(
  /** @type {Document} */ doc,
  /** @type {SchemaState} */ s,
  /** @type {Act} */ act,
  /** @type {string} */ id,
) {
  const chosen = new Set(s.chosen);
  const groups = /** @type {[Item["state"], string][]} */ ([
    ["left", `Only on the left`],
    ["right", `Only on the right`],
    ["differs", "Differ"],
  ]);
  const list = el(doc, "div", { class: "sc-list", "data-part": "list" });
  for (const [state, title] of groups) {
    const items = s.items.filter((i) => i.state === state);
    if (!items.length) continue;
    const all = el(doc, "input", {
      type: "checkbox",
      class: "desk-check",
      "aria-label": messageText("features.compareSchema.panel.chooseEveryObject", {
        title: String(title),
      }),
    });
    /** @type {HTMLInputElement} */ (all).checked = items.every((i) => chosen.has(i.key));
    all.addEventListener("change", () =>
      act(
        "schemaCompareChoose",
        id,
        items.map((i) => i.key),
        /** @type {HTMLInputElement} */ (all).checked,
      ),
    );
    list.append(el(doc, "h3", { class: "sc-group" }, all, ` ${title} (${n(items.length)})`));
    for (const item of items.slice(0, SHOWN)) {
      const box = el(doc, "input", {
        type: "checkbox",
        class: "desk-check",
        "aria-label": messageText("features.compareSchema.panel.inTheScript", {
          kind: String(item.kind),
          name: String(item.name),
        }),
      });
      /** @type {HTMLInputElement} */ (box).checked = chosen.has(item.key);
      box.addEventListener("change", () =>
        act("schemaCompareChoose", id, [item.key], /** @type {HTMLInputElement} */ (box).checked),
      );
      const pick = el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-quiet sc-name",
          "data-key": `item:${item.key}`,
          "aria-pressed": String(item.key === s.selected),
        },
        `${item.kind} ${item.name}`,
      );
      pick.addEventListener("click", () => act("schemaCompareSelect", id, item.key));
      list.append(
        el(
          doc,
          "div",
          { class: `sc-row${item.key === s.selected ? " sc-selected" : ""}` },
          box,
          pick,
        ),
      );
    }
    if (items.length > SHOWN)
      list.append(
        el(
          doc,
          "p",
          { class: "sc-more" },
          messageText("features.compareSchema.panel.andMoreChosenWithTheBox", {
            value: String(n(items.length - SHOWN)),
          }),
        ),
      );
  }
  const item = s.items.find((i) => i.key === s.selected);
  const side = (/** @type {string} */ title, /** @type {string} */ text) =>
    el(
      doc,
      "div",
      { class: "sc-ddl" },
      el(doc, "h3", {}, title),
      el(
        doc,
        "pre",
        { tabindex: "0", "aria-label": title },
        text || messageText("features.compareSchema.panel.notOnThisSide"),
      ),
    );
  const detail = item
    ? el(
        doc,
        "div",
        { class: "sc-detail", "data-part": "detail" },
        side(`Left: ${s.left.label}`, item.left),
        side(`Right: ${s.right.label}`, item.right),
      )
    : el(doc, "div", { class: "sc-detail" });
  return el(doc, "div", { class: "sc-body" }, list, detail);
}

/** The script, what it will not write, and its buttons. */
function script(
  /** @type {Document} */ doc,
  /** @type {SchemaState} */ s,
  /** @type {(action: string, label: string, cls?: string, off?: boolean) => HTMLElement} */ button,
) {
  const [source, target] = s.target === "right" ? [s.left, s.right] : [s.right, s.left];
  const running = s.run?.status === "running";
  const can = !s.refused && !running;
  const parts = [
    el(
      doc,
      "div",
      { class: "sc-script-head" },
      el(
        doc,
        "h3",
        {},
        messageText("features.compareSchema.panel.scriptMakesLike", {
          label: String(target.label),
          label2: String(source.label),
        }),
      ),
      button("schemaCompareDirection", "Swap direction", "desk-btn-quiet", running),
    ),
  ];
  if (s.script?.held.length)
    parts.push(
      el(
        doc,
        "ul",
        { class: "sc-held", role: "alert", "data-part": "held" },
        ...s.script.held.map((h) => el(doc, "li", {}, h)),
      ),
    );
  parts.push(
    el(
      doc,
      "pre",
      {
        class: "sc-script",
        tabindex: "0",
        "aria-label": messageText("features.compareSchema.panel.script"),
        "data-part": "script",
      },
      s.script?.text || messageText("features.compareSchema.panel.nothingChosen"),
    ),
  );
  const actions = [
    button(
      "schemaCompareRun",
      running && !s.run?.dry ? "Running…" : "Run",
      "desk-btn-primary",
      !can,
    ),
    button("schemaCompareDryRun", running && s.run?.dry ? "Running…" : "Dry run", "", !can),
    button("schemaCompareConsole", "Open in console", "desk-btn-quiet", !s.script?.text),
  ];
  if (s.refused && !s.script?.held.length)
    actions.push(el(doc, "span", { class: "sc-hint", "data-part": "refused" }, s.refused));
  parts.push(el(doc, "div", { class: "sc-run" }, ...actions));
  if (s.run && s.run.status !== "running")
    parts.push(
      el(
        doc,
        "div",
        {
          class: s.run.status === "failed" ? "desk-error" : "desk-callout",
          role: "status",
          "data-part": "result",
          ...(s.run.status === "failed" ? {} : { "data-tone": "info" }),
        },
        el(doc, "p", {}, s.run.message),
      ),
    );
  return parts;
}
