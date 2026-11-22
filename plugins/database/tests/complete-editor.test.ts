// @vitest-environment jsdom
// Completion and signature help in the console editor (PG-31, ADR 0327) on jsdom: the controller is
// asked with the statement, the caret in it and where it starts; a candidate with tab stops goes in
// as a snippet that Tab steps through, one with a range replaces it (`*` written out), each pick is
// told; the list opens by itself at INSERT's column list; a candidate's comment is in the info box;
// and a call's overloads show over its `(`, stepped with ArrowUp and ArrowDown, closed by Escape.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  EditorSelection,
  EditorView,
} from "../ui/vendor/editor/editor-component.mjs";
import { createEditor } from "../ui/view-editor.js";

beforeAll(() => {
  const none = () => Object.assign([], { item: () => null });
  Range.prototype.getClientRects = none as never;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

type View = InstanceType<typeof EditorView>;
type Answer = (text: string, caret: number, offset: number, want?: string) => unknown;

function setup(text: string, answer: Answer) {
  document.body.innerHTML = [
    '<div id="editor-box"><pre id="highlight" aria-hidden="true"></pre>',
    '<textarea id="editor" aria-label="SQL"></textarea>',
    '<ul id="complete" role="listbox" hidden></ul></div>',
  ].join("");
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const box = byId("editor-box");
  const act = vi.fn((action: string, ...args: unknown[]) =>
    action === "complete"
      ? answer(args[0] as string, args[1] as number, args[2] as number, args[3] as string)
      : undefined,
  );
  const ed = createEditor(
    document,
    {
      box,
      editor: byId("editor") as HTMLTextAreaElement,
      layer: byId("highlight"),
      list: byId("complete"),
    },
    act,
    () => false,
  );
  ed.show(text, "postgresql", false, "first");
  const view = EditorView.findFromDOM(box.querySelector(".cm-editor") as HTMLElement) as View;
  return { ed, view, box, act };
}

const press = (view: View, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
};
const type = (view: View, text: string) =>
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: "input.type" });
const text = (view: View) => view.state.doc.toString();
const select = (view: View, at: number) => view.dispatch({ selection: EditorSelection.single(at) });
const selected = (view: View) => {
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to);
};
const open = async (view: View) => {
  press(view, " ", { ctrlKey: true });
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
  await new Promise((resolve) => setTimeout(resolve, 100));
};

const item = (over: Record<string, unknown>) => ({
  label: "x",
  kind: "column",
  detail: "",
  insert: "x",
  key: "column:x",
  ...over,
});

describe("completion in the editor", () => {
  it("asks with the statement, the caret and where it starts; a snippet's tab stops take Tab", async () => {
    const answer = vi.fn((_t: string, caret: number) => ({
      from: caret,
      to: caret,
      wants: [],
      place: "none",
      items: [
        item({
          label: "customer_id, total",
          kind: "columns",
          insert: "customer_id, total) values (${customer_id}, ${total})",
          snippet: true,
          key: "columns:the columns without a default",
        }),
      ],
    }));
    const before = "select 1;\ninsert into orders (";
    const { view, act } = setup(before, answer);
    select(view, before.length);
    await open(view);
    expect(answer).toHaveBeenCalledWith("\ninsert into orders (", 21, 9, undefined);
    expect(acceptCompletion(view)).toBe(true);
    expect(text(view)).toBe(
      "select 1;\ninsert into orders (customer_id, total) values (customer_id, total)",
    );
    expect(selected(view)).toBe("customer_id");
    expect(view.state.selection.main.from).toBe(text(view).lastIndexOf("customer_id"));
    press(view, "Tab");
    expect(selected(view)).toBe("total");
    expect(act).toHaveBeenCalledWith("picked", "columns:the columns without a default");
  });

  it("a candidate with a range replaces it, and its comment is in the info box", async () => {
    const { view } = setup("select * from orders", () => ({
      from: 8,
      to: 8,
      wants: [],
      place: "none",
      items: [
        item({
          label: "id, total",
          kind: "expand",
          insert: "id, total",
          range: { from: 7, to: 8 },
          info: "Every column of orders",
          key: "expand:*",
        }),
      ],
    }));
    select(view, 8);
    await open(view);
    expect(currentCompletions(view.state)[0]).toMatchObject({ info: "Every column of orders" });
    acceptCompletion(view);
    expect(text(view)).toBe("select id, total from orders");
  });

  it("opens by itself at INSERT's column list", async () => {
    const answer = vi.fn(() => ({
      from: 0,
      to: 0,
      wants: [],
      place: "none",
      items: [item({ label: "id" })],
    }));
    const { view } = setup("insert into orders ", answer);
    select(view, 19);
    type(view, "(");
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
  });

  it("the editor writes out a `*` on request, and says when there is none", async () => {
    const answer = vi.fn((_t: string, _c: number, _o: number, want?: string) =>
      want === "star"
        ? {
            from: 8,
            to: 8,
            wants: [],
            place: "none",
            items: [item({ kind: "expand", insert: "id", range: { from: 7, to: 8 } })],
          }
        : { from: 0, to: 0, wants: [], place: "none", items: [] },
    );
    const { ed, view } = setup("select * from orders", answer);
    select(view, 8);
    expect(await ed.expandStar()).toBe(true);
    expect(text(view)).toBe("select id from orders");
    answer.mockImplementation(() => ({ from: 0, to: 0, wants: [], place: "none", items: [] }));
    expect(await ed.expandStar()).toBe(false);
  });
});

describe("signature help in the editor", () => {
  const signature = {
    name: "add",
    at: 10,
    arg: 0,
    active: 0,
    overloads: [
      {
        label: "add(a integer, b integer) → integer",
        args: ["a integer", "b integer"],
        result: "integer",
        comment: "",
      },
      {
        label: "add(a numeric, b numeric) → numeric",
        args: ["a numeric", "b numeric"],
        result: "numeric",
        comment: "Adds two numbers",
      },
    ],
  };
  /** The help inside the parentheses of `add(`, at the argument the commas before the caret say. */
  const inside = (t: string, caret: number) => {
    const open = t.indexOf("(");
    return open >= 0 && caret > open && !t.slice(open, caret).includes(")");
  };
  const answer: Answer = (t, caret, _o, want) => ({
    from: caret,
    to: caret,
    items: [],
    wants: [],
    place: "none",
    ...(want === "signature"
      ? {
          signature: inside(t, caret)
            ? { ...signature, arg: (t.slice(0, caret).match(/,/gu) ?? []).length }
            : null,
        }
      : {}),
  });
  const help = (box: HTMLElement) => box.ownerDocument.querySelector(".signature-help");

  it("typing ( after a function shows its overloads with the argument at the caret", async () => {
    const { view, box } = setup("select add", answer);
    select(view, 10);
    type(view, "(");
    await vi.waitFor(() => expect(help(box)).not.toBeNull());
    expect(help(box)?.querySelector(".signature")?.textContent).toBe(
      "add(a integer, b integer) → integer",
    );
    expect(help(box)?.querySelector(".signature-arg")?.textContent).toBe("a integer");
    expect(help(box)?.getAttribute("role")).toBe("status");
    type(view, "1, ");
    await vi.waitFor(() =>
      expect(help(box)?.querySelector(".signature-arg")?.textContent).toBe("b integer"),
    );
    // ArrowDown steps to the next overload, with its comment; Escape closes it.
    expect(press(view, "ArrowDown")).toBe(true);
    await vi.waitFor(() => expect(help(box)?.textContent).toContain("Adds two numbers"));
    expect(help(box)?.querySelector(".signature-count")?.textContent).toMatch(/^2 of 2/u);
    expect(press(view, "Escape")).toBe(true);
    await vi.waitFor(() => expect(help(box)).toBeNull());
    // Closed, typing a word leaves it closed; a `,` shows it again; the `)` that ends the call closes it.
    type(view, "2");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(help(box)).toBeNull();
    type(view, ", ");
    await vi.waitFor(() => expect(help(box)).not.toBeNull());
    type(view, ")");
    await vi.waitFor(() => expect(help(box)).toBeNull());
  });

  it("Ctrl+Shift+Space and the command show it; outside a call they say there is none", async () => {
    const { ed, view, box } = setup("select add(1)", answer);
    select(view, 11);
    press(view, " ", { ctrlKey: true, shiftKey: true });
    await vi.waitFor(() => expect(help(box)).not.toBeNull());
    select(view, 3);
    await vi.waitFor(() => expect(help(box)).toBeNull());
    const outside = setup("select 1", answer);
    select(outside.view, 8);
    expect(await outside.ed.signatures()).toBe(false);
    expect(await ed.signatures()).toBe(false);
  });
});
