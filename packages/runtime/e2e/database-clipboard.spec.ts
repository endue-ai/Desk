import { expect, type Frame, type Page, test } from "@playwright/test";

// Copying from endue.database (#504) on the browser stub, with a desk command standing in for the
// palette (it records each question and gives the next answer) and the frame's Clipboard API
// recording what is written. A copy past 100,000 cells asks first, and on No copies nothing: the
// fixture's `select * from many` has 500 rows of 240 columns. Copy as TSV writes one item with
// the text and an HTML table of the same cells, Copy as CSV the text only, and the grid's Mod+C puts
// both types on the copy event.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

type Written = { types: Record<string, string> } | { text: string };

declare global {
  interface Window {
    __answers: string[];
    __asked: string[];
    __written: Written[];
  }
}

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() => {
    window.__answers = [];
    window.__asked = [];
    window.__desk.runtime.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        window.__asked.push(String((args as { title?: string }).title));
        return window.__answers.shift() ?? "";
      },
    });
  });
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, LARGE);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  // What the plugin writes, by type; the sandboxed frame's own clipboard would refuse it.
  await frame.evaluate(() => {
    window.__written = [];
    const write = async (items: ClipboardItem[]) => {
      for (const item of items) {
        const types: Record<string, string> = {};
        for (const type of item.types) types[type] = await (await item.getType(type)).text();
        window.__written.push({ types });
      }
    };
    const writeText = async (text: string) => void window.__written.push({ text });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write, writeText },
    });
  });
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown>) =>
  page.evaluate(([command, args]) => window.__desk.runtime.commands.run(command, args), [
    command,
    args,
  ] as const);

/** A console on the fixture connection with `sql` run. */
async function query(page: Page, frame: Frame, sql: string) {
  await run(page, "endue.database.console", { connection: "fixture" });
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await editor.click();
  await editor.fill(sql);
  await editor.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
}

const answer = (page: Page, ...answers: string[]) =>
  page.evaluate((given) => void window.__answers.push(...given), answers);
const asked = (page: Page) => page.evaluate(() => window.__asked);
const written = (frame: Frame) => frame.evaluate(() => window.__written);

test("a copy past 100,000 cells asks first: No copies nothing, Yes copies", async ({ page }) => {
  const frame = await open(page);
  await query(page, frame, "select * from many;");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("1");
  const status = frame.locator("#status");

  await answer(page, "csv", "no");
  await run(page, "endue.database.copy", {});
  await expect(status).toHaveText("Nothing copied.");
  expect(await asked(page)).toEqual([
    "Database: copy the result as",
    "Copy 120,000 cells to the clipboard?",
  ]);
  expect(await written(frame)).toEqual([]);

  await answer(page, "yes");
  await run(page, "endue.database.copy", { format: "csv" });
  await expect(status).toHaveText("Copied as CSV.");
  const [copied] = await written(frame);
  const text = copied && "text" in copied ? copied.text : "";
  const lines = text.split("\r\n");
  expect(lines).toHaveLength(501);
  expect(lines[1]).toBe(["1", ...Array(239).fill("0")].join(","));
});

test("Copy as TSV writes the text and an HTML table, Copy as CSV the text only", async ({
  page,
}) => {
  const frame = await open(page);
  await query(page, frame, "select * from people;");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("1");
  const status = frame.locator("#status");

  await run(page, "endue.database.copy", { format: "tsv" });
  await expect(status).toHaveText("Copied as TSV.");
  await run(page, "endue.database.copy", { format: "csv" });
  await expect(status).toHaveText("Copied as CSV.");
  const cells = [
    ["1", "Ada", "first"],
    ["2", "Bob", "second"],
    ["3", "Cy", "third"],
    ["4", "Dee", "fourth"],
  ];
  const table = cells.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`);
  expect(await written(frame)).toEqual([
    {
      types: {
        "text/plain": cells.map((row) => row.join("\t")).join("\n"),
        "text/html": `<table>${table.join("")}</table>`,
      },
    },
    { text: `id,name,note\r\n${cells.map((row) => row.join(",")).join("\r\n")}` },
  ]);
  expect(await asked(page)).toEqual([]);

  // The grid's Mod+C: a block of two cells, both types on the copy event.
  await frame.locator("#result [role=gridcell]", { hasText: /^Ada$/u }).click();
  await frame.locator("#result [role=grid]").press("Shift+ArrowRight");
  const data = await frame.evaluate(() => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      text: clipboardData.getData("text/plain"),
      html: clipboardData.getData("text/html"),
    };
  });
  expect(data).toEqual({
    prevented: true,
    text: "Ada\tfirst",
    html: "<table><tr><td>Ada</td><td>first</td></tr></table>",
  });
});
