// Several images side by side, each in a window of its own (ADR 0212, #259): the real Images frames
// over the file viewers' fixtures (?files=1). Each window shows its own image and is drawn again on
// its own; opening an open image brings its window forward; closing one leaves the others.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const PHOTO = "~/Documents/photo.jpg";
const PICTURE = "~/Documents/picture.png";
const GREY = "~/Documents/grey.jpg";
/** The three windows' keys, in the order their images open, and the image each shows. */
const OPENED: Array<[string, string, string]> = [
  ["endue.images", PHOTO, "photo.jpg"],
  ["endue.images@2", PICTURE, "picture.png"],
  ["endue.images@3", GREY, "grey.jpg"],
];

const windowOf = (page: Page, key: string) =>
  page.locator(`section.surface[data-surface="${key}"]`);
const imageWindows = (page: Page) => page.locator('section.surface[data-surface^="endue.images"]');
const frame = (page: Page, key: string) =>
  page.frameLocator(`.desk-surface[data-surface="${key}"] iframe`);
const run = (page: Page, id: string, args?: unknown) =>
  page.evaluate(
    ([id, args]) => window.__shell.desk.runtime.commands.run(id as string, args),
    [id, args],
  );

/** What window `key` draws once its image is decoded: its name and the image's size. */
async function drawn(page: Page, key: string) {
  const img = frame(page, key).locator("#pane-a img");
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  return {
    name: await frame(page, key).locator("#name").textContent(),
    size: await img.evaluate((i: HTMLImageElement) => `${i.naturalWidth}x${i.naturalHeight}`),
  };
}

async function openThree(page: Page) {
  for (const [, path] of OPENED) await run(page, "desk.files.open", { path });
  for (const [key, , name] of OPENED) {
    await expect(windowOf(page, key)).toBeVisible();
    await expect(frame(page, key).locator("#name")).toHaveText(name);
  }
}

test.beforeEach(async ({ page }) => {
  await openShell(page, "?files=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
});

test("three images open in three windows, each showing its own", async ({ page }) => {
  await openThree(page);
  await expect(imageWindows(page)).toHaveCount(3);
  const sizes = await Promise.all(OPENED.map(([key]) => drawn(page, key)));
  expect(sizes).toEqual([
    { name: "photo.jpg", size: "16x12" },
    // Its EXIF orientation turns it a quarter.
    { name: "picture.png", size: "48x64" },
    { name: "grey.jpg", size: "128x96" },
  ]);
});

test("opening an open image brings its window forward instead of opening another", async ({
  page,
}) => {
  await openThree(page);
  await expect(windowOf(page, "endue.images@3")).toHaveClass(/is-focused/);
  await run(page, "desk.files.open", { path: PHOTO });
  await expect(windowOf(page, "endue.images")).toHaveClass(/is-focused/);
  await expect(windowOf(page, "endue.images@3")).not.toHaveClass(/is-focused/);
  await expect(imageWindows(page)).toHaveCount(3);
});

test("an image that changed on disk is drawn again in its own window only", async ({ page }) => {
  await openThree(page);
  const before = await Promise.all(OPENED.map(([key]) => drawn(page, key)));
  // picture.png now holds grey.jpg's bytes, as if another app saved over it.
  await page.evaluate(
    ({ to, from }) => {
      const files = window.__shell.files;
      files[to] = files[from] ?? "";
    },
    { to: PICTURE, from: GREY },
  );
  await run(page, "desk.files.changed", { path: PICTURE });
  await expect.poll(async () => (await drawn(page, "endue.images@2")).size).toBe("128x96");
  expect(await drawn(page, "endue.images")).toEqual(before[0]);
  expect(await drawn(page, "endue.images@3")).toEqual(before[2]);
});

test("walking a window's folder shows the next image in that window only", async ({ page }) => {
  // The folder in natural order: grey.jpg, photo.jpg, picture.png.
  await run(page, "desk.files.open", { path: GREY });
  await run(page, "desk.files.open", { path: PICTURE });
  await expect(frame(page, "endue.images@2").locator("#name")).toHaveText("picture.png");
  await frame(page, "endue.images@2").locator("#previous").click();
  await expect(frame(page, "endue.images@2").locator("#name")).toHaveText("photo.jpg");
  await expect(frame(page, "endue.images").locator("#name")).toHaveText("grey.jpg");
  await expect(imageWindows(page)).toHaveCount(2);
});

test("closing one image's window leaves the others, and the image opens again in a new one", async ({
  page,
}) => {
  await openThree(page);
  await windowOf(page, "endue.images@2")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(windowOf(page, "endue.images@2")).toHaveCount(0);
  await expect(imageWindows(page)).toHaveCount(2);
  await expect(frame(page, "endue.images").locator("#name")).toHaveText("photo.jpg");
  await expect(frame(page, "endue.images@3").locator("#name")).toHaveText("grey.jpg");
  // A window's number is never used again in a session: its host's page is always its own.
  await run(page, "desk.files.open", { path: PICTURE });
  await expect(frame(page, "endue.images@4").locator("#name")).toHaveText("picture.png");
  await expect(imageWindows(page)).toHaveCount(3);
});
