// Plugin surfaces as shell windows: the shell fixture with ?plugins=1 installs two UI test plugins,
// whose centre surfaces open inside the shell's windows (ADR 0040): slots, the drawer and the
// plugin's on/off. With ?many=18 there are twenty, and the windows the live budget leaves out sleep
// (ADR 0134). Dragging, resizing, snapping and maximizing are the window manager's (desk-wm on the
// compositor, ADR 0153): e2e/specs/windows-plugins.spec.ts drives them on the desk, and here the
// page asks its desk-wm for them (`fixture/wm.ts`). Which windows the budget keeps is desk-wm's to
// decide too (crates/desk-wm tests/host.rs, #83): this page names the set, the runtime carries it out.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });

const COUNTER = "test.counter";
const HELLO = "example.hello-ui";
const window_ = (page: Page, id = COUNTER) => page.locator(`section.surface[data-surface="${id}"]`);
const inner = (page: Page, id = COUNTER) => page.locator(`.desk-surface[data-surface="${id}"]`);
const frame = (page: Page, id = COUNTER) =>
  page.frameLocator(`.desk-surface[data-surface="${id}"] iframe`);

test.describe("plugin surfaces as shell windows", () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page, "?plugins=1&lang=en");
    await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  });

  test("a UI plugin's surface opens inside a shell window, in the slot beside the other", async ({
    page,
  }) => {
    await expect(window_(page)).toBeVisible();
    await expect(window_(page).locator(".surface-name")).toHaveText("Counter");
    await expect(window_(page).locator(`[data-pane][data-view="plugin:${COUNTER}"]`)).toHaveCount(
      1,
    );
    await expect(inner(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
    // Two unplaced windows take the first two slots under Eris: side by side, one size.
    await expect(window_(page)).toHaveCSS("left", "104px");
    await expect(window_(page)).toHaveCSS("top", "190px");
    await expect(window_(page, HELLO)).toHaveCSS("left", "497px");
    await expect(window_(page)).toHaveCSS("width", "381px");
    await expect(window_(page)).toHaveCSS("height", "261px");
    // The runtime's surfaces layer holds nothing but overlays: the window manager placed them.
    await expect(
      page.locator(".desk-surfaces > .desk-surface:not(.desk-surface--overlay)"),
    ).toHaveCount(0);
  });

  test("putting it in the drawer takes the frame away and raising it brings the plugin back", async ({
    page,
  }) => {
    await window_(page).locator('.tool[aria-label="Put in drawer"]').click();
    await expect(window_(page)).toHaveCount(0);
    await expect(page.locator(".drawer-button .badge")).toHaveText("4");
    await page.click(".drawer-button");
    await page.click(`[data-key="raise-surface-${COUNTER}"]`);
    await expect(window_(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
  });

  test("turning the plugin off removes its window and on brings it back", async ({ page }) => {
    await page.evaluate(
      (id) =>
        window.__shell.stub.emit({
          event: "plugin.changed",
          data: { plugin: id, change: "disabled", revision: 1 },
        }),
      COUNTER,
    );
    await expect(window_(page)).toHaveCount(0);
    // The other window stays where it was, at its size.
    await expect(window_(page, HELLO)).toHaveCSS("left", "497px");
    await expect(window_(page, HELLO)).toHaveCSS("width", "381px");
    await page.evaluate(
      (id) =>
        window.__shell.stub.emit({
          event: "plugin.changed",
          data: { plugin: id, change: "enabled", revision: 1 },
        }),
      COUNTER,
    );
    await expect(window_(page)).toBeVisible();
    await expect(frame(page).getByRole("button")).toBeVisible();
  });

  test("a plugin that opens one of its surfaces comes in front with the focus, from the drawer too", async ({
    page,
  }) => {
    // What the core sends the runtime when the permissions plugin raises its prompt (#17).
    const opened = (caller: string) =>
      page.evaluate(
        (id) =>
          window.__shell.stub.emit({
            event: "ui.surface.opened",
            data: { handle: "s-1", caller: id, surface: "main", placement: "center" },
          }),
        caller,
      );
    const z = (id: string) =>
      window_(page, id).evaluate((el) => Number(getComputedStyle(el).zIndex));
    await window_(page, HELLO).locator(".surface-name").click();
    await expect(window_(page, HELLO)).toHaveClass(/is-focused/);
    await opened(COUNTER);
    await expect(window_(page)).toHaveClass(/is-focused/);
    await expect(window_(page, HELLO)).not.toHaveClass(/is-focused/);
    expect(await z(COUNTER)).toBeGreaterThan(await z(HELLO));
    await window_(page).locator('.tool[aria-label="Put in drawer"]').click();
    await expect(window_(page)).toHaveCount(0);
    await opened(COUNTER);
    await expect(window_(page)).toHaveClass(/is-focused/);
    await expect(frame(page).getByRole("button")).toBeVisible();
  });

  test("Control+Tab reaches it and its window shows as focused", async ({ page }) => {
    await page.keyboard.press("Meta+n");
    await expect(page.locator('[data-surface="window-1"]')).toHaveClass(/is-focused/);
    await page.keyboard.press("Control+Tab");
    await step(page, 50);
    await expect(window_(page)).toHaveClass(/is-focused/);
    await expect(page.locator('[data-surface="window-1"]')).not.toHaveClass(/is-focused/);
    await page.keyboard.press("Control+Tab");
    await expect(window_(page, HELLO)).toHaveClass(/is-focused/);
  });
});

test.describe("the live budget (#37)", () => {
  // Counter, Hello and eighteen more Hello pages (test.many-1 … 18): twenty plugin windows.
  const MANY = 18;
  const many = Array.from({ length: MANY }, (_, i) => `test.many-${i + 1}`);
  const init = encodeURIComponent(JSON.stringify({ "desk.surfaces.live": 8 }));
  /** The windows the compositor's live budget would keep. */
  const keep = (page: Page, ids: string[]) =>
    page.evaluate((kept) => window.__shell.wm.keep(kept), ids);
  /** The plugin windows whose frame is on the page, sorted: an asleep one has a placeholder. */
  const live = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".desk-surface--windowed")]
        .filter((section) => section.querySelector("iframe[src]"))
        .map((section) => section.dataset.surface ?? "")
        .sort(),
    );
  const focus = (page: Page, id: string) =>
    page.evaluate((surface) => window.__shell.desk.runtime.focusSurface(surface), id);
  const asleep = (page: Page, id: string) => inner(page, id).locator(".desk-surface-placeholder");

  test.beforeEach(async ({ page }) => {
    await openShell(page, `?plugins=1&many=${MANY}&lang=en&init=${init}`);
    await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  });

  test("with 20 windows the ones the budget leaves out sleep, and one woken gets its count back", async ({
    page,
  }) => {
    await expect(page.locator(".desk-surface--windowed")).toHaveCount(20);
    // Hello counts to three; the count lives in what it gave through desk:state.
    await focus(page, HELLO);
    const hello = frame(page, HELLO);
    for (let i = 0; i < 3; i++) await hello.getByRole("button", { name: "Count" }).click();
    await expect(hello.getByTestId("count")).toHaveText("3");
    // Nine windows are focused after it and the ninth fills the app: the other nineteen are out of
    // sight, Hello the ninth most recent of them.
    const recent = many.slice(0, 9);
    for (const id of recent) await focus(page, id);
    const top = recent[8] ?? "";
    await page.evaluate((id) => window.__shell.wm.fill(id, "full"), top);
    await expect(window_(page, top)).toHaveCSS("width", "1440px");
    // The budget keeps the one in sight and the eight most recent out of sight; the rest sleep.
    await keep(page, recent);
    await expect.poll(() => live(page)).toEqual([...recent].sort());
    await expect(asleep(page, HELLO)).toHaveCount(1);
    await expect(asleep(page, COUNTER)).toHaveCount(1);
    await expect(asleep(page, "test.many-18")).toHaveCount(1);

    // Focusing Hello wakes it, under the window that fills the app, and hands its count back.
    await focus(page, HELLO);
    await expect(asleep(page, HELLO)).toHaveCount(0);
    await expect(hello.getByTestId("count")).toHaveText("3");
  });
});
