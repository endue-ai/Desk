// The maintenance form (features/README.md): the target with its size and statistics and Read
// again, a refusal or a failed read, the operations as tabs, the options the server's version has
// (one that does not apply shows why), the statement, what it locks, Run and Cancel, and
// result.js's run. A new state is drawn in place and the control that had the focus keeps it.
// While a run goes on it reads the progress a period after the last read. Keys anywhere in it:
// Mod+Enter runs, Escape cancels a run, g reads the target again (outside a field). Layout and
// colours: maintenance.css.

import { el } from "../../dom.js";
import { locksOf } from "./locks.js";
import { labelOf, summaryOf } from "./model.js";
import { offered, operationsFor, TITLES } from "./options.js";
import { runSection } from "./result.js";
import { refusalOf } from "./runs.js";
import { statementOf } from "./sql.js";

/**
 * @typedef {import("./controller.js").MaintenanceState} MaintenanceState
 * @typedef {import("./options.js").Offer} Offer
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** How long after a progress read the next one starts, while a run goes on. */
export const POLL_MS = 1500;
const HINTS = "Mod+Enter run · Escape cancel · g read again";
const FIELDS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
const SWITCH = { "": "The table's setting", auto: "AUTO", on: "ON", off: "OFF" };

/** One option's control, its label, and why it does not apply when it does not. */
function optionOf(
  /** @type {Document} */ doc,
  /** @type {Offer} */ offer,
  /** @type {MaintenanceState} */ s,
  /** @type {(key: string, value: unknown) => void} */ set,
) {
  const value = s.options[offer.key];
  const off = offer.why !== "" || s.run?.status === "running";
  const attrs = { "data-key": offer.key, ...(off ? { disabled: true } : {}) };
  const why = offer.why ? el(doc, "span", { class: "maint-why" }, offer.why) : undefined;
  if (offer.type === "check") {
    const input = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", ...attrs })
    );
    input.checked = value === true;
    input.addEventListener("change", () => set(offer.key, input.checked));
    return el(doc, "label", { class: "maint-option" }, input, ` ${offer.label}`, why);
  }
  /** @type {HTMLInputElement | HTMLSelectElement} */
  let field;
  if (offer.type === "switch" || offer.type === "pick") {
    const none =
      offer.key === "tablespace" ? "Where they are" : offer.key === "using" ? "Pick one" : "";
    field = /** @type {HTMLSelectElement} */ (
      el(
        doc,
        "select",
        { class: "desk-field", ...attrs },
        ...offer.values.map((v) =>
          el(
            doc,
            "option",
            { value: v },
            offer.type === "switch" ? SWITCH[/** @type {keyof typeof SWITCH} */ (v)] : v || none,
          ),
        ),
      )
    );
    field.value = String(value ?? "");
  } else {
    const number = offer.type === "number";
    field = /** @type {HTMLInputElement} */ (
      el(doc, "input", {
        class: "desk-field",
        ...(number
          ? { type: "number", min: "0", max: "1024", placeholder: "server decides" }
          : { placeholder: "256kB" }),
        ...attrs,
      })
    );
    field.value = value === null ? "" : String(value);
  }
  field.addEventListener("change", () => set(offer.key, field.value));
  return el(doc, "label", { class: "maint-option maint-field" }, `${offer.label} `, field, why);
}

/**
 * @param {Document} doc
 * @param {MaintenanceState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function maintenancePanel(doc, first, act, buffer) {
  let state = first;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let armed = "";
  const id = buffer.id;
  const set = (/** @type {string} */ key, /** @type {unknown} */ value) =>
    act("maintenanceView", id, { options: { [key]: value } });
  const body = el(doc, "div", { class: "maint-body" });
  const root = el(doc, "div", { class: "maint", tabindex: "-1" }, body);

  root.addEventListener("focusin", () => {
    const line = doc.getElementById("hints");
    if (line) line.textContent = HINTS;
  });
  root.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const ctl = /** @type {HTMLElement | null} */ (target.closest("[data-ctl]"));
    const op = /** @type {HTMLElement | null} */ (target.closest("[data-op]"))?.dataset.op;
    if (op && op !== state.operation && state.run?.status !== "running")
      return void act("maintenanceView", id, { operation: op });
    if (!ctl || ctl.hasAttribute("disabled")) return;
    const name = ctl.dataset.ctl;
    if (name === "run") act("maintenanceRun", id);
    else if (name === "cancel") act("maintenanceCancel", id);
    else if (name === "refresh") act("maintenanceRefresh", id);
  });
  root.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const running = state.run?.status === "running";
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!running) act("maintenanceRun", id);
    } else if (event.key === "Escape" && running) {
      event.preventDefault();
      act("maintenanceCancel", id);
    } else if (
      event.key === "g" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !FIELDS.has(target.tagName) &&
      !running
    ) {
      event.preventDefault();
      act("maintenanceRefresh", id);
    }
  });

  /** Read the progress again a period after the last read, while a run goes on and shows. */
  const arm = () => {
    const run = state.run;
    const key = run?.status === "running" ? `${run.started}|${run.reads}` : "";
    if (key === armed) return;
    armed = key;
    clearTimeout(timer);
    timer = undefined;
    if (!key) return;
    const tick = () => {
      timer = undefined;
      if (!root.isConnected) return;
      if (root.closest("[hidden]") || doc.visibilityState === "hidden")
        timer = setTimeout(tick, POLL_MS);
      else act("maintenanceProgress", id);
    };
    timer = setTimeout(tick, POLL_MS);
  };

  const draw = () => {
    const s = state;
    const focused = /** @type {HTMLElement | null} */ (doc.activeElement);
    const mark = focused && body.contains(focused) ? markOf(focused) : "";
    const running = s.run?.status === "running";
    const read = s.read;
    const where = read ? `PostgreSQL ${read.server}` : s.reading ? "Reading…" : "";
    const head = el(
      doc,
      "div",
      { class: "maint-head", "data-part": "target" },
      el(
        doc,
        "p",
        { class: "maint-title" },
        el(doc, "strong", {}, titleOf(s.target, read?.database ?? "")),
        ` on ${s.conn.name}${where ? ` · ${where}` : ""}`,
      ),
      el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-quiet",
          "data-ctl": "refresh",
          title: "Read the target again (g)",
          ...(running || s.reading ? { disabled: true } : {}),
        },
        "Read again",
      ),
    );
    const facts = el(
      doc,
      "p",
      { class: "maint-facts", "data-part": "facts" },
      read
        ? `${summaryOf(s.target, read.stats)} · last vacuum ${read.stats.lastVacuum ?? "never"} (auto ${read.stats.lastAutovacuum ?? "never"}) · last analyze ${read.stats.lastAnalyze ?? "never"} (auto ${read.stats.lastAutoanalyze ?? "never"})`
        : "",
    );
    const parts = [head, facts];
    const refused = refusalOf(s.conn, s);
    if (s.error)
      parts.push(
        el(
          doc,
          "div",
          { class: "desk-error", role: "alert", "data-part": "notice" },
          el(doc, "p", {}, s.error),
          el(
            doc,
            "button",
            { type: "button", class: "desk-btn", "data-ctl": "refresh" },
            "Try again",
          ),
        ),
      );
    if (read) {
      const ops = operationsFor(s.target.kind);
      parts.push(
        el(
          doc,
          "div",
          {
            class: "desk-tabs maint-ops",
            role: "tablist",
            "aria-label": "Operation",
            "data-part": "operations",
          },
          ...ops.map((op) =>
            el(
              doc,
              "button",
              {
                type: "button",
                class: "desk-tab",
                role: "tab",
                "data-op": op,
                "aria-selected": String(op === s.operation),
                ...(running ? { disabled: true } : {}),
              },
              TITLES[op],
            ),
          ),
        ),
      );
      const offers = offered(s.operation, s.target, read, s.options);
      parts.push(
        el(
          doc,
          "fieldset",
          { class: "maint-options", "data-part": "options" },
          el(doc, "legend", { class: "sr-only" }, "Options"),
          ...offers.map((o) => optionOf(doc, o, s, set)),
        ),
      );
      const { sql } = statementOf(s, read);
      parts.push(
        el(
          doc,
          "pre",
          { class: "maint-sql", "data-part": "statement", "aria-label": "Statement" },
          sql,
        ),
      );
      const locks = locksOf(s, read, s.timeout);
      parts.push(
        el(
          doc,
          "div",
          {
            class: "desk-callout maint-locks",
            "data-tone": locks.heavy ? "warning" : "info",
            "data-part": "locks",
          },
          el(
            doc,
            "div",
            { class: "desk-callout-body" },
            el(
              doc,
              "p",
              { class: "desk-callout-title" },
              locks.heavy ? "What it blocks" : "What it locks",
            ),
            el(
              doc,
              "ul",
              { class: "maint-lines" },
              ...locks.lines.map((line) => el(doc, "li", {}, line)),
            ),
          ),
        ),
      );
      if (refused && !s.error)
        parts.push(el(doc, "p", { class: "maint-refused", "data-part": "refused" }, refused));
    }
    const can = Boolean(read) && !refused && !running && !s.reading;
    parts.push(
      el(
        doc,
        "div",
        { class: "maint-actions" },
        el(
          doc,
          "button",
          {
            type: "button",
            class: "desk-btn desk-btn-primary",
            "data-ctl": "run",
            ...(can ? {} : { disabled: true }),
          },
          `Run ${TITLES[s.operation]}`,
        ),
        running
          ? el(
              doc,
              "button",
              {
                type: "button",
                class: "desk-btn",
                "data-ctl": "cancel",
                ...(s.run?.cancelling ? { disabled: true } : {}),
              },
              s.run?.cancelling ? "Cancelling…" : "Cancel",
            )
          : undefined,
        el(
          doc,
          "span",
          { class: "maint-keys" },
          el(doc, "kbd", { class: "desk-kbd" }, "Mod"),
          el(doc, "kbd", { class: "desk-kbd" }, "Enter"),
          " run",
        ),
      ),
    );
    if (s.run) parts.push(runSection(doc, s));
    body.replaceChildren(...parts);
    if (mark) /** @type {HTMLElement | null} */ (body.querySelector(mark))?.focus();
    arm();
  };

  draw();
  return {
    el: root,
    update(/** @type {MaintenanceState} */ next) {
      state = next;
      draw();
    },
    destroy() {
      clearTimeout(timer);
      timer = undefined;
      armed = "";
    },
  };
}

/** A selector that finds the same control after a redraw. */
function markOf(/** @type {HTMLElement} */ node) {
  for (const attr of ["data-key", "data-op", "data-ctl"]) {
    const value = node.getAttribute(attr);
    if (value) return `[${attr}="${value}"]`;
  }
  return "";
}

/** The target's label; a kind word ahead of the name starts with a capital, a name keeps its case. */
const titleOf = (/** @type {MaintenanceState["target"]} */ t, /** @type {string} */ database) => {
  const label = labelOf(t, database);
  return t.kind === "table" ? label : label.charAt(0).toUpperCase() + label.slice(1);
};
