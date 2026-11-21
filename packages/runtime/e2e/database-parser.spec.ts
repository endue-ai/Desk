import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's SQL parser (#445, ADR 0283) in Chromium: the parser ui/main.js provides with the
// SDK's startWorker, in the plugin's sandboxed frame under the app's CSP, its worker fetching the
// vendored wasm as the app's scheme serves it. Nothing on the page calls the parser yet, so the test
// imports the plugin's own client module, the one main.js already loaded, and asks it.
const SURFACE = '[data-surface="endue.database"]';

/** Open the fixture page and endue.database, and resolve with its frame once main.js has mounted. */
async function open(page: Page): Promise<Frame> {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

test("the SQL parser runs in its worker: trees, the server's message and position, a missing name", async ({
  page,
}) => {
  const served = await page.request.get("/plugins/endue.database/ui/index.html");
  expect(served.headers()["content-security-policy"]).toContain("'wasm-unsafe-eval'");
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  const frame = await open(page);
  const wasm = page.waitForResponse((response) => response.url().includes("/libpg-query.wasm"));

  const answer = await frame.evaluate(async () => {
    const url = new URL("./sql/parse/client.js", document.baseURI).href;
    const { sqlParser } = await import(url);
    const parser = sqlParser();
    if (!parser) return { provided: false };
    const script = "select name from people;\nselec 2";
    const parsed = await parser.parse(script);
    const model = {
      schemas: [
        {
          name: "public",
          relations: [
            { name: "people", kind: "table", columns: [{ name: "id" }, { name: "name" }] },
          ],
          routines: [],
        },
      ],
    };
    const resolved = await parser.resolve("select nope, name from people", model);
    const [first, second] = parsed.statements;
    return {
      provided: true,
      whole: parsed.whole,
      kinds: parsed.statements.map((s: { kind: string | null }) => s.kind),
      relation: first?.tree?.SelectStmt?.fromClause?.[0]?.RangeVar?.relname,
      column: first?.tree?.SelectStmt?.targetList?.[0]?.ResTarget?.val?.ColumnRef?.location,
      firstEnd: first?.end,
      error: second?.error,
      trees: resolved.statements.map((s: { tree: unknown }) => s.tree),
      names: resolved.names.map(
        (n: { name: string; target: unknown }) => `${n.name} ${n.target ? "bound" : "unbound"}`,
      ),
      unbound: resolved.unbound.map((n: { name: string; reason: string; start: unknown }) => ({
        name: n.name,
        reason: n.reason,
        start: n.start,
      })),
    };
  });

  const response = await wasm;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/wasm");
  expect(answer).toEqual({
    provided: true,
    whole: false,
    kinds: ["SelectStmt", null],
    relation: "people",
    column: 7,
    firstEnd: { byte: 23, offset: 23, line: 1, column: 24 },
    error: {
      message: 'syntax error at or near "selec"',
      position: { byte: 25, offset: 25, line: 2, column: 1 },
    },
    trees: [null],
    names: ["people bound", "nope unbound", "name bound"],
    unbound: [
      { name: "nope", reason: "missing", start: { byte: 7, offset: 7, line: 1, column: 8 } },
    ],
  });
  expect(problems).toEqual([]);
});
