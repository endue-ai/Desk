// @vitest-environment jsdom
// The console editor on the vendored component (ADR 0282, ui/view-editor.js) on jsdom: find and
// replace, several carets, indent and comment toggles, an undo history per console, the surface's
// keys and an IME, completion from the controller with the statement around the caret, the
// console's textarea handle that view.js holds, and the component's colours from the theme.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  EditorSelection,
  EditorView,
  foldCode,
  foldedRanges,
} from "../ui/vendor/editor-component.mjs";
import { createEditor } from "../ui/view-editor.js";

beforeAll(() => {
  // jsdom lays nothing out; the component measures ranges of text.
  const none = () => Object.assign([], { item: () => null });
  Range.prototype.getClientRects = none as never;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

type Completion = { from: number; to: number; items: unknown[]; wants: unknown[] };

function setup(text = "", answer?: (text: string, caret: number) => Completion | undefined) {
  document.body.innerHTML = [
    '<div id="editor-box"><pre id="highlight" aria-hidden="true"></pre>',
    '<textarea id="editor" aria-label="SQL" placeholder="SELECT …"></textarea>',
    '<ul id="complete" role="listbox" hidden></ul></div>',
  ].join("");
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const editor = byId("editor") as HTMLTextAreaElement;
  const box = byId("editor-box");
  let running = false;
  const act = vi.fn((action: string, ...args: unknown[]) =>
    action === "complete" ? answer?.(args[0] as string, args[1] as number) : undefined,
  );
  const ed = createEditor(
    document,
    { box, editor, layer: byId("highlight"), list: byId("complete") },
    act,
    () => running,
  );
  ed.show(text, "postgresql", false, "first");
  const view = EditorView.findFromDOM(box.querySelector(".cm-editor") as HTMLElement);
  if (!view) throw new Error("no editor component");
  return {
    ed,
    view,
    editor,
    box,
    act,
    run: (on: boolean) => {
      running = on;
    },
  };
}

type View = InstanceType<typeof EditorView>;

/** A key press on the editor; true when the editor took it. */
function press(view: View, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}
const ctrl = { ctrlKey: true };
/** What typing does: the text goes in at every caret. */
const type = (view: View, text: string) =>
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: "input.type" });
const text = (view: View) => view.state.doc.toString();
const select = (view: View, anchor: number, head = anchor) =>
  view.dispatch({ selection: EditorSelection.single(anchor, head) });

describe("find and replace: plain, whole word and regular expression", () => {
  const bar = (box: HTMLElement) => {
    const panel = box.querySelector('[role="search"]') as HTMLElement;
    const field = (name: string) => panel.querySelector(`[name="${name}"]`) as HTMLInputElement;
    const set = (name: string, value: string) => {
      field(name).value = value;
      field(name).dispatchEvent(new Event("input", { bubbles: true }));
    };
    const tick = (name: string) => {
      field(name).checked = true;
      field(name).dispatchEvent(new Event("change", { bubbles: true }));
    };
    const click = (name: string) => (field(name) as unknown as HTMLButtonElement).click();
    return { panel, field, set, tick, click };
  };

  it("Mod+F opens the bar with labelled fields; Replace all replaces every plain match", async () => {
    const { view, box } = setup("select a, ab from t where a = 1;");
    expect(press(view, "f", ctrl)).toBe(true);
    const { panel, field, set, click } = bar(box);
    expect(panel.getAttribute("aria-label")).toBe("Find and replace");
    for (const name of ["search", "replace", "case", "word", "re"])
      expect(field(name)).not.toBeNull();
    expect(field("search").getAttribute("aria-label")).toBe("Find");
    set("search", "a");
    await vi.waitFor(() => expect(panel.querySelector(".count")?.textContent).toBe("3 matches"));
    set("replace", "x");
    click("replaceAll");
    expect(text(view)).toBe("select x, xb from t where x = 1;");
  });

  it("whole word leaves a longer word alone; Enter finds the next match", () => {
    const { view, box } = setup("select a, ab from t where a = 1;");
    press(view, "f", ctrl);
    const { field, set, tick, click } = bar(box);
    tick("word");
    set("search", "a");
    field("search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "a",
    );
    expect(view.state.selection.main.from).toBe(7);
    set("replace", "x");
    click("replaceAll");
    expect(text(view)).toBe("select x, ab from t where x = 1;");
    // Escape from anywhere in the bar closes it.
    const word = field("word");
    word.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(box.querySelector('[role="search"]')).toBeNull();
  });

  it("a regular expression with groups; an invalid one says so", async () => {
    const { view, box } = setup("a1 b22 c333");
    press(view, "f", ctrl);
    const { panel, set, tick, click } = bar(box);
    tick("re");
    set("search", "([a-z])(\\d+)");
    set("replace", "$2$1");
    click("replaceAll");
    expect(text(view)).toBe("1a 22b 333c");
    set("search", "(");
    await vi.waitFor(() =>
      expect(panel.querySelector(".count")?.textContent).toBe("Not a valid expression"),
    );
  });
});

describe("several carets and column selection", () => {
  it("Mod+Alt+ArrowDown adds a caret below, and typing reaches every caret", () => {
    const { view } = setup("a\nb\nc");
    select(view, 0);
    expect(press(view, "ArrowDown", { ctrlKey: true, altKey: true })).toBe(true);
    // jsdom lays nothing out, so where the new caret lands is the app test's (database-editor.spec.ts).
    expect(view.state.selection.ranges).toHaveLength(2);
    expect(press(view, "Escape")).toBe(true);
    expect(view.state.selection.ranges).toHaveLength(1);
    select(view, 0);
    press(view, "ArrowDown", { ctrlKey: true, altKey: true });
    type(view, "x");
    expect(text(view).split("x")).toHaveLength(3);
  });

  it("Alt+J selects the next occurrence; Shift+Alt+J every one", () => {
    const { view } = setup("foo bar foo baz foo");
    select(view, 0, 3);
    expect(press(view, "j", { altKey: true, keyCode: 74 })).toBe(true);
    expect(view.state.selection.ranges.map((r: { from: number }) => r.from)).toEqual([0, 8]);
    select(view, 0, 3);
    expect(press(view, "J", { altKey: true, shiftKey: true, keyCode: 74 })).toBe(true);
    expect(view.state.selection.ranges.map((r: { from: number }) => r.from)).toEqual([0, 8, 16]);
    type(view, "q");
    expect(text(view)).toBe("q bar q baz q");
  });

  it("the component takes Alt+drag as a column selection", () => {
    const { view } = setup("abc\ndef");
    expect(view.state.facet(EditorView.mouseSelectionStyle).length).toBeGreaterThan(0);
  });
});

describe("indent and comment toggles", () => {
  it("Tab and Shift+Tab indent a selection; Tab without one is left to the page", () => {
    const { view } = setup("select 1\nfrom t");
    select(view, 0, text(view).length);
    expect(press(view, "Tab")).toBe(true);
    expect(text(view)).toBe("  select 1\n  from t");
    press(view, "Tab", { shiftKey: true });
    expect(text(view)).toBe("select 1\nfrom t");
    select(view, 3);
    expect(press(view, "Tab")).toBe(false);
  });

  it("Mod+Alt+/ toggles line comments, Shift+Alt+A a block comment", () => {
    const { view } = setup("select 1\nfrom t");
    select(view, 0, text(view).length);
    press(view, "/", { ctrlKey: true, altKey: true });
    expect(text(view)).toBe("-- select 1\n-- from t");
    press(view, "/", { ctrlKey: true, altKey: true });
    expect(text(view)).toBe("select 1\nfrom t");
    select(view, 0, 8);
    press(view, "A", { altKey: true, shiftKey: true, keyCode: 65 });
    expect(text(view)).toBe("/* select 1 */\nfrom t");
  });
});

describe("each console keeps its own undo history, selection and folds", () => {
  it("switching consoles and back undoes in the console's own history", () => {
    const { ed, view } = setup("select 1;\n");
    select(view, 9);
    type(view, " -- one");
    const first = text(view);
    ed.show("select 2", "sqlite", false, "second");
    expect(text(view)).toBe("select 2");
    select(view, 8);
    type(view, ";");
    ed.show(first, "postgresql", false, "first");
    expect(text(view)).toBe(first);
    expect(view.state.selection.main.head).toBe(16);
    expect(press(view, "z", ctrl)).toBe(true);
    expect(text(view)).toBe("select 1;\n");
    ed.show("select 2;", "sqlite", false, "second");
    press(view, "z", ctrl);
    expect(text(view)).toBe("select 2");
    press(view, "y", ctrl);
    expect(text(view)).toBe("select 2;");
  });

  it("a fold stays with its console", () => {
    const { ed, view } = setup("select a,\n  b\nfrom t;\n");
    select(view, 3);
    foldCode(view);
    expect(foldedRanges(view.state).size).toBe(1);
    ed.show("select 3;", "postgresql", false, "other");
    expect(foldedRanges(view.state).size).toBe(0);
    ed.show("select a,\n  b\nfrom t;\n", "postgresql", false, "first");
    expect(foldedRanges(view.state).size).toBe(1);
  });

  it("text from the model replaces only what differs, and stays undoable", () => {
    const { ed, view, act } = setup("select a from t;");
    ed.show("select a, b from t;", "postgresql", false, "first");
    expect(text(view)).toBe("select a, b from t;");
    expect(act).not.toHaveBeenCalledWith("edited", expect.anything());
    press(view, "z", ctrl);
    expect(text(view)).toBe("select a from t;");
  });
});

describe("the run keys, Escape while running, Ctrl+Space and an IME", () => {
  it("Mod+Enter runs the statement, Mod+Shift+Enter the script, Mod+Shift+F formats", () => {
    const { view, act } = setup("select 1;");
    expect(press(view, "Enter", ctrl)).toBe(true);
    expect(press(view, "Enter", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press(view, "F", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(act.mock.calls.map((c) => c[0])).toEqual(["run", "runAll", "format"]);
    expect(text(view)).toBe("select 1;");
  });

  it("Escape cancels only while a run goes on", () => {
    const { view, act, run } = setup("select 1;");
    expect(press(view, "Escape")).toBe(false);
    run(true);
    expect(press(view, "Escape")).toBe(true);
    expect(act).toHaveBeenCalledWith("cancel");
  });

  it("a key while an IME composes never runs a statement", () => {
    const { view, act } = setup("select 1;");
    press(view, "Enter", { ctrlKey: true, isComposing: true });
    press(view, "Process", { ctrlKey: true, keyCode: 229 });
    expect(act).not.toHaveBeenCalledWith("run");
  });
});

describe("completion asks the controller with the statement around the caret and inserts the choice", () => {
  const orders = (_text: string, caret: number): Completion => ({
    from: caret - 2,
    to: caret,
    items: [{ label: "orders", kind: "table", detail: "public", insert: "orders" }],
    wants: [],
  });

  it("Ctrl+Space asks with the statement at the caret only, and Enter takes the choice", async () => {
    const answer = vi.fn(orders);
    const { view } = setup("select 1;\nselect * from or;\nselect 3;", answer);
    const at = "select 1;\nselect * from or".length;
    select(view, at);
    expect(press(view, " ", ctrl)).toBe(true);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    expect(answer).toHaveBeenCalledWith("\nselect * from or;", "\nselect * from or".length);
    expect(currentCompletions(view.state).map((c: { label: string }) => c.label)).toEqual([
      "orders",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(acceptCompletion(view)).toBe(true);
    expect(text(view)).toBe("select 1;\nselect * from orders;\nselect 3;");
  });

  it("asked for with nothing to offer, it says so", async () => {
    const { view, act } = setup("select 'x", () => ({ from: 9, to: 9, items: [], wants: [] }));
    select(view, 9);
    press(view, " ", ctrl);
    await vi.waitFor(() => expect(act).toHaveBeenCalledWith("say", "Nothing to complete here."));
  });

  it("the list is a labelled listbox the editor points at", async () => {
    const { view, box } = setup("select * from or", orders);
    select(view, 16);
    press(view, " ", ctrl);
    await vi.waitFor(() =>
      expect(box.querySelector('[role="listbox"] [role="option"]')).not.toBeNull(),
    );
    const option = box.querySelector('[role="option"]') as HTMLElement;
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(option.className).toContain("kind-table");
    expect(view.contentDOM.getAttribute("aria-activedescendant")).toBe(option.id);
    expect(view.contentDOM.getAttribute("aria-autocomplete")).toBe("list");
  });
});

describe("the console's textarea handle: an error position selected, a dropped file inserted at the caret, Format replacing a range", () => {
  it("answers value and selection, takes setSelectionRange and setRangeText", () => {
    const { view, editor, act } = setup("select oops from t;");
    expect(editor.hidden).toBe(true);
    expect(editor.value).toBe("select oops from t;");
    editor.setSelectionRange(7, 11);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([7, 11]);
    expect(view.state.selection.main.from).toBe(7);
    editor.setSelectionRange(19, 19);
    editor.setRangeText("\nselect 2;", 19, 19, "end");
    expect(editor.value).toBe("select oops from t;\nselect 2;");
    expect(editor.selectionStart).toBe(29);
    expect(act).toHaveBeenCalledWith("edited", "select oops from t;\nselect 2;");
  });

  it("Format replaces a range, undoably, and tells the controller", () => {
    const { ed, view, act } = setup("select   1");
    ed.replace(0, 10, "SELECT 1");
    expect(text(view)).toBe("SELECT 1");
    expect(act).toHaveBeenCalledWith("edited", "SELECT 1");
    press(view, "z", ctrl);
    expect(text(view)).toBe("select   1");
  });

  it("the editor is a labelled multi-line text box, and focusing it tells the textarea", () => {
    const { view, editor } = setup("");
    expect(view.contentDOM.getAttribute("role")).toBe("textbox");
    expect(view.contentDOM.getAttribute("aria-label")).toBe("SQL");
    expect(view.contentDOM.getAttribute("aria-multiline")).toBe("true");
    const heard = vi.fn();
    editor.addEventListener("focusin", heard);
    view.contentDOM.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(heard).toHaveBeenCalled();
  });

  it("a DDL view is read-only and says so", () => {
    const { ed, view } = setup("");
    ed.show("CREATE TABLE t (a int);", "postgresql", true, "ddl");
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
  });
});

describe("every coloured part of the component takes a --desk-* token", () => {
  const css = readFileSync(join(import.meta.dirname, "../ui/editor/editor.css"), "utf8");
  /** The declarations of every rule whose selector names `part`. */
  const rules = (part: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
      .filter(([, selector]) => selector?.includes(part))
      .map(([, , body]) => body ?? "");

  const parts = [
    ".cm-editor",
    ".cm-content",
    ".cm-cursor",
    ".cm-selectionBackground",
    ".cm-gutters",
  ];
  parts.push(".cm-foldPlaceholder", ".cm-tooltip", "[aria-selected]", ".cm-searchMatch");
  parts.push(".cm-searchMatch-selected", ".cm-selectionMatch", ".cm-matchingBracket");
  parts.push(".cm-nonmatchingBracket", ".cm-panels", ".cm-placeholder", ".find-bar");
  parts.push(".tok-keyword", ".tok-string", ".tok-comment");
  for (const part of parts)
    it(part, () => {
      const found = rules(part);
      expect(found.length, `no rule for ${part}`).toBeGreaterThan(0);
      for (const body of found) {
        const colours =
          body.match(/(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline)\s*:[^;]+/gu) ?? [];
        for (const colour of colours)
          expect(colour).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black)\b/iu);
      }
      expect(found.join("")).toMatch(/var\(--desk-/u);
    });
});
