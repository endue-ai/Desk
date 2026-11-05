import type { BridgeRequest } from "@endue-ai/bridge";
import { expect, type Frame, type Page, test } from "@playwright/test";
import { DESK, openShell, step } from "./shell-helpers";

// Say it, see it (#472, ADR 0102): Eris turns a sentence into a universal view previewed in
// desk.universal, and the view builder makes the same file by hand, on the views page's fixture items
// and files (views.html?propose=1, fixture/universal-files.ts) and from the shell's talk line
// (shell.html?views=1). The scripted brain answers as examples/brain-echo/universal.mjs does.
const UNIVERSAL = '[data-surface="desk.universal"]';
const PALETTE = '[data-surface="desk.palette"]';
const SENTENCE = "show this repo's issues as a board";
const ID = "eris.issues-board";

test.use({ timezoneId: "Asia/Seoul", locale: "en-US" });

async function load(page: Page): Promise<void> {
  await page.clock.setFixedTime("2026-10-30T09:00:00+09:00");
  await page.goto("/views.html?propose=1");
  await page.waitForFunction(() => window.__views !== undefined);
  await page.evaluate(() => window.__views.ready);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  for (const id of ["desk.propose", "desk.universal.preview", "desk.universal.build"])
    await expect
      .poll(() => page.evaluate((c) => window.__desk.runtime.commands.has(c), id))
      .toBe(true);
}

/** desk.universal's frame, once its surface shows. */
async function universalFrame(page: Page): Promise<Frame> {
  await expect(page.locator(UNIVERSAL)).toBeVisible();
  const frame = await (await page.locator(`${UNIVERSAL} iframe`).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no universal frame");
  return frame;
}

/** The view file `id` as the core's view.get answers it, or the error code. */
const fileOf = (page: Page, which: "__desk" | "__shell", id: string) =>
  page.evaluate(
    async ([handle, viewId]) => {
      const stub = handle === "__desk" ? window.__desk.stub : window.__shell.stub;
      const request = {
        id: 0,
        method: "view.get",
        params: { id: viewId, scope: { permission: "view:manage" } },
      } as BridgeRequest;
      const answer = await stub.call(request);
      return answer.ok
        ? (answer.result as { view: Record<string, unknown> }).view
        : (answer.error as { code: string }).code;
    },
    [which, id] as const,
  );

/** Run a palette command by its title. */
async function palette(page: Page, query: string, title: string): Promise<void> {
  await page.keyboard.press("Control+K");
  const frame = page.frameLocator(`${PALETTE} iframe`);
  await expect(frame.getByTestId("query")).toBeFocused();
  await page.keyboard.type(query);
  await expect(frame.getByRole("option").first()).toContainText(title);
  await page.keyboard.press("Enter");
}

test.describe("say it, see it", () => {
  test("Make with Eris… previews a universal board over the fixture tasks; Apply keeps the file and the drawn view, with Undo", async ({
    page,
  }) => {
    await load(page);
    await palette(page, "Make with Eris", "Make with Eris…");
    await expect(page.frameLocator(`${PALETTE} iframe`).getByTestId("title")).toHaveText(
      "Make with Eris",
    );
    await page.keyboard.type(SENTENCE);
    await page.keyboard.press("Enter");

    const frame = await universalFrame(page);
    const bar = frame.locator(".bar");
    await expect(bar).toHaveAttribute("data-mode", "preview");
    await expect(bar).toContainText(`Eris made this from “${SENTENCE}”.`);
    const view = frame.locator("desk-universal-view");
    await expect(view).toHaveAttribute("state", "ready");
    await expect(view.locator(".column-title .name")).toHaveText(["open", "done", "cancelled"]);
    await expect(view.locator(".column[data-group='open'] .entry-title").first()).toBeVisible();
    expect(await fileOf(page, "__desk", ID)).toBe("not_found");

    // Apply keeps the element and its data: mark it and find the mark after.
    await view.evaluate((el) => el.setAttribute("data-mark", "drawn"));
    await bar.getByRole("button", { name: "Apply" }).click();
    await expect(bar).toHaveAttribute("data-mode", "notice");
    await expect(bar).toContainText(`Eris made this view: ~/.desk/views/${ID}.yaml`);
    await expect(frame.locator("desk-universal-view[data-mark='drawn']")).toHaveCount(1);
    expect(await fileOf(page, "__desk", ID)).toMatchObject({
      id: ID,
      title: "Issues board",
      type: "kanban",
      source: { items: { kinds: ["task"] } },
      provenance: { author: "eris", words: SENTENCE, brain: "scripted" },
    });

    await bar.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(UNIVERSAL)).toBeHidden();
    expect(await fileOf(page, "__desk", ID)).toBe("not_found");
    await expect(page.locator(".desk-status")).toContainText("Removed “Issues board”");
  });

  test("the builder: a file source, the board shape, a field mapped with a live preview, Save; the shape switches later over the same data", async ({
    page,
  }) => {
    await load(page);
    await palette(page, "Build a view", "Build a view…");
    const frame = await universalFrame(page);
    const builder = frame.locator(".builder");
    await expect(builder).toBeVisible();
    await expect(builder.locator('[data-source="file"]')).toHaveAttribute("aria-selected", "true");
    await builder.getByLabel("Where").fill("~/boards/launch.yaml");
    await builder.getByRole("button", { name: "Load" }).click();
    await expect(builder.locator(".build-status")).toContainText("4 entries");
    await expect(builder.getByLabel("Name")).toHaveValue("Launch");

    await builder.locator('[data-shape="kanban"]').click();
    const preview = builder.locator("desk-universal-view");
    // column was suggested as the board's columns.
    await expect(preview.locator(".column-title .name")).toHaveText(["doing", "todo", "done"]);
    await builder.locator('select[data-role="group"]').selectOption("owner");
    await expect(preview.locator(".column-title .name")).toHaveText(["Mira", "Theo", "No group"]);
    await builder.locator('select[data-role="group"]').selectOption("column");
    await expect(preview.locator(".column-title .name")).toHaveText(["doing", "todo", "done"]);
    expect(await page.evaluate(() => window.__views.reads.length)).toBe(1);

    await builder.getByRole("button", { name: "Save view" }).click();
    const bar = frame.locator(".bar");
    await expect(bar).toContainText("Saved ~/.desk/views/my.launch.yaml");
    await expect(bar.getByRole("button", { name: "Edit" })).toBeVisible();
    expect(await fileOf(page, "__desk", "my.launch")).toMatchObject({
      id: "my.launch",
      title: "Launch",
      type: "kanban",
      source: { file: "~/boards/launch.yaml" },
      map: { title: "name", group: "column", start: "due" },
    });

    const view = frame.locator("desk-universal-view");
    await expect(view.locator(".column-title .name")).toHaveText(["doing", "todo", "done"]);
    const reads = await page.evaluate(() => window.__views.reads.length);
    await view.locator('[role="tab"][data-type="timeline"]').click();
    await expect(view.locator(".timeline .day").first()).toBeVisible();
    await expect(view.getByText("Write the launch post")).toBeVisible();
    expect(await page.evaluate(() => window.__views.reads.length)).toBe(reads);
  });
});

test.describe("say it, see it from the talk line", () => {
  test.use({ viewport: DESK });

  test("a show … as a board sentence previews in desk.universal, and Eris says what she made after Apply", async ({
    page,
  }) => {
    await openShell(page, "?views=1&lang=en");
    await page.keyboard.type(SENTENCE);
    await expect(page.getByRole("option").last()).toHaveText(`Make with Eris · ${SENTENCE}`);
    await page.keyboard.press("Enter");
    const frame = await universalFrame(page);
    const bar = frame.locator(".bar");
    await expect(bar).toContainText(`Eris made this from “${SENTENCE}”.`);
    await bar.getByRole("button", { name: "Apply" }).click();
    await expect(bar).toContainText(`~/.desk/views/${ID}.yaml`);
    expect(await fileOf(page, "__shell", ID)).toMatchObject({ id: ID, title: "Issues board" });
    await step(page, 3000);
    await expect(page.locator(".eris")).toHaveAttribute(
      "aria-label",
      "Eris: I made “Issues board” and saved it in your views.",
    );
    await page.evaluate(() => window.__shell.desk.runtime.commands.run("desk.propose.undo"));
    await expect(page.locator(UNIVERSAL)).toBeHidden();
    expect(await fileOf(page, "__shell", ID)).toBe("not_found");
  });
});
