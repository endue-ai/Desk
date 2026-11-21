import { expect, type Frame, type Page, test } from "@playwright/test";
import { contrast, over, type RGBA } from "../src/shell/contrast";

// NF-05 on the rendered page: endue.database in the desk's dark and light schemes, with its
// connections tagged and coloured, a table's rows with a chosen cell and every kind of pending
// change, a console's editor holding every kind of token, a plan's tree, flame and table with
// their marks, and the overview, activity and maintenance panels. Every element that draws text is
// walked, whatever its class, and its colour is measured on the backgrounds stacked under it:
// 4.5:1, or 3:1 for large text (WCAG 1.4.3). plugins/database/tests/contrast.test.ts measures the
// sheets' marks and the states this page does not reach.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };
const QUERY =
  "select o.id, c.name from orders o join customers c on c.id = o.customer_id where c.region = 'north' order by o.total";
/** One of each token: keyword, function, string, number, quoted name, parameter, comment. */
const TOKENS = `-- every kind of token\nselect upper('text'), 42, "quoted name", :param\nfrom people;`;

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
  await expect(frame.locator("#tree [role=treeitem]", { hasText: "warehouse" })).toBeVisible();
  return frame;
}

/** Run a desk command; `wait: false` leaves it running (a dialog it shows waits for an answer). */
const run = (page: Page, command: string, args: Record<string, unknown> = {}, wait = true) =>
  page.evaluate(
    ([command, args, wait]) => {
      const done = window.__desk.runtime.commands.run(command, args);
      if (wait) return done.then(() => undefined);
      done.catch(() => {});
      return undefined;
    },
    [command, args, wait] as const,
  );

const sql = (frame: Frame) => frame.getByRole("textbox", { name: "SQL" });

/** Give a connection an environment and a colour through its own form. */
async function tag(page: Page, frame: Frame, connection: string, env: string, colour: string) {
  await run(page, "endue.database.edit-connection", { connection }, false);
  const form = frame.locator("#form");
  await expect(form).toBeVisible();
  await frame.locator("#f-tag").selectOption(env);
  await frame.locator("#f-color").selectOption(colour);
  // Enter in a field saves, as the form's Save does (its foot can lie under the window's edge).
  await frame.locator("#f-name").press("Enter");
  await expect(form).toBeHidden();
}

interface Sample {
  where: string;
  text: string;
  color: string;
  layers: string[];
  size: number;
  weight: number;
}

/** Every visible element with text of its own: its colour, the backgrounds under it (innermost first). */
const samples = (frame: Frame): Promise<Sample[]> =>
  frame.evaluate(() => {
    const out: Sample[] = [];
    const clear = (c: string) =>
      c === "" || c === "none" || c === "transparent" || c.endsWith(", 0)") || / \/ 0\)$/.test(c);
    for (const el of document.body.querySelectorAll("*")) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (
        !own ||
        el.closest("[hidden], [disabled], [aria-disabled='true'], [inert], .sr-only, option")
      )
        continue;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1 || style.visibility !== "visible") continue;
      // A faded element is an inactive control; the sheets' test measures every opacity they set.
      let opacity = 1;
      for (let a: Element | null = el; a; a = a.parentElement)
        opacity *= Number(getComputedStyle(a).opacity);
      if (opacity < 1) continue;
      const layers: string[] = [];
      if (el instanceof SVGElement) {
        // SVG text sits on the shapes drawn before it in its group, the last one on top.
        const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
        const before = [...(el.parentElement?.children ?? [])].slice(
          0,
          [...(el.parentElement?.children ?? [])].indexOf(el),
        );
        for (const shape of before.reverse()) {
          const r = shape.getBoundingClientRect();
          const fill = getComputedStyle(shape).fill;
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && !clear(fill))
            layers.push(fill);
        }
      }
      for (let a: Element | null = el; a; a = a.parentElement) {
        const bg = getComputedStyle(a).backgroundColor;
        if (!clear(bg)) layers.push(bg);
      }
      const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].map((c) => `.${c}`).join("")}`;
      out.push({
        where: name,
        text: (el.textContent ?? "").trim().slice(0, 32),
        color: el instanceof SVGElement ? style.fill : style.color,
        layers,
        size: Number.parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
      });
    }
    return out;
  });

/** A computed colour as the engine writes it: rgb(), rgba(), or color(srgb …) for a color-mix(). */
function rgba(text: string): RGBA {
  const [r = 0, g = 0, b = 0, a = 1] = (text.match(/-?[\d.]+(e-?\d+)?/g) ?? []).map(Number);
  const scale = text.startsWith("color(srgb") ? 255 : 1;
  return [r * scale, g * scale, b * scale, a];
}

function ratio(s: Sample): number {
  const layers = s.layers.map(rgba);
  let bg: RGBA = layers.at(-1) ?? [0, 0, 0, 1];
  for (const layer of layers.slice(0, -1).reverse()) bg = over(layer, bg);
  return contrast(rgba(s.color), bg);
}

/** WCAG's large text: 24px, or 18.66px bold. */
const need = (s: Sample) => (s.size >= 24 || (s.size >= 18.66 && s.weight >= 700) ? 3 : 4.5);

for (const scheme of ["dark", "light"] as const)
  test(`every text endue.database draws reaches 4.5:1 in the ${scheme} scheme`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const frame = await open(page);
    if (scheme === "light") await run(page, "desk.theme.light");
    await expect(frame.locator("html")).toHaveAttribute("data-scheme", scheme);
    const failing: string[] = [];
    const walked: Record<string, number> = {};
    const walk = async (state: string) => {
      const found = await samples(frame);
      walked[state] = found.length;
      for (const s of found) {
        const r = ratio(s);
        if (!(r >= need(s))) failing.push(`${state}: ${s.where} "${s.text}" ${r.toFixed(2)}`);
      }
    };

    await tag(page, frame, "fixture-pg", "staging", "chart-3");
    await tag(page, frame, "warehouse", "development", "chart-2");
    await tag(page, frame, "reports", "production", "chart-7");

    // A table's rows: a chosen cell, an edited one, a row to add and a row to delete.
    await run(page, "endue.database.open-table", {
      connection: "fixture-pg",
      schema: "public",
      table: "items",
    });
    await expect(frame.locator("#page")).toHaveText("1–3");
    const cell = (text: RegExp) => frame.locator("#result [role=gridcell]", { hasText: text });
    await cell(/^ok$/).click();
    await page.keyboard.press("Enter");
    await expect(frame.locator(".cell-editor [role=listbox]")).toBeFocused();
    await walk("a cell's editor");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(frame.locator("#result .cell.changed")).toHaveCount(1);
    await frame.locator('[data-act="addRow"]').click();
    await expect(frame.locator("#result .grid-row.inserted")).toHaveCount(1);
    await cell(/^sad$/).click();
    await page.keyboard.press("Delete");
    await expect(frame.locator("#result .grid-row.deleted")).toHaveCount(1);
    await walk("pending changes on a staging connection");

    // A console's editor with every kind of token, then a query's rows.
    await run(page, "endue.database.console", { connection: "warehouse" });
    await sql(frame).fill(TOKENS);
    await expect(frame.locator("#editor-box .tok-param")).toHaveCount(1);
    await walk("the editor's tokens");

    // A plan with its marks, as a tree, a flame and a table.
    await sql(frame).fill(QUERY);
    await run(page, "endue.database.explain-analyze");
    const plan = frame.locator(".plan-box");
    await expect(plan.locator(".plan-mark").first()).toBeVisible();
    await walk("a plan's tree");
    await plan.locator('.plan-views [data-view="flame"]').click();
    await expect(frame.locator(".flame-block").first()).toBeVisible();
    await walk("a plan's flame");
    await plan.locator('.plan-views [data-view="table"]').click();
    await walk("a plan's table");

    // The panels: the server overview of a production connection, its activity, maintenance.
    await run(page, "endue.database.overview", { connection: "reports" });
    await expect(frame.locator("#ov-tables tbody tr").first()).toContainText("orders");
    await walk("the overview of a production connection");
    await run(page, "endue.database.activity", { connection: "warehouse" });
    await expect(frame.locator('[data-part="sessions"] tbody tr').first()).toBeVisible();
    await walk("the activity panel");
    await run(page, "endue.database.maintenance", {
      connection: "warehouse",
      schema: "public",
      table: "orders",
    });
    await expect(frame.locator('[data-part="statement"]')).toHaveText(
      "VACUUM (VERBOSE) public.orders",
    );
    await walk("the maintenance form");

    expect(failing).toEqual([]);
    // Each state's walk found the page's text: the explorer, the header and the footer at least.
    expect(Object.entries(walked).filter(([, n]) => n < 20)).toEqual([]);
  });
