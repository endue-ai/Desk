// The maintenance form (features/README.md): the target with its size and statistics and Read
// again, a refusal or a failed read, the operations as tabs, the options the server's version has
// (one that does not apply shows why), the statement, what it locks, Run and Cancel, and
// result.js's run. A new state is drawn in place and the control that had the focus keeps it.
// While a run goes on it reads the progress a period after the last read. Keys anywhere in it:
// Mod+Enter runs, Escape cancels a run, g reads the target again (outside a field). Layout and
// colours: maintenance.css.

import { el } from "../../dom.js";
import { t as messageText } from "../../strings/index.js";
import { locksOf } from "./locks.js";
import { labelOf, summaryOf } from "./model.js";
import { optionOf } from "./option-view.js";
import { offered, operationsFor, TITLES } from "./options.js";
import { runSection } from "./result.js";
import { refusalOf } from "./runs.js";
import { statementOf } from "./sql.js";

/**
 * @typedef {import("./controller.js").MaintenanceState} MaintenanceState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** How long after a progress read the next one starts, while a run goes on. */
export const POLL_MS = 1500;
const HINTS = messageText("features.maintenance.panel.modEnterRunEscapeCancelG");
const FIELDS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
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
        messageText("features.maintenance.panel.on", {
          name: String(s.conn.name),
          value: String(where ? ` · ${where}` : ""),
        }),
      ),
      el(
        doc,
        "button",
        {
          type: "button",
          class: "desk-btn desk-btn-quiet",
          "data-ctl": "refresh",
          title: messageText("features.maintenance.panel.readTheTargetAgainG"),
          ...(running || s.reading ? { disabled: true } : {}),
        },
        messageText("features.maintenance.panel.readAgain"),
      ),
    );
    const facts = el(
      doc,
      "p",
      { class: "maint-facts", "data-part": "facts" },
      read
        ? messageText("features.maintenance.panel.lastVacuumAutoLastAnalyzeAuto", {
            value: String(summaryOf(s.target, read.stats)),
            value2: String(
              read.stats.lastVacuum ?? messageText("features.maintenance.panel.never"),
            ),
            value3: String(
              read.stats.lastAutovacuum ?? messageText("features.maintenance.panel.never"),
            ),
            value4: String(
              read.stats.lastAnalyze ?? messageText("features.maintenance.panel.never"),
            ),
            value5: String(
              read.stats.lastAutoanalyze ?? messageText("features.maintenance.panel.never"),
            ),
          })
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
            messageText("features.maintenance.panel.tryAgain"),
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
            "aria-label": messageText("features.maintenance.panel.operation"),
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
          el(
            doc,
            "legend",
            { class: "sr-only" },
            messageText("features.maintenance.panel.options"),
          ),
          ...offers.map((o) => optionOf(doc, o, s, set)),
        ),
      );
      const { sql } = statementOf(s, read);
      parts.push(
        el(
          doc,
          "pre",
          {
            class: "maint-sql",
            "data-part": "statement",
            "aria-label": messageText("features.maintenance.panel.statement"),
          },
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
              locks.heavy
                ? messageText("features.maintenance.panel.whatItBlocks")
                : messageText("features.maintenance.panel.whatItLocks"),
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
          messageText("features.maintenance.panel.run", { value: String(TITLES[s.operation]) }),
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
              s.run?.cancelling
                ? messageText("features.maintenance.panel.cancelling")
                : messageText("features.maintenance.panel.cancel"),
            )
          : undefined,
        el(
          doc,
          "span",
          { class: "maint-keys" },
          el(doc, "kbd", { class: "desk-kbd" }, messageText("features.maintenance.panel.mod")),
          el(doc, "kbd", { class: "desk-kbd" }, messageText("features.maintenance.panel.enter")),
          messageText("features.maintenance.panel.run2"),
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
