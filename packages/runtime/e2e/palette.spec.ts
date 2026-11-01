import { expect, type Page, test } from "@playwright/test";

const palette = '[data-surface="desk.palette"]';
const frame = (page: Page) => page.frameLocator(`${palette} iframe`);

async function open(page: Page, query = "") {
  await page.goto(`/desk.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(
    page.frameLocator('[data-surface="test.echo"] iframe').getByTestId("scheme"),
  ).not.toHaveText("none");
  // The palette answers once its frame has connected.
  await expect(page.locator(palette)).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__desk.runtime.commands.has("desk.palette.open")))
    .toBe(true);
}

const scheme = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>("#desk")?.dataset.scheme);

test.describe("desk.palette", () => {
  test("Mod+K opens it; typing filters, Enter runs and the palette closes", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await expect(page.locator(palette)).toBeVisible();
    await expect(frame(page).getByTestId("query")).toBeFocused();
    await page.keyboard.type("light dark");
    await expect(frame(page).getByRole("option").first()).toContainText(
      "Switch between light and dark",
    );
    await expect(frame(page).getByRole("option").first()).toContainText("Ctrl+Shift+L");
    await page.keyboard.press("Enter");
    await expect(page.locator(palette)).toBeHidden();
    expect(await scheme(page)).toBe("light");
  });

  test("a command just run comes first next time; Escape closes without running", async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("do not disturb");
    await page.keyboard.press("Enter");
    await expect(page.locator(palette)).toBeHidden();
    await page.keyboard.press("Control+K");
    await expect(frame(page).getByRole("option").first()).toContainText("do not disturb");
    await page.keyboard.press("Escape");
    await expect(page.locator(palette)).toBeHidden();
    expect(await scheme(page)).toBe("dark");
  });

  test("a command asks the person to pick one, and hears a cancel as cancelled", async ({
    page,
  }) => {
    await open(page);
    const picked = page.evaluate(() =>
      window.__desk.runtime.commands.run("desk.palette.pick", {
        title: "Pick a fruit",
        items: [
          { id: "a", label: "Apple" },
          { id: "b", label: "Banana", detail: "yellow" },
        ],
      }),
    );
    await expect(frame(page).getByTestId("title")).toHaveText("Pick a fruit");
    await expect(frame(page).getByTestId("query")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await picked).toBe("b");

    const cancelled = page.evaluate(() =>
      window.__desk.runtime.commands
        .run("desk.palette.pick", { items: [{ id: "a", label: "Apple" }] })
        .then(
          () => "picked",
          (error: { code?: string }) => error.code,
        ),
    );
    await expect(frame(page).getByTestId("query")).toBeFocused();
    await page.keyboard.press("Escape");
    expect(await cancelled).toBe("cancelled");
  });
});

test.describe("desk.display", () => {
  test("a plugin's rule sizes its surface on the grid and gives it the focus", async ({ page }) => {
    const rules = [
      {
        match: { plugin: "test.echo" },
        area: "center",
        size: { columns: 2, rows: 2 },
        focus: true,
      },
    ];
    await open(page, `?rules=${encodeURIComponent(JSON.stringify(rules))}`);
    const state = await page.evaluate(() => ({
      echo: window.__desk.runtime.layout().cells["test.echo"],
      counter: window.__desk.runtime.layout().cells["test.counter"],
      focused: window.__desk.runtime.shortcuts.focused,
    }));
    expect(state).toEqual({
      echo: { col: 1, row: 1, colSpan: 2, rowSpan: 2 },
      counter: { col: 3, row: 1, colSpan: 1, rowSpan: 1 },
      focused: "test.echo",
    });
  });

  test("Control+Tab moves the focus between surfaces; the hidden palette is skipped", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => window.__desk.runtime.focusSurface("test.echo"));
    await page.keyboard.press("Control+Tab");
    expect(await page.evaluate(() => window.__desk.runtime.shortcuts.focused)).toBe("test.counter");
    await page.keyboard.press("Control+Tab");
    expect(await page.evaluate(() => window.__desk.runtime.shortcuts.focused)).toBe("test.echo");
    await page.keyboard.press("Control+Shift+Tab");
    expect(await page.evaluate(() => window.__desk.runtime.shortcuts.focused)).toBe("test.counter");
  });
});

test("search opens a disabled plugin and matches another plugin's published body", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(async () => {
    await window.__desk.stub.call({
      id: 900,
      method: "plugin.setEnabled",
      params: { plugin: "test.counter", enabled: false, scope: { permission: "plugin:manage" } },
    });
    await window.__desk.stub.call(
      {
        id: 901,
        method: "search.replace",
        params: {
          documents: [
            { id: "trip", title: "Travel plan", text: "서울 출장", detail: "Echo document" },
          ],
        },
      },
      "test.echo",
    );
  });
  await expect(page.locator('[data-surface="test.counter"]')).toHaveCount(0);
  await page.keyboard.press("Control+K");
  await frame(page).getByTestId("query").fill("test.counter");
  await expect(frame(page).getByRole("option").first()).toContainText("test.counter");
  await page.keyboard.press("Enter");
  await expect(page.locator(palette)).toBeHidden();
  await expect(page.locator('[data-surface="test.counter"]')).toBeVisible();
  await page.evaluate(() => window.__desk.runtime.plugins?.unmount("test.echo"));
  await page.keyboard.press("Control+K");
  await frame(page).getByTestId("query").fill("서울 출장");
  await expect(frame(page).getByRole("option").first()).toContainText("Travel plan");
  await page.keyboard.press("Enter");
  await expect(page.locator(palette)).toBeHidden();
  expect(await page.evaluate(() => window.__desk.runtime.shortcuts.focused)).toBe("test.echo");
});

test.describe("desk.palette: a command that fails", () => {
  test("a command that fails from the palette says why", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("Show a plugin");
    await expect(frame(page).getByRole("option").first()).toContainText("Show a plugin's surface");
    await page.keyboard.press("Enter");
    await expect(page.locator(palette)).toBeHidden();
    await expect(page.locator(".desk-status")).toHaveText(
      "Show a plugin's surface failed — say which plugin: { plugin }",
    );
    await expect(page.locator(".desk-status")).toHaveAttribute("data-level", "error");
  });
});
