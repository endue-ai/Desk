import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Plugin frames do not inherit shell CSS. Exercise each affected stylesheet in its own document.
for (const plugin of ["images", "player", "permissions", "web", "eris"]) {
  test(`${plugin}: actions use a pointer, disabled controls do not, text stays selectable`, async ({
    page,
  }) => {
    const css = readFileSync(
      new URL(`../../../plugins/${plugin}/ui/style.css`, import.meta.url),
      "utf8",
    );
    await page.setContent(
      '<button class="send">Action</button><select><option>Choice</option></select><input type="text">',
    );
    await page.addStyleTag({ content: css });
    const button = page.getByRole("button");
    await expect(button).toHaveCSS("cursor", "pointer");
    await expect(page.locator("select")).toHaveCSS("cursor", "pointer");
    // WebKit reports its native text-field cursor as auto; it must not inherit pointer.
    await expect(page.locator("input")).toHaveCSS("cursor", /^(auto|text)$/);
    await page.locator("input").fill("Still editable");
    await expect(page.locator("input")).toHaveValue("Still editable");
    await button.evaluate((el: HTMLButtonElement) => {
      el.disabled = true;
    });
    await expect(button).toHaveCSS("cursor", "not-allowed");
  });
}
