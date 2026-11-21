import { expect, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

// The notification centre (#307): what the desk said, kept in a panel the control beside the status
// line opens, and Mod+Shift+N too. Notices are grouped by day, an action runs from the panel, one
// is dismissed, all are cleared, do not disturb is in its header, and opening it reads them.
test.use({ viewport: DESK });

test("the notification centre holds what the desk said", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.evaluate(() => {
    const { runtime } = window.__shell.desk;
    const pings = { count: 0 };
    Object.assign(window, { pings });
    runtime.commands.define("test.ping", {
      title: "Ping",
      owner: "desk",
      run: () => void pings.count++,
    });
    runtime.notify({ caller: "desk", title: "Saved notes.md", level: "success" });
    runtime.notify({
      caller: "desk",
      title: "The upload stopped",
      body: "The server is away.",
      level: "warning",
      actions: [{ label: "Retry", command: "test.ping" }],
    });
  });

  // The control sits right after the status line, at the top centre, and counts them.
  const bell = page.locator(".desk-status + .desk-notify-bell");
  await expect(bell).toHaveAttribute("aria-label", "Notifications, 2 unread");
  await expect(bell.locator(".desk-notify-count")).toHaveText("2");
  const [line, control] = await Promise.all([
    page.locator(".desk-status").boundingBox(),
    bell.boundingBox(),
  ]);
  expect(control && line && control.x >= line.x + line.width).toBe(true);
  expect(control && control.y < 60).toBe(true);

  await page.keyboard.press("Meta+Shift+n");
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel).toBeVisible();
  await expect(bell).toHaveAttribute("aria-label", "Notifications");
  await expect(bell.locator(".desk-notify-count")).toBeHidden();
  await expect(panel.locator('[aria-live="polite"]')).toHaveText("2 notifications");
  const today = panel.getByRole("list", { name: "Today" });
  await expect(today.getByRole("listitem")).toHaveCount(2);
  await expect(today.getByRole("listitem").first()).toContainText("The upload stopped");
  await expect(today.getByRole("listitem").first()).toContainText("endue");
  await expect(page.getByRole("list", { name: "Earlier" })).toHaveCount(0);

  // An action runs from the history, the panel staying open.
  await today.getByRole("button", { name: "Retry" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as { pings?: { count: number } }).pings?.count))
    .toBe(1);
  await expect(panel).toBeVisible();

  // Dismiss takes out one row.
  const saved = today.getByRole("listitem").filter({ hasText: "Saved notes.md" });
  await saved.getByRole("button", { name: "Dismiss" }).click();
  await expect(today.getByRole("listitem")).toHaveCount(1);
  await expect(panel.locator('[aria-live="polite"]')).toHaveText("1 notification");

  // Do not disturb, in the header.
  const dnd = panel.getByRole("switch", { name: "Do not disturb" });
  await expect(dnd).toHaveAttribute("aria-checked", "false");
  await dnd.click();
  await expect(dnd).toHaveAttribute("aria-checked", "true");
  expect(
    await page.evaluate(() => window.__shell.desk.runtime.settings.get("desk.notify.dnd")),
  ).toBe(true);
  await dnd.click();
  await expect(dnd).toHaveAttribute("aria-checked", "false");

  // Clear all, and the panel says it is empty.
  await panel.getByRole("button", { name: "Clear all" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
  await expect(panel.locator(".desk-notify-empty")).toContainText("No notifications");

  // Escape closes it; the focus goes back to the control. The count stays at 0 until a new one.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();
  await expect(bell.locator(".desk-notify-count")).toBeHidden();
  await page.evaluate(() =>
    window.__shell.desk.runtime.notify({ caller: "desk", title: "Synced", level: "info" }),
  );
  await expect(bell).toHaveAttribute("aria-label", "Notifications, 1 unread");
  // The control opens it too.
  await bell.click();
  await expect(panel).toBeVisible();
  await expect(bell.locator(".desk-notify-count")).toBeHidden();
});
