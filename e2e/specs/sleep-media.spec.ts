// An image or a video that slept comes back as the person left it (#162, ADR 0176), on the CEF desk
// with no window out of sight kept live (desk.surfaces.live 0): the opener's window goes to another
// desktop, sleeps there, and wakes when the person goes there (support/sleep.ts). Images at its zoom
// and pan, the Player at its place, paused. The editors are in sleep-openers.spec.ts, the documents
// in sleep-documents.spec.ts.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser, expect } from "@wdio/globals";
import { inFrame } from "../support/desk";
import {
  asleep,
  filesFolder,
  mark,
  marked,
  show,
  sleepOn,
  startWithNoneLive,
} from "../support/sleep";
import { run, until } from "../support/windows";

const PLAYER = "endue.player";
const root = fileURLToPath(new URL("../..", import.meta.url));

describe("media openers: an image or a video that slept comes back as it was (#162)", () => {
  let files = "";

  before(async function () {
    this.timeout(180_000);
    files = filesFolder();
    await startWithNoneLive();
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
