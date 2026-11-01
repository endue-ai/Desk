import { expect, type Frame, type Page, test } from "@playwright/test";
import { viewTree } from "./view-tree";

// desk.views on the browser stub's fixture items (views.html), at the stub's clock: Friday
// 30 October 2026, 9 in the morning in Seoul.
const VIEWS = '[data-surface="desk.views"]';
const PALETTE = '[data-surface="desk.palette"]';

test.use({ timezoneId: "Asia/Seoul", locale: "en-US" });

async function load(page: Page, query = ""): Promise<void> {
  await page.clock.setFixedTime("2026-10-30T09:00:00+09:00");
  await page.goto(`/views.html${query}`);
  await page.waitForFunction(() => window.__views !== undefined);
  await page.evaluate(() => window.__views.ready);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect
    .poll(() => page.evaluate(() => window.__desk.runtime.commands.has("desk.views.open")))
    .toBe(true);
}

/** Run desk.views.open as the desk does, and resolve with the views frame once it shows. */
async function open(page: Page, args: Record<string, unknown>): Promise<Frame> {
  await page.evaluate((a) => window.__desk.runtime.commands.run("desk.views.open", a), args);
  await expect(page.locator(VIEWS)).toBeVisible();
  const frame = await (await page.locator(`${VIEWS} iframe`).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no views frame");
  return frame;
}

/** The plugin's own bridge calls of one method, as the stub logged them. */
const calls = (page: Page, method: string) =>
  page.evaluate(
    (m) =>
      window.__desk.stub.log
        .filter((entry) => entry.caller === "desk.views" && entry.request.method === m)
        .map((entry) => entry.request.params),
    method,
  );

test.describe("desk.views", () => {
  test("view-today renders from the spec's vector on the stub fixtures", async ({ page }) => {
    await load(page);
    const frame = await open(page, { id: "test.view-today" });
    await expect(frame.locator('[data-component="list"][data-state="ready"]')).toBeVisible();
    await expect(frame.locator('[data-component="agenda"][data-state="ready"]')).toBeVisible();
    await expect(frame.locator("#root")).toHaveAttribute("data-density", "regular");
    await expect(frame.getByText("Send the weekly report")).toBeVisible();
    await expect(frame.getByText("12:30 Lunch with Mina")).toBeVisible();
    expect(await viewTree(frame)).toMatchSnapshot("view-today.json");
  });

  test("view-table-with-actions renders its table, and a sortable column sorts", async ({
    page,
  }) => {
    await load(page, "?jira=1");
    const frame = await open(page, { id: "example.open-tasks" });
    await expect(frame.locator('[data-component="table"][data-state="ready"]')).toBeVisible();
    expect(await viewTree(frame)).toMatchSnapshot("view-table-with-actions.json");

    const priority = frame.getByRole("columnheader", { name: "Priority" });
    const rows = frame.getByRole("row").filter({ has: frame.getByRole("gridcell") });
    await expect(priority).toHaveAttribute("aria-sort", "ascending");
    await expect(rows.first()).toContainText("Send the weekly report");
    await priority.getByRole("button").focus();
    await page.keyboard.press("Enter");
    await expect(priority).toHaveAttribute("aria-sort", "descending");
    await expect(rows.first()).toContainText("Buy groceries");
    await expect(rows.last()).toContainText("Send the weekly report");
  });

  test("a data.changed from the stub updates the rendered list", async ({ page }) => {
    await load(page);
    const frame = await open(page, { id: "test.view-today" });
    const list = frame.locator('[data-component="list"] desk-list');
    await expect(list).toContainText("Send the weekly report");
    // A mark on the frame's window: a reloaded frame would not have it.
    await frame.evaluate(() => {
      (window as unknown as { marked: boolean }).marked = true;
    });
    const plants = {
      kind: "task" as const,
      id: "task-plants",
      source: { connector: "desk.fixtures", instance: "default" },
      title: "Water the plants",
      updatedAt: "2026-10-30T08:59:00+09:00",
      status: "open" as const,
      due: "2026-10-30T18:00:00+09:00",
    };
    await page.evaluate((item) => window.__views.upsert(item), plants);
    await expect(list).toContainText("Water the plants");
    await expect(list.getByRole("option")).toHaveText([
      /Send the weekly report/,
      /Water the plants/,
      /Buy groceries/,
    ]);
    await page.evaluate((item) => window.__views.remove(item.source, item.id), plants);
    await expect(list).not.toContainText("Water the plants");
    expect(await calls(page, "view.get")).toHaveLength(1);
    // The same document: the frame was not reloaded.
    expect(await frame.evaluate(() => (window as unknown as { marked?: boolean }).marked)).toBe(
      true,
    );
  });

  test("a binding that matches nothing draws its empty text", async ({ page }) => {
    await load(page);
    const frame = await open(page, { id: "test.empty" });
    const component = frame.locator('[data-component="list"]');
    await expect(component).toHaveAttribute("data-state", "empty");
    await expect(component).toContainText("Nothing due");
    expect(await viewTree(frame)).toMatchSnapshot("empty.json");
  });

  test("a connector in error draws the error state with Reconnect", async ({ page }) => {
    await load(page, "?status=error");
    const frame = await open(page, { id: "test.view-today" });
    const bound = frame.locator("[data-component]");
    await expect(bound).toHaveCount(2);
    for (const component of await bound.all()) {
      await expect(component).toHaveAttribute("data-state", "error");
      await expect(component).toContainText("The fixture source stopped answering.");
    }
    expect(await viewTree(frame)).toMatchSnapshot("connector-error.json");

    await frame.getByRole("button", { name: "Reconnect" }).first().click();
    await expect
      .poll(() => calls(page, "connector.sync"))
      .toEqual([
        {
          connector: "desk.fixtures",
          instance: "default",
          scope: { permission: "connector:manage" },
        },
      ]);
    await expect(frame.locator('[data-state="ready"]')).toHaveCount(2);
  });

  test('Enter runs the first action; "." and a right click open the actions menu', async ({
    page,
  }) => {
    await load(page, "?jira=1");
    const frame = await open(page, { id: "example.open-tasks" });
    const first = frame.getByRole("row").filter({ hasText: "Send the weekly report" });
    await first.click();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.__views.invoked))
      .toEqual([
        {
          id: "example.jira.done",
          args: { id: "task-report", instance: "default" },
          caller: "desk.views",
        },
      ]);

    const menu = frame.locator("desk-menu");
    const items = ["Done", "Open in Jira", "Open in the original app"];
    await page.keyboard.press(".");
    await expect(menu).toHaveAttribute("open", "");
    await expect(menu.getByRole("menuitem")).toHaveText(items);
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(page.locator(VIEWS)).toBeVisible();

    await first.click({ button: "right" });
    await expect(menu).toHaveAttribute("open", "");
    await expect(menu.getByRole("menuitem")).toHaveText(items);
    // The original opens through shell.open (ADR 0047); the stub core hands its link to window.open.
    await page.evaluate(() => {
      const opened: string[] = [];
      Object.assign(window, { __opened: opened });
      window.open = (url) => {
        opened.push(String(url));
        return null;
      };
    });
    await menu.getByRole("menuitem", { name: "Open in the original app" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toEqual(["https://jira.example.com/browse/task-report"]);
    await expect(frame.locator("desk-toast")).toBeHidden();
  });

  test("a surface narrower than 480 px draws compact", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await load(page);
    const frame = await open(page, { id: "test.view-today" });
    await expect(frame.locator('[data-component="list"][data-state="ready"]')).toBeVisible();
    await expect(frame.locator("#root")).toHaveAttribute("data-density", "compact");
    const densities = await frame.evaluate(() =>
      [...document.querySelectorAll("#root *")]
        .filter((el) => el.localName.startsWith("desk-"))
        .map((el) => [el.localName, el.getAttribute("density")]),
    );
    expect(densities.length).toBeGreaterThan(1);
    for (const [name, density] of densities) expect(density, name ?? "").toBe("compact");
  });

  test("the palette opened over a view is drawn above it", async ({ page }) => {
    await load(page);
    const frame = await open(page, { id: "test.view-today" });
    await expect(frame.locator('[data-component="list"][data-state="ready"]')).toBeVisible();
    await page.keyboard.press("Control+K");
    await expect(page.locator(PALETTE)).toBeVisible();
    const box = await page.frameLocator(`${PALETTE} iframe`).locator(".box").boundingBox();
    if (!box) throw new Error("the palette has no box");
    const centre = [box.x + box.width / 2, box.y + box.height / 2] as const;
    const on = await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.closest("[data-surface]")?.getAttribute("data-surface"),
      centre,
    );
    expect(on).toBe("desk.palette");
    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toBeHidden();
    await expect(page.locator(VIEWS)).toBeVisible();
  });
});
