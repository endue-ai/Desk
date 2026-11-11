// What the desk does with the phone's video and photo formats its engine may have no decoder for
// (#162 findings 3 and 4, ADR XXXX), on the real CEF engine: an H.264 + AAC MP4 plays, or opens as
// the Player's card naming the decoder this build lacks; a HEIC shows, or opens as Images' card
// naming this build's limit; an uncompressed 8-bit RGB TIFF (as `sips` writes) is drawn by Images
// itself. Each card offers Show in Finder; it is not pressed, since that opens the system's file
// manager. The files are opened with `desk cmd run desk.files.open`, which gives the opener the
// file's folder (ADR 0131).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser, expect } from "@wdio/globals";
import { deskOk } from "../support/cli";
import { inFrame, press, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** A folder of the spec's person for the sample files. */
function media(): string {
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  const dir = join(home, "Media");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const open = (path: string) =>
  deskOk(["cmd", "run", "desk.files.open", "--args", JSON.stringify({ path })]);

/** A 4 × 2 little-endian TIFF of one uncompressed 8-bit RGB strip, every pixel (200, 40, 10). */
function plainTiff(): Uint8Array {
  const entries: Array<[tag: number, type: 3 | 4, count: number, value: number]> = [
    [256, 3, 1, 4],
    [257, 3, 1, 2],
    [258, 3, 3, 134],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 140],
    [277, 3, 1, 3],
    [278, 3, 1, 2],
    [279, 4, 1, 24],
    [284, 3, 1, 1],
  ];
  const bytes = new Uint8Array(164);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 42, 0], 0);
  view.setUint32(4, 8, true);
  view.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  });
  // IFD ends at 8 + 2 + 120 + 4 = 134: BitsPerSample's three values, then the strip.
  for (let i = 0; i < 3; i++) view.setUint16(134 + i * 2, 8, true);
  for (let p = 0; p < 8; p++) bytes.set([200, 40, 10], 140 + p * 3);
  return bytes;
}

describe("file formats: what this build plays and shows, or says it does not", () => {
  it("an H.264 + AAC MP4 plays, or the Player's card names the decoder this build lacks", async () => {
    await shellReady();
    const clip = join(media(), "clip.mp4");
    copyFileSync(join(root, "plugins/player/tests/fixtures/clip.mp4"), clip);
    open(clip);
    await inFrame("endue.player", async () => {
      await expect($("#title")).toHaveText("clip.mp4", { wait: 15_000 });
      const h264 = await browser.execute(() =>
        document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'),
      );
      if (h264 === "") {
        await expect($("#why")).toHaveText(
          "This build of the desk has no H.264 decoder, so it cannot play this MP4 file.",
          { wait: 15_000 },
        );
        await expect($("#reveal")).toHaveText(/^Show in /);
        await expect($("#transport")).not.toBeDisplayed();
        await expect($("#progress")).not.toBeDisplayed();
        return;
      }
      await press("#play");
      await browser.waitUntil(
        () =>
          browser.execute(() => (document.getElementById("video") as HTMLVideoElement).currentTime),
        { timeout: 15_000, timeoutMsg: "clip.mp4 did not play" },
      );
    });
  });

  it("a HEIC shows, or Images' card names this build's limit", async () => {
    await shellReady();
    const photo = join(media(), "photo.heic");
    copyFileSync(join(root, "plugins/images/tests/fixtures/exif.heic"), photo);
    open(photo);
    await inFrame("endue.images", async () => {
      await expect($("#name")).toHaveText("photo.heic", { wait: 15_000 });
      // The webview's <img> is tried first: decoded, or its error turns it into the card.
      await browser.waitUntil(
        () =>
          browser.execute(() => {
            const img = document.querySelector("#pane-a img.media") as HTMLImageElement | null;
            const shown = !!img && img.complete && img.naturalWidth > 0;
            return shown || !!document.querySelector("#pane-a .notice");
          }),
        { timeout: 15_000, timeoutMsg: "photo.heic shows neither a picture nor a card" },
      );
      const card = $("#pane-a .notice");
      if (!(await card.isExisting())) return;
      await expect(card.$(".reason")).toHaveText(
        "This build of the desk does not decode HEIC images.",
      );
      await expect(card.$("button")).toHaveText(/^Show in /);
    });
  });

  it("an uncompressed 8-bit RGB TIFF is drawn", async () => {
    await shellReady();
    const scan = join(media(), "scan.tif");
    writeFileSync(scan, plainTiff());
    open(scan);
    await inFrame("endue.images", async () => {
      await expect($("#name")).toHaveText("scan.tif", { wait: 15_000 });
      await expect($("#format")).toHaveText("TIFF · 4 × 2");
      await browser.waitUntil(
        () =>
          browser.execute(() => {
            const canvas = document.querySelector("#pane-a canvas") as HTMLCanvasElement | null;
            const pixel = canvas?.getContext("2d")?.getImageData(0, 0, 1, 1).data;
            return !!pixel && pixel[0] === 200 && pixel[1] === 40 && pixel[2] === 10;
          }),
        { timeout: 15_000, timeoutMsg: "scan.tif was not drawn" },
      );
      await expect($("#pane-a .notice")).not.toExist();
    });
  });
});
