// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createNoteEditor } from "../ui/editor.js";

const large = "endue text\n".repeat(110_000);

function setup() {
  const field = document.createElement("textarea");
  document.body.replaceChildren(field);
  const view = {
    element: document.createElement("div"),
    focus: vi.fn(),
    destroy: vi.fn(),
    reset: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    scroll: 0,
  };
  const mountLargeEditor = vi.fn(() => view);
  let complete!: (module: typeof import("../ui/large-editor.js")) => void;
  let reject!: (reason: Error) => void;
  const module = new Promise<typeof import("../ui/large-editor.js")>((resolve, fail) => {
    complete = resolve;
    reject = fail;
  });
  const edit = vi.fn();
  const request = vi.fn(() => module);
  const editor = createNoteEditor(field, edit, request);
  return {
    editor,
    field,
    view,
    edit,
    mountLargeEditor,
    request,
    load: () => complete({ mountLargeEditor }),
    reject,
  };
}

it("loads the optional viewport once when the first large note is shown", async () => {
  const { editor, request, load, mountLargeEditor } = setup();
  editor.show(undefined, "");
  editor.show("endue-short", "note");
  expect(request).not.toHaveBeenCalled();
  editor.show("endue-large", large);
  editor.show("endue-next", large + "text");
  expect(request).toHaveBeenCalledOnce();
  load();
  await Promise.resolve();
  expect(mountLargeEditor).toHaveBeenCalledOnce();
});

it("keeps text, focus and selection typed before the viewport loads", async () => {
  const { editor, field, view, edit, mountLargeEditor, load } = setup();
  editor.show("endue-large", large);
  field.focus();
  field.setSelectionRange(6, 10);
  editor.insert("note");
  const typed = field.value;
  expect(edit).toHaveBeenLastCalledWith(typed);
  expect(typed.slice(6, 10)).toBe("note");
  editor.scroll = 120;
  load();
  await Promise.resolve();
  expect(mountLargeEditor).toHaveBeenCalledTimes(1);
  expect(field.value).toBe(typed);
  expect(field.selectionStart).toBe(10);
  expect(view.focus).toHaveBeenCalled();
  expect(view.scroll).toBe(120);
  editor.show("endue-short", "small");
  expect(view.destroy).toHaveBeenCalledOnce();
  expect(editor.element).toBe(field);
});

it.each(["switch", "close"])(
  "a delayed load respects the current document after %s",
  async (action) => {
    const { editor, field, load, mountLargeEditor } = setup();
    editor.show("endue-large", large);
    const current = action === "switch" ? "short note" : "";
    editor.show(action === "switch" ? "endue-short" : undefined, current);
    load();
    await Promise.resolve();
    expect(mountLargeEditor).not.toHaveBeenCalled();
    expect(field.value).toBe(current);
    expect(field.dataset.viewport).toBeUndefined();
  },
);

it("retains the complete editable native note if its optional module cannot load", async () => {
  const { editor, field, edit, reject } = setup();
  editor.show("endue-large", large);
  reject(new Error("Asset unavailable"));
  await Promise.resolve();
  expect(editor.element).toBe(field);
  expect(field.dataset.viewport).toBeUndefined();
  field.setSelectionRange(0, 0);
  editor.insert("endue ");
  expect(edit).toHaveBeenLastCalledWith("endue " + large);
});
