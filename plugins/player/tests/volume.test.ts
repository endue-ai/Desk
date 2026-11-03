// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Model } from "../ui/player.js";
import { createMedia } from "../ui/view-media.js";
import { file, fixture } from "./harness";
import { mountPage } from "./page";
import { setup } from "./software-fakes";

const video = file("~/Movies/clip.mp4");
const audio = file("~/Music/tone.m4a");
const files = { [video.path]: fixture("clip.mp4"), [audio.path]: fixture("tone.m4a") };
const grants = ["~/Movies/**", "~/Music/**"];

function setVolume(value: string) {
  const slider = document.getElementById("volume") as HTMLInputElement;
  slider.value = value;
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("volume and mute", () => {
  it("carries the controls from video to audio and steps from the current volume", async () => {
    const page = await mountPage({ files, grants });
    await page.host.command("desk.files.visit", video);
    setVolume("0.3");
    page.byId("mute").click();
    expect(page.video.element.volume).toBe(0.3);
    expect(page.video.element.muted).toBe(true);

    await page.host.command("desk.files.visit", audio);
    expect(page.audio.element.volume).toBe(0.3);
    expect(page.audio.element.muted).toBe(true);
    expect(page.byId<HTMLInputElement>("volume").value).toBe("0.3");
    expect(page.byId("mute").getAttribute("aria-pressed")).toBe("true");
    page.press("ArrowUp");
    expect(page.audio.element.volume).toBe(0.4);
  });

  it("carries the controls to each new software-engine media", () => {
    const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    const native = document.getElementById("video") as HTMLVideoElement;
    native.pause = vi.fn();
    native.load = vi.fn();
    const created: ReturnType<typeof setup>["media"][] = [];
    const engines = {
      open(
        next: Model,
        element: HTMLMediaElement,
        _screen: HTMLCanvasElement,
        hooks: { listen: (target: EventTarget) => void },
      ) {
        if (next.engine !== "software") return { media: element, close() {} };
        const media = setup({ canvas: false }).media;
        created.push(media);
        hooks.listen(media);
        return { media, close: () => media.close() };
      },
    } as unknown as Parameters<typeof createMedia>[2];
    const view = createMedia(document, () => {}, engines);
    const model = (src: string, engine: "native" | "software"): Model => ({
      buffer: src,
      path: src,
      name: src,
      size: 1,
      format: "",
      mode: "media",
      element: engine === "native" ? "video" : "audio",
      src,
      engine,
    });
    view.load(model("first.mp4", "native"));
    setVolume("0.3");
    document.getElementById("mute")?.click();
    view.load(model("second.wma", "software"));
    expect(created[0]?.volume).toBe(0.3);
    expect(created[0]?.muted).toBe(true);
    view.load(model("third.wma", "software"));
    expect(created[1]?.volume).toBe(0.3);
    expect(created[1]?.muted).toBe(true);
    view.unload();
  });

  it("restores the controls at start and stores changes", async () => {
    const page = await mountPage({
      files,
      grants,
      store: { volume: { volume: 0.3, muted: true } },
    });
    expect(page.byId<HTMLInputElement>("volume").value).toBe("0.3");
    expect(page.byId("mute").getAttribute("aria-pressed")).toBe("true");
    await page.host.command("desk.files.visit", audio);
    expect(page.audio.element.volume).toBe(0.3);
    expect(page.audio.element.muted).toBe(true);
  });

  it("stores changes to the slider and mute button", async () => {
    const page = await mountPage({ files, grants });
    await page.host.command("desk.files.visit", video);
    page.byId("mute").click();
    setVolume("0.65");
    await vi.waitFor(() => expect(page.store.volume).toEqual({ volume: 0.65, muted: true }));
    page.byId("mute").click();
    await vi.waitFor(() => expect(page.store.volume).toEqual({ volume: 0.65, muted: false }));
  });
});
