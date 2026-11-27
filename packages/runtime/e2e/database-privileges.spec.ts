import { expect, type Frame, type Page, test } from "@playwright/test";

// Roles and privileges in endue.database (plugins/database/ui/features/privileges/) on the
// fixture's scripted PostgreSQL connection `fixture-pg` (answered by privileges-fixture.ts): `p` on a
// table opens its privileges as a matrix whose cells name their grantors, a pressed cell is counted
// for review, and its dialog shows the exact GRANT and runs it; and a new role's password is typed in a field that
// hides it while the script shows a mask, left with Escape.
const SURFACE = '[data-surface="endue.database"]';
const LARGE = { width: 898, height: 558 };

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

const iframe = (page: Page) => page.locator(`${SURFACE} iframe`);

/** Open the fixture page and endue.database; resolves with its frame. */
async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  await expect(iframe(page)).toBeVisible();
  await iframe(page).evaluate((el, { width, height }) => {
    el.style.cssText += `;width:${width}px!important;height:${height}px!important`;
  }, LARGE);
  const frame = await (await iframe(page).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").nth(1)).toContainText("fixture-pg");
  return frame;
}

/** Open the explorer's rows one after the other by their exact labels, leaving the last selected. */
async function reach(page: Page, frame: Frame, ...labels: string[]) {
  for (const [i, label] of labels.entries()) {
    const row = frame.locator("#tree [role=treeitem]", {
      has: frame.locator(".label", { hasText: new RegExp(`^${label}$`, "u") }),
    });
    await expect(row.first()).toBeVisible();
    await row.first().click();
    if (i < labels.length - 1) await page.keyboard.press("ArrowRight");
  }
}

test("p opens a table's privileges; a pressed cell is reviewed as the exact GRANT", async ({
  page,
}) => {
  const frame = await open(page);
  await reach(page, frame, "fixture-pg", "public", "Tables", "orders");
  await page.keyboard.press("p");
  const panel = frame.locator(".privileges");
  await expect(panel.locator('[data-tab="object"]')).toHaveAttribute("aria-selected", "true");
  const reports = panel.locator(
    'tr[data-grantee="reports"][data-column=""] [data-privilege="SELECT"]',
  );
  await expect(reports).toHaveAttribute("data-state", "option");
  await expect(reports).toHaveAttribute(
    "aria-label",
    "SELECT to reports: granted with grant option; granted by app (with grant option)",
  );
  const ana = panel.locator('tr[data-grantee="ana"][data-column=""] [data-privilege="SELECT"]');
  await expect(ana).toHaveAttribute("data-state", "none");
  await ana.click();
  await expect(ana).toHaveAttribute("data-state", "granted");
  await expect(ana).toHaveClass(/pending/u);
  const review = panel.locator('[data-focus="review"]');
  await expect(review).toHaveText("Review 1 change…");
  await review.click();
  const dialog = frame.locator("form.privileges-change");
  await expect(dialog.locator("h2")).toHaveText("Change the privileges of table public.orders");
  await expect(dialog.locator(".privileges-script")).toHaveText(
    'GRANT SELECT ON TABLE "public"."orders" TO "ana";',
  );
  await dialog.getByRole("button", { name: "Grant" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(frame.locator("#status")).toHaveText("Ran 1 statement on fixture-pg.");
  // Read again from the server, whose scripted ACL keeps what it had.
  await expect(ana).toHaveAttribute("data-state", "none");
  await expect(review).toHaveText("Review changes…");
});

test("a new role's password is typed in a field that hides it, and the script shows a mask", async ({
  page,
}) => {
  const frame = await open(page);
  // Escape cancels the command: its rejection is the answer, not a failure. The call is awaited
  // before the test ends, so it never outlives the page ("page.evaluate: Test ended").
  const created = page.evaluate(() =>
    window.__desk.runtime.commands
      .run("endue.database.create-role", { connection: "fixture-pg", name: "zoe", login: true })
      .catch(() => {}),
  );
  const dialog = frame.locator("form.privileges-change");
  await expect(dialog.locator("h2")).toHaveText("Create a role");
  const password = dialog.locator('input[name="password"]');
  await expect(password).toHaveAttribute("type", "password");
  await password.fill("fixture secret");
  const script = dialog.locator(".privileges-script");
  await expect(script).toHaveText(`CREATE ROLE "zoe" WITH LOGIN PASSWORD '••••••••';`);
  await expect(dialog).not.toContainText("fixture secret");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await created;
});
