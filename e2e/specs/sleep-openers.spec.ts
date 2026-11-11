// A file window that slept comes back with its file, its place and its unsaved edits (#162, ADR
// 0176), on the CEF desk with no window out of sight kept live (desk.surfaces.live 0): the opener's
// window goes to another desktop, sleeps there, and wakes when the person goes there. Notes first,
// then the Player; the other openers join as they take the SDK's keepFiles. Reader's case is in its unit tests for
// now: on the machine this was written on, a woken Reader page stopped answering chromedriver.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser, expect } from "@wdio/globals";
import { inFrame, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { byId, clearDesk, deskNow, freshDesktop, openWindow, run, until } from "../support/windows";

const NOTES = "endue.notes";
const PLAYER = "endue.player";
const root = fileURLToPath(new URL("../..", import.meta.url));

/** A 114 KB note, as the QA pass edited one: its state no longer fit the desk's 64 KiB. */
const LONG = `# Long note\n\n${"the desk keeps what a person was doing while a window sleeps\n".repeat(1900)}`;

type Buffers = Array<{ id: string; modified: boolean; plugin: string }>;
const asleep = (d: Awaited<ReturnType<typeof deskNow>>, plugin: string) =>
  byId(d, plugin)?.panes[0]?.asleep === true;

/**
 * Mark the plugin's page, so a test can tell the page that comes back is a new one: a window that
 * only looked asleep would keep its old page and its state with it.
 */
const mark = (plugin: string) =>
  inFrame(plugin, () =>
    browser.execute(() => {
      (window as { slept?: boolean }).slept = true;
    }),
  );
const marked = (plugin: string) =>
  inFrame(plugin, () => browser.execute(() => (window as { slept?: boolean }).slept === true));

/** Show a plugin's window in front and in use, asked again while it is still mounting. */
async function show(plugin: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      await run("desk.display.show", { plugin });
      const w = byId(await deskNow(), plugin);
      return w?.focused === true && !w.hidden;
    },
    { timeout: 15_000, interval: 300, timeoutMsg: `${plugin} is not shown and in use` },
  );
}

/** The host a plugin's page is served from, as the desk names it (data-surface-host). */
const pageHost = async (plugin: string) =>
  (await $(`#desk.shell .desk-surface[data-surface="${plugin}"] [data-surface-host]`).getAttribute(
    "data-surface-host",
  )) ?? "";

/** Whether a page of `host` is open: a browser of its own that chromedriver lists. */
async function pageOpen(host: string): Promise<boolean> {
  const shell = await browser.getWindowHandle();
  try {
    for (const handle of await browser.getWindowHandles()) {
      if (handle === shell) continue;
      await browser.switchToWindow(handle);
      if ((await browser.getUrl()).startsWith(`desk-plugin://${host}/`)) return true;
    }
    return false;
  } finally {
    await browser.switchToWindow(shell);
  }
}

/**
 * Move the plugin's window (in use) to desktop `to`, use another window, and wait for its sleep: the
 * desk lists it asleep, and its page has closed. The page closes a moment after the listing says so;
 * a window woken before then keeps its old page, with what the sleep would have dropped.
 */
async function sleepOn(plugin: string, to: 2 | 3 | 4): Promise<void> {
  await show(plugin);
  const host = await pageHost(plugin);
  await run(`desk.shell.move-to-desktop-${to}`);
  await openWindow();
  await until((d) => asleep(d, plugin), `${plugin} asleep on desktop ${to}`, 20_000);
  await browser.waitUntil(async () => !(await pageOpen(host)), {
    timeout: 20_000,
    timeoutMsg: `${plugin}'s page did not close as it slept`,
  });
}

describe("file openers: a window that slept comes back whole (#162)", () => {
  let files = "";

  before(async function () {
    this.timeout(180_000);
    const home = process.env[HOME_VAR] ?? "";
    files = join(home, "files");
    mkdirSync(files, { recursive: true });
    writeFileSync(join(files, "long.md"), LONG);
    writeFileSync(join(files, "small.md"), "# Small note\n");
    // A profile with no window kept live out of sight, read at start.
    mkdirSync(join(home, ".desk/profiles"), { recursive: true });
    const profile = "name: E2E live 0\nsettings:\n  desk.surfaces.live: 0\n";
    writeFileSync(join(home, ".desk/profiles/e2e-live.yaml"), profile);
    await browser.reloadSession();
    await shellReady();
    await run("desk.profiles.switch", { id: "e2e-live" });
    await clearDesk([NOTES]);
    await freshDesktop();
  });

  it("Notes: a 114 KB note and a small one, both unsaved, come back with their text, still marked", async function () {
    this.timeout(120_000);
    const long = join(files, "long.md");
    const small = join(files, "small.md");
    // The desk names each buffer as the OS names its file (`~/files/long.md` under the home folder).
    const longId = await run("desk.files.open", { path: long });
    const smallId = await run("desk.files.open", { path: small });
    await show(NOTES);
    await inFrame(NOTES, () => browser.keys(" KEEP-SMALL".split("")));
    await run("desk.buffers.switch", { id: longId });
    await inFrame(NOTES, () => browser.keys(" UNSAVED-LONG".split("")));
    const text = () => inFrame(NOTES, () => $("textarea").getValue());
    await browser.waitUntil(async () => (await text()).includes("UNSAVED-LONG"), {
      timeoutMsg: "the typed text is not in the note",
    });
    const typed = await text();
    await mark(NOTES);

    await sleepOn(NOTES, 2);
    await run("desk.shell.desktop-2");
    await until((d) => !asleep(d, NOTES), "Notes awake on desktop 2", 20_000);
    await browser.waitUntil(async () => (await text().catch(() => "")) === typed, {
      timeoutMsg: "the long note did not come back with its unsaved text",
    });
    // A new page, not the old one kept: the text came back from what the sleep kept.
    expect(await marked(NOTES)).toBe(false);
    expect(await inFrame(NOTES, () => $("body").getText())).toContain("Unsaved changes");
    await run("desk.buffers.switch", { id: smallId });
    await browser.waitUntil(async () => (await text()).includes("KEEP-SMALL"), {
      timeoutMsg: "the small note did not come back with its unsaved text",
    });
    const listed = (await run("desk.buffers.list")) as Buffers;
    expect(listed.filter((b) => b.plugin === NOTES && b.modified).map((b) => b.id)).toEqual(
      expect.arrayContaining([longId, smallId]),
    );
    // Nothing reached the disk.
    expect(readFileSync(long, "utf8")).toBe(LONG);
  });

  it("Player: a video comes back where it was, paused", async function () {
    this.timeout(120_000);
    const clip = join(files, "clip.webm");
    copyFileSync(join(root, "plugins/player/tests/fixtures/clip.webm"), clip);
    await run("desk.files.open", { path: clip });
    await show(PLAYER);
    type At = { time: number; paused: boolean; src: string };
    const at = () =>
      inFrame(PLAYER, () =>
        browser.execute((): At | null => {
          const video = document.getElementById("video") as HTMLVideoElement | null;
          if (!video || video.readyState < 1) return null;
          return { time: video.currentTime, paused: video.paused, src: video.currentSrc };
        }),
      );
    const near = (now: At | null) => now !== null && Math.abs(now.time - 0.6) < 0.05;
    await browser.waitUntil(async () => (await at()) !== null, {
      timeout: 15_000,
      timeoutMsg: "the video did not load",
    });
    // A seek is heard as the person's place (timeupdate), as a drag on the bar is.
    await inFrame(PLAYER, () =>
      browser.execute(() => {
        (document.getElementById("video") as HTMLVideoElement).currentTime = 0.6;
      }),
    );
    await browser.waitUntil(async () => near(await at()), { timeoutMsg: "the seek did not land" });
    await mark(PLAYER);

    await sleepOn(PLAYER, 3);
    await run("desk.shell.desktop-3");
    await until((d) => !asleep(d, PLAYER), "Player awake on desktop 3", 20_000);
    await browser.waitUntil(async () => near(await at().catch(() => null)), {
      timeout: 20_000,
      timeoutMsg: "the video did not come back at 0.6 s",
    });
    expect(await marked(PLAYER)).toBe(false);
    expect((await at())?.paused).toBe(true);
    await inFrame(PLAYER, () => expect($("#title")).toHaveText("clip.webm"));
  });
});
