import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });
const images = (page: Page) =>
  page.frameLocator('.desk-surface[data-surface="endue.images"] iframe');
const explorer = (page: Page) =>
  page.frameLocator('.desk-surface[data-surface="endue.explorer"] iframe');
const viewer = (page: Page) => page.locator('section.surface[data-surface="endue.images"]');
const run = (page: Page, id: string, args?: unknown) =>
  page.evaluate(
    ([id, args]) => window.__shell.desk.runtime.commands.run(id as string, args),
    [id, args],
  );
async function shown(page: Page, name: string) {
  await expect(viewer(page)).toBeVisible();
  await expect(images(page).locator("#name")).toHaveText(name);
  await expect
    .poll(() =>
      images(page)
        .locator("#pane-a img")
        .evaluate(
          (img: HTMLImageElement) =>
            img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0,
        ),
    )
    .toBe(true);
}
test.beforeEach(async ({ page }) => {
  await openShell(page, "?files=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
});
test("renders JPEG and PNG through the actual image viewer", async ({ page }) => {
  await run(page, "desk.files.open", { path: "~/Documents/photo.jpg" });
  await shown(page, "photo.jpg");
  await run(page, "desk.files.open", { path: "~/Documents/picture.png" });
  await shown(page, "picture.png");
});
test("a tree click opens Images from off, and opens it again after its window closes", async ({
  page,
}) => {
  await run(page, "desk.plugins.open", { plugin: "endue.explorer" });
  await expect(viewer(page)).toHaveCount(0);
  await explorer(page)
    .getByRole("treeitem", { name: /photo.jpg/ })
    .click();
  await shown(page, "photo.jpg");
  await viewer(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);
  await explorer(page)
    .getByRole("treeitem", { name: /picture.png/ })
    .click();
  await shown(page, "picture.png");
});
test("opening an existing image brings its window out of the drawer", async ({ page }) => {
  await run(page, "desk.files.open", { path: "~/Documents/photo.jpg" });
  await shown(page, "photo.jpg");
  await viewer(page).getByRole("button", { name: "Put in drawer", exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);
  await run(page, "desk.files.open", { path: "~/Documents/photo.jpg" });
  await shown(page, "photo.jpg");
});
test("opening another image brings the viewer out of the drawer before reading it", async ({
  page,
}) => {
  await run(page, "desk.files.open", { path: "~/Documents/photo.jpg" });
  await shown(page, "photo.jpg");
  await viewer(page).getByRole("button", { name: "Put in drawer", exact: true }).click();
  await expect(viewer(page)).toHaveCount(0);
  await run(page, "desk.files.open", { path: "~/Documents/picture.png" });
  await shown(page, "picture.png");
  await run(page, "desk.files.open", { path: "~/Documents/photo.jpg" });
  await shown(page, "photo.jpg");
});
