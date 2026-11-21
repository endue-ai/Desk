// Format SQL never changes what a statement says (ADR 0292), over the parser's corpus and the SQL
// the plugin writes itself, in several styles: with whitespace taken out the text is the same (the
// same with keywords case-folded when the style changes their case), the scanner reads the same
// tokens but for the case of keywords, every statement parses to the same tree, nothing is refused,
// and a second Format changes nothing. The layout runs in the parse worker.
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLayout, shapeOf } from "../ui/sql/layout/layout.js";
import { STYLE } from "../ui/sql/layout/style.js";
import { createSqlParser } from "../ui/sql/parse/client.js";
import { loadLibpgQuery, type RawParser } from "../ui/sql/parse/wasm.js";
import { STATEMENTS } from "./pg-corpus";
import { FIXTURES } from "./pg-generated";
import { WASM } from "./pg-parser";

const STYLES = [
  { keywordCase: "preserve" },
  {},
  { oneLine: "statement", lineWidth: 240 },
  { oneLine: "item", comma: "first", andOr: "after" },
  {
    lists: "align",
    comma: "first",
    joins: "indented",
    keywordCase: "lower",
    indent: 2,
    lineWidth: 40,
  },
];

/** Every script: each corpus statement on its own, then the corpus's scripts and the plugin's SQL. */
const SCRIPTS: Array<[string, string]> = [
  ...STATEMENTS.map(([name, sql]): [string, string] => [name, sql]),
  ...FIXTURES,
];

let raw: RawParser;
let layout: ReturnType<typeof createLayout>;
beforeAll(async () => {
  raw = await loadLibpgQuery(readFileSync(WASM));
  layout = createLayout(raw);
});

const stripped = (text: string) => text.replace(/\s+/gu, "");

/** The scanner's tokens, keywords in upper case, comments as they are. */
function tokens(text: string) {
  const scanned = raw.scan(text);
  if ("error" in scanned) throw new Error(scanned.error);
  return scanned.tokens.map((t) => (t.keywordKind > 0 ? t.text.toUpperCase() : t.text));
}

/** Each statement's tree, places left out. */
function trees(text: string) {
  const parsed = raw.parse(text);
  if (!("tree" in parsed)) return [parsed.error.message];
  return (parsed.tree.stmts ?? []).map((s) => shapeOf(s.stmt));
}

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

describe("Format SQL over the corpus", () => {
  it("never changes the meaning over the corpus", () => {
    let statements = 0;
    for (const style of STYLES)
      for (const [name, sql] of SCRIPTS) {
        const once = layout(sql, style);
        const what = [name, JSON.stringify(style)];
        expect([...what, once.refused, once.left]).toEqual([...what, 0, []]);
        if (style.keywordCase === "preserve")
          expect([...what, stripped(once.text)]).toEqual([...what, stripped(sql)]);
        expect([...what, tokens(once.text)]).toEqual([...what, tokens(sql)]);
        expect([...what, trees(once.text)]).toEqual([...what, trees(sql)]);
        expect([...what, layout(once.text, style).text]).toEqual([...what, once.text]);
        statements += once.laid + once.kept;
      }
    expect(statements).toBeGreaterThan(STYLES.length * (STATEMENTS.length + 50));
  });

  describe("in the parse worker", () => {
    const parser = createSqlParser(threadWorker);
    afterAll(() => parser.close());

    it("the layout runs in the parse worker", async () => {
      const sql = "select a,b from t where x=1;\nselect 2";
      const laid = await parser.layout(sql, { ...STYLE, keywordCase: "lower" }, {});
      expect(laid).toEqual(layout(sql, { keywordCase: "lower" }));
      expect(laid.text).toBe("select a, b\nfrom t\nwhere x = 1;\n\nselect 2");
      expect(await parser.layout(sql, STYLE, { at: sql.length })).toMatchObject({
        from: 29,
        to: 37,
        text: "SELECT 2",
      });
    });
  });
});
