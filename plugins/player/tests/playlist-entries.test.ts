// @vitest-environment jsdom
// A playlist's entries on the player's real page (#162, finding 17): an entry's details describe its
// own file, not the playlist; an entry that cannot be read leaves the one before it on screen and says
// why; and what was said about one entry goes when another plays.
import { expect, it } from "vitest";
import { file, fixture } from "./harness";
import { mountPage } from "./page";

const LIST = file("~/Music/list.m3u");
const M3U = [
  "#EXTM3U",
  "#EXTINF:1,Song mp3",
  "song.mp3",
  "#EXTINF:1,Song wav",
  "song.wav",
  "#EXTINF:1,Video",
  "video.mp4",
  "#EXTINF:1,Missing",
  "missing.mp3",
  "",
].join("\n");
const FILES = {
  [LIST.path]: M3U,
  "~/Music/song.mp3": fixture("tone-v24.mp3"),
  "~/Music/song.wav": fixture("tone.wav"),
  "~/Music/video.mp4": fixture("clip.mp4"),
};

/** The list on an engine without H.264, as this build's Chromium (ADR 0174). */
async function playlist() {
  const page = await mountPage({ files: FILES, grants: ["~/Music/**"] });
  page.video.element.canPlayType = (type) => (/avc1|mp4a\.40/.test(type) ? "" : "maybe");
  page.audio.element.canPlayType = (type) => (/avc1|mp4a\.40/.test(type) ? "" : "maybe");
  await page.host.command("desk.files.visit", LIST);
  await page.settle();
  return page;
}
type Page = Awaited<ReturnType<typeof playlist>>;

/** Click the playlist's row titled `title`. */
async function pick(page: Page, title: string) {
  const row = [...page.byId("rows").querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith(title),
  );
  if (!row) throw new Error(`no row ${title}`);
  row.click();
  await page.settle();
}
const facts = (page: Page) =>
  Object.fromEntries(
    [...page.byId("facts").querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]),
  );
const current = (page: Page) =>
  page.byId("rows").querySelector('[aria-current="true"]')?.textContent ?? "";
const status = (page: Page) => page.byId("status").textContent;

it("an entry's details name its own file and size, not the playlist's", async () => {
  const page = await playlist();
  await pick(page, "Video");
  expect(page.byId("details").hidden).toBe(false);
  expect(facts(page)).toMatchObject({ Name: "video.mp4", Size: "6.3 KB", Format: "MP4" });
});

it("an entry that cannot be read leaves the one before it on screen, and says why", async () => {
  const page = await playlist();
  await pick(page, "Video");
  await pick(page, "Missing");
  // The video's card stays, with its name; the playlist itself is not shown as the entry.
  expect(page.byId("title").textContent).toBe("video.mp4");
  expect(facts(page)).toMatchObject({ Name: "video.mp4", Format: "MP4" });
  expect(page.byId("why").textContent).toContain("H.264");
  expect(current(page)).toBe("Video (0:01)");
  const missing = [...page.byId("rows").querySelectorAll("li")].at(-1);
  expect(missing?.className).toBe("missing");
  expect(missing?.textContent).toBe("Missing (Not found)");
  expect(status(page)).toBe("Could not read ~/Music/missing.mp3: there is no file at that path.");
});

it("what was said about one entry goes when another plays", async () => {
  const page = await playlist();
  await pick(page, "Video");
  expect(status(page)).toContain("H.264");
  await pick(page, "Song wav");
  expect(page.byId("details").hidden).toBe(true);
  expect(page.audio.element.getAttribute("src")).toMatch(/^data:audio\/(wav|x-wav)/);
  expect(current(page)).toBe("Song wav (0:01)");
  expect(status(page)).toBe("");
});
