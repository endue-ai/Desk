// @vitest-environment jsdom
// Typed cell editors (PG-40, #467) on the page: each opens over its cell, keeps with Enter (Mod+Enter
// where Enter makes a new line), cancels with Escape, and sets NULL and DEFAULT as two choices; a
// value the type refuses stays in the editor with the reason. The grid's cursor cell says when its
// column cannot change, and why.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { typesOf } from "../ui/cell-editors/pg-types.js";
import { editorOf } from "../ui/cell-editors/resolve.js";
import { DEFAULT } from "../ui/edit/values.js";
import { createCellEditor } from "../ui/view-cell.js";
import { createGrid } from "../ui/view-grid.js";

const info = typesOf([
  ["flag", "boolean", "bool", "B", "", "", "{}", "YES", "NO", "", "", "Asia/Seoul"],
  ["mood", "mood", "mood", "E", "", "", '{sad,ok,"so so"}', "NO", "YES", "", "", "Asia/Seoul"],
  ["day", "date", "date", "D", "", "", "{}", "YES", "NO", "", "", "Asia/Seoul"],
  [
    "at",
    "timestamp with time zone",
    "timestamptz",
    "D",
    "",
    "",
    "{}",
    "YES",
    "NO",
    "",
    "",
    "Asia/Seoul",
  ],
  ["j", "jsonb", "jsonb", "U", "", "", "{}", "YES", "NO", "", "", "Asia/Seoul"],
  ["ints", "integer[]", "_int4", "A", "int4", "N", "{}", "YES", "NO", "", "", "Asia/Seoul"],
  ["bytes", "bytea", "bytea", "U", "", "", "{}", "YES", "NO", "", "", "Asia/Seoul"],
  ["id", "uuid", "uuid", "U", "", "", "{}", "YES", "YES", "", "", "Asia/Seoul"],
  ["note", "text", "text", "S", "", "", "{}", "YES", "YES", "", "", "Asia/Seoul"],
]);
const editing = (name: string, value: string | null) => {
  const types = info.get(name);
  const editor = editorOf(
    "postgresql",
    { name, type: types?.type ?? "", nullable: true, default: null },
    types,
  );
  return { row: 0, col: 0, value, name, type: types?.type ?? "", editor };
};

let host: HTMLElement;
let cell: HTMLElement;
const commit = vi.fn();
const done = vi.fn();
const act = vi.fn();

beforeEach(() => {
  document.body.innerHTML = '<div id="grid"><div id="cell">x</div></div>';
  host = document.getElementById("grid") as HTMLElement;
  cell = document.getElementById("cell") as HTMLElement;
  commit.mockReset();
  done.mockReset();
  act.mockReset();
});

const open = (name: string, value: string | null) => {
  const editor = createCellEditor(document, host, commit, done, act);
  const at = editing(name, value);
  editor.open(cell, at);
  return { editor, at, panel: () => document.querySelector<HTMLElement>(".cell-editor") };
};
const press = (key: string, more: KeyboardEventInit = {}) =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }),
  );
const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

describe("each editor opens with Enter, keeps with Enter or Mod+Enter, cancels with Escape", () => {
  it("a boolean is a toggle with NULL, by keys", () => {
    const { at, panel } = open("flag", "t");
    expect(panel()?.querySelector('[aria-pressed="true"]')?.textContent).toBe("true");
    press("f");
    expect(q('[data-value="f"]').getAttribute("aria-pressed")).toBe("true");
    press(" ");
    expect(q('[data-value="t"]').getAttribute("aria-pressed")).toBe("true");
    press("n");
    press("Enter");
    expect(commit).toHaveBeenCalledWith(at, null, "down");
    expect(panel()).toBeNull();
    expect(done).toHaveBeenCalled();
  });

  it("an enum is a list of its labels", () => {
    const { at } = open("mood", "ok");
    expect([...document.querySelectorAll("[role=option]")].map((o) => o.textContent)).toEqual([
      "sad",
      "ok",
      "so so",
    ]);
    expect(q('[role=option][aria-selected="true"]').textContent).toBe("ok");
    press("ArrowDown");
    press("Enter");
    expect(commit).toHaveBeenCalledWith(at, "so so", "down");
  });

  it("an enum's DEFAULT is a choice of its own, and Escape keeps the cell as it was", () => {
    const first = open("mood", "ok");
    expect(q('[data-choice="null"]')).toBeNull(); // mood is NOT NULL
    press("d", { code: "KeyD", altKey: true });
    expect(commit).toHaveBeenCalledWith(first.at, DEFAULT, "down");
    commit.mockReset();
    open("mood", "ok");
    press("Escape");
    expect(commit).not.toHaveBeenCalled();
    expect(q(".cell-editor")).toBeNull();
  });

  it("a date is text checked before it is kept, with a picker that writes it", () => {
    const { at } = open("day", "2026-11-21");
    const text = q<HTMLInputElement>(".cell-editor-text");
    const picker = q<HTMLInputElement>('input[type="date"]');
    expect(text.value).toBe("2026-11-21");
    expect(picker.value).toBe("2026-11-21");
    type(picker, "2026-12-01");
    expect(text.value).toBe("2026-12-01");
    text.focus();
    type(text, "2025-02-29");
    press("Enter");
    expect(commit).not.toHaveBeenCalled();
    expect(q("[role=alert]").textContent).toMatch(/February 2025 has 28 days/u);
    type(text, "2025-02-28");
    press("Enter");
    expect(commit).toHaveBeenCalledWith(at, "2025-02-28", "down");
  });

  it("a timestamp with a zone shows the session's time zone in its header", () => {
    open("at", "2026-11-21 10:00:00+09");
    expect(q(".cell-editor-head").textContent).toMatch(/Asia\/Seoul/u);
    expect(q<HTMLInputElement>('input[type="time"]').value).toBe("10:00:00");
  });

  it("JSON is laid out, refused when invalid, and kept with Mod+Enter", () => {
    const { at } = open("j", '{"a":1,"b":[1,2]}');
    const text = q<HTMLTextAreaElement>("textarea.cell-editor-text");
    expect(text.value).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    press("Enter");
    expect(commit).not.toHaveBeenCalled();
    press("Enter", { ctrlKey: true });
    // Laid out but the same: no change.
    expect(commit).toHaveBeenCalledWith(at, undefined, "down");
    commit.mockReset();
    open("j", '{"a":1}');
    type(q("textarea.cell-editor-text"), '{"a": }');
    press("Enter", { metaKey: true });
    expect(commit).not.toHaveBeenCalled();
    expect(q("[role=alert]").textContent).toMatch(/line 1, column 7/u);
    type(q("textarea.cell-editor-text"), '{"a":2}');
    press("f", { code: "KeyF", altKey: true });
    expect(q<HTMLTextAreaElement>("textarea.cell-editor-text").value).toBe('{\n  "a": 2\n}');
    press("Enter", { metaKey: true });
    expect(commit).toHaveBeenCalledWith(expect.anything(), '{\n  "a": 2\n}', "down");
  });

  it("an array is a list of elements, each checked by the element's type", () => {
    const { at } = open("ints", "{1,2,NULL}");
    const elements = () => [...document.querySelectorAll<HTMLInputElement>(".cell-editor-element")];
    expect(elements().map((e) => e.value)).toEqual(["1", "2", ""]);
    expect(elements()[2]?.placeholder).toBe("NULL");
    q('[data-do="add"]').click();
    expect(elements()).toHaveLength(4);
    type(elements()[3] as HTMLInputElement, "x");
    press("Enter", { metaKey: true });
    expect(q("[role=alert]").textContent).toMatch(/element 4: .*whole number/u);
    type(elements()[3] as HTMLInputElement, "4");
    press("Enter", { metaKey: true });
    expect(commit).toHaveBeenCalledWith(at, "{1,2,NULL,4}", "down");
  });

  it("bytes show as hex with their size, and load from a file", async () => {
    act.mockResolvedValueOnce({ hex: "\\xdeadbeef", name: "a.bin", size: 4 });
    const { at } = open("bytes", "\\x0102ff");
    expect(q<HTMLTextAreaElement>(".cell-editor-text").value).toBe("\\x0102ff");
    expect(q(".cell-editor-size").textContent).toBe("3 bytes");
    q('[data-do="load"]').click();
    await vi.waitFor(() =>
      expect(q<HTMLTextAreaElement>(".cell-editor-text").value).toBe("\\xdeadbeef"),
    );
    expect(act).toHaveBeenCalledWith("cellFileLoad");
    expect(q(".cell-editor-size").textContent).toBe("4 bytes · a.bin");
    q('[data-do="save"]').click();
    expect(act).toHaveBeenLastCalledWith("cellFileSave", "\\xdeadbeef", "bytes");
    press("Enter", { metaKey: true });
    expect(commit).toHaveBeenCalledWith(at, "\\xdeadbeef", "down");
  });

  it("a UUID can be generated, and NULL and DEFAULT are two choices", () => {
    const { at } = open("id", null);
    q('[data-do="generate"]').click();
    const text = q<HTMLInputElement>(".cell-editor-text");
    expect(text.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(q('[data-choice="null"]').textContent).toBe("Set NULL");
    expect(q('[data-choice="default"]').textContent).toBe("Set DEFAULT");
    q('[data-choice="default"]').click();
    expect(commit).toHaveBeenCalledWith(at, DEFAULT, "none");
  });

  it("a text column keeps its field over the cell, with Alt+D for DEFAULT", () => {
    const { at } = open("note", "hello");
    const input = q<HTMLInputElement>(".cell-input");
    expect(input.value).toBe("hello");
    expect(q(".cell-editor")).toBeNull();
    press("d", { code: "KeyD", altKey: true });
    expect(commit).toHaveBeenCalledWith(at, DEFAULT, "down");
  });
});

describe("the grid's cursor cell", () => {
  it("says a fixed column cannot change, and why", () => {
    document.body.innerHTML = '<div id="result"></div>';
    const act = vi.fn();
    const grid = createGrid(document, q("#result"), act);
    const editor = {
      ...editing("note", null).editor,
      fixed: "twice is generated: the server computes it.",
    };
    const edit = {
      key: "k",
      status: "ready" as const,
      reason: "",
      count: 0,
      message: "",
      changes: { updates: new Map(), inserts: [], deletes: new Set<number>() },
      target: {
        dialect: "postgresql" as const,
        schema: "public",
        name: "t",
        key: [0],
        columns: [
          { name: "id", type: "integer", key: true, known: true },
          { name: "twice", type: "integer", key: false, known: true, editor },
        ],
      },
    };
    const set = { columns: ["id", "twice"], rows: [["1", "2"]], truncated: false };
    grid.render({ kind: "rows", set } as never, true, { edit, server: false });
    q("#result [role=grid]").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(grid.cursorCell()).toMatchObject({
      editable: false,
      reason: "twice is generated: the server computes it.",
      editor: { fixed: "twice is generated: the server computes it." },
    });
  });
});
