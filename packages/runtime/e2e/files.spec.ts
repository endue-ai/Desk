import { expect, type Page, test } from "@playwright/test";

const echo = (page: Page) => page.frameLocator('[data-surface="test.echo"] iframe');
const lazy = (page: Page) => page.frameLocator('[data-surface="test.lazy"] iframe');
const surface = (page: Page, id: string) => page.locator(`[data-surface="${id}"]`);
const autoloaded = (page: Page) => page.evaluate(() => window.__deskStore["files.autoloaded"]);
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

test.describe("desk.files: a file no rule names, one file one buffer, the ring (#162)", () => {
  const fallback = `?init=${encodeURIComponent(JSON.stringify({ "desk.files.fallback": "test.lazy" }))}`;

  test("a file no rule names opens in the fallback; a name without an extension as text", async ({
    page,
  }) => {
    await open(page, fallback);
    expect(await run(page, "desk.files.open", { path: "~/files/blob.bin" })).toBe(
      "file:~/files/blob.bin",
    );
    await expect(lazy(page).getByTestId("file")).toHaveText(
      "file:~/files/blob.bin: ~/files/blob.bin",
    );
    expect(await run(page, "desk.files.open", { path: "~/src/README" })).toBe("file:~/src/README");
    await expect(echo(page).getByTestId("file")).toHaveText("file:~/src/README: ~/src/README");
    await expect(status(page)).not.toHaveText(/No plugin opens/);
  });

  test("the same file by three spellings of its path is one buffer", async ({ page }) => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a bridge path root, not a placeholder
    const home = "${home}";
    await open(page);
    for (const path of ["~/notes/a.txt", `${home}/notes/a.txt`, "~/notes/./x/../a.txt"])
      expect(await run(page, "desk.files.open", { path })).toBe("file:~/notes/a.txt");
    expect((await buffers(page)).filter((id) => id.includes("a.txt"))).toEqual([
      "file:~/notes/a.txt",
    ]);
    await expect(echo(page).getByTestId("log")).toContainText("visit ~/notes/a.txt;");
    await expect(echo(page).getByTestId("log")).not.toContainText(`visit ${home}`);
  });

  test("Mod+W twice in a plugin with three files leaves the third showing", async ({ page }) => {
    await open(page);
    for (const name of ["a", "b", "c"])
      await run(page, "desk.files.open", { path: `~/${name}.txt` });
    // The plugin's own surface, which a walk with Mod+Alt+Right used to stop at, stands for its file.
    expect(await run(page, "desk.buffers.switch", { id: "surface:test.echo" })).toBe(
      "file:~/c.txt",
    );
    await page.evaluate(() => window.__desk.runtime.focusSurface("test.echo"));
    await page.keyboard.press("Control+W");
    await expect(echo(page).getByTestId("file")).toHaveText("file:~/b.txt: ~/b.txt");
    await page.keyboard.press("Control+W");
    await expect(echo(page).getByTestId("file")).toHaveText("file:~/a.txt: ~/a.txt");
    expect(await buffers(page)).toContain("file:~/a.txt");
  });
});

test.describe("desk.files: the plugin's own writes", () => {
  test("saving a file does not report it as changed on disk", async ({ page }) => {
    await open(page);
    await run(page, "desk.files.open", { path: "~/notes/a.txt" });
    await run(page, "desk.files.save", {});
    await expect(status(page)).toHaveText("Saved a.txt");
    expect(await run(page, "desk.files.changed", { path: "~/notes/a.txt" })).toBe("own-save");
    await expect(status(page)).toHaveText("Saved a.txt");
    await expect(echo(page).getByTestId("log")).not.toContainText("revert ~/notes/a.txt;");
  });
});

test.describe("desk.files: autoload openers (ADR 0046)", () => {
  test("an autoload opener is off at start, comes up with the file and goes when the file closes", async ({
    page,
  }) => {
    await open(page);
    await expect(surface(page, "test.lazy")).toHaveCount(0);
    expect(await run(page, "desk.files.open", { path: "~/notes/a.lazy" })).toBe(
      "file:~/notes/a.lazy",
    );
    await expect(lazy(page).getByTestId("file")).toHaveText("file:~/notes/a.lazy: ~/notes/a.lazy");
    expect(await autoloaded(page)).toEqual(["test.lazy"]);
    await run(page, "desk.buffers.close", { id: "file:~/notes/a.lazy" });
    await expect(surface(page, "test.lazy")).toHaveCount(0);
    expect(await buffers(page)).not.toContain("surface:test.lazy");
    await expect.poll(() => autoloaded(page)).toEqual([]);
    // The plain opener beside it stays where it was.
    await expect(surface(page, "test.echo")).toHaveCount(1);
  });
});
