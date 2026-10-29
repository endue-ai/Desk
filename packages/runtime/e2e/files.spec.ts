import { expect, type Page, test } from "@playwright/test";

const echo = (page: Page) => page.frameLocator('[data-surface="test.echo"] iframe');
const palette = (page: Page) => page.frameLocator('[data-surface="desk.palette"] iframe');
const status = (page: Page) => page.locator(".desk-status");
const run = (page: Page, id: string, args?: unknown) =>
  page.evaluate(([id, args]) => window.__desk.runtime.commands.run(id as string, args), [id, args]);
const buffers = (page: Page) =>
  page.evaluate(() =>
    window.__desk.runtime.commands
      .run("desk.buffers.list")
      .then((list) =>
        (list as Array<{ id: string; modified: boolean }>).map(
          (b) => `${b.id}${b.modified ? "*" : ""}`,
        ),
      ),
  );

async function open(page: Page, query = "") {
  await page.goto(`/desk.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(echo(page).getByTestId("scheme")).not.toHaveText("none");
  await expect
    .poll(() => page.evaluate(() => window.__desk.runtime.commands.has("desk.palette.pick")))
    .toBe(true);
}

test.describe("desk.files", () => {
  test("a file opens in the plugin its rule names, as a buffer, and is remembered", async ({
    page,
  }) => {
    await open(page);
    expect(await run(page, "desk.files.open", { path: "~/notes/a.txt" })).toBe(
      "file:~/notes/a.txt",
    );
    await expect(echo(page).getByTestId("file")).toHaveText("file:~/notes/a.txt: ~/notes/a.txt");
    expect((await buffers(page))[0]).toBe("file:~/notes/a.txt");
    const recent = await page.evaluate(() => window.__deskStore["files.recent"]);
    expect(recent).toEqual([{ path: "~/notes/a.txt", plugin: "test.echo" }]);
    // Opening it again shows the same buffer instead of a second one.
    await run(page, "desk.files.open", { path: "~/notes/a.txt" });
    await expect(echo(page).getByTestId("log")).toHaveText(
      "visit ~/notes/a.txt;show file:~/notes/a.txt;show file:~/notes/a.txt;",
    );
  });

  test("Mod+S has the plugin save the file in use, and says so", async ({ page }) => {
    await open(page);
    await run(page, "desk.files.open", { path: "~/notes/a.txt" });
    await echo(page).getByTestId("field").fill("changed");
    await expect.poll(() => buffers(page)).toContain("file:~/notes/a.txt*");
    await page.keyboard.press("Control+S");
    await expect(status(page)).toHaveText("Saved a.txt");
    expect(await page.evaluate(() => window.__deskWritten)).toEqual([
      { path: "~/notes/a.txt", content: "changed" },
    ]);
    expect(await buffers(page)).toContain("file:~/notes/a.txt");
  });

  test("a file no plugin opens is refused with a warning", async ({ page }) => {
    await open(page);
    const failed = await run(page, "desk.files.open", { path: "~/x.pdf" }).catch(
      (e: Error) => e.message,
    );
    expect(failed).toContain("no plugin opens ~/x.pdf");
    await expect(status(page)).toHaveText("No plugin opens x.pdf");
    await expect(status(page)).toHaveAttribute("data-level", "warning");
  });

  test("a file that changed on disk reloads when it has no unsaved changes", async ({ page }) => {
    await open(page);
    await run(page, "desk.files.open", { path: "~/notes/a.txt" });
    expect(await run(page, "desk.files.changed", { path: "~/notes/a.txt" })).toBe("reloaded");
    await expect(status(page)).toHaveText("Reloaded a.txt — It changed on disk.");
    await expect(echo(page).getByTestId("log")).toContainText("revert ~/notes/a.txt;");
  });

  test("Mod+O opens a typed path through the palette", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+O");
    await expect(palette(page).getByTestId("query")).toBeFocused();
    await page.keyboard.type("~/notes/typed.txt");
    await expect(palette(page).getByRole("option").first()).toContainText(
      "Use “~/notes/typed.txt”",
    );
    await page.keyboard.press("Enter");
    await expect(echo(page).getByTestId("file")).toHaveText(
      "file:~/notes/typed.txt: ~/notes/typed.txt",
    );
  });
});

test.describe("desk.buffers", () => {
  test("closing a buffer with unsaved changes asks first", async ({ page }) => {
    await open(page);
    await run(page, "desk.files.open", { path: "~/notes/a.txt" });
    await echo(page).getByTestId("field").fill("unsaved");
    await expect.poll(() => buffers(page)).toContain("file:~/notes/a.txt*");
    await page.evaluate(() => window.__desk.runtime.focusSurface("test.echo"));
    await page.keyboard.press("Control+W");
    await expect(palette(page).getByTestId("title")).toHaveText("a.txt has unsaved changes");
    await expect(palette(page).getByTestId("query")).toBeFocused();
    await page.keyboard.type("without");
    await page.keyboard.press("Enter");
    await expect.poll(() => buffers(page)).not.toContain("file:~/notes/a.txt*");
    await expect(echo(page).getByTestId("log")).toContainText("closed file:~/notes/a.txt;");
    expect(await page.evaluate(() => window.__deskWritten)).toEqual([]);
  });

  test("Mod+B switches buffers through the palette; next and previous step through them", async ({
    page,
  }) => {
    await open(page);
    await run(page, "desk.files.open", { path: "~/notes/a.txt" });
    await page.evaluate(() => window.__desk.runtime.focusSurface("test.counter"));
    expect((await buffers(page))[0]).toBe("surface:test.counter");
    await page.keyboard.press("Control+B");
    await expect(palette(page).getByTestId("title")).toHaveText("Switch to a buffer");
    await page.keyboard.type("a.txt");
    await page.keyboard.press("Enter");
    await expect.poll(() => buffers(page).then((list) => list[0])).toBe("file:~/notes/a.txt");
    expect(await page.evaluate(() => window.__desk.runtime.shortcuts.focused)).toBe("test.echo");
    const next = await run(page, "desk.buffers.next");
    const back = await run(page, "desk.buffers.previous");
    expect(next).not.toBe("file:~/notes/a.txt");
    expect(back).toBe("file:~/notes/a.txt");
  });
});
