// The table of name/value rows that params, headers, form fields and variables share: a switch,
// the name, the value (both with {{variables}}), a note and a remove button. The empty row at the
// end becomes a real one as soon as something is typed in it. Bulk edit swaps the table for text,
// one `name: value` per line, `//` in front of a row that is off.

import { append, button, h, icon } from "./dom.js";
import { pair } from "./model.js";
import { varField } from "./var-field.js";

/**
 * @typedef {import("./model.js").Pair & { kind?: "text" | "file" }} Row
 * @typedef {{ rows: Row[], scopes: () => import("./vars.js").Scope[], onChange(rows: Row[]): void,
 *   keyLabel?: string, valueLabel?: string, keyHint?: string, valueHint?: string,
 *   files?: boolean, secret?: (row: Row) => boolean, notes?: boolean, title?: string, fixed?: boolean,
 *   onPickFile?(): Promise<string | undefined> }} TableSpec
 */

/** Rows as bulk text. @param {Row[]} rows */
export function toBulk(rows) {
  return rows
    .filter((r) => r.key !== "" || r.value !== "")
    .map((r) => `${r.on ? "" : "// "}${r.key}: ${r.value}`)
    .join("\n");
}

/** Bulk text as rows, keeping the ids and notes of rows with the same name. @param {string} text @param {Row[]} old */
export function fromBulk(text, old) {
  const left = [...old];
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const off = /^\s*\/\/\s?/.test(line);
      const body = line.replace(/^\s*\/\/\s?/, "");
      const colon = body.indexOf(":");
      const key = (colon >= 0 ? body.slice(0, colon) : body).trim();
      const value = colon >= 0 ? body.slice(colon + 1).trim() : "";
      const at = left.findIndex((r) => r.key === key);
      const prev = at >= 0 ? left.splice(at, 1)[0] : undefined;
      return { ...(prev ?? pair()), key, value, on: !off };
    });
}

/** @param {TableSpec} spec */
export function kvTable(spec) {
  let rows = spec.rows;
  let bulk = false;
  const body = h("div.kv-body");
  const root = h("div.kv");
  const emit = () => spec.onChange(rows.filter((r) => r.key !== "" || r.value !== "" || r.desc));

  const head = h(
    "div.kv-row.kv-head",
    null,
    h("span.kv-cell.kv-on"),
    h("span.kv-cell", null, spec.keyLabel ?? "Name"),
    h("span.kv-cell", null, spec.valueLabel ?? "Value"),
    spec.notes === false ? null : h("span.kv-cell.kv-note-head", null, "Description"),
    h("span.kv-cell.kv-act"),
  );

  /** @param {Row} row @param {boolean} ghost */
  const line = (row, ghost) => {
    const check = /** @type {HTMLInputElement} */ (
      h("input.desk-check", {
        type: "checkbox",
        checked: row.on,
        "aria-label": "Use this row",
        disabled: ghost,
      })
    );
    const el = h(`div.kv-row${ghost ? ".is-ghost" : ""}${row.on ? "" : ".is-off"}`);
    const promote = () => {
      if (!ghost) return;
      ghost = false;
      rows = [...rows, row];
      el.classList.remove("is-ghost");
      check.disabled = false;
      body.append(line(pair(spec.files ? { kind: "text" } : {}), true));
    };
    check.addEventListener("change", () => {
      row.on = check.checked;
      el.classList.toggle("is-off", !row.on);
      emit();
    });
    const key = varField({
      value: row.key,
      label: spec.keyLabel ?? "Name",
      placeholder: ghost ? (spec.keyHint ?? "Add a name") : "",
      scopes: spec.scopes,
      className: "kv-key",
      onChange: (v) => {
        row.key = v;
        promote();
        emit();
      },
    });
    const fileMode = spec.files && row.kind === "file";
    const value = varField({
      value: row.value,
      label: spec.valueLabel ?? "Value",
      placeholder: ghost ? (spec.valueHint ?? "Value") : fileMode ? "Path of a file" : "",
      scopes: spec.scopes,
      secret: spec.secret?.(row),
      className: "kv-value",
      onChange: (v) => {
        row.value = v;
        promote();
        emit();
      },
    });
    const valueCell = h("span.kv-cell.kv-val", null, value.el);
    if (spec.files) {
      const kind = h(
        "select.desk-field.kv-kind",
        {
          "aria-label": "Kind of part",
          onChange: (/** @type {Event} */ e) => {
            row.kind =
              /** @type {HTMLSelectElement} */ (e.target).value === "file" ? "file" : "text";
            emit();
            el.replaceWith(line(row, ghost));
          },
        },
        h("option", { value: "text", selected: row.kind !== "file" }, "Text"),
        h("option", { value: "file", selected: row.kind === "file" }, "File"),
      );
      valueCell.prepend(kind);
      if (fileMode && spec.onPickFile)
        valueCell.append(
          button({
            label: "Choose a file",
            icon: "file",
            hideLabel: true,
            kind: "kv-pick",
            onClick: async () => {
              const path = await spec.onPickFile?.();
              if (!path) return;
              value.set(path);
              row.value = path;
              promote();
              emit();
            },
          }),
        );
    }
    const note = /** @type {HTMLInputElement} */ (
      h("input.desk-field.kv-note", {
        type: "text",
        value: row.desc ?? "",
        "aria-label": "Description",
        placeholder: ghost ? "" : "",
      })
    );
    note.addEventListener("input", () => {
      row.desc = note.value;
      promote();
      emit();
    });
    const remove = button({
      label: "Remove",
      icon: "x",
      hideLabel: true,
      kind: "kv-remove",
      onClick: () => {
        rows = rows.filter((r) => r !== row);
        el.remove();
        emit();
      },
    });
    append(el, [
      h("span.kv-cell.kv-on", null, check),
      h("span.kv-cell", null, key.el),
      valueCell,
      spec.notes === false ? null : h("span.kv-cell.kv-note-cell", null, note),
      h("span.kv-cell.kv-act", null, ghost || spec.fixed ? null : remove),
    ]);
    if (spec.notes === false) el.classList.add("no-notes");
    return el;
  };

  const area = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.kv-bulk", {
      spellcheck: "false",
      "aria-label": "Rows as text",
      placeholder: "name: value\n// a row that is off: value",
    })
  );
  area.addEventListener("input", () => {
    rows = fromBulk(area.value, rows);
    emit();
  });

  const toggle = button({
    label: "Bulk edit",
    icon: "list",
    kind: "desk-btn-quiet kv-toggle",
    onClick: () => {
      bulk = !bulk;
      draw();
    },
  });

  const draw = () => {
    toggle.querySelector(".label")?.replaceChildren(bulk ? "Table" : "Bulk edit");
    if (bulk) {
      area.value = toBulk(rows);
      root.replaceChildren(
        h("div.kv-bar", null, spec.title ? h("span.kv-title", null, spec.title) : null, toggle),
        area,
      );
      area.focus();
      return;
    }
    body.replaceChildren(
      ...rows.map((r) => line(r, false)),
      spec.fixed ? "" : line(pair(spec.files ? { kind: "text" } : {}), true),
    );
    root.replaceChildren(
      h("div.kv-bar", null, spec.title ? h("span.kv-title", null, spec.title) : null, toggle),
      h("div.kv-grid", null, head, body),
    );
    if (spec.notes === false) head.classList.add("no-notes");
  };
  draw();

  return {
    el: root,
    /** Put new rows in (the URL bar changed the params). @param {Row[]} next */
    set(next) {
      rows = next;
      if (!root.contains(document.activeElement) || bulk) draw();
      else redrawValues();
    },
  };

  /** Rows changed under a focused table: rebuild but keep the focus where it was. */
  function redrawValues() {
    const focused = /** @type {HTMLElement | null} */ (document.activeElement);
    const rowEl = focused?.closest(".kv-row");
    const index = rowEl ? [...body.children].indexOf(rowEl) : -1;
    const field = focused?.closest(".kv-key") ? ".kv-key input" : ".kv-value input";
    const caret = /** @type {HTMLInputElement} */ (focused).selectionStart ?? 0;
    draw();
    const again = /** @type {HTMLInputElement | null} */ (
      body.children[index]?.querySelector(field) ?? null
    );
    again?.focus();
    again?.setSelectionRange(caret, caret);
  }
}

/** The headers people type most, offered while naming a header. */
export const COMMON_HEADERS = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "If-Match",
  "If-None-Match",
  "Idempotency-Key",
  "Origin",
  "Prefer",
  "Range",
  "Referer",
  "User-Agent",
  "X-Api-Key",
  "X-Request-Id",
];

/** An icon and a count for a tab label. @param {number} n */
export function count(n) {
  return n > 0 ? h("span.tab-count", null, String(n)) : null;
}

export { icon };
