import { expect, type Page, test } from "@playwright/test";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const ID = "endue.image-studio";
const run = (page: Page, id: string, args?: Record<string, unknown>) =>
  page.evaluate(({ id, args }) => window.__shell.desk.runtime.commands.run(id, args), { id, args });

test("the studio edits a file in its sandboxed worker and adapts to themes at 360px", async ({
  page,
}) => {
  await openShell(page, "?files=1&imageStudio=1&lang=en");
  await run(page, "desk.plugins.open", { plugin: ID });
  const iframe = page.locator(`.desk-surface[data-surface="${ID}"] iframe`);
  const studio = iframe.contentFrame();
  const preview = studio.getByRole("img", { name: "Edited image preview" });
  const opened = (await run(page, `${ID}.open`, { path: "~/Documents/photo.jpg" })) as {
    document: string;
    revision: number;
  };
  expect(opened).toMatchObject({ width: 16, height: 12, revision: 0, dirty: false });
  await expect(preview).toHaveAttribute("width", "16");
  await run(page, `${ID}.apply`, {
    document: opened.document,
    revision: opened.revision,
    operations: [{ op: "rotate", degrees: 90 }],
  });
  await expect(preview).toHaveAttribute("width", "12");
  await expect(preview).toHaveAttribute("height", "16");
  await studio.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(preview).toHaveAttribute("width", "16");
  await expect(studio.getByRole("status")).toContainText("16 × 12 px");
  await iframe.evaluate((el) => {
    el.style.width = "360px";
  });
  const html = studio.locator("html");
  for (const [command, attribute, value] of [
    ["desk.theme.light", "data-scheme", "light"],
    ["desk.theme.dark", "data-scheme", "dark"],
    ["desk.theme.contrast", "data-contrast", "high"],
    ["desk.theme.motion", "data-motion", "reduce"],
  ] as const) {
    await run(page, command);
    await expect(html).toHaveAttribute(attribute, value);
    expect(await html.evaluate((el) => el.clientWidth)).toBe(360);
    expect(await html.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});
