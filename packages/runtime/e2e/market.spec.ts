import { expect, type Page, test } from "@playwright/test";

// Settings, Market (ADR 0107) on the views page, whose market answers this repository's market/views
// entries and two from a market that is not verified (fixture/market.ts). The page promises "What
// each would be allowed is shown first": Install asks before anything installs, and so does Remove.
// The views page draws Settings in Korean, the runtime's default.

async function openMarket(page: Page): Promise<void> {
  await page.goto("/views.html");
  await page.waitForFunction(() => window.__views !== undefined);
  await page.evaluate(() => window.__views.ready);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() => window.__desk.runtime.commands.run("desk.market.open"));
}

const installs = (page: Page) =>
  page.evaluate(
    () =>
      window.__desk.stub.log.filter((e) =>
        ["plugin.install", "plugin.remove"].includes(e.request.method),
      ).length,
  );

test("Install asks first, saying what it would be allowed; Remove asks too", async ({ page }) => {
  await openMarket(page);
  const entry = page.locator('.market-entry[data-entry="market.week-ahead"]');
  await expect(entry).toBeVisible();
  await entry.getByRole("button", { name: "설치", exact: true }).click();
  const asked = entry.getByRole("alertdialog");
  await expect(asked).toContainText("허락할 권한이 없습니다.");
  expect(await installs(page)).toBe(0);
  await asked.getByRole("button", { name: "취소" }).click();
  await expect(asked).toHaveCount(0);
  expect(await installs(page)).toBe(0);

  await entry.getByRole("button", { name: "설치", exact: true }).click();
  await entry.getByRole("alertdialog").getByRole("button", { name: "설치" }).click();
  await expect(entry).toContainText("설치됨");
  expect(await installs(page)).toBe(1);

  await entry.getByRole("button", { name: "제거" }).click();
  await expect(entry.getByRole("alertdialog")).toContainText("제거할까요?");
  expect(await installs(page)).toBe(1);
  await entry.getByRole("alertdialog").getByRole("button", { name: "제거" }).click();
  await expect(entry.getByRole("button", { name: "설치", exact: true })).toBeVisible();
  expect(await installs(page)).toBe(2);
});
