import { expect, type Page, test } from "@playwright/test";

const echo = (page: Page) => page.frameLocator('[data-surface="test.echo"] iframe');

async function open(page: Page, query = "") {
  await page.goto(`/desk.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(echo(page).getByTestId("scheme")).not.toHaveText("none");
}

/** Change the desk: a file open, the counter moved and in use, one notice. */
async function work(page: Page) {
  await page.evaluate(async () => {
    const { runtime } = window.__desk;
    await runtime.commands.run("desk.files.open", { path: "~/notes/a.txt" });
    runtime.moveSurface("test.counter", { col: 3, row: 2, colSpan: 1, rowSpan: 1 });
    runtime.notify({ caller: "desk", title: "Before the restart" });
    runtime.focusSurface("test.counter");
  });
}

const saved = (page: Page) => page.evaluate(() => window.__deskStore.session ?? null);

test.describe("desk.session", () => {
  test("the session is kept as it changes, and a new start puts it back", async ({ page }) => {
    await open(page);
    await work(page);
    await expect
      .poll(() => saved(page))
      .toMatchObject({
        version: 1,
        files: [{ path: "~/notes/a.txt", plugin: "test.echo" }],
        focused: "test.counter",
      });
    const session = await saved(page);
    expect(
      (session as { layout: { cells: Record<string, unknown> } }).layout.cells["test.counter"],
    ).toEqual({ col: 3, row: 2, colSpan: 1, rowSpan: 1 });

    // A restart: the core's store keeps the session; the window's own storage does not.
    await page.evaluate(() => localStorage.clear());
    await open(page, `?store=${encodeURIComponent(JSON.stringify({ session }))}`);
    await expect(echo(page).getByTestId("file")).toHaveText("file:~/notes/a.txt: ~/notes/a.txt");
    const state = await page.evaluate(async () => ({
      cell: window.__desk.runtime.layout().cells["test.counter"],
      focused: window.__desk.runtime.shortcuts.focused,
      notices: (
        (await window.__desk.runtime.commands.run("desk.notify.history", {
          show: false,
        })) as Array<{
          title: string;
        }>
      ).map((n) => n.title),
    }));
    expect(state).toEqual({
      cell: { col: 3, row: 2, colSpan: 1, rowSpan: 1 },
      focused: "test.counter",
      notices: ["Before the restart"],
    });
  });

  test("with desk.session off, nothing is kept or put back", async ({ page }) => {
    await open(page, "?off=desk.session");
    await work(page);
    await page.waitForTimeout(600);
    expect(await saved(page)).toBeNull();
    const session = {
      version: 1,
      layout: { version: 1, columns: 3, rows: 2, cells: {} },
      files: [{ path: "~/notes/a.txt", plugin: "test.echo" }],
      focused: null,
      notices: [],
    };
    await page.evaluate(() => localStorage.clear());
    await open(page, `?off=desk.session&store=${encodeURIComponent(JSON.stringify({ session }))}`);
    await page.waitForTimeout(300);
    await expect(echo(page).getByTestId("file")).toHaveText("");
  });
});
