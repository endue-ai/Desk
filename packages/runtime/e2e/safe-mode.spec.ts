// Safe mode, quarantine and the state files kept broken (ADR 0061), on the stubs: safe-mode.html
// mounts the shell as a start that found something, and keeps the core's store in localStorage so a
// reload is one more desk start.
import { expect, type Page, test } from "@playwright/test";
import { DESK } from "./shell-helpers";

test.use({ viewport: DESK });

interface SafePage {
  desk: { ready: Promise<void> };
  page: { relaunched: number };
  core: { opened(): Array<{ target: string; reveal: boolean }> };
  store: { get(key: string): unknown };
}

const THROWS = "test.throws";

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/safe-mode.html?lang=en&${query}`);
  await page.waitForFunction(() => "__safe" in window);
  await page.evaluate(() => (window as unknown as { __safe: SafePage }).__safe.desk.ready);
}

const stored = (page: Page, key: string) =>
  page.evaluate((k) => (window as unknown as { __safe: SafePage }).__safe.store.get(k), key);
const reveals = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __safe: SafePage }).__safe.core
      .opened()
      .filter((o) => o.reveal)
      .map((o) => o.target),
  );
const status = (page: Page) => page.locator("footer.desk-status");
const action = (page: Page, label: string) =>
  status(page).locator(".desk-status-action", { hasText: label });
const surface = (page: Page, id: string) => page.locator(`.desk-surface[data-surface="${id}"]`);

test("safe mode: a badge with Start normally, and only the desk's own policies run", async ({
  page,
}) => {
  await open(page, "safe=asked&held=desk.palette");
  const badge = page.locator('[data-layer="system"] .safe-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Safe mode");
  await expect(surface(page, "desk.palette")).toHaveCount(0);
  await expect(status(page).locator(".desk-status-action")).toHaveCount(0);

  await badge.getByRole("button", { name: "Start normally" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __safe: SafePage }).__safe.page.relaunched === 1,
  );
});

test("a crash-loop start names the plugins it held off", async ({ page }) => {
  await open(page, "safe=crash-loop&held=endue.notes,endue.terminal");
  await expect(status(page)).toContainText("The desk started in safe mode");
  await expect(status(page)).toContainText("endue.notes, endue.terminal");
  await expect(action(page, "Start normally")).toBeVisible();
});

test("each state file kept broken gets one notice, and Show in file manager reveals it", async ({
  page,
}) => {
  await open(page, "broken=store.json,plugins.json");
  await expect(status(page)).toContainText("plugins.json could not be read");
  await action(page, "Show in file manager").click();
  await expect(status(page)).toContainText("store.json could not be read");
  await action(page, "Show in file manager").click();
  await expect(status(page).locator(".desk-status-action")).toHaveCount(0);
  expect(await reveals(page)).toEqual(["/data/plugins.json.broken", "/data/store.json.broken"]);
});

test("a session that fails to restore starts an empty desk and says so", async ({ page }) => {
  await open(page, "session=torn");
  await expect(status(page)).toContainText("The saved session could not be read");
  expect(await stored(page, "session.broken")).toEqual({ version: 1, files: "torn" });
  // The torn record is gone from `session`: the empty desk may have saved its own by now.
  expect(await stored(page, "session")).not.toEqual({ version: 1, files: "torn" });
  await action(page, "Show in file manager").click();
  expect(await reveals(page)).toEqual(["/data/store.json"]);
});

/** Load the page as one more desk start and wait until test.throws's failure is counted. */
async function failingStart(page: Page, starts: number): Promise<void> {
  if (starts === 1) await open(page, "throws=1");
  else {
    await page.reload();
    await page.waitForFunction(() => "__safe" in window);
  }
  await page.waitForFunction(
    ([id, n]) => {
      const store = (window as unknown as { __safe: SafePage }).__safe.store;
      const failures = store.get("plugins.failures") as Record<string, { starts: number }>;
      const quarantined = (store.get("plugins.quarantined") ?? []) as unknown[];
      return failures?.[id]?.starts === n || (n === 3 && quarantined.length === 1);
    },
    [THROWS, starts] as const,
  );
}

test("a frame that fails three starts in a row is quarantined, and stays off", async ({ page }) => {
  await failingStart(page, 1);
  await expect(status(page).locator(".desk-status-action")).toHaveCount(0);
  await failingStart(page, 2);
  await failingStart(page, 3);
  await expect(status(page)).toContainText("Throws is off: it failed to start three times");
  await expect(action(page, "Turn on again")).toBeVisible();
  await expect(surface(page, THROWS)).toHaveCount(0);
  expect(await stored(page, "plugins.quarantined")).toEqual([
    expect.objectContaining({ id: THROWS, version: "0.1.0" }),
  ]);

  // The next start holds it off, quietly.
  await page.reload();
  await page.waitForFunction(() => "__safe" in window);
  await page.evaluate(() => (window as unknown as { __safe: SafePage }).__safe.desk.ready);
  await expect(surface(page, THROWS)).toHaveCount(0);
  await expect(status(page).locator(".desk-status-action")).toHaveCount(0);
});

test("Turn on again lets the plugin go and mounts it again", async ({ page }) => {
  for (const start of [1, 2, 3]) await failingStart(page, start);
  await action(page, "Turn on again").click();
  await expect(surface(page, THROWS)).toHaveCount(1);
  await page.waitForFunction(
    () =>
      (
        (window as unknown as { __safe: SafePage }).__safe.store.get("plugins.quarantined") as
          | unknown[]
          | undefined
      )?.length === 0,
  );
});
