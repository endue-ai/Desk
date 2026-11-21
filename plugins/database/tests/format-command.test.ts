// Format SQL in a console (ADR 0291): a PostgreSQL console's selection, the statement at the caret
// or the whole console laid out in the parse worker by the format settings, which it follows while
// the plugin runs; what it left as written is said. MySQL and SQLite keep the word-by-word format.
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatNote } from "../ui/console-run.js";
import { PREVIEW, SAMPLE } from "../ui/features/format/index.js";
import { provideSqlParser } from "../ui/sql/parse/client.js";
import { mount, SAVED } from "./harness";

/** startWorker for Node: the module in a worker thread, behind a page Worker's surface. */
function threadWorker(url: URL) {
  const thread = new Worker(new URL("./parse-worker-thread.mjs", import.meta.url), {
    workerData: { url: url.href },
  });
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { message: string }) => void) | null,
    postMessage: (message: unknown) => thread.postMessage(message),
    terminate: () => void thread.terminate(),
  };
  thread.on("message", (data) => worker.onmessage?.({ data }));
  thread.on("error", (error: Error) => worker.onerror?.({ message: error.message }));
  return worker as unknown as globalThis.Worker;
}

let parser: ReturnType<typeof provideSqlParser>;
beforeAll(() => {
  parser = provideSqlParser(threadWorker);
});
afterAll(() => parser.close());

const SCRIPT = "select 1;\nselect a,b from t where x=1;\nselect   3";

async function shop(settings: Record<string, unknown> = {}) {
  const m = await mount({ store: { connections: SAVED }, settings });
  await m.host.command("endue.database.console", { connection: "Shop" });
  m.view.text = SCRIPT;
  return m;
}

const setting = async (m: Awaited<ReturnType<typeof mount>>, key: string, value: unknown) => {
  await m.host.call("settings.set", { key, value }, "endue.database");
  await m.settle();
};

describe("Format SQL in a console", () => {
  it("formats a PostgreSQL console: the selection, the statement at the caret and the whole console", async () => {
    const m = await shop();
    // The statement at the caret, and nothing else.
    m.view.caret = 15;
    expect(await m.host.command("endue.database.format-statement")).toBe("Formatted.");
    expect(m.view.text).toBe("select 1;\nSELECT a, b\nFROM t\nWHERE x = 1;\nselect   3");
    // The selection: what is selected is laid out as a script of its own.
    m.view.text = SCRIPT;
    m.view.caret = 0;
    m.view.selectionEnd = 8;
    expect(await m.host.command("endue.database.format-statement")).toBe("Formatted.");
    expect(m.view.text).toBe(`SELECT 1${SCRIPT.slice(8)}`);
    // The whole console, a statement a line apart; Mod+Shift+F says what it did.
    m.view.text = SCRIPT;
    m.view.selectionEnd = -1;
    expect(await m.host.command("endue.database.format")).toBe("Formatted.");
    expect(m.view.text).toBe("SELECT 1;\n\nSELECT a, b\nFROM t\nWHERE x = 1;\n\nSELECT 3");
    m.view.text = "select 1;\nselec oops";
    await m.app.format();
    expect(m.view.said.at(-1)).toBe(
      'Formatted; a statement that does not parse is left as written (line 2: syntax error at or near "selec").',
    );
    expect(m.view.text).toBe("SELECT 1;\nselec oops");
    // MySQL and SQLite keep today's format, the statement at the caret too.
    await m.host.command("endue.database.console", { connection: "Notes" });
    m.view.text = "select 1;\nselect n from numbers where n > 1";
    m.view.caret = 12;
    expect(await m.host.command("endue.database.format-statement")).toBe("Formatted.");
    expect(m.view.text).toBe("select 1;\nSELECT n\nFROM numbers\nWHERE n > 1");
  });

  it("follows the format settings while the plugin runs, and the preview shows them", async () => {
    const m = await shop({ "format-keyword-case": "lower" });
    expect(await m.host.command("endue.database.format")).toBe("Formatted.");
    expect(m.view.text).toBe("select 1;\n\nselect a, b\nfrom t\nwhere x = 1;\n\nselect 3");
    await setting(m, "format-keyword-case", "upper");
    await setting(m, "format-one-line", "item");
    await setting(m, "format-indent", 2);
    m.view.text = SCRIPT;
    await m.host.command("endue.database.format");
    expect(m.view.text).toBe("SELECT 1;\n\nSELECT\n  a,\n  b\nFROM t\nWHERE x = 1;\n\nSELECT 3");
    // The preview lays its sample out by the settings in force, and again when one changes.
    const text = await m.host.command("endue.database.format-preview");
    expect(m.shown()).toMatchObject({ kind: "format", name: PREVIEW, format: { text } });
    expect(text).toBe((await parser.layout(SAMPLE, m.shown()?.format.style)).text);
    expect(text).toContain("SELECT\n  p.id,\n  p.name,");
    await setting(m, "format-keyword-case", "lower");
    await expect.poll(() => m.shown()?.format.text).toContain("select\n  p.id,\n  p.name,");
    expect(m.shown()?.format.style).toMatchObject({
      keywordCase: "lower",
      oneLine: "item",
      indent: 2,
    });
    await m.host.command("endue.database.console", { connection: "Shop" });
    await setting(m, "format-keyword-case", "upper");
    // A value that is not one of the choices keeps the default.
    await setting(m, "format-comma", "middle");
    await setting(m, "format-comma", "first");
    m.view.text = SCRIPT;
    await m.host.command("endue.database.format");
    expect(m.view.text).toContain("SELECT\n  a\n  , b\n");
  });

  it("says each statement it left as written", () => {
    const laid = { from: 0, to: 0, text: "", laid: 0, left: [], kept: 0, refused: 0 };
    expect(formatNote(laid)).toBe("Nothing to format.");
    expect(formatNote({ ...laid, laid: 1 })).toBe("Formatted.");
    const left = [
      { line: 3, column: 1, message: "syntax error at end of input" },
      { line: 9, column: 2, message: 'syntax error at or near ")"' },
    ];
    expect(formatNote({ ...laid, left, kept: 2, refused: 1 })).toBe(
      "Nothing formatted; 2 statements that do not parse are left as written (line 3: syntax error at end of input); 2 BEGIN ATOMIC bodies are left as written; a statement is left as written: laid out, it would not read the same.",
    );
  });
});
