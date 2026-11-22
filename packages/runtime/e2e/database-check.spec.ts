import { expect, type Frame, type Page, test } from "@playwright/test";

// What a check of the real app found in endue.database (#564), on the fixture page: the grid's
// sticky header never draws over the value viewer or the pending-changes preview (the fixture's
// PostgreSQL table public.items, plugins/database/tests/fixtures-pg.ts), the connection form's Test
// result shows without scrolling, and Check the clients fits the footer's one line.
const SURFACE = '[data-surface="endue.database"]';
type Size = { width: number; height: number };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1600, height: 1100 } });

const iframe = (page: Page) => page.locator(`${SURFACE} iframe`);

async function open(page: Page, size: Size) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  await expect(iframe(page)).toBeVisible();
  // The surface (its title bar and border) grows with the frame, so nothing clips the frame.
  await iframe(page).evaluate((el, { width, height }) => {
    const surface = el.closest("section") ?? el.parentElement;
    if (!surface) return;
    const [f, s] = [el, surface].map((e) => e.getBoundingClientRect()) as [DOMRect, DOMRect];
    surface.style.cssText += `;flex:none!important;max-width:none!important;max-height:none!important;width:${width + s.width - f.width}px!important;height:${height + s.height - f.height}px!important`;
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, size);
  const frame = await (await iframe(page).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  await expect
    .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([command, args]) => window.__desk.runtime.commands.run(command, args), [
    command,
    args,
  ] as const);

/**
 * What is drawn on top in the middle of where two boxes meet: whether it lies inside `inside`,
 * with the point and what was hit, for the message.
 */
const onTop = (frame: Frame, under: string, over: string, inside: string) =>
  frame.evaluate(
    ([under, over, inside]) => {
      const a = document.querySelector(under)?.getBoundingClientRect();
      const b = document.querySelector(over)?.getBoundingClientRect();
      if (!a || !b) return { met: false, inside: false, hit: "" };
      const box = {
        left: Math.max(a.left, b.left),
        right: Math.min(a.right, b.right),
        top: Math.max(a.top, b.top),
        bottom: Math.min(a.bottom, b.bottom),
      };
      if (box.left >= box.right || box.top >= box.bottom)
        return { met: false, inside: false, hit: "" };
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return {
        met: true,
        inside: Boolean(hit?.closest(inside)),
        hit: hit ? `${hit.tagName}.${hit.className}` : "",
      };
    },
    [under, over, inside] as const,
  );

test("the value viewer and the pending-changes preview draw above the grid's header", async ({
  page,
}) => {
  const frame = await open(page, { width: 1100, height: 700 });
  await run(page, "endue.database.open-table", {
    connection: "fixture-pg",
    schema: "public",
    table: "items",
  });
  await expect(frame.locator("#page")).toHaveText("1–3");
  await expect(frame.locator('[data-act="addRow"]')).toBeVisible();
  const cell = frame.locator("#result [role=gridcell]", { hasText: /^ok$/u });

  await cell.click();
  await frame.locator("#value-open").click();
  await expect(frame.locator("#value")).toBeVisible();
  const value = await onTop(frame, "#result .grid-row.head", "#value", "#value");
  expect(value.met, "the value viewer lies over the grid's header").toBe(true);
  expect(value.inside, `the value viewer is on top, not ${value.hit}`).toBe(true);
  await frame.locator("#value-close").click();
  await expect(frame.locator("#value")).toBeHidden();

  await cell.click();
  await page.keyboard.press("Enter");
  await expect(frame.locator(".cell-editor [role=listbox]")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(frame.locator("#result .cell.changed")).toHaveText(["so so"]);
  await frame.locator('[data-act="previewChanges"]').click();
  await expect(frame.locator("#preview-sql")).toContainText("UPDATE");
  const preview = await onTop(frame, "#result .grid-row.head", "#preview-sql", "#preview-sql");
  expect(preview.met, "the preview's statements lie over the grid's header").toBe(true);
  expect(preview.inside, `the preview's statements are on top, not ${preview.hit}`).toBe(true);
});

for (const size of [
  { width: 1100, height: 700 },
  { width: 900, height: 600 },
]) {
  test(`the connection form's Test result is in view at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    const frame = await open(page, size);
    await frame.locator('[data-act="create"]').click();
    await expect(frame.locator("#f-name")).toBeFocused();
    await frame.locator("#f-host").fill("db.example");
    await frame.locator("#f-user").fill("app");
    await frame.locator("#form-test").click();
    await expect(frame.locator("#form-note")).toContainText("Connected");
    await expect
      .poll(() =>
        frame.evaluate(() => {
          const note = document.getElementById("form-note")?.getBoundingClientRect();
          const form = document.getElementById("form")?.getBoundingClientRect();
          if (!note || !form) return "no note";
          if (note.top < form.top || note.bottom > form.bottom) return "outside the form";
          const hit = document.elementFromPoint(note.left + 8, (note.top + note.bottom) / 2);
          return hit?.closest("#form-note") ? "in view" : `under ${hit?.className ?? "nothing"}`;
        }),
      )
      .toBe("in view");
  });
}

for (const size of [
  { width: 402, height: 305 },
  { width: 900, height: 600 },
]) {
  test(`Check the clients fits the footer's one line at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    const frame = await open(page, size);
    await run(page, "endue.database.clients");
    const status = frame.locator("#status");
    await expect(status).toContainText("sqlite3");
    const seen = await status.evaluate((el: HTMLElement) => ({
      scroll: el.scrollWidth,
      width: el.clientWidth,
      text: el.textContent ?? "",
    }));
    expect(seen.scroll, `"${seen.text}" is cut`).toBeLessThanOrEqual(seen.width);
    expect(seen.text).toMatch(/PostgreSQL.*mysql.*sqlite3/u);
  });
}
