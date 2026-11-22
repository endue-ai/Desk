import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's statement completion (PG-31, ADR 0327) on the browser stub: the fixture's
// PostgreSQL connection `fixture-pg` has a scripted server whose catalog the schema cache reads (the
// shop of plugins/database/tests/pg-catalog.ts, orders.person a foreign key to people.id). After
// JOIN the list offers the table the key links with its ON condition, a function's `(` shows its
// arguments, and a 1 MB script is typed into while the list opens, with a timer chain in the frame
// measuring its longest task.
const SURFACE = '[data-surface="endue.database"]';
/** A frame budget with room for a loaded machine, as the editor's own measure allows. */
const FRAME_MS = 100;

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
  await iframe.evaluate((el) => {
    el.style.cssText += ";width:898px!important;height:558px!important";
  });
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  const row = frame.locator("#tree [role=treeitem]", { hasText: "fixture-pg" });
  await expect(row).toBeVisible();
  // The explorer opens the connection's schema cache; completion reads only what it holds.
  await row.click();
  await page.keyboard.press("ArrowRight");
  await expect(frame.locator("#tree [role=treeitem]", { hasText: "public" })).toBeVisible();
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await editor.focus();
  return { frame, editor };
}

const options = (frame: Frame) => frame.locator(".cm-tooltip-autocomplete [role=option]");
const text = (frame: Frame) =>
  frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value);

test("after JOIN the table a foreign key links comes first, and Enter writes its ON condition", async ({
  page,
}) => {
  const { frame, editor } = await open(page);
  await editor.pressSequentially("select * from people p join or", { delay: 20 });
  await expect(options(frame).first()).toContainText("orders");
  await expect(options(frame).first()).toContainText("on orders.person = p.id");
  await page.screenshot({ path: test.info().outputPath("complete-join.png") });
  await page.keyboard.press("Enter");
  await expect
    .poll(() => text(frame))
    .toBe("select * from people p join orders on orders.person = p.id");

  // A column after the alias, with its type beside it.
  await page.keyboard.type(" where p.na");
  await expect(options(frame).first()).toContainText("name");
  await expect(options(frame).first()).toContainText("text · p");
  await page.keyboard.press("Escape");
});

test("a function's ( shows its arguments, and Escape closes them", async ({ page }) => {
  const { frame, editor } = await open(page);
  await editor.pressSequentially("select upper(", { delay: 20 });
  const help = frame.locator(".signature-help");
  await expect(help).toContainText("upper(text text) → text");
  await expect(help.locator(".signature-arg")).toHaveText("text text");
  await page.screenshot({ path: test.info().outputPath("complete-signature.png") });
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("a 1 MB script takes typing while the list opens", async ({ page }) => {
  const { frame, editor } = await open(page);
  const opened = await frame.evaluate(() => {
    const line =
      "select p.id, p.name from people p join orders o on o.person = p.id where o.id = 42;\n";
    let text = "";
    while (text.length < 1024 * 1024) text += line;
    (document.getElementById("editor") as HTMLTextAreaElement).value = text;
    return text.length;
  });
  await frame.evaluate(() => {
    const timing = { gaps: [] as number[], on: true };
    (window as unknown as { __timing: typeof timing }).__timing = timing;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      timing.gaps.push(now - last);
      last = now;
      if (timing.on) setTimeout(tick, 8);
    };
    setTimeout(tick, 8);
  });
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await editor.pressSequentially("select * from people p where p.na", { delay: 40 });
  await expect(options(frame).first()).toContainText("name", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await editor.pressSequentially(";\nselect * from people p join or", { delay: 40 });
  await expect(options(frame).first()).toContainText("on orders.person = p.id", {
    timeout: 15_000,
  });
  await page.waitForTimeout(500);
  const gaps = await frame.evaluate(() => {
    const timing = (window as unknown as { __timing: { gaps: number[]; on: boolean } }).__timing;
    timing.on = false;
    return timing.gaps;
  });
  const sorted = [...gaps].sort((a, b) => a - b);
  const longest = Math.round(sorted.at(-1) ?? 0);
  const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  const measured = { bytes: opened, ticks: gaps.length, longest, p95 };
  test.info().annotations.push({ type: "1 MB script", description: JSON.stringify(measured) });
  console.log(`database completion, 1 MB script: ${JSON.stringify(measured)}`);
  expect(gaps.length).toBeGreaterThan(50);
  expect(longest, "the frame's longest task while typing and completing").toBeLessThan(FRAME_MS);
});
