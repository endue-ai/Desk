import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.database's Map tab (PG-46, ADR 0325) on the browser stub: the PostgreSQL connection
// "fixture-pg" whose scripted server answers a table of parcels and one of twenty thousand squares
// as geometry values (plugins/database/tests/geo-fixture.ts). The parcels drawn on the plugin's own
// canvas in their coordinates with a scale, a curve read back by the viewer's own statement, a shape
// picked by the pointer and the keyboard and shown in the grid, the grid's rows shown on the map;
// then twenty thousand shapes zoomed and panned while a timer chain in the frame measures its
// longest task. No tiles, no network: the map draws in the plugin's worker.
const SURFACE = '[data-surface="endue.database"]';
const SIZE = { width: 898, height: 558 };
/** A frame budget with room for a loaded machine, as the editor's and the grid's measures allow. */
const FRAME_MS = 100;
const PARCELS = "select id, name, geom from parcels";
const MANY = "select id, geom from parcels_many";

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
  }, SIZE);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([command, args]) => window.__desk.runtime.commands.run(command, args), [
    command,
    args,
  ] as const);

/** A console on fixture-pg that ran `text`. */
async function query(page: Page, frame: Frame, text: string) {
  await run(page, "endue.database.console", { connection: "fixture-pg" });
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await editor.click();
  await editor.fill(text);
  await editor.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
}

const tabs = (frame: Frame) =>
  frame.locator("#tabs [role=tab]").evaluateAll((all) => all.map((t) => t.textContent?.trim()));
const box = (frame: Frame) => frame.locator(".geo-box");
const canvas = (frame: Frame) => frame.locator(".geo-box .geo-canvas");
const said = (frame: Frame) => frame.locator(".geo-said");

/** How the canvas is painted: its pixels unlike its commonest colour, and how many colours. */
const painted = (frame: Frame) =>
  frame.evaluate(() => {
    const c = document.querySelector(".geo-box .geo-canvas") as HTMLCanvasElement;
    const data = (c.getContext("2d") as CanvasRenderingContext2D).getImageData(
      0,
      0,
      c.width,
      c.height,
    ).data;
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const most = Math.max(...counts.values());
    return { inked: (data.length / 4 - most) / (data.length / 4), colours: counts.size };
  });

test("a geometry result's Map tab draws the fixture and links to the grid", async ({ page }) => {
  const frame = await open(page);
  await query(page, frame, PARCELS);
  expect(await tabs(frame)).toEqual(["Result", "Map", "Messages"]);
  await frame.locator("#tabs [role=tab]", { hasText: "Map" }).click();
  // Five shapes: the curve read back as a line by the viewer's own statement; the NULL has none.
  await expect(box(frame)).toHaveAttribute("data-shapes", "5");
  await expect(canvas(frame)).toHaveAttribute(
    "aria-label",
    "Map of geom: 2 Polygon, 2 LineString, 1 Point, SRID 4326",
  );
  // The grid's cursor was on the first row: the map opens with it picked; Escape lets it go.
  await expect(said(frame)).toHaveText("Row 1 · id 1 · name harbour · Polygon · 5 vertices");
  await canvas(frame).press("Escape");
  await expect(said(frame)).toHaveText("5 shapes, SRID 4326");
  await expect(frame.locator(".geo-scale-text")).toHaveText(/^\d+ (m|km)$/u);
  await expect(frame.locator(".geo-note")).toBeHidden();
  await expect.poll(async () => (await painted(frame)).inked).toBeGreaterThan(0.05);
  expect((await painted(frame)).colours).toBeGreaterThan(4);

  // The harbour holds the middle of them all: a click there picks it.
  const at = await canvas(frame).boundingBox();
  if (!at) throw new Error("no canvas box");
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  await expect(said(frame)).toHaveText("Row 1 · id 1 · name harbour · Polygon · 5 vertices");
  await expect(frame.locator(".geo-at")).toHaveText(/^x 12[67]\.\d+ · y 37\.5\d+$/u);
  // N picks the next shape (the NULL row has none), Enter shows it in the grid.
  await canvas(frame).press("n");
  await canvas(frame).press("n");
  await canvas(frame).press("n");
  await expect(said(frame)).toHaveText("Row 4 · id 4 · name well · Point · 1 vertex");
  await canvas(frame).press("Enter");
  await expect(frame.locator("#tabs [role=tab][aria-selected=true]")).toHaveText("Result");
  await expect(frame.locator("#result .cell.cursor")).toHaveText("4");

  // The grid's rows on the map: a block of two rows, then Show on a map.
  await frame.locator("#result [role=grid]").press("Shift+ArrowUp");
  await run(page, "endue.database.show-map");
  await expect(frame.locator(".geo-rows [role=tab][aria-selected=true]")).toHaveText(
    "Selected rows (2)",
  );
  await expect(box(frame)).toHaveAttribute("data-shapes", "2");
  await frame.locator(".geo-rows [role=tab]", { hasText: "All rows" }).click();
  await expect(box(frame)).toHaveAttribute("data-shapes", "5");
});

test("twenty thousand shapes zoom and pan with the frame's longest task under 100 ms", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const frame = await open(page);
  await query(page, frame, MANY);
  // 500 rows, then four times as many each time: 2,000, 8,000, then all 20,000.
  for (let i = 0; i < 3; i++) await run(page, "endue.database.more");
  await run(page, "endue.database.show-map");
  await expect(box(frame)).toHaveAttribute("data-shapes", "20000", { timeout: 30_000 });
  await expect(box(frame)).not.toHaveAttribute("aria-busy", "true");
  const fitMs = Number(await box(frame).getAttribute("data-ms"));

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
  const at = await canvas(frame).boundingBox();
  if (!at) throw new Error("no canvas box");
  const middle = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(16);
  }
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(middle.x - i * 8, middle.y - i * 4);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(16);
  }
  await canvas(frame).focus();
  for (const key of ["+", "+", "ArrowLeft", "ArrowUp", "ArrowRight", "-", "-", "0"])
    await page.keyboard.press(key, { delay: 20 });
  const gaps = await frame.evaluate(() => {
    const timing = (window as unknown as { __timing: { gaps: number[]; on: boolean } }).__timing;
    timing.on = false;
    return timing.gaps;
  });
  await expect(box(frame)).toHaveAttribute("data-shapes", "20000");
  const sorted = [...gaps].sort((a, b) => a - b);
  const longest = Math.round(sorted.at(-1) ?? 0);
  const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  const drawMs = Number(await box(frame).getAttribute("data-ms"));
  const measured = { shapes: 20_000, ticks: gaps.length, longest, p95, fitMs, drawMs };
  test.info().annotations.push({ type: "20,000 shapes", description: JSON.stringify(measured) });
  console.log(`database map, 20,000 shapes: ${JSON.stringify(measured)}`);
  expect(gaps.length).toBeGreaterThan(50);
  expect(longest, "the frame's longest task while zooming and panning").toBeLessThan(FRAME_MS);
});
