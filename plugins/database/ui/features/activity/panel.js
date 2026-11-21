// The activity panel (features/README.md): a toolbar (Refresh, Pause, the period, the database, the
// filters), a status line, a notice (a failed read with Try again, what the role cannot see, locks
// not all read) and tables.js's sections. A new state is drawn in place: the toolbar stays, the
// sections are drawn again and the session that had the focus keeps it. While on screen and not
// paused it reads again a period after the last read; its keys work anywhere in it but in its
// fields, and the footer shows them. Layout and colours: activity.css.

import { el } from "../../dom.js";
import { readAtText } from "../../schema-cache/view.js";
import { databasesOf, hiddenOf, PERIODS, saidOf, sorted, visible } from "./model.js";
import { LOCK_ROWS } from "./sql.js";
import { locksSection, sessionsSection, treeSection } from "./tables.js";

/**
 * @typedef {import("./controller.js").ActivityState} ActivityState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/** The panel's keys: the key, what it does, its hint ("" for none). */
export const KEYS = /** @type {const} */ ([
  ["ArrowDown", "next", ""],
  ["ArrowUp", "previous", ""],
  ["Home", "first", ""],
  ["End", "last", ""],
  ["Enter", "whole", "whole statement"],
  ["g", "refresh", "refresh"],
  ["p", "pause", "pause"],
  ["c", "cancel", "cancel"],
  ["e", "end", "end"],
]);
const HINTS = [
  "↑↓ select",
  ...KEYS.filter((k) => k[2]).map(([key, , hint]) => `${key} ${hint}`),
].join(" · ");
const AGES = new Set(["stateMs", "xactMs", "queryMs"]);
const FIELDS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** The status line: when it was read, what, and how it refreshes. */
function statusOf(/** @type {ActivityState} */ s) {
  if (!s.read) return s.reading ? "Reading the server's activity…" : s.error ? "Not read." : "";
  const waiting = s.read.sessions.filter((x) => x.blockedBy.length).length;
  const refresh = s.reading
    ? "reading…"
    : s.paused
      ? "Paused"
      : s.error
        ? "Refresh stopped"
        : `every ${s.period} s`;
  return [
    readAtText(s.read.at, Date.now(), true),
    `PostgreSQL ${s.read.server}`,
    `${s.read.sessions.length} sessions, ${waiting} waiting`,
    refresh,
  ].join(" · ");
}

/**
 * @param {Document} doc
 * @param {ActivityState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function activityPanel(doc, first, act, buffer) {
  let state = first;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let armed = "";
  let told = "";
  /** @type {number | undefined} The session to focus once its selection is drawn. */
  let focusPid;
  const id = buffer.id;
  const view = (/** @type {Record<string, unknown>} */ patch) => act("activityView", id, patch);
  const button = (
    /** @type {string} */ ctl,
    /** @type {string} */ text,
    /** @type {string} */ title,
  ) =>
    el(
      doc,
      "button",
      { type: "button", class: "desk-btn desk-btn-quiet", "data-ctl": ctl, title },
      text,
    );
  const check = (/** @type {string} */ ctl, /** @type {string} */ text) => {
    const input = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", "data-ctl": ctl })
    );
    input.addEventListener("change", () => view({ filters: { [ctl]: input.checked } }));
    return { input, label: el(doc, "label", { class: "check" }, input, ` ${text}`) };
  };

  const pause = button("pause", "Pause", "Pause the refresh (p)");
  const period = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { class: "desk-field", "data-ctl": "period" },
      ...PERIODS.map((p) => el(doc, "option", { value: String(p) }, `${p} s`)),
    )
  );
  const database = /** @type {HTMLSelectElement} */ (
    el(
      doc,
      "select",
      { class: "desk-field", "data-ctl": "database", "aria-label": "Database" },
      el(doc, "option", { value: "" }, "All databases"),
    )
  );
  const [idle, own, system] = [
    check("idle", "Hide idle"),
    check("own", "Hide the view's reads"),
    check("system", "Background processes"),
  ];
  const bar = el(
    doc,
    "div",
    { class: "activity-bar", role: "toolbar", "aria-label": "Server activity" },
    button("refresh", "Refresh", "Read again (g)"),
    pause,
    el(doc, "label", { class: "activity-field" }, "Every ", period),
    database,
    idle.label,
    own.label,
    system.label,
  );
  const status = el(doc, "p", { class: "activity-status", role: "status" });
  const notice = el(doc, "div", { "data-part": "notice", class: "activity-notice" });
  let sections = el(doc, "div", { class: "activity-sections" });
  const root = el(doc, "div", { class: "activity" }, bar, status, notice, sections);

  pause.addEventListener("click", () => view({ paused: !state.paused }));
  period.addEventListener("change", () => view({ period: Number(period.value) }));
  database.addEventListener("change", () => view({ filters: { database: database.value } }));
  const hints = () => {
    const line = doc.getElementById("hints");
    if (line) line.textContent = HINTS;
  };
  root.addEventListener("focusin", hints);

  root.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const ctl = /** @type {HTMLElement | null} */ (target.closest("[data-ctl]"))?.dataset.ctl;
    if (ctl === "refresh") return void act("activityRefresh", id);
    if (ctl === "whole") return void view({ whole: !state.whole });
    if ((ctl === "cancel" || ctl === "end") && state.selected !== null)
      return void act("activityStop", id, ctl, state.selected);
    const sort = /** @type {HTMLElement | null} */ (target.closest("[data-sort]"))?.dataset.sort;
    if (sort) {
      const desc = state.sort.key === sort ? !state.sort.desc : AGES.has(sort);
      return void view({ sort: { key: sort, desc } });
    }
    const pid = /** @type {HTMLElement | null} */ (target.closest("[data-pid]"))?.dataset.pid;
    if (pid !== undefined && Number(pid) !== state.selected) view({ selected: Number(pid) });
  });

  /** The sessions on screen, in their order. */
  const order = () =>
    state.read
      ? sorted(visible(state.read.sessions, state.filters), state.sort).map((s) => s.pid)
      : [];
  root.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (event.metaKey || event.ctrlKey || event.altKey || FIELDS.has(target.tagName)) return;
    const action = KEYS.find(([key]) => key === event.key)?.[1];
    const onRow = target.closest('[data-part="sessions"] tr[data-pid]') !== null;
    if (!action || (action === "whole" && !onRow)) return;
    event.preventDefault();
    const pids = order();
    const at = pids.indexOf(state.selected ?? -1);
    const step = { next: 1, previous: -1 }[/** @type {string} */ (action)];
    if (step !== undefined || action === "first" || action === "last") {
      const to =
        action === "first" || at < 0
          ? pids[0]
          : action === "last"
            ? pids.at(-1)
            : pids[Math.max(0, Math.min(pids.length - 1, at + (step ?? 0)))];
      if (to !== undefined) {
        focusPid = to;
        view({ selected: to });
      }
    } else if (action === "whole" && state.selected !== null) view({ whole: !state.whole });
    else if (action === "refresh") act("activityRefresh", id);
    else if (action === "pause") view({ paused: !state.paused });
    else if ((action === "cancel" || action === "end") && state.selected !== null)
      act("activityStop", id, action, state.selected);
  });

  /** Read again a period after the last read, while on screen, not paused and not failing. */
  const arm = () => {
    const s = state;
    const key = s.paused || s.reading || s.error || !s.read ? "" : `${s.read.at}|${s.period}`;
    if (key === armed) return;
    armed = key;
    clearTimeout(timer);
    timer = undefined;
    if (!key) return;
    const ms = s.period * 1000;
    const tick = () => {
      timer = undefined;
      if (!root.isConnected) return;
      if (root.closest("[hidden]") || doc.visibilityState === "hidden")
        timer = setTimeout(tick, ms);
      else act("activityRefresh", id);
    };
    timer = setTimeout(tick, ms);
  };

  /** What the panel tells above its sections, drawn again only when it changes. */
  const tell = (/** @type {ActivityState} */ s) => {
    const hidden = s.read ? hiddenOf(s.read.sessions) : "";
    const more = s.read?.more
      ? `Only the first ${LOCK_ROWS.toLocaleString("en-US")} locks were read, the waiting ones first.`
      : "";
    const key = [s.error, hidden, more].join("\n");
    if (key === told) return;
    told = key;
    const callout = (/** @type {string} */ text) =>
      el(
        doc,
        "div",
        { class: "desk-callout", "data-tone": "info" },
        el(doc, "div", { class: "desk-callout-body" }, text),
      );
    notice.replaceChildren(
      ...(s.error
        ? [
            el(
              doc,
              "div",
              { class: "desk-error", role: "alert" },
              el(doc, "p", {}, s.error),
              el(
                doc,
                "button",
                { type: "button", class: "desk-btn", "data-ctl": "refresh" },
                "Try again",
              ),
            ),
          ]
        : []),
      ...[hidden, more].filter(Boolean).map(callout),
    );
  };

  const draw = () => {
    const s = state;
    pause.textContent = s.paused ? "Resume" : "Pause";
    pause.setAttribute("aria-pressed", String(s.paused));
    period.value = String(s.period);
    const names = s.read ? databasesOf(s.read.sessions) : [];
    if (s.filters.database && !names.includes(s.filters.database)) names.push(s.filters.database);
    const have = [...database.options].slice(1).map((o) => o.value);
    if (have.join("\n") !== names.join("\n"))
      database.replaceChildren(
        /** @type {HTMLOptionElement} */ (database.options[0]),
        ...names.map((n) => el(doc, "option", { value: n }, n)),
      );
    database.value = s.filters.database;
    idle.input.checked = s.filters.idle;
    own.input.checked = s.filters.own;
    system.input.checked = s.filters.system;
    status.textContent = statusOf(s);
    tell(s);
    const focused = /** @type {HTMLElement | null} */ (doc.activeElement);
    const row =
      focused && root.contains(focused)
        ? /** @type {HTMLElement | null} */ (focused.closest("tr[data-pid]"))
        : null;
    const shown = s.read ? sorted(visible(s.read.sessions, s.filters), s.sort) : [];
    const next = el(
      doc,
      "div",
      { class: "activity-sections" },
      ...(s.read
        ? [treeSection(doc, s), sessionsSection(doc, s, shown), locksSection(doc, s)]
        : []),
    );
    sections.replaceWith(next);
    sections = next;
    const want =
      focusPid ?? (row?.closest('[data-part="sessions"]') ? Number(row.dataset.pid) : undefined);
    focusPid = undefined;
    if (want !== undefined)
      /** @type {HTMLElement | null} */ (
        sections.querySelector(`[data-part="sessions"] tr[data-pid="${want}"]`)
      )?.focus();
    arm();
  };

  /**
   * The footer's sentence about a read (the open command's) follows each read while the footer
   * still shows it; anything said since stays.
   * @param {NonNullable<ActivityState["read"]>} before
   * @param {NonNullable<ActivityState["read"]>} now
   */
  const follow = (before, now) => {
    const line = doc.getElementById("status");
    if (!line || line.textContent !== saidOf(state.conn.name, before)) return;
    line.textContent = saidOf(state.conn.name, now);
    line.title = line.textContent;
  };

  draw();
  hints();
  if (!state.read && !state.reading && !state.error) act("activityRefresh", id);
  return {
    el: root,
    update(/** @type {ActivityState} */ next) {
      const before = state.read;
      state = next;
      draw();
      if (before && next.read && before !== next.read) follow(before, next.read);
    },
    destroy() {
      clearTimeout(timer);
      timer = undefined;
      armed = "";
    },
  };
}
