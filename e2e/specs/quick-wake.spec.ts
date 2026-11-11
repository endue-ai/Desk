// A window woken right after it slept ends with one page, a new one that answers (W1), on
// the CEF desk with no window out of sight kept live (desk.surfaces.live 0). The desk's page tells
// the app about its frames on its animation frames, or about once a second while it draws none (a
// locked screen): a Notes window moved to another desktop sleeps there, and is shown again within
// 300 ms. Right after the move the app may hear the sleep before the wake, or not; a window moved
// away again just after it woke sleeps once its grace after loading ends (`frames/install.ts`), on no
// change of the desk's, and the app hears only that its frame is back.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { inFrame, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { byId, clearDesk, deskNow, freshDesktop, openWindow, run, until } from "../support/windows";

const NOTES = "endue.notes";
const WEB = "endue.web";
/** The host of Notes' main surface, which its page's URL names. */
const HOST = "main.endue-notes";

const asleep = (d: Awaited<ReturnType<typeof deskNow>>, plugin: string) =>
  byId(d, plugin)?.panes[0]?.asleep === true;

/** Mark the plugin's page, so the page that comes back is seen to be a new one. */
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

/** The app's DevTools pages of Notes' main surface: its live pages and any still closing. */
async function notesPages(): Promise<string[]> {
  const caps = browser.requestedCapabilities as {
    "goog:chromeOptions"?: { debuggerAddress?: string };
  };
  const at = caps["goog:chromeOptions"]?.debuggerAddress;
  if (!at) throw new Error("the session names no DevTools address");
  const targets = (await (await fetch(`http://${at}/json/list`)).json()) as Array<{
    id: string;
    type: string;
    url: string;
  }>;
  return targets
    .filter((t) => t.type === "page" && t.url.startsWith(`desk-plugin://${HOST}/`))
    .map((t) => t.id);
}

/** The note's text, read in Notes' page; empty while the page does not answer. */
const text = () => inFrame(NOTES, () => $("textarea").getValue()).catch(() => "");

/**
 * Move Notes (in use) to desktop `to`, give the keys to another window and wait for its sleep; show
 * it again at once. Returns how long after the desk listed it asleep the desk was asked to show it.
 */
async function sleepAndWake(to: 1 | 2): Promise<number> {
  await show(NOTES);
  await run(`desk.shell.move-to-desktop-${to}`);
  await openWindow();
  await until((d) => asleep(d, NOTES), `Notes asleep on desktop ${to}`, 20_000);
  const slept = Date.now();
  await run("desk.display.show", { plugin: NOTES });
  return Date.now() - slept;
}

/** One page of Notes' surface, a new one, answering with what the sleep kept. */
async function oneNewPage(typed: string): Promise<void> {
  await until((d) => !asleep(d, NOTES), "Notes awake", 20_000);
  let pages: string[] = [];
  await browser
    .waitUntil(
      async () => {
        pages = await notesPages();
        return pages.length === 1;
      },
      { timeout: 15_000 },
    )
    .catch(() => {
      throw new Error(`the app kept ${pages.length} pages of Notes' surface`);
    });
  await browser.waitUntil(async () => (await text()) === typed, {
    timeout: 20_000,
    timeoutMsg: "the woken page did not come back with the note's unsaved text",
  });
  // The page that answers is the new one: the old one, which kept the text itself, is gone.
  expect(await marked(NOTES)).toBe(false);
  expect(await notesPages()).toEqual(pages);
}

/** `work`'s answer, or a failure naming `what` once `ms` have passed without one. */
async function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer in ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

describe("a window woken right after it slept has one page, the new one (W1)", () => {
  let typed = "";
  let files = "";

  before(async function () {
    this.timeout(180_000);
    const home = process.env[HOME_VAR] ?? "";
    files = join(home, "files");
    mkdirSync(files, { recursive: true });
    writeFileSync(join(files, "quick.md"), "# Quick note\n");
    // A profile with no window kept live out of sight, read at start.
    mkdirSync(join(home, ".desk/profiles"), { recursive: true });
    const profile = "name: E2E live 0\nsettings:\n  desk.surfaces.live: 0\n";
    writeFileSync(join(home, ".desk/profiles/e2e-live.yaml"), profile);
    await browser.reloadSession();
    await shellReady();
    await run("desk.profiles.switch", { id: "e2e-live" });
    await clearDesk([NOTES]);
    await freshDesktop();
    await run("desk.files.open", { path: join(files, "quick.md") });
    await show(NOTES);
    await inFrame(NOTES, () => browser.keys(" UNSAVED-QUICK".split("")));
    await browser.waitUntil(async () => (await text()).includes("UNSAVED-QUICK"), {
      timeoutMsg: "the typed text is not in the note",
    });
    typed = await text();
  });

  it("moved to desktop 2 and shown within 300 ms of its sleep: one page answers, a new one", async function () {
    this.timeout(120_000);
    await mark(NOTES);
    expect(await sleepAndWake(2)).toBeLessThan(300);
    await oneNewPage(typed);
  });

  it("moved away again as soon as it woke, asleep at its grace's end: one new page all the same", async function () {
    this.timeout(120_000);
    await mark(NOTES);
    expect(await sleepAndWake(1)).toBeLessThan(300);
    await oneNewPage(typed);
  });

  it("a file opened on that desktop right after the wake opens in its own window", async function () {
    this.timeout(120_000);
    const html = join(files, "page.html");
    writeFileSync(html, "<!doctype html><title>Saved page</title><p>A page the person saved.</p>");
    await mark(NOTES);
    expect(await sleepAndWake(2)).toBeLessThan(300);
    // At once, on the desktop Notes woke on: Web opens its window there, while Notes' page loads.
    await within(20_000, "desk.files.open", run("desk.files.open", { path: html }));
    await show(WEB);
    await browser.waitUntil(
      () =>
        inFrame(WEB, () =>
          browser.execute(() => document.getElementById("file-name")?.textContent ?? ""),
        ).then(
          (name) => name === "page.html",
          () => false,
        ),
      { timeout: 20_000, timeoutMsg: "Web did not show page.html" },
    );
    await oneNewPage(typed);
  });
});
