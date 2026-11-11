// A file window that slept comes back with its file, its place and its unsaved edits (#162, ADR
// 0176), on the CEF desk with no window out of sight kept live (desk.surfaces.live 0): the opener's
// window goes to another desktop, sleeps there, and wakes when the person goes there. Notes first;
// the other openers join as they take the SDK's keepFiles. Reader's case is in its unit tests for
// now: on the machine this was written on, a woken Reader page stopped answering chromedriver.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { inFrame, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { byId, clearDesk, deskNow, freshDesktop, openWindow, run, until } from "../support/windows";

const NOTES = "endue.notes";

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

/** Move the plugin's window (in use) to desktop `to`, use another window, and wait for its sleep. */
async function sleepOn(plugin: string, to: 2 | 3 | 4): Promise<void> {
  await show(plugin);
  await run(`desk.shell.move-to-desktop-${to}`);
  await openWindow();
  await until((d) => asleep(d, plugin), `${plugin} asleep on desktop ${to}`, 20_000);
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
    await run("desk.files.open", { path: long });
    await run("desk.files.open", { path: small });
    await show(NOTES);
    await inFrame(NOTES, () => browser.keys(" KEEP-SMALL".split("")));
    await run("desk.buffers.switch", { id: `file:${long}` });
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
    await run("desk.buffers.switch", { id: `file:${small}` });
    await browser.waitUntil(async () => (await text()).includes("KEEP-SMALL"), {
      timeoutMsg: "the small note did not come back with its unsaved text",
    });
    const listed = (await run("desk.buffers.list")) as Buffers;
    expect(listed.filter((b) => b.plugin === NOTES && b.modified).map((b) => b.id)).toEqual(
      expect.arrayContaining([`file:${long}`, `file:${small}`]),
    );
    // Nothing reached the disk.
    expect(readFileSync(long, "utf8")).toBe(LONG);
  });
});
