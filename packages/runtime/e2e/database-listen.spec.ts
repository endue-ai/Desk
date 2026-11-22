import { expect, type Page, test } from "@playwright/test";

// A console that listens (PG-25, ADR 0358), on the browser stub's fixture connection `fixture-pg`:
// the first console LISTENs, a second one NOTIFYs; the first's Notifications tab shows the row
// (when, channel, payload, the sender's pid) with a badge of the unseen ones, which goes once the
// tab is on screen; the tab's note names the channel, and Clear empties it.
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
  return frame;
}

const command = (page: Page, id: string, args: Record<string, unknown>) =>
  page.evaluate(([id, args]) => window.__desk.runtime.commands.run(id, args), [id, args] as const);

test("a NOTIFY from another console shows on the listening console's Notifications tab, with a badge, and Clear empties it", async ({
  page,
}) => {
  const frame = await open(page);
  const first = await command(page, "endue.database.console", { connection: "fixture-pg" });
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  const runs = async (sql: string) => {
    await editor.click();
    await editor.fill(sql);
    await editor.press("ControlOrMeta+Enter");
    await expect(frame.locator("#summary")).toContainText(/Done/u);
  };
  await runs("LISTEN jobs");
  const tab = frame.locator("#tabs [role=tab].tab-notifications");
  await expect(tab).toHaveText("Notifications");

  await command(page, "endue.database.new-console", { connection: "fixture-pg" });
  await runs("NOTIFY jobs, 'order 7 paid'");
  await command(page, "endue.database.consoles", { console: first });
  await expect(tab).toHaveText("Notifications · 1 new");
  await page.screenshot({ path: test.info().outputPath("listen-badge.png") });

  await tab.click();
  await expect(tab).toHaveText("Notifications");
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const grid = frame.locator("#result");
  await expect(grid).toContainText("order 7 paid");
  await expect(grid).toContainText("jobs");
  await expect(frame.locator("#edit-note")).toHaveText("Listening on jobs.");
  await expect(frame.locator("#notifications-bar")).toBeVisible();
  await expect(frame.locator("#listen-again")).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("listen-tab.png") });

  await frame.locator("#notifications-bar button", { hasText: "Clear" }).click();
  await expect(frame.locator("#status")).toContainText("Notifications cleared.");
  await expect(grid).not.toContainText("order 7 paid");
});
