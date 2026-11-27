// The agent audit panel (features/README.md, PG-91): a header with the connection and Export and
// Clear; what agents may reach of it (closed to agents, EXPLAIN ANALYZE allowed, the sensitive
// columns with a field to add one and a button to remove each); the last sentence said; and the
// list, newest first: when, who, the command, the statement, the rows, the person's answer and how
// it ended. A new state is drawn in place and the field keeps what was typed. Layout: audit.css.

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";

/**
 * @typedef {import("./controller.js").AuditState} AuditState
 * @typedef {import("./log.js").Entry} Entry
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** Who called, in words. */
export const callerText = (/** @type {string} */ caller) =>
  caller === "desk" ? "You (palette)" : caller.startsWith("agent:") ? caller.slice(6) : caller;

/** The person's answer, in words. */
export const answerText = (/** @type {Entry} */ e) =>
  !e.asked ? "Not asked" : e.allowed ? "Allowed once" : "Declined";

const OUTCOME = /** @type {Record<Entry["outcome"], string>} */ ({
  ran: "Ran",
  failed: "Failed",
  refused: "Refused",
  declined: "Not run",
  cancelled: "Cancelled",
});

/** When, as a local date and time to the second. */
const whenText = (/** @type {string} */ at) => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * @param {Document} doc
 * @param {AuditState} first
 * @param {Act} act
 * @param {{ connection: string }} buffer
 */
export function auditPanel(doc, first, act, buffer) {
  const id = buffer.connection;
  const button = (
    /** @type {string} */ ctl,
    /** @type {string} */ text,
    /** @type {string} */ more,
    /** @type {() => void} */ press,
  ) => {
    const node = el(
      doc,
      "button",
      { type: "button", class: `desk-btn ${more}`.trim(), "data-ctl": ctl },
      text,
    );
    node.addEventListener("click", press);
    return node;
  };
  const check = (/** @type {"closed" | "analyze"} */ ctl, /** @type {string} */ text) => {
    const input = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", "data-ctl": ctl })
    );
    input.addEventListener("change", () => act("auditAccess", id, { [ctl]: input.checked }));
    return { input, label: el(doc, "label", { class: "audit-check" }, input, ` ${text}`) };
  };

  const title = el(doc, "h2", { class: "desk-header-title" }, t("features.audit.panel.agentAudit"));
  const desc = el(doc, "p", { class: "desk-header-desc" });
  const header = el(
    doc,
    "div",
    { class: "desk-header audit-header" },
    el(doc, "div", { class: "desk-header-text" }, title, desc),
    el(
      doc,
      "div",
      { class: "desk-header-actions" },
      button("export", "Export", "", () => act("auditExport", id)),
      button("clear", "Clear", "desk-btn-danger", () => act("auditClear", id)),
    ),
  );
  const closed = check("closed", "Closed to agents");
  const analyze = check("analyze", "Agents may run EXPLAIN ANALYZE (it runs the statement)");
  const field = /** @type {HTMLInputElement} */ (
    el(doc, "input", {
      type: "text",
      class: "desk-field",
      "data-ctl": "sensitive",
      "aria-label": t("features.audit.panel.sensitiveColumn"),
      placeholder: t("features.audit.panel.publicPeopleEmail"),
    })
  );
  const add = () => {
    const name = field.value.trim();
    if (!name) return;
    void Promise.resolve(act("auditAccess", id, { add: name })).then(() => {
      field.value = "";
    });
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") add();
  });
  const chips = el(doc, "ul", {
    class: "audit-chips",
    "aria-label": t("features.audit.panel.sensitiveColumns"),
  });
  const access = el(
    doc,
    "section",
    { class: "audit-access", "aria-label": t("features.audit.panel.whatAgentsMayReach") },
    closed.label,
    analyze.label,
    el(
      doc,
      "p",
      { class: "audit-muted" },
      t("features.audit.panel.sensitiveColumnsAreMaskedInEverything"),
    ),
    el(doc, "div", { class: "audit-add" }, field, button("add", "Mask column", "", add)),
    chips,
  );
  const note = el(doc, "p", { class: "audit-muted", role: "status" });
  const list = el(doc, "div", { class: "audit-list" });
  const root = el(doc, "div", { class: "audit" }, header, access, note, list);

  const row = (/** @type {Entry} */ e) =>
    el(
      doc,
      "tr",
      { "data-outcome": e.outcome },
      el(doc, "td", { class: "audit-when" }, whenText(e.at)),
      el(doc, "td", {}, callerText(e.caller)),
      el(doc, "td", {}, e.command.replace(/^endue\.database\./u, "")),
      el(
        doc,
        "td",
        { class: "audit-sql" },
        el(doc, "code", {}, e.statement),
        ...(e.error ? [el(doc, "div", { class: "audit-error" }, e.error)] : []),
      ),
      el(doc, "td", { class: "audit-num" }, e.rows === null ? "" : String(e.rows)),
      el(doc, "td", {}, answerText(e)),
      el(doc, "td", {}, OUTCOME[e.outcome] ?? e.outcome),
    );

  const draw = (/** @type {AuditState} */ s) => {
    const count = s.entries.length;
    desc.textContent = t("features.audit.panel.keptApartFromYourHistory", {
      name: String(s.name),
      value: String(s.tag !== "none" ? ` · ${s.tag}` : ""),
      count: String(count),
      value2: String(
        count === 1 ? t("features.audit.panel.entry") : t("features.audit.panel.entries"),
      ),
    });
    closed.input.checked = s.access.closed;
    analyze.input.checked = s.access.analyze;
    chips.replaceChildren(
      ...s.access.sensitive.map((name) =>
        el(
          doc,
          "li",
          { class: "desk-chip audit-chip" },
          el(doc, "code", {}, name),
          button("remove", "Unmask", "desk-btn-quiet", () =>
            act("auditAccess", id, { remove: name }),
          ),
        ),
      ),
    );
    note.textContent = s.note;
    if (count === 0) {
      list.replaceChildren(
        el(doc, "p", { class: "audit-muted" }, t("features.audit.panel.noAgentHasRunAnythingOn")),
      );
      return;
    }
    const head = el(
      doc,
      "tr",
      {},
      ...["When", "Who", "Command", "Statement", "Rows", "Asked", "Outcome"].map((h) =>
        el(doc, "th", { scope: "col" }, h),
      ),
    );
    list.replaceChildren(
      el(
        doc,
        "table",
        { class: "desk-table audit-table", "aria-label": t("features.audit.panel.whatAgentsRan") },
        el(doc, "thead", {}, head),
        el(doc, "tbody", {}, ...s.entries.map(row)),
      ),
    );
  };
  draw(first);
  return { el: root, update: draw };
}
