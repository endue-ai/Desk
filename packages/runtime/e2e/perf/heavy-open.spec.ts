import { expect, type Locator, type Page, test } from "@playwright/test";
import { DESK, openShell } from "../shell-helpers";

// The shell's frame time while a plugin works on something large (#38). In WebKit every plugin frame
// runs on the shell's main thread, so work a plugin does there stalls the desk. A timer chain on the
// shell (every 8 ms) measures how long that thread was taken: the longest gap is the longest task,
// which is what a frame waits for. (The page's animation frames are not used: the e2e container's
// headless WebKit draws only a few per second.) The files are fixture/heavy-files.ts's.
/** A frame budget with room for a loaded machine. */
const FRAME_MS = 100;
/** What an open may take beyond the engine's fill: the drawing of the text area it shows, too. */
const OPEN_MS = 150;

test.use({ viewport: DESK });

const frame = (page: Page, plugin: string) =>
  page.frameLocator(`.desk-surface[data-surface="${plugin}"] iframe`);
const run = (page: Page, id: string, args?: unknown) =>
  page.evaluate(
    ([id, args]) => window.__shell.desk.runtime.commands.run(id as string, args),
    [id, args],
  );

/** The shell thread's gaps while `work` runs: the longest and the 95th percentile, in ms. */
async function shellGaps(page: Page, work: () => Promise<void>) {
  await page.evaluate(() => {
    const timing = { gaps: [] as number[], on: true };
    (window as unknown as { __timing: typeof timing }).__timing = timing;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      timing.gaps.push(now - last);
      last = now;
      if (timing.on) setTimeout(tick, 8);
    };
    setTimeout(tick, 8);
  });
  await work();
  const gaps = await page.evaluate(() => {
    const timing = (window as unknown as { __timing: { gaps: number[]; on: boolean } }).__timing;
    timing.on = false;
    return timing.gaps;
  });
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    ticks: gaps.length,
    longest: Math.round(sorted.at(-1) ?? 0),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
  };
}

/**
 * What the engine itself costs with this much text, which no worker can take: a twin of the note's
 * text area (same place and style) filled with the same text, then typed into, its value read once
 * per key as any editor that keeps its text must.
 */
async function engineCost(page: Page, area: Locator, keys: string) {
  const fill = await area.evaluate((text: HTMLTextAreaElement) => {
    const twin = text.cloneNode() as HTMLTextAreaElement;
    twin.id = "twin-text";
    twin.hidden = false;
    let kept = "";
    twin.addEventListener("input", () => {
      kept = twin.value;
    });
    twin.dataset.kept = String(kept.length);
    text.after(twin);
    text.hidden = true;
    const start = performance.now();
    twin.value = text.value;
    void twin.scrollHeight;
    const ms = performance.now() - start;
    twin.focus();
    twin.setSelectionRange(twin.value.length, twin.value.length);
    return Math.round(ms);
  });
  const twin = area.locator("xpath=following-sibling::textarea[@id='twin-text']");
  const typing = await shellGaps(page, () => twin.pressSequentially(keys, { delay: 30 }));
  await area.evaluate((text: HTMLTextAreaElement) => {
    text.nextElementSibling?.remove();
    text.hidden = false;
  });
  return { fill, typing: typing.longest };
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await openShell(page, "?files=1&apps=1&heavy=1&lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
});

test("Notes counts a 4 MiB note off the shell's thread, on open and while typing", async ({
  page,
}) => {
  await run(page, "desk.plugins.open", { plugin: "endue.notes" });
  const notes = frame(page, "endue.notes");
  const count = notes.locator("#note-count");
  await expect(notes.locator("#note-name")).toHaveText("No note open");
  const opening = await shellGaps(page, async () => {
    await run(page, "desk.files.open", { path: "~/Notes/long.txt" });
    await expect(count).toHaveText(/^\d+ words · 4194304 characters$/, { timeout: 60_000 });
  });
  const area = notes.locator("#note-text");
  const engine = await engineCost(page, area, "more");
  await area.evaluate((text: HTMLTextAreaElement) => {
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  });
  const typing = await shellGaps(page, async () => {
    await area.pressSequentially("more", { delay: 30 });
    await expect(count).toContainText("4194308 characters", { timeout: 60_000 });
  });
  console.log("notes, 4 MiB:", JSON.stringify({ engine, opening, typing }));
  // Counting 4 MiB took the thread for about 200 ms on open and on each key before #38 (here an open
  // 560–814 ms, a key 450–665 ms). Now the open waits for the engine filling the text area, and a
  // key for the engine and Notes keeping its text (about 130 ms more than the twin at this size, not
  // counting; see the audit in docs/qa/TESTING.md). On the CEF desk's Chromium the open's longest
  // task is the text area's first layout as it is shown and focused (about 270 ms in a CPU profile)
  // and its drawing (about 45 ms), more than the twin's fill, which leaves the drawing out: alone an
  // open is 325–346 ms against a fill of 215–229 ms, with Notes' own script about 11 ms of it.
  // Counting on the thread would add about 200 ms (198 ms measured), so OPEN_MS still catches it.
  expect(opening.longest).toBeLessThan(engine.fill + OPEN_MS);
  expect(typing.longest).toBeLessThan(engine.typing + 2 * FRAME_MS);
});

test("Explorer previews a 7.1 MiB image and the shell keeps its frames", async ({ page }) => {
  await run(page, "desk.plugins.open", { plugin: "endue.explorer" });
  const explorer = frame(page, "endue.explorer");
  const item = explorer.getByRole("treeitem", { name: /large\.png/ });
  const image = explorer.locator("#preview-content img");
  const shown = () =>
    expect
      .poll(
        () =>
          image
            .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1360)
            .catch(() => false),
        { timeout: 60_000 },
      )
      .toBe(true);
  // The first large image the engine draws costs it once, whoever reads it: not measured.
  await item.click();
  await item.press(" ");
  await shown();
  await item.press("Escape");
  await expect(image).toHaveCount(0);
  const timing = await shellGaps(page, async () => {
    await item.press(" ");
    await shown();
  });
  console.log("explorer, 7.1 MiB PNG:", JSON.stringify(timing));
  expect(timing.longest).toBeLessThan(2 * FRAME_MS);
});
