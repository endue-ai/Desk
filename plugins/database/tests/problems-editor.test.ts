// @vitest-environment jsdom
// The SQL problems in the console editor (PG-30, ADR 0294) on jsdom: the component's own lint
// extension underlines what the parse worker's check found a pause after typing stops, marks the
// gutter, never draws while an IME composes, steps through the problems with F8 and Shift+F8 saying
// each, lists them with Mod+. as a listbox a screen reader reads, and asks nothing for MySQL, SQLite
// or a read-only DDL view. The worker's service runs in this thread.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { provideSqlParser } from "../ui/sql/parse/client.js";
import { createService } from "../ui/sql/parse/worker.js";
import {
  EditorSelection,
  EditorView,
  forEachDiagnostic,
} from "../ui/vendor/editor/editor-component.mjs";
import { createEditor } from "../ui/view-editor.js";
import { loadRaw, PROBLEM_MODEL } from "./problems-fixture";

type View = InstanceType<typeof EditorView>;
type Request = Parameters<ReturnType<typeof createService>["answer"]>[0];
const posted: Request[] = [];

beforeAll(async () => {
  const none = () => Object.assign([], { item: () => null });
  Range.prototype.getClientRects = none as never;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const raw = await loadRaw();
  provideSqlParser(() => {
    const service = createService(raw);
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(message: Request) {
        posted.push(message);
        const sent = structuredClone(message);
        setTimeout(() => {
          const reply = service.answer(sent);
          if (reply) worker.onmessage?.({ data: structuredClone(reply) });
        });
      },
      terminate: () => {},
    };
    return worker as unknown as Worker;
  });
});

function setup(
  text: string,
  { dialect = "postgresql", readOnly = false, syntax = true, names = true } = {},
) {
  document.body.innerHTML = [
    '<div id="editor-box"><pre id="highlight" aria-hidden="true"></pre>',
    '<textarea id="editor" aria-label="SQL"></textarea>',
    '<ul id="complete" role="listbox" hidden></ul></div>',
  ].join("");
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const box = byId("editor-box");
  const context = { syntax, names };
  const act = vi.fn((action: string, ..._args: unknown[]) =>
    action === "problemsContext"
      ? Promise.resolve(
          dialect === "postgresql"
            ? {
                doc: "c-1",
                model: PROBLEM_MODEL,
                searchPath: ["$user", "public"],
                user: "",
                ...context,
              }
            : undefined,
        )
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
  ed.show(text, dialect as never, readOnly, "c-1");
  const view = EditorView.findFromDOM(box.querySelector(".cm-editor") as HTMLElement) as View;
  return { ed, view, box, act, context };
}

/** The problems drawn: the text each underlines and its message. */
function drawn(view: View) {
  const found: Array<[string, string]> = [];
  forEachDiagnostic(view.state, (d: { message: string }, from: number, to: number) =>
    found.push([view.state.doc.sliceString(from, to), d.message]),
  );
  return found;
}
const type = (view: View, text: string) =>
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: "input.type" });
const press = (view: View, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("problems in the console editor", () => {
  it("problems are drawn after a pause and never while composing", async () => {
    const { view, box } = setup("select * from people;\n");
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    type(view, "select emial from peple");
    await pause(150);
    expect(drawn(view)).toEqual([]);
    await vi.waitFor(() =>
      expect(drawn(view)).toEqual([
        [
          "peple",
          'relation "peple" does not exist (search path: "$user", public)\nPerhaps you meant "people".',
        ],
      ]),
    );
    const underline = box.querySelector(".cm-lintRange-error");
    expect(underline?.textContent).toBe("peple");
    expect(box.querySelector(".cm-gutter-lint .cm-lint-marker-error")).not.toBeNull();

    // Fixed, the underline goes after the pause.
    view.dispatch({ changes: { from: view.state.doc.length - 3, insert: "o" } });
    await vi.waitFor(() => expect(drawn(view).map(([text]) => text)).toEqual(["emial"]));

    // While an IME composes nothing new is drawn; once it ends, the problems come.
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    type(view, ";\nselec");
    await pause(700);
    expect(drawn(view).map(([text]) => text)).toEqual(["emial"]);
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    type(view, " ");
    await vi.waitFor(() => expect(drawn(view).map(([text]) => text)).toEqual(["emial", "selec"]));
  });

  it("the settings turn each kind off, and another engine or a DDL view never asks", async () => {
    const off = setup("selec 1;\nselect * from peple", { syntax: false });
    await vi.waitFor(() => expect(drawn(off.view).map(([text]) => text)).toEqual(["peple"]));
    const none = setup("selec 1;\nselect * from peple", { names: false });
    await vi.waitFor(() => expect(drawn(none.view).map(([text]) => text)).toEqual(["selec"]));

    const sent = posted.length;
    for (const dialect of ["mysql", "sqlite"]) {
      const other = setup("selec 1", { dialect });
      await pause(500);
      expect(drawn(other.view)).toEqual([]);
    }
    const ddl = setup("selec 1", { readOnly: true });
    await pause(500);
    expect(drawn(ddl.view)).toEqual([]);
    expect(ddl.act).not.toHaveBeenCalledWith("problemsContext");
    expect(posted.slice(sent).filter((p) => p.type === "check")).toEqual([]);
  });

  it("F8 and Shift+F8 step through the problems and say each one; Mod+. lists them", async () => {
    const sql = "select emial from people;\nselect 1;\nselect * from peple";
    const { view, act, box, ed } = setup(sql);
    await vi.waitFor(() => expect(drawn(view)).toHaveLength(2));
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(press(view, "F8")).toBe(true);
    const at = () =>
      view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to);
    expect(at()).toBe("emial");
    expect(act).toHaveBeenLastCalledWith(
      "say",
      'Problem 1 of 2: column "emial" does not exist. Perhaps you meant to reference the column "people.email".',
    );
    expect(press(view, "F8")).toBe(true);
    expect(at()).toBe("peple");
    expect(act.mock.lastCall?.[1]).toMatch(/^Problem 2 of 2: relation "peple" does not exist/);
    expect(press(view, "F8", { shiftKey: true })).toBe(true);
    expect(at()).toBe("emial");

    expect(press(view, ".", { ctrlKey: true })).toBe(true);
    const list = box.querySelector(".cm-panel-lint [role=listbox]") as HTMLElement;
    expect(list.getAttribute("aria-label")).toBe("Problems");
    expect(document.activeElement).toBe(list);
    const options = [...list.querySelectorAll("[role=option]")].map((o) => o.textContent);
    expect(options).toHaveLength(2);
    expect(options[0]).toContain('column "emial" does not exist');
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    expect(box.querySelector(".cm-panel-lint")).toBeNull();

    // The commands reach the same through the view.
    expect(ed.problems("next")).toBe(true);
    expect(ed.problems("list")).toBe(true);
    expect(box.querySelector(".cm-panel-lint")).not.toBeNull();

    // Nothing to step to says so.
    const clean = setup("select 1");
    await pause(500);
    expect(press(clean.view, "F8")).toBe(true);
    expect(clean.act).toHaveBeenLastCalledWith("say", "No problems in this script.");
  });

  it("a recheck or a run's answer draws again without typing", async () => {
    const { view, ed } = setup("select * from ghost;\nselect * from peple");
    await vi.waitFor(() => expect(drawn(view).map(([text]) => text)).toEqual(["ghost", "peple"]));
    ed.ran({
      at: 1,
      statements: [{ text: "select * from ghost" }],
      result: { statements: [{ index: 0, ran: true, sets: [] }] },
    } as never);
    await vi.waitFor(() => expect(drawn(view).map(([text]) => text)).toEqual(["peple"]));
  });
});
