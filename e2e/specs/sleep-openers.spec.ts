// A file window that slept comes back with its file, its place and its unsaved edits (#162, ADR
// 0176), on the CEF desk with no window out of sight kept live (desk.surfaces.live 0): the opener's
// window goes to another desktop, sleeps there, and wakes when the person goes there. Images, Notes,
// the Player, Docs, Slides and Web; the other openers join as they take the SDK's keepFiles.
// Reader's case is in its unit tests for now: on the machine this was written on, a woken Reader
// page stopped answering chromedriver.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser, expect } from "@wdio/globals";
import { inFrame, press, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { byId, clearDesk, deskNow, freshDesktop, openWindow, run, until } from "../support/windows";

const NOTES = "endue.notes";
const PLAYER = "endue.player";
const DOCS = "endue.docs";
const SLIDES = "endue.slides";
const WEB = "endue.web";
const root = fileURLToPath(new URL("../..", import.meta.url));

/** A saved page long enough to scroll. */
const LONG_PAGE = `<!doctype html><title>Long page</title>${Array.from(
  { length: 200 },
  (_, i) => `<p id="p${i}">Paragraph ${i} of a page the person reads down.</p>`,
).join("")}`;

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
 * Move the plugin's window (in use) to desktop `to` (its place in the list, or its id), use another
 * window, and wait for its sleep: the desk lists it asleep, and its page has closed. The page closes
 * a moment after the listing says so; a window woken before then keeps its old page, with what the
 * sleep would have dropped.
 */
async function sleepOn(plugin: string, to: 2 | 3 | 4 | string): Promise<void> {
  await show(plugin);
  const host = await pageHost(plugin);
  if (typeof to === "string") await run("desk.shell.move-to-desktop", { desktop: to });
  else await run(`desk.shell.move-to-desktop-${to}`);
  await openWindow();
  await until((d) => asleep(d, plugin), `${plugin} asleep on desktop ${to}`, 20_000);
  await browser.waitUntil(async () => !(await pageOpen(host)), {
    timeout: 20_000,
    timeoutMsg: `${plugin}'s page did not close as it slept`,
  });
}

/**
 * Two new desktops for a case: an empty one of its own for its window to sleep on (its id), and the
 * one in front, where the case opens its window.
 */
async function desktopsOfItsOwn(): Promise<string> {
  const own = await freshDesktop();
  await freshDesktop();
  return own;
}

/** Wake the window on desktop `id` by going there, as the person does. */
async function wakeOn(plugin: string, id: string): Promise<void> {
  await run("desk.shell.desktop-go", { desktop: id });
  await until((d) => !asleep(d, plugin), `${plugin} awake on its desktop`, 20_000);
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

  it("Images: an image comes back at its zoom and pan", async function () {
    this.timeout(120_000);
    const IMAGES = "endue.images";
    const photo = join(files, "photo.png");
    const fixture = new URL("../../plugins/images/tests/fixtures/exif.png", import.meta.url);
    writeFileSync(photo, readFileSync(fixture));
    await run("desk.files.open", { path: photo });
    await show(IMAGES);
    /** The zoom and the image's transform, once the image is drawn. */
    const view = () =>
      inFrame(IMAGES, () =>
        browser.execute(() => {
          const img = document.querySelector<HTMLImageElement>("#pane-a img");
          if (!img?.complete || img.naturalWidth === 0) return null;
          return `${document.getElementById("zoom-level")?.textContent} ${img.style.transform}`;
        }),
      );
    await browser.waitUntil(async () => (await view()) !== null, {
      timeout: 15_000,
      timeoutMsg: "the image was not drawn",
    });
    // Zoomed in past the window (the 64 × 48 photo, turned by its EXIF orientation) and panned with
    // the arrows, as the person's buttons and keys do.
    await inFrame(IMAGES, () =>
      browser.execute(() => {
        for (let i = 0; i < 6; i++) document.getElementById("zoom-in")?.click();
        const stage = document.getElementById("stage");
        for (const key of ["ArrowRight", "ArrowDown"])
          stage?.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
          );
      }),
    );
    const seen = await view();
    expect(seen).toMatch(/^\d+% translate\(-[\d.]+px, -[\d.]+px\)/);
    await mark(IMAGES);

    await sleepOn(IMAGES, 4);
    await run("desk.shell.desktop-4");
    await until((d) => !asleep(d, IMAGES), "Images awake on desktop 4", 20_000);
    await browser.waitUntil(async () => (await view().catch(() => null)) === seen, {
      timeout: 20_000,
      timeoutMsg: `the image did not come back as ${seen}`,
    });
    expect(await marked(IMAGES)).toBe(false);
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

  it("Docs: a document comes back on its page, at the zoom the person chose, and can be switched to", async function () {
    this.timeout(120_000);
    const rich = join(files, "rich.docx");
    copyFileSync(join(root, "plugins/docs/tests/fixtures/rich.docx"), rich);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: rich });
    await show(DOCS);
    const now = () =>
      inFrame(DOCS, () =>
        browser.execute(() => {
          const desk = document.getElementById("desk");
          return {
            name: document.getElementById("doc-name")?.textContent ?? "",
            zoom: document.getElementById("zoom-level")?.textContent ?? "",
            top: desk?.scrollTop ?? 0,
            pages: document.querySelectorAll(".page").length,
          };
        }),
      );
    await browser.waitUntil(async () => (await now()).pages >= 2, {
      timeoutMsg: "Docs did not draw rich.docx",
    });
    // The person zooms in twice and scrolls down into the document.
    await inFrame(DOCS, async () => {
      await press("#zoom-in");
      await press("#zoom-in");
      await browser.execute(() => {
        const desk = document.getElementById("desk");
        if (desk) desk.scrollTop = Math.round(desk.scrollHeight / 2);
      });
    });
    const before = await now();
    expect(before.top).toBeGreaterThan(0);
    await mark(DOCS);

    await sleepOn(DOCS, own);
    await wakeOn(DOCS, own);
    await browser.waitUntil(
      async () => {
        const back = await now().catch(() => undefined);
        return (
          back?.name === "rich.docx" &&
          back.zoom === before.zoom &&
          Math.abs(back.top - before.top) < 24
        );
      },
      { timeoutMsg: `Docs did not come back as ${JSON.stringify(before)}` },
    );
    // A new page, not the old one kept: the place came back from what the sleep kept.
    expect(await marked(DOCS)).toBe(false);
    // The desk still lists the document, and a switch to it reaches it ("No document" before).
    await run("desk.buffers.switch", { id });
    expect((await now()).name).toBe("rich.docx");
  });

  it("Slides: a presentation comes back on the slide the person was on, and can be switched to", async function () {
    this.timeout(120_000);
    const deck = join(files, "sample.pptx");
    copyFileSync(join(root, "plugins/slides/tests/fixtures/sample.pptx"), deck);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: deck });
    await show(SLIDES);
    const slide = () =>
      inFrame(SLIDES, () =>
        browser.execute(() => ({
          name: document.getElementById("deck-name")?.textContent ?? "",
          at: document.getElementById("stage")?.getAttribute("aria-label") ?? "",
        })),
      );
    await browser.waitUntil(async () => (await slide()).name === "sample.pptx", {
      timeoutMsg: "Slides did not open sample.pptx",
    });
    // The person picks the fourth slide in the rail.
    await inFrame(SLIDES, () => press("#rail li:nth-child(4) button"));
    await browser.waitUntil(async () => (await slide()).at.startsWith("Slide 4 of"), {
      timeoutMsg: "the rail did not go to slide 4",
    });
    const before = await slide();
    await mark(SLIDES);

    await sleepOn(SLIDES, own);
    await wakeOn(SLIDES, own);
    await browser.waitUntil(
      async () => {
        const back = await slide().catch(() => undefined);
        return back?.name === before.name && back.at === before.at;
      },
      { timeoutMsg: `Slides did not come back as ${JSON.stringify(before)}` },
    );
    // A new page, not the old one kept: the slide came back from what the sleep kept.
    expect(await marked(SLIDES)).toBe(false);
    // The desk still lists the presentation, and a switch to it reaches it ("No presentation" before).
    await run("desk.buffers.switch", { id });
    expect((await slide()).name).toBe("sample.pptx");
  });

  it("Web: a saved page comes back as far down as the person read, and can be switched to", async function () {
    this.timeout(120_000);
    const html = join(files, "long.html");
    writeFileSync(html, LONG_PAGE);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: html });
    await show(WEB);
    const now = () =>
      inFrame(WEB, () =>
        browser.execute(() => {
          const page = document.getElementById("page");
          return {
            name: document.getElementById("file-name")?.textContent ?? "",
            down: page && page.scrollHeight > 0 ? page.scrollTop / page.scrollHeight : 0,
            tall: page ? page.scrollHeight > page.clientHeight * 2 : false,
          };
        }),
      );
    await browser.waitUntil(async () => (await now()).tall, {
      timeoutMsg: "Web did not draw long.html",
    });
    // The person reads half way down the page.
    await inFrame(WEB, () =>
      browser.execute(() => {
        const page = document.getElementById("page");
        if (page) page.scrollTop = Math.round(page.scrollHeight / 2);
      }),
    );
    const before = await now();
    expect(before.down).toBeGreaterThan(0.3);
    await mark(WEB);

    await sleepOn(WEB, own);
    await wakeOn(WEB, own);
    await browser.waitUntil(
      async () => {
        const back = await now().catch(() => undefined);
        return back?.name === "long.html" && Math.abs(back.down - before.down) < 0.02;
      },
      { timeoutMsg: `Web did not come back as ${JSON.stringify(before)}` },
    );
    expect(await marked(WEB)).toBe(false);
    // The desk still lists the page, and a switch to it reaches it ("No file" before).
    await run("desk.buffers.switch", { id });
    expect((await now()).name).toBe("long.html");
  });
});
