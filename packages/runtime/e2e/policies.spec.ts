import { expect, type Page, test } from "@playwright/test";

const echo = '[data-surface="test.echo"] iframe';

async function open(page: Page, query = "") {
  await page.goto(`/desk.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await expect(page.frameLocator(echo).getByTestId("scheme")).not.toHaveText("none");
}

const desk = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#desk");
    return {
      scheme: root?.dataset.scheme,
      contrast: root?.dataset.contrast,
      motion: root?.dataset.motion,
      background: root ? getComputedStyle(root).getPropertyValue("--desk-background").trim() : "",
    };
  });

test.describe("desk.theme", () => {
  test("the dark theme applies by default, in the desk and in plugin frames", async ({ page }) => {
    await open(page);
    expect(await desk(page)).toMatchObject({ scheme: "dark", background: "#141416" });
    await expect(page.frameLocator(echo).getByTestId("scheme")).toHaveText("dark");
  });

  test("init.yaml settings choose the theme", async ({ page }) => {
    await open(
      page,
      `?init=${encodeURIComponent('{"desk.theme.scheme":"light","desk.theme.contrast":"high"}')}`,
    );
    expect(await desk(page)).toMatchObject({
      scheme: "light",
      contrast: "high",
      background: "#ffffff",
    });
  });

  test("a plugin toggles the theme with a command, and every frame follows", async ({ page }) => {
    await open(page);
    const frame = page.frameLocator(echo);
    await frame.getByTestId("toggle").click();
    await expect(frame.getByTestId("out")).toHaveText("light");
    await expect(frame.getByTestId("scheme")).toHaveText("light");
    expect(await desk(page)).toMatchObject({ scheme: "light", background: "#faf9fc" });
  });
});

test.describe("desk.keys", () => {
  test("a key runs its command on the desk and inside a plugin's frame", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+Shift+L");
    expect((await desk(page)).scheme).toBe("light");
    const frame = page.frameLocator(echo);
    await frame.getByTestId("field").click();
    await page.keyboard.press("Control+Shift+L");
    await expect(frame.getByTestId("scheme")).toHaveText("dark");
  });

  test("Mod is Meta on macOS", async ({ page }) => {
    await open(page, "?platform=mac");
    await page.keyboard.press("Control+Shift+L");
    expect((await desk(page)).scheme).toBe("dark");
    await page.keyboard.press("Meta+Shift+L");
    expect((await desk(page)).scheme).toBe("light");
  });

  test("turning a policy plugin off takes its commands and their keys away", async ({ page }) => {
    await open(page, "?off=desk.theme");
    await page.keyboard.press("Control+Shift+L");
    expect((await desk(page)).scheme).toBe("dark");
    const ids = await page.evaluate(() => window.__desk.runtime.commands.list().map((c) => c.id));
    expect(ids.filter((id) => id.startsWith("desk.theme."))).toEqual([]);
    expect(ids).toContain("desk.keys.quit");
  });

  test("one registry: the desk's built-ins and plugins' commands, with their keys", async ({
    page,
  }) => {
    await open(page);
    const listed = await page.evaluate(() =>
      window.__desk.runtime.commands.list().map((c) => [c.id, c.provider]),
    );
    expect(listed).toContainEqual(["desk.theme.toggle", "desk"]);
    expect(listed).toContainEqual(["test.echo.say", "test.echo"]);
    expect(listed).toContainEqual(["desk.palette.open", "desk.palette"]);
    const keys = await page.evaluate(() => window.__desk.runtime.commands.run("desk.keys.list"));
    expect(keys).toContainEqual(
      expect.objectContaining({ key: "Ctrl+Shift+L", command: "desk.theme.toggle" }),
    );
    const said = await page.evaluate(() =>
      window.__desk.runtime.commands.run("test.echo.say", { text: "hi" }),
    );
    expect(said).toEqual({ said: { text: "hi" }, by: "test.echo" });
  });
});

test.describe("desk.notify", () => {
  test("a plugin's ui.notify shows in the status line for its level's time", async ({ page }) => {
    await open(page);
    const base = await page.evaluate(() => window.__desk.runtime.status());
    await page.frameLocator(echo).getByTestId("notify").click();
    await expect(page.locator(".desk-status")).toHaveText("Hello from echo — It works.");
    await expect(page.locator(".desk-status")).toHaveAttribute("data-level", "success");
    await page.evaluate(() => window.__desk.clock.advance(3999));
    await expect(page.locator(".desk-status")).toHaveText("Hello from echo — It works.");
    await page.evaluate(() => window.__desk.clock.advance(1));
    await expect(page.locator(".desk-status")).toHaveText(base);
  });

  test("do not disturb holds notifications back; Escape dismisses one", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+Shift+D");
    await page.frameLocator(echo).getByTestId("notify").click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__desk.runtime.commands
            .run("desk.notify.history")
            .then((h) => (h as unknown[]).length),
        ),
      )
      .toBe(1);
    await expect(page.locator(".desk-status")).not.toHaveText(/Hello from echo/);
    await page.keyboard.press("Control+Shift+D");
    await expect(page.locator(".desk-status")).toHaveText("1 notification while you were away");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Escape");
    await expect(page.locator(".desk-status")).not.toHaveText(/while you were away/);
  });
});
