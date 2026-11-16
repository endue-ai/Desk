// The real Explorer frame selects several rows and finds files by name (#313): Shift+End and a
// Shift-click select a range, Mod+A every row, the count is said in the status region, the filter
// narrows the folder as the person types, and a search below lists a file with its folder, which
// Enter opens and reveal shows in the tree. Paste and nested folders need a disk with folders and
// fs.copy, which the fixture's three images do not have; the plugin's tests run them over the
// runtime's file tree stub.
import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const ID = "endue.explorer";
const frame = (page: Page) => page.frameLocator(`.desk-surface[data-surface="${ID}"] iframe`);
const row = (page: Page, name: RegExp) => frame(page).getByRole("treeitem", { name });
const selected = (page: Page) => frame(page).locator("[role=treeitem][aria-selected=true]");

test.beforeEach(async ({ page }) => {
  await openShell(page, "?files=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await page.evaluate(
    (id) => window.__shell.desk.runtime.commands.run("desk.plugins.open", { plugin: id }),
    ID,
  );
  await expect(row(page, /picture\.png/)).toBeVisible();
});

test("Shift+End, a Shift-click and Mod+A select several rows and say how many", async ({
  page,
}) => {
  const tree = frame(page).locator("#tree");
  await expect(tree).toHaveAttribute("aria-multiselectable", "true");
  await tree.focus();
  await tree.press("Home");
  await tree.press("ArrowDown");
  await expect(row(page, /grey\.jpg/)).toHaveAttribute("aria-selected", "true");
  await tree.press("Shift+End");
  await expect(selected(page)).toHaveCount(3);
  await expect(frame(page).getByRole("status")).toHaveText("3 selected");

  await tree.press("ArrowUp");
  await expect(selected(page)).toHaveCount(1);
  await row(page, /grey\.jpg/).click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(2);
  await expect(frame(page).getByRole("status")).toHaveText("2 selected");

  await tree.press("ControlOrMeta+a");
  await expect(selected(page)).toHaveCount(4);
  await expect(frame(page).getByRole("status")).toHaveText("4 selected");
});

test("the filter narrows the folder as the person types; search below finds and reveals", async ({
  page,
}) => {
  const tree = frame(page).locator("#tree");
  await tree.focus();
  await tree.press("ControlOrMeta+f");
  const query = frame(page).getByRole("searchbox", { name: "Filter this folder" });
  await expect(query).toBeFocused();
  await query.pressSequentially("ph");
  await expect(frame(page).getByRole("treeitem")).toHaveCount(2);
  await expect(row(page, /photo\.jpg/)).toBeVisible();

  await frame(page).getByRole("button", { name: "Search below" }).click();
  await query.fill("pic");
  await query.press("Enter");
  const found = frame(page).getByRole("option", { name: /picture\.png/ });
  await expect(found).toContainText("~/Documents");
  await expect(frame(page).getByRole("status")).toHaveText("1 found below Documents.");

  await frame(page).getByRole("button", { name: "Show picture.png in its folder" }).click();
  await expect(frame(page).locator("#find")).toBeHidden();
  await expect(frame(page).getByRole("treeitem")).toHaveCount(4);
  await expect(row(page, /picture\.png/)).toHaveAttribute("aria-selected", "true");
});
