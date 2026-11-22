import { expect, type Page, test } from "@playwright/test";

// A console's COPY through standard input or output (PG-23) on the browser stub: the fixture's
// connection `fixture-pg` copies its items out to the file the save dialog answers (~/Downloads)
// and in from the one the open dialog answers (plugins/database/tests/copy-fixture.ts). While a write
// waits, the console's bar shows the COPY with Cancel; the console shows the COPY's row count.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 1100, height: 600 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
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
  await expect(frame.locator("#tree [role=treeitem]").nth(1)).toContainText("fixture-pg");
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  return frame;
}

const files = (page: Page) =>
  page.evaluate(() => (window as unknown as { __files: Record<string, string> }).__files);

test("COPY TO STDOUT writes the file the save dialog answers, with the bar while it goes; COPY FROM STDIN reads one in", async ({
  page,
}) => {
  const frame = await open(page);
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  const runs = async (sql: string) => {
    await editor.click();
    await editor.fill(sql);
    await editor.press("ControlOrMeta+Enter");
  };
  // The write waits until the test lets it go, so the bar shows.
  await page.evaluate(() => {
    const hold = window as unknown as { __copyHold?: Promise<void>; __copyGo?: () => void };
    hold.__copyHold = new Promise<void>((resolve) => {
      hold.__copyGo = resolve;
    });
  });
  await runs("copy items to stdout");
  const bar = frame.locator("#copying");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("label", "COPY to items.txt");
  await expect(bar).toHaveAttribute("cancelable", "");
  await page.evaluate(() => (window as unknown as { __copyGo(): void }).__copyGo());
  await expect(bar).toBeHidden();
  await expect(frame.locator("#summary")).toContainText("COPY: 3 rows");
  expect((await files(page))["~/Downloads/items.txt"]?.split("\n")[0]).toBe(
    '1\tok\t{"size": 1}\tt\t{a,b}\t2026-11-21 09:00:00+00',
  );
  await page.evaluate(() => {
    (window as unknown as { __copyHold?: Promise<void> }).__copyHold = undefined;
  });

  await runs("copy items from stdin");
  await expect(frame.locator("#summary")).toContainText("COPY: 3 rows");
  await expect(bar).toBeHidden();
});
