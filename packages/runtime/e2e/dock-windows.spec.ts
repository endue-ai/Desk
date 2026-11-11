import { expect, type Page, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

// The dock beside the shell's window manager, as the app has it (#158): a tile of a plugin that is on
// brings the plugin's window forward, from under other windows or out of the drawer, and puts the
// plugin away when its window is the one in front (or it has no window).

const COUNTER = "test.counter";
const HELLO = "example.hello-ui";

type Listed = {
  windows: Array<{
    z?: number;
    focused?: boolean;
    hidden?: boolean;
    panes: Array<{ plugin?: string }>;
  }>;
};

/** Each plugin window's place in the stacking order, its focus and the drawer, by plugin. */
const stack = (page: Page) =>
  page.evaluate(async () => {
    const desk = (await window.__shell.desk.runtime.commands.run("desk.windows.list")) as Listed;
    const out: Record<string, { z?: number; focused: boolean; hidden: boolean }> = {};
    for (const w of desk.windows) {
      const plugin = w.panes.find((pane) => pane.plugin)?.plugin;
      if (plugin) out[plugin] = { z: w.z, focused: w.focused === true, hidden: w.hidden === true };
    }
    return out;
  });

const windowOf = (page: Page, plugin: string) => page.locator(`.surface[data-surface="${plugin}"]`);
const tileOf = (page: Page, plugin: string) =>
  page.frameLocator('[data-surface="endue.dock"] iframe').locator(`[data-plugin="${plugin}"]`);

test.beforeEach(async ({ page }) => {
  await openShell(page, "?lang=en&plugins=1&dock=1");
  // The sample profiles turn the dock off; Default keeps it on.
  await page.evaluate(() =>
    window.__shell.desk.runtime.commands.run("desk.profiles.switch", { id: "default" }),
  );
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "true");
  await expect(windowOf(page, COUNTER)).toHaveCount(1);
});

test("a tile brings its window forward, and puts its plugin away once that window is in front", async ({
  page,
}) => {
  // Hello's window is above Counter's.
  const before = await stack(page);
  expect(before[HELLO]?.z).toBeGreaterThan(before[COUNTER]?.z ?? 0);

  await tileOf(page, COUNTER).click();
  await expect
    .poll(async () => {
      const now = await stack(page);
      return [now[COUNTER]?.focused, (now[COUNTER]?.z ?? 0) > (now[HELLO]?.z ?? 0)];
    })
    .toEqual([true, true]);
  await expect(windowOf(page, COUNTER)).toHaveCount(1);
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "true");

  // In front now: the same tile puts the plugin away, and the next brings it back.
  await tileOf(page, COUNTER).click();
  await expect(windowOf(page, COUNTER)).toHaveCount(0);
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "false");
  await tileOf(page, COUNTER).click();
  await expect(windowOf(page, COUNTER)).toHaveCount(1);
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "true");
});

test("a tile brings its window back from the drawer", async ({ page }) => {
  await windowOf(page, COUNTER).getByRole("button", { name: "Put in drawer" }).click();
  await expect.poll(async () => (await stack(page))[COUNTER]?.hidden).toBe(true);
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "true");

  await tileOf(page, COUNTER).click();
  await expect
    .poll(async () => {
      const now = (await stack(page))[COUNTER];
      return [now?.hidden, now?.focused];
    })
    .toEqual([false, true]);
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "true");
});

test("a tile of a plugin whose window was closed puts the plugin away, as before", async ({
  page,
}) => {
  await windowOf(page, COUNTER).getByRole("button", { name: "Close", exact: true }).click();
  await expect(windowOf(page, COUNTER)).toHaveCount(0);
  // Closing a window leaves its plugin on (ADR 0040): the tile is still pressed.
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "true");
  await tileOf(page, COUNTER).click();
  await expect(tileOf(page, COUNTER)).toHaveAttribute("aria-pressed", "false");
  await tileOf(page, COUNTER).click();
  await expect(windowOf(page, COUNTER)).toHaveCount(1);
});
