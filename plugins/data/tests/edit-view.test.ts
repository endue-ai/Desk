// @vitest-environment jsdom
// The edit tier on the surface and editing in the tree, on the plugin's page: the view only sets
// attributes on <desk-edit-tier>, opens an input on a scalar row and hands the text to its action.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shown } from "../ui/data.js";
import { createSession } from "../ui/edit/session.js";
import { createView } from "../ui/view.js";
import { bytesOf, loadPage } from "./harness";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
const rows = () => [...document.querySelectorAll<HTMLElement>("#tree [role=treeitem]")];
const rowOf = (key: string) => {
  const row = rows().find((r) => r.querySelector(".key")?.textContent === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
};
const press = (key: string, target: Element = $("#tree")) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const editor = () => document.querySelector<HTMLInputElement>("#tree input.edit");

let view: ReturnType<typeof createView>;
const actions = {
  validateWith: () => {},
  begin: vi.fn(async (_path: number[]) => "desk"),
  edit: vi.fn(async (_path: number[], _text: string) => {}),
};

const show = (name: string, text: string, maskKeys = true) => {
  const bytes = bytesOf(text);
  const session = createSession(name, bytes);
  const model: Shown = {
    buffer: `file:~/data/${name}`,
    path: `~/data/${name}`,
    name,
    size: bytes.length,
    opened: session.opened,
    tier: session.tier,
    why: session.why,
    schema: { state: "none", errors: [] },
    maskKeys,
  };
  view.show(model);
};

beforeEach(() => {
  loadPage();
  actions.begin.mockClear();
  actions.edit.mockClear();
  view = createView(document, actions);
});

describe("the edit tier", () => {
  it.each([
    ["a.json", '{"a": 1}', "lossless", "JSON"],
    ["a.yaml", "a: 1\n", "text", "YAML"],
    ["Cargo.toml", 'a = "x"\n', "text", "TOML"],
    ["feed.xml", "<a>1</a>", "read-only", "XML"],
  ])("%s shows %s with its format", (name, text, tier, format) => {
    show(name, text);
    const label = $("desk-edit-tier#tier");
    expect(label.hidden).toBe(false);
    expect(label.getAttribute("tier")).toBe(tier);
    expect(label.getAttribute("format")).toBe(format);
  });

  it("says why a file is read-only, and hides with no file", () => {
    show("broken.json", '{"a": }');
    expect($("#tier").getAttribute("tier")).toBe("read-only");
    expect($("#tier").getAttribute("detail")).toBe(
      "This file opens for reading: the file does not parse.",
    );
    view.show(null);
    expect($("#tier").hidden).toBe(true);
  });
});

describe("editing in the tree", () => {
  it("Enter on a scalar opens an input with its value; Enter commits with the row's path", async () => {
    show("a.json", '{"name": "desk", "nested": {"n": 1}}');
    rowOf("name").click();
    press("Enter");
    await vi.waitFor(() => expect(editor()).not.toBeNull());
    expect(actions.begin).toHaveBeenCalledWith([0, 0]);
    const input = editor() as HTMLInputElement;
    expect(input.value).toBe("desk");
    expect(input.getAttribute("aria-label")).toBe("New value of name");
    expect(document.activeElement).toBe(input);
    input.value = "Desk";
    expect(press("Enter", input).defaultPrevented).toBe(true);
    expect(actions.edit).toHaveBeenCalledWith([0, 0], "Desk");
    expect(editor()).toBeNull();
  });

  it("F2 opens it too; arrows stay in the input; Escape cancels and keeps the value", async () => {
    show("a.json", '{"name": "desk", "count": 2}');
    rowOf("count").click();
    actions.begin.mockResolvedValueOnce("2");
    press("F2");
    await vi.waitFor(() => expect(editor()).not.toBeNull());
    const input = editor() as HTMLInputElement;
    press("ArrowUp", input);
    expect(rows().find((r) => r.getAttribute("aria-selected") === "true")?.textContent).toContain(
      "count",
    );
    input.value = "3";
    press("Escape", input);
    expect(editor()).toBeNull();
    expect(actions.edit).not.toHaveBeenCalled();
    expect(rowOf("count").textContent).toContain("2");
  });

  it("does not edit containers, masked values or read-only files", async () => {
    show("a.json", '{"nested": {"n": 1}, "password": "fixture-secret"}');
    rowOf("nested").click();
    press("F2");
    rowOf("password").click();
    press("Enter");
    await Promise.resolve();
    expect(actions.begin).not.toHaveBeenCalled();
    expect($("#status").textContent).toBe("Reveal the value of password to edit it.");

    show("feed.xml", "<a><b>1</b></a>");
    rowOf("b").click();
    press("F2");
    await Promise.resolve();
    expect(actions.begin).not.toHaveBeenCalled();
    expect($("#status").textContent).toBe(
      "feed.xml opens read-only: XML files are not edited here.",
    );
  });

  it("a double click on a value opens the editor", async () => {
    show("a.yaml", "name: desk\n");
    const value = rowOf("name").querySelector(".value") as HTMLElement;
    value.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    value.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await vi.waitFor(() => expect(editor()).not.toBeNull());
    expect(actions.begin).toHaveBeenCalledWith([0, 0]);
  });
});
