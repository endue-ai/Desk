import { expect, type Frame, type Page, test } from "@playwright/test";

// The ER diagram of endue.database (plugins/database/ui/features/diagram) on the fixture page's
// scripted PostgreSQL connection `depot` (plugins/database/tests/diagram-fixture.ts): a table dragged
// stays where it was put after its panel closes and the diagram opens again; Export writes an SVG
// naming every table and a PNG through the fixture's save dialog; and a schema of 500 tables and
// 1,000 foreign keys opens and pans with its frame times measured.
const SURFACE = '[data-surface="endue.database"]';
const SIZE = { width: 1100, height: 700 };

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
  // The surface grows with the frame, so a pointer reaches every part of the page.
  await iframe.evaluate((el, { width, height }) => {
    const surface = el.closest("section") ?? el.parentElement;
    if (!surface) return;
    const [f, s] = [el, surface].map((e) => e.getBoundingClientRect()) as [DOMRect, DOMRect];
    const sheet = document.head.appendChild(document.createElement("style"));
    surface.setAttribute("data-e2e-surface", "");
    sheet.textContent = `[data-e2e-surface] { flex: none !important; max-width: none !important;
      max-height: none !important; width: ${width + s.width - f.width}px !important;
      height: ${height + s.height - f.height}px !important; }`;
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, SIZE);
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([c, a]) => window.__desk.runtime.commands.run(c as string, a), [command, args]);

const diagram = async (page: Page, frame: Frame, schema: string, tables: number) => {
  await run(page, "endue.database.er-diagram", { connection: "depot", schema });
  await expect(frame.locator("#panel-box .diagram svg.er g.er-table")).toHaveCount(tables, {
    timeout: 20_000,
  });
};
const files = (page: Page) =>
  page.evaluate(() => (window as unknown as { __files: Record<string, string> }).__files);

test("a dragged table stays where it was put after the diagram opens again", async ({ page }) => {
  const frame = await open(page);
  await diagram(page, frame, "public", 7);
  const audit = frame.locator('g.er-table[aria-label^="audit:"]');
  const before = await audit.getAttribute("transform");
  // The diagram fits itself once drawn and again a frame later: take the box once it holds still.
  let box = await audit.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const now = await audit.boundingBox();
    if (JSON.stringify(now) === JSON.stringify(box)) break;
    box = now;
  }
  if (!box) throw new Error("audit is not on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 70, { steps: 6 });
  await page.mouse.up();
  const moved = await audit.getAttribute("transform");
  expect(moved).not.toBe(before);
  // The move is kept a moment after it stops; then the panel closes and the diagram opens again.
  await page.waitForTimeout(800);
  await run(page, "desk.buffers.close");
  await expect(frame.locator("#panel-box .diagram")).toHaveCount(0);
  await diagram(page, frame, "public", 7);
  await expect(frame.locator('g.er-table[aria-label^="audit:"]')).toHaveAttribute(
    "transform",
    moved ?? "",
  );
});

test("Export writes an SVG naming every table and a PNG where the save dialog says", async ({
  page,
}) => {
  const frame = await open(page);
  await diagram(page, frame, "public", 7);
  await run(page, "endue.database.er-export", { format: "svg" });
  await expect
    .poll(async () => Object.keys(await files(page)))
    .toContain("~/Pictures/er-depot-public.svg");
  const svg = (await files(page))["~/Pictures/er-depot-public.svg"] ?? "";
  for (const table of [
    "customers",
    "orders",
    "order_lines",
    "products",
    "invoices",
    "notes",
    "audit",
  ])
    expect(svg).toContain(`>${table}</text>`);
  expect(svg).not.toContain("var(");
  expect(svg).not.toContain("tabindex");
  await run(page, "endue.database.er-export", { format: "png2x" });
  await expect
    .poll(async () => (await files(page))["~/Pictures/er-depot-public.png"]?.slice(0, 12))
    .toBe("iVBORw0KGgoA");
});

test("500 tables and 1,000 foreign keys open and pan within the frame budget", async ({ page }) => {
  const frame = await open(page);
  const started = Date.now();
  await diagram(page, frame, "big", 500);
  const opened = Date.now() - started;
  await expect(frame.locator("g.er-link")).toHaveCount(1000);
  // Pan by the wheel once a frame for 120 frames, timing each frame.
  const times = await frame.evaluate(async () => {
    const svg = document.querySelector("svg.er") as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const gaps: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      svg.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: i % 40 < 20 ? 18 : -18,
          deltaY: 9,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((done) => requestAnimationFrame(done));
      const now = performance.now();
      gaps.push(now - last);
      last = now;
    }
    return gaps.slice(5).sort((a, b) => a - b);
  });
  const at = (q: number) => Math.round((times[Math.floor(q * (times.length - 1))] ?? 0) * 10) / 10;
  const figures = { opened, p50: at(0.5), p95: at(0.95), max: at(1) };
  test.info().annotations.push({ type: "frame-times", description: JSON.stringify(figures) });
  console.log(`ER diagram of 500 tables: ${JSON.stringify(figures)}`);
  expect(figures.p95, "the 95th percentile frame while panning").toBeLessThan(50);
});
