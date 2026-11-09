// The talk line moves where the person drags it (desk.shell.talk-place): folded by the pill itself,
// open by its grip; it stays inside the app as it grows, keeps its place across a reload, and a
// double-click on the grip puts it back on the bottom edge.
import { expect, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

test.use({ viewport: DESK });

/** Press at (x, y), move by (dx, dy) in steps, and let go. */
async function drag(
  page: import("@playwright/test").Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test("the folded pill moves where it is dropped, stays there across a reload, and does not open", async ({
  page,
}) => {
  await openShell(page, "?lang=en&persist=1");
  await page.evaluate(() => localStorage.clear());
  await openShell(page, "?lang=en&persist=1");
  const pill = page.locator(".talk-pill");
  const home = await pill.boundingBox();
  if (!home) throw new Error("no pill");
  // From the bottom centre to the upper right.
  await drag(page, home.x + 40, home.y + 24, 420, -560);
  await expect(pill).toHaveClass(/is-placed/);
  await expect(pill).not.toHaveClass(/is-open/);
  await page.mouse.move(700, 600);
  await expect(pill).toHaveAttribute("data-state", "idle");
  const moved = await pill.boundingBox();
  if (!moved) throw new Error("no pill");
  expect(Math.round(moved.x + moved.width / 2)).toBe(Math.round(home.x + home.width / 2 + 420));
  expect(Math.round(moved.y + moved.height)).toBe(Math.round(home.y + home.height - 560));
  const stored = await page.evaluate(() =>
    window.__shell.desk.runtime.settings.get("desk.shell.talk-place"),
  );
  expect(stored).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  // High up, its lists open below it.
  await expect(pill).toHaveClass(/is-high/);
  await page.reload();
  await page.waitForFunction(() => window.__shell !== undefined);
  await page.evaluate(() => window.__shell.desk.ready);
  expect(await pill.boundingBox()).toEqual(moved);
});

test("near an edge it grows inwards; open, the grip moves it and a double-click puts it back", async ({
  page,
}) => {
  await openShell(page, "?lang=en");
  const pill = page.locator(".talk-pill");
  const home = await pill.boundingBox();
  if (!home) throw new Error("no pill");
  // Dropped past the right edge: it stays 8 px inside, and grows leftwards on hover.
  await drag(page, home.x + 40, home.y + 24, 1000, -300);
  await page.mouse.move(700, 500);
  const folded = await pill.boundingBox();
  expect(folded && Math.round(folded.x + folded.width)).toBe(DESK.width - 8);
  await page.getByRole("button", { name: "Talk to Eris", exact: true }).click();
  await step(page, 240);
  await expect(pill).toHaveAttribute("data-state", "edit");
  const open = await pill.boundingBox();
  expect(open && Math.round(open.x + open.width)).toBe(DESK.width - 8);
  // Pressing the text line types; the grip moves the open pill.
  const before = await pill.boundingBox();
  const input = await page.locator(".composer-input").boundingBox();
  if (!input || !before) throw new Error("no input");
  await drag(page, input.x + 20, input.y + 5, -200, -200);
  expect(await pill.boundingBox()).toEqual(before);
  const grip = await page.locator(".talk-grip").boundingBox();
  if (!grip) throw new Error("no grip");
  await drag(page, grip.x + 4, grip.y + 6, -300, -200);
  await expect(pill).toHaveAttribute("data-state", "edit");
  const lifted = await pill.boundingBox();
  expect(lifted && Math.round(lifted.y)).toBe(Math.round(before.y - 200));
  await page.locator(".talk-grip").dblclick();
  await expect(pill).not.toHaveClass(/is-placed/);
  await page.keyboard.press("Escape");
  await expect(pill).toHaveAttribute("data-state", "idle");
  expect(await pill.boundingBox()).toEqual(home);
});
