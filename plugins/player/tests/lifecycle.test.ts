// @vitest-environment jsdom
import { expect, it, type TestContext, vi } from "vitest";
import { file, fixture } from "./harness";
import { mountPage } from "./page";

const VIDEO = file("~/Movies/clip.mp4");
const AUDIO = file("~/Music/tone.m4a");
const FILES = { [VIDEO.path]: fixture("clip.mp4"), [AUDIO.path]: fixture("tone.m4a") };
const GRANTS = ["~/Movies/**", "~/Music/**"];
type Page = Awaited<ReturnType<typeof mountPage>>;

function observeCleanup({ onTestFinished }: TestContext) {
  // The SDK host's zero-delay settling remains real; only playback intervals use this clock.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const pages: Page[] = [];
  onTestFinished(() => {
    try {
      // Vitest runs this observer after the page helper's afterEach cleanup.
      expect(vi.getTimerCount()).toBe(0);
      for (const page of pages) {
        for (const media of [page.video, page.audio]) {
          expect(media.paused).toBe(true);
          expect(media.element.hasAttribute("src")).toBe(false);
        }
      }
    } finally {
      // Keep the red regression isolated too, after recording the missing cleanup assertion.
      for (const page of pages) page.view.show(null);
      vi.useRealTimers();
    }
  });
  return pages;
}

it("unloads a playing page before test-finished observers run", async (context) => {
  const pages = observeCleanup(context);
  const page = await mountPage({ files: FILES, grants: GRANTS });
  pages.push(page);
  await page.host.command("desk.files.visit", VIDEO);
  page.byId("play").click();
  expect(page.video.paused).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
});

it("unloads every page mounted by one test", async (context) => {
  const pages = observeCleanup(context);
  for (const item of [VIDEO, AUDIO]) {
    const page = await mountPage({ files: FILES, grants: GRANTS });
    pages.push(page);
    await page.host.command("desk.files.visit", item);
    page.byId("play").click();
  }
  expect(pages[0]?.video.element.isConnected).toBe(false);
  expect(pages[0]?.video.paused).toBe(false);
  expect(pages[1]?.audio.paused).toBe(false);
  expect(vi.getTimerCount()).toBe(2);
});
