import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's SQL problems (PG-30, ADR 0294) on the browser stub: the fixture's PostgreSQL
// connection `fixture-pg` has a scripted server whose catalog the schema cache reads (public.people,
// orders and others: the shop of plugins/database/tests/pg-catalog.ts). Typing a statement that
// names nothing there underlines it a pause after typing stops, with its message on hover, in the
// list Mod+. opens and on the status line F8 writes; fixing it clears the underline. Then a 1 MB
// script is typed into while its problems are checked, and a timer chain in the frame measures its
// longest task.
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
  // The explorer opens the connection's schema cache; typing alone never does.
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

const underlines = (frame: Frame) => frame.locator(".cm-content .cm-lintRange-error");

test("an underline appears while typing on the fixture's PostgreSQL connection and clears when the statement is fixed, with its message", async ({
  page,
}) => {
  const { frame, editor } = await open(page);
  await editor.pressSequentially("select nmae from peple", { delay: 20 });
  await expect(underlines(frame)).toHaveText(["peple"]);
  await expect(frame.locator(".cm-gutter-lint .cm-lint-marker-error")).toHaveCount(1);

  // The message on hover, as the server words it with the search path the check used.
  await underlines(frame).first().hover();
  const tooltip = frame.locator(".cm-tooltip-lint");
  await expect(tooltip).toContainText(
    'relation "peple" does not exist (search path: "$user", public)',
  );
  await expect(tooltip).toContainText('Perhaps you meant "people".');
  await page.screenshot({ path: test.info().outputPath("problems-underline.png") });

  // Fixed, the table's column is the problem; fixed again, nothing is underlined.
  for (let i = 0; i < "peple".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("people");
  await expect(underlines(frame)).toHaveText(["nmae"]);
  await editor.focus();
  await page.keyboard.press("F8");
  await expect(frame.locator("#status")).toContainText(
    'Problem 1 of 1: column "nmae" does not exist. Perhaps you meant to reference the column "people.name".',
  );
  await page.keyboard.press("ControlOrMeta+.");
  const list = frame.getByRole("listbox", { name: "Problems" });
  await expect(list).toBeFocused();
  await expect(list.getByRole("option")).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("problems-list.png") });
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  for (let i = 0; i < " from people".length; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "mae".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("ame");
  await expect(underlines(frame)).toHaveCount(0);

  // A syntax error has the parser's message.
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(";\nselec");
  await expect(underlines(frame)).toHaveText(["selec"]);
  await page.keyboard.type("t 1");
  await expect(underlines(frame)).toHaveCount(0);
});

test("a 1 MB script takes typing while its problems are checked", async ({ page }) => {
  const { frame, editor } = await open(page);
  const opened = await frame.evaluate(() => {
    const line =
      "select id, name, joined from people where id = 42 and name is not null; -- a note\n";
    let text = "";
    while (text.length < 1024 * 1024) text += line;
    (document.getElementById("editor") as HTMLTextAreaElement).value =
      `${text}select * from peple;\n`;
    return text.length;
  });
  await expect(underlines(frame)).toHaveCount(1, { timeout: 15_000 });
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
  await editor.pressSequentially("select nmae from people;", { delay: 40 });
  await expect(underlines(frame)).toHaveCount(2, { timeout: 15_000 });
  await frame.evaluate(() =>
    (document.getElementById("editor") as HTMLTextAreaElement).setSelectionRange(500_000, 500_000),
  );
  await editor.pressSequentially(" x", { delay: 40 });
  await page.waitForTimeout(1000);
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
  console.log(`database problems, 1 MB script: ${JSON.stringify(measured)}`);
  expect(gaps.length).toBeGreaterThan(50);
  expect(longest, "the frame's longest task while typing and checking").toBeLessThan(FRAME_MS);
});
