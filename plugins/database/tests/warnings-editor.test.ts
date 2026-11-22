// @vitest-environment jsdom
// The SQL warnings in the console editor (PG-36, ADR 0328) on jsdom: drawn as warnings beside the
// problems (underline, gutter mark, the identifier under the message), the fix offered as the
// message's action and through Database: fix the SQL warning at the caret, a fix refused once its
// text changed, and the setting that turns them off. The worker's service runs in this thread.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { provideSqlParser } from "../ui/sql/parse/client.js";
import { createService } from "../ui/sql/parse/worker.js";
import {
  EditorSelection,
  EditorView,
  forEachDiagnostic,
} from "../ui/vendor/editor/editor-component.mjs";
import { createEditor } from "../ui/view-editor.js";
import { loadRaw } from "./problems-fixture";
import { WARN_MODEL } from "./warnings-fixture";

type View = InstanceType<typeof EditorView>;
type Diagnostic = {
  message: string;
  severity: string;
  source?: string;
  actions?: Array<{ name: string; apply(view: View, from: number, to: number): void }>;
};

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
      postMessage(message: Parameters<typeof service.answer>[0]) {
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

function setup(text: string, { warnings = true, off = [] as string[] } = {}) {
  document.body.innerHTML = [
    '<div id="editor-box"><pre id="highlight" aria-hidden="true"></pre>',
    '<textarea id="editor" aria-label="SQL"></textarea>',
    '<ul id="complete" role="listbox" hidden></ul></div>',
  ].join("");
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const box = byId("editor-box");
  const context = { syntax: true, names: true, warnings, off };
  const act = vi.fn((action: string, ..._args: unknown[]) =>
    action === "problemsContext"
      ? Promise.resolve({
          doc: "c-1",
          model: WARN_MODEL,
          searchPath: ["$user", "public"],
          user: "",
          ...context,
        })
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
  ed.show(text, "postgresql", false, "c-1");
  const view = EditorView.findFromDOM(box.querySelector(".cm-editor") as HTMLElement) as View;
  /** The command's way in: Database: fix the SQL warning at the caret. */
  const fix = () => (ed.problems as unknown as (what: string) => boolean)("fix");
  return { ed, view, box, act, fix };
}

/** The diagnostics drawn: the text each covers, its severity, source and actions. */
function drawn(view: View) {
  const found: Array<{ text: string; d: Diagnostic; from: number; to: number }> = [];
  forEachDiagnostic(view.state, (d: Diagnostic, from: number, to: number) =>
    found.push({ text: view.state.doc.sliceString(from, to), d, from, to }),
  );
  return found;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("warnings in the console editor", () => {
  it("are drawn as warnings beside the errors, with their identifier and fix", async () => {
    const { view, box } = setup(
      "select emial from people;\nselect * from people where name = null",
    );
    await vi.waitFor(() => expect(drawn(view)).toHaveLength(2));
    const [error, warning] = drawn(view);
    expect([error?.text, error?.d.severity]).toEqual(["emial", "error"]);
    expect(warning).toMatchObject({
      text: "= null",
      d: {
        severity: "warning",
        message: "= NULL is never true, not even when the value is NULL: IS NULL tests for it.",
        source: "warning null-comparison",
      },
    });
    expect(warning?.d.actions?.map((a) => a.name)).toEqual(["Use IS NULL"]);
    expect(box.querySelector(".cm-lintRange-warning")?.textContent).toBe("= null");
    expect(box.querySelector(".cm-gutter-lint .cm-lint-marker-warning")).not.toBeNull();
    expect(box.querySelector(".cm-gutter-lint .cm-lint-marker-error")).not.toBeNull();

    // The message's action rewrites the text; the warning goes after the pause.
    const { d, from, to } = warning as NonNullable<typeof warning>;
    d.actions?.[0]?.apply(view, from, to);
    expect(view.state.doc.toString()).toBe(
      "select emial from people;\nselect * from people where name is null",
    );
    await vi.waitFor(() => expect(drawn(view).map((p) => p.text)).toEqual(["emial"]));
  });

  it("the command fixes the warning at the caret, and says when there is none or it changed", async () => {
    const sql = "insert into people values (1, 'a');\nselect * from people limit 5";
    const { view, act, fix } = setup(sql);
    await vi.waitFor(() => expect(drawn(view)).toHaveLength(2));
    // At a warning without a fix, or away from any: nothing changes, the status line says so.
    view.dispatch({ selection: EditorSelection.cursor(sql.length - 2) });
    expect(fix()).toBe(true);
    expect(act).toHaveBeenLastCalledWith("say", "No fix for a SQL warning at the caret.");
    expect(view.state.doc.toString()).toBe(sql);
    view.dispatch({ selection: EditorSelection.cursor(14) });
    expect(fix()).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "insert into people (id, name) values (1, 'a');\nselect * from people limit 5",
    );
    expect(act).toHaveBeenLastCalledWith("say", "Fixed: List the columns.");

    // A fix whose text changed since the check is refused until the check comes again.
    const other = setup("select * from people where name = null");
    await vi.waitFor(() => expect(drawn(other.view)).toHaveLength(1));
    other.view.dispatch({ changes: { from: 34, to: 38, insert: "nul" } });
    other.view.dispatch({ selection: EditorSelection.cursor(33) });
    expect(other.fix()).toBe(true);
    expect(other.act).toHaveBeenLastCalledWith(
      "say",
      "Not fixed: the statement changed since it was checked. Try again after the pause.",
    );
    expect(other.view.state.doc.toString()).toBe("select * from people where name = nul");
  });

  it("the setting turns them off and leaves the errors", async () => {
    const sql = "select emial from people;\nselect * from people where name = null limit 1";
    const off = setup(sql, { warnings: false });
    await vi.waitFor(() => expect(drawn(off.view).map((p) => p.text)).toEqual(["emial"]));
    await pause(400);
    expect(drawn(off.view).map((p) => p.text)).toEqual(["emial"]);
    const one = setup(sql, { off: ["null-comparison"] });
    await vi.waitFor(() =>
      expect(drawn(one.view).map((p) => p.text)).toEqual(["emial", "limit 1"]),
    );
  });

  it("F8 says a warning as one", async () => {
    const { view, act } = setup("select * from people where name = null");
    await vi.waitFor(() => expect(drawn(view)).toHaveLength(1));
    view.dispatch({ selection: EditorSelection.cursor(0) });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F8", bubbles: true, cancelable: true }),
    );
    expect(act).toHaveBeenLastCalledWith(
      "say",
      "Problem 1 of 1, warning null-comparison: = NULL is never true, not even when the value is NULL: IS NULL tests for it.",
    );
  });
});
