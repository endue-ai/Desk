// Unsaved changes are asked about wherever they would go, as ⌘W asks (#160, #162, #163): closing the
// window that shows them by its × and quitting the desk (desk.buffers' guard, `shell/windows.ts`,
// `apps/desk/src/quit.ts`, `apps/desk/shell/src/quit.rs`). The case the person met: text typed into
// a note. The question is the palette's pick, read and answered in its page. The quit is DevTools'
// Browser.close, which reaches the shell's own Quit through `terminate:` on macOS (`run_event.rs`).
// Chromium ends the renderers it may end before that (pages without an unload, pagehide or
// visibilitychange handler), and a dead page's target holds chromedriver's calls: after the quit
// the spec reads the desk's main page only and types through the compositor, as the keyboard does.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { closeBrowser } from "../support/cef";
import { feed, keyPress } from "../support/compositor";
import { inFrame, shellReady } from "../support/desk";
import { APP_VAR, HOME_VAR } from "../support/driver";
import { click, toolAt } from "../support/gestures";
import { byId, clearDesk, deskNow, rectOf, run, windowNow } from "../support/windows";

const NOTES = "endue.notes";
const PALETTE = "desk.palette";
const NAME = "unsaved.md";
const SAVED = "# A note\n\nsaved line\n";
const TYPED = "UNSAVED-EDIT";

const home = () => process.env[HOME_VAR] ?? "";
const notePath = () => join(home(), "Notes", NAME);

type Listed = Array<{ name: string; modified: boolean }>;
const modified = async () =>
  ((await run("desk.buffers.list")) as Listed).some((b) => b.name === NAME && b.modified);
const noteText = () => inFrame(NOTES, () => $("textarea").getValue());

/** The question the palette shows: its title and its rows. */
const question = () =>
  inFrame(PALETTE, async () => ({
    title: await $("[data-testid=title]").getText(),
    rows: await $$("[role=option] .label").map((row) => row.getText()),
  }));

async function asked(title: string): Promise<string[]> {
  let rows: string[] = [];
  await browser.waitUntil(
    async () => {
      const shown = await question().catch(() => undefined);
      rows = shown?.title === title ? shown.rows : [];
      return rows.length > 0;
    },
    { timeout: 15_000, interval: 300, timeoutMsg: `the palette never asked "${title}"` },
  );
  return rows;
}

/** Pick the palette's first row matching `words`, as the person types them and presses Enter. */
const answer = (words: string) =>
  inFrame(PALETTE, async () => {
    await $("[data-testid=query]").addValue(words);
    await browser.keys("Enter");
  });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("unsaved changes: the window's × and the quit ask as ⌘W does", () => {
  before(async () => {
    await shellReady();
    await clearDesk([NOTES]);
    mkdirSync(join(home(), "Notes"), { recursive: true });
    writeFileSync(notePath(), SAVED);
    await run("desk.files.open", { path: notePath() });
    await browser.waitUntil(async () => (await noteText()) === SAVED, {
      timeout: 15_000,
      timeoutMsg: "the note never opened in Notes",
    });
    // Its whole title bar in sight: the slot it took may reach past the app's right edge.
    const { screen } = await deskNow();
    const w = await windowNow(NOTES);
    const steps = Math.max(0, Math.ceil((w.x + w.w + 8 - screen.w) / 32));
    for (let i = 0; i < steps; i++) await run("desk.display.move-left");
  });

  it("the × asks what ⌘W asks, and Keep it open keeps the window and the text", async () => {
    await inFrame(NOTES, () => $("textarea").addValue(TYPED));
    await browser.waitUntil(modified, { timeout: 10_000, timeoutMsg: "the note never changed" });
    await click(toolAt(rectOf(await windowNow(NOTES)), "close"));
    expect(await asked(`${NAME} has unsaved changes`)).toEqual([
      "Save, then close",
      "Close without saving",
      "Keep it open",
    ]);
    await answer("keep");
    await browser.pause(1_000);
    expect(byId(await deskNow(), NOTES)).toBeDefined();
    expect(await noteText()).toBe(`${SAVED}${TYPED}`);
    expect(await modified()).toBe(true);
    expect(readFileSync(notePath(), "utf8")).toBe(SAVED);
  });

  it("a quit asks too, and goes only once the person says so", async function () {
    // Browser.close reaches the shell's Quit by `terminate:`, which is macOS's (`run_event.rs`).
    if (process.platform !== "darwin") this.skip();
    const pid = Number(process.env[APP_VAR]);
    const at = (
      browser.requestedCapabilities as { "goog:chromeOptions"?: { debuggerAddress?: string } }
    )["goog:chromeOptions"]?.debuggerAddress;
    expect(await closeBrowser(Number(at?.split(":")[1]))).toBe(true);
    // The palette's question is up over the desk (its words: policies/buffers.test.ts).
    await expect($(`#desk.shell .desk-surface[data-surface="${PALETTE}"]`)).toBeDisplayed({
      wait: 15_000,
    });
    // The shell waits 3 s for the page's first answer; asking, it waits for the person.
    await browser.pause(4_000);
    expect(alive(pid)).toBe(true);
    const typed = [..."without"].flatMap((c) => keyPress(c, `Key${c.toUpperCase()}`, c));
    // The desk quits on the answer, before the compositor's answer comes back.
    await feed([...typed, ...keyPress("Enter", "Enter")]).catch(() => undefined);
    await browser.waitUntil(async () => !alive(pid), {
      timeout: 15_000,
      interval: 200,
      timeoutMsg: "the desk did not quit after Quit without saving",
    });
    expect(readFileSync(notePath(), "utf8")).toBe(SAVED);
  });
});
