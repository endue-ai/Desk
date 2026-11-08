// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { file, fixture } from "./harness";
import { mountPage } from "./page";

const V = file("~/Movies/clip.mp4");
const A = file("~/Music/tone.m4a");
const FILES = { [V.path]: fixture("clip.mp4"), [A.path]: fixture("tone.m4a") };
const GRANTS = ["~/Movies/**", "~/Music/**"];

const visible = (element: HTMLElement) => !element.hidden && !element.closest("[hidden]");

describe("the transport", () => {
  it("plays and pauses, seeks, sets the volume and mutes from the keyboard", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS, duration: 100 });
    await page.host.command("desk.files.visit", V);
    const { video, press } = page;
    expect(video.element.getAttribute("src")).toMatch(/^data:video\/mp4;base64,/);
    expect(visible(video.element)).toBe(true);

    expect(press(" ").defaultPrevented).toBe(true);
    expect(video.element.play).toHaveBeenCalledTimes(1);
    press("k");
    expect(video.element.pause).toHaveBeenCalledTimes(1);
    press("K");
    expect(video.element.play).toHaveBeenCalledTimes(2);

    press("ArrowRight");
    expect(video.element.currentTime).toBe(5);
    press("l");
    expect(video.element.currentTime).toBe(15);
    press("ArrowLeft");
    expect(video.element.currentTime).toBe(10);
    press("j");
    expect(video.element.currentTime).toBe(0);
    press("End");
    expect(video.element.currentTime).toBe(100);
    press("Home");
    expect(video.element.currentTime).toBe(0);

    press("ArrowDown");
    expect(video.element.volume).toBeCloseTo(0.9, 5);
    press("ArrowUp");
    expect(video.element.volume).toBeCloseTo(1, 5);
    press("m");
    expect(video.element.muted).toBe(true);
    expect(page.byId("mute").getAttribute("aria-pressed")).toBe("true");
  });

  it("never takes the desk's chords", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS });
    await page.host.command("desk.files.visit", V);
    for (const key of ["s", "o", "w", "k", " "])
      expect(page.press(key, { metaKey: true }).defaultPrevented, key).toBe(false);
    expect(page.press("k", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(page.video.element.play).not.toHaveBeenCalled();
  });

  it("the buttons have names and work by keyboard", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS });
    await page.host.command("desk.files.visit", V);
    const play = page.byId<HTMLButtonElement>("play");
    expect(play.getAttribute("aria-label")).toBe("Play");
    play.click();
    expect(page.video.element.play).toHaveBeenCalledTimes(1);
    expect(play.getAttribute("aria-label")).toBe("Pause");
    for (const control of document.querySelectorAll<HTMLElement>("button, input, select")) {
      const name = control.getAttribute("aria-label") ?? control.textContent?.trim();
      expect(name, control.id).toBeTruthy();
    }
    // Space on a focused button is the button's own: it is not also play and pause.
    page.byId<HTMLButtonElement>("loop").focus();
    expect(page.press(" ").defaultPrevented).toBe(false);
  });

  it("the speed menu goes from 0.5x to 2x", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS });
    await page.host.command("desk.files.visit", V);
    const speed = page.byId<HTMLSelectElement>("speed");
    expect([...speed.options].map((o) => o.value)).toEqual([
      "0.5",
      "0.75",
      "1",
      "1.25",
      "1.5",
      "1.75",
      "2",
    ]);
    speed.value = "1.5";
    speed.dispatchEvent(new Event("change", { bubbles: true }));
    expect(page.video.element.playbackRate).toBe(1.5);
  });

  it("loop, and theatre mode that Escape leaves", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS });
    await page.host.command("desk.files.visit", V);
    page.byId("loop").click();
    expect(page.video.element.loop).toBe(true);
    expect(page.byId("loop").getAttribute("aria-pressed")).toBe("true");

    expect(page.press("Escape").defaultPrevented).toBe(false);
    page.press("t");
    expect(document.body.classList.contains("theatre")).toBe(true);
    expect(page.byId("theatre").getAttribute("aria-pressed")).toBe("true");
    expect(page.press("Escape").defaultPrevented).toBe(true);
    expect(document.body.classList.contains("theatre")).toBe(false);
  });

  it("an audio file shows its cover, title, artist and album", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS });
    await page.host.command("desk.files.visit", A);
    expect(visible(page.audio.element)).toBe(false);
    expect(page.audio.element.getAttribute("src")).toMatch(/^data:audio\/mp4;base64,/);
    expect(visible(page.video.element)).toBe(false);
    const card = page.byId("card");
    expect(visible(card)).toBe(true);
    expect(card.textContent).toContain("Test Tone");
    expect(card.textContent).toContain("Endue Player");
    expect(card.textContent).toContain("Fixtures");
    expect(page.byId<HTMLImageElement>("cover").src).toMatch(/^data:image\/png;base64,/);
  });
});

describe("resuming long files", () => {
  const LONG = (path: string) => ({ resume: [{ path, t: 754, d: 1800 }] });

  it("offers to resume where a long file was left", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS, store: LONG(V.path) });
    await page.host.command("desk.files.visit", V);
    const offer = page.byId("resume");
    expect(visible(offer)).toBe(true);
    expect(offer.textContent).toContain("Resume at 12:34");
    page.byId("resume-yes").click();
    expect(page.video.element.currentTime).toBe(754);
    expect(visible(offer)).toBe(false);
  });

  it("keeps the position of a file longer than ten minutes, and not of a short one", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS, duration: 1800 });
    await page.host.command("desk.files.visit", V);
    page.video.element.currentTime = 100;
    page.video.fire("timeupdate");
    page.video.fire("pause");
    await page.settle();
    expect(page.store.resume).toEqual([{ path: V.path, t: 100, d: 1800 }]);

    const short = await mountPage({ files: FILES, grants: GRANTS, duration: 120 });
    await short.host.command("desk.files.visit", V);
    short.video.element.currentTime = 100;
    short.video.fire("timeupdate");
    short.video.fire("pause");
    await short.settle();
    expect(short.store.resume).toBeUndefined();
  });

  it("endue.player.resume: false neither offers nor keeps", async () => {
    const page = await mountPage({
      files: FILES,
      grants: GRANTS,
      duration: 1800,
      store: LONG(V.path),
      init: { "endue.player.resume": false },
    });
    await page.host.command("desk.files.visit", V);
    expect(visible(page.byId("resume"))).toBe(false);
    page.video.element.currentTime = 300;
    page.video.fire("pause");
    await page.settle();
    expect(page.store.resume).toEqual(LONG(V.path).resume);
  });
});

describe("what WebKit refuses", () => {
  it("the element's error event opens the details view", async () => {
    const page = await mountPage({ files: FILES, grants: GRANTS });
    await page.host.command("desk.files.visit", V);
    page.video.error = { code: 4 };
    page.video.fire("error");
    await page.settle();
    const details = page.byId("details");
    expect(visible(details)).toBe(true);
    expect(details.textContent).toContain(
      "This system's WebKit cannot play MP4 with H.264 and AAC.",
    );
    expect(details.textContent).toContain("clip.mp4");
    expect(details.textContent).toContain("176 × 144");
    expect(visible(page.video.element)).toBe(false);
    expect(page.video.element.hasAttribute("src")).toBe(false);
    expect(page.byId("status").textContent).toContain("cannot play");
  });
});
