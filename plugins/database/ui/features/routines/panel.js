// The routine form (features/README.md): the routine with Read again, what it returns and how it
// runs (volatility decides), a failed read, a procedure's note that it runs outside a transaction
// block, a row per argument (fields.js), the exact call as it will run, what stops it, the choice
// to run it in a transaction rolled back at the end (said plainly), a refusal, Run, and how the
// last run ended in which console. The fields are drawn once per read; a new state changes the
// rest in place, so focus stays where it is. Keys anywhere in it: Mod+Enter runs, g reads the
// routine again (outside the arguments). Layout: routines.css.

import { el } from "../../dom.js";
import { callOf } from "./call.js";
import { argumentRow } from "./fields.js";
import { canRollBack, natureOf, ROLLBACK_WORDS, refusalOf, titleOf } from "./guard.js";

/**
 * @typedef {import("./controller.js").RoutineState} RoutineState
 * @typedef {import("./fields.js").Row} Row
 * @typedef {import("./call.js").Entry} Entry
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const HINTS = "Mod+Enter run · g read again · Alt+N NULL · Alt+D DEFAULT";

/**
 * @param {Document} doc
 * @param {RoutineState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function routinePanel(doc, first, act, buffer) {
  let state = first;
  let drawn = "";
  /** @type {{ position: number, row: Row }[]} */
  let rows = [];
  const id = buffer.id;
  const part = (
    /** @type {string} */ tag,
    /** @type {string} */ name,
    /** @type {Record<string, string>} */ attrs = {},
    /** @type {(Node | string)[]} */ ...children
  ) => el(doc, tag, { "data-part": name, ...attrs }, ...children);

  const title = el(doc, "p", { class: "routine-title" });
  const refresh = el(
    doc,
    "button",
    {
      type: "button",
      class: "desk-btn desk-btn-quiet",
      "data-ctl": "refresh",
      title: "Read the routine again (g)",
    },
    "Read again",
  );
  const facts = part("p", "facts", { class: "routine-facts" });
  const error = part("div", "error", { class: "desk-error", role: "alert" });
  const control = part("div", "control", { class: "desk-callout", "data-tone": "info" });
  const args = part("fieldset", "arguments", { class: "routine-args" });
  const statement = part("pre", "statement", { class: "routine-sql", "aria-label": "Statement" });
  const problem = part("p", "problem", { class: "routine-problem", role: "status" });
  const check = /** @type {HTMLInputElement} */ (
    el(doc, "input", { type: "checkbox", class: "desk-check", "data-ctl": "rollback" })
  );
  const rollback = part(
    "div",
    "rollback",
    { class: "routine-rollback" },
    el(doc, "label", {}, check, " Run in a transaction and roll back"),
    el(doc, "p", { class: "desk-muted" }, ROLLBACK_WORDS),
  );
  const refused = part("p", "refused", { class: "routine-refused" });
  const run = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-primary", "data-ctl": "run" },
    "Run",
  );
  const where = el(doc, "span", { class: "desk-muted" });
  const last = part("p", "last", { class: "routine-last", "aria-live": "polite" });
  const body = el(
    doc,
    "div",
    { class: "routine-body" },
    el(doc, "div", { class: "routine-head", "data-part": "routine" }, title, refresh),
    facts,
    error,
    control,
    args,
    statement,
    problem,
    rollback,
    refused,
    el(
      doc,
      "div",
      { class: "routine-actions" },
      run,
      where,
      el(
        doc,
        "span",
        { class: "routine-keys" },
        el(doc, "kbd", { class: "desk-kbd" }, "Mod"),
        el(doc, "kbd", { class: "desk-kbd" }, "Enter"),
        " run",
      ),
    ),
    last,
  );
  const root = el(doc, "div", { class: "routine", tabindex: "-1" }, body);

  /** The entries as the fields hold them now, by argument position. */
  const entries = () => {
    const out = [...state.entries];
    for (const { position, row } of rows) {
      const entry = row.read();
      if (entry) out[position - 1] = entry;
    }
    return out;
  };
  /** The call, what stops it and the Run button, from the given entries. */
  const drawCall = (/** @type {(Entry | undefined)[]} */ now) => {
    const r = state.routine;
    const call = r ? callOf(r, now) : { sql: "", problem: "" };
    statement.textContent = call.sql;
    statement.hidden = !r;
    problem.textContent = call.problem;
    problem.hidden = call.problem === "";
    const no = r ? refusalOf(state.conn, r) : "";
    const can = Boolean(r) && !no && !call.problem && !state.running && !state.reading;
    run.toggleAttribute("disabled", !can);
  };
  const changed = () => {
    const now = entries();
    drawCall(now);
    act("routineView", id, { entries: now });
  };

  root.addEventListener("focusin", () => {
    const line = doc.getElementById("hints");
    if (line) line.textContent = HINTS;
  });
  root.addEventListener("click", (event) => {
    const ctl = /** @type {HTMLElement | null} */ (event.target)?.closest?.("[data-ctl]");
    if (!ctl || ctl.hasAttribute("disabled")) return;
    if (ctl.dataset.ctl === "run") act("routineRun", id, entries());
    else if (ctl.dataset.ctl === "refresh") act("routineRefresh", id);
  });
  check.addEventListener("change", () => act("routineView", id, { rollback: check.checked }));
  root.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!run.hasAttribute("disabled")) act("routineRun", id, entries());
    } else if (
      event.key === "g" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !target.closest(".routine-args") &&
      target.tagName !== "INPUT" &&
      !state.running
    ) {
      event.preventDefault();
      act("routineRefresh", id);
    }
  });

  /** The fields, drawn again only after a read. */
  const build = () => {
    const r = state.routine;
    rows = (r?.args ?? []).map((a) => ({
      position: a.position,
      row: argumentRow(
        doc,
        /** @type {NonNullable<typeof r>} */ (r),
        a,
        state.entries[a.position - 1] ?? blank(a),
        {
          act,
          changed,
        },
      ),
    }));
    const legend = el(doc, "legend", { class: "routine-legend" }, "Arguments");
    args.replaceChildren(legend, ...rows.map((x) => x.row.el));
    if (rows.length === 0)
      args.append(el(doc, "p", { class: "desk-muted" }, "It takes no arguments."));
    args.hidden = !r;
  };

  const draw = () => {
    const s = state;
    const r = s.routine;
    const key = `${s.oid}|${s.reads}`;
    if (key !== drawn) {
      drawn = key;
      build();
    }
    title.replaceChildren(
      el(doc, "strong", {}, r ? titleOf(r) : "A routine"),
      ` on ${s.conn.name}`,
    );
    refresh.toggleAttribute("disabled", s.running || s.reading);
    facts.textContent = r
      ? `${r.kind === "procedure" ? "" : `Returns ${r.result || "nothing"} · `}${r.language} · ${natureOf(r)}`
      : s.reading
        ? "Reading…"
        : "";
    error.replaceChildren(
      el(doc, "p", {}, s.error),
      el(doc, "button", { type: "button", class: "desk-btn", "data-ctl": "refresh" }, "Try again"),
    );
    error.hidden = s.error === "";
    control.replaceChildren(
      el(
        doc,
        "div",
        { class: "desk-callout-body" },
        el(doc, "p", { class: "desk-callout-title" }, "Outside a transaction block"),
        el(
          doc,
          "p",
          {},
          "Its source commits or rolls back, so it runs alone, as its own statement: what it commits stays, and it cannot run rolled back.",
        ),
      ),
    );
    control.hidden = !r?.controls;
    rollback.hidden = !r || !canRollBack(r);
    check.checked = s.rollback;
    check.toggleAttribute("disabled", s.running);
    const no = r ? refusalOf(s.conn, r) : "";
    refused.textContent = no;
    refused.hidden = no === "";
    run.textContent = s.running
      ? "Running…"
      : s.rollback && r && canRollBack(r)
        ? "Run and roll back"
        : "Run";
    where.textContent = `In ${s.conn.name}'s console, where its result shows.`;
    last.textContent = s.last
      ? `Last run, in the console ${s.last.console}: ${s.last.summary}.`
      : "";
    last.dataset.status = s.last?.status ?? "";
    last.hidden = !s.last;
    drawCall(s.entries);
  };

  draw();
  return {
    el: root,
    update(/** @type {RoutineState} */ next) {
      state = next;
      draw();
    },
    destroy() {
      rows = [];
    },
  };
}

/** An argument's entry before the person touched it: DEFAULT where it has one. */
const blank = (/** @type {import("./read.js").Arg} */ a) =>
  /** @type {Entry} */ ({ choice: a.default !== null ? "default" : "value", value: "" });
