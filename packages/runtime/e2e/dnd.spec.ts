// Drag and drop between plugin frames (ADR 0119), in the real Explorer and Notes frames of the shell
// page, under the app's plugin CSP: the desk draws the drag image above every frame, the frame under
// the pointer marks where it would land, and the drop reaches that frame alone.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const frame = (page: Page, id: string) =>
  page.frameLocator(`.desk-surface[data-surface="${id}"] iframe`);
const run = (page: Page, id: string, args?: unknown) =>
  page.evaluate(
    ([id, args]) => window.__shell.desk.runtime.commands.run(id as string, args),
    [id, args],
  );
const image = (page: Page) => page.locator(".desk-dnd-image");
const opened = (page: Page) =>
  page.evaluate(() =>
    window.__shell.stub.log
      .filter(({ request }) => request.method === "fs.read" || request.method === "fs.url")
      .map(({ caller, request }) => `${caller}:${(request.params as { path: string }).path}`),
  );

/** The middle of an element on the page, frames' offsets included. */
async function middle(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await openShell(page, "?files=1&apps=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await run(page, "desk.plugins.open", { plugin: "endue.explorer" });
  await run(page, "desk.plugins.open", { plugin: "endue.notes" });
  await expect(frame(page, "endue.notes").locator("#note-name")).toHaveText("No note open");
});

test("a file dragged from the Explorer to Notes is offered, marked and dropped there", async ({
  page,
}) => {
  const row = frame(page, "endue.explorer").getByRole("treeitem", { name: /photo\.jpg/ });
  const notes = frame(page, "endue.notes").locator("main");
  const from = await middle(row);
  const to = await middle(notes);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Under the threshold a press is still a click: no drag yet.
  await page.mouse.move(from.x + 2, from.y + 1);
  await expect(image(page)).toHaveCount(0);
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
  await expect(image(page)).toBeVisible();
  await expect(image(page)).toContainText("photo.jpg");
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // Notes, with no note open, would open the file: it marks its page with the effect, link.
  await expect(notes).toHaveAttribute("data-desk-drop", "link");
  await expect(image(page)).toHaveAttribute("data-effect", "link");
  await page.mouse.up();
  await expect(image(page)).toHaveCount(0);
  await expect(notes).not.toHaveAttribute("data-desk-drop");
  // The drop handed over the path; the file opened in the plugin the desk names for it.
  await expect.poll(() => opened(page)).toContain("endue.images:~/Documents/photo.jpg");
  await expect(frame(page, "endue.images").locator("#name")).toHaveText("photo.jpg");
});

test("Escape cancels a drag between frames: nothing is dropped", async ({ page }) => {
  const row = frame(page, "endue.explorer").getByRole("treeitem", { name: /picture\.png/ });
  const notes = frame(page, "endue.notes").locator("main");
  const from = await middle(row);
  const to = await middle(notes);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect(notes).toHaveAttribute("data-desk-drop", "link");
  await page.keyboard.press("Escape");
  await expect(image(page)).toHaveCount(0);
  await expect(notes).not.toHaveAttribute("data-desk-drop");
  await page.mouse.up();
  await expect.poll(() => opened(page)).not.toContain("endue.images:~/Documents/picture.png");
});

test("a click on a row still opens the file and never starts a drag", async ({ page }) => {
  await frame(page, "endue.explorer")
    .getByRole("treeitem", { name: /photo\.jpg/ })
    .click();
  await expect(image(page)).toHaveCount(0);
  await expect(frame(page, "endue.images").locator("#name")).toHaveText("photo.jpg");
});
