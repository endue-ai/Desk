// @vitest-environment jsdom
import { expect, it } from "vitest";
import { file, fixture } from "./harness";
import { mountPage } from "./page";

const VIDEO = file("~/Movies/clip.mp4");
const SUBTITLE = "~/Movies/clip.en.srt";
const FILES = {
  [VIDEO.path]: fixture("clip.mp4"),
  [SUBTITLE]: "1\n00:00:01,000 --> 00:00:04,000\nExample caption.\n",
};

it("the agent and keys drive the same live transport and current media state", async () => {
  const { host, press, video } = await mountPage({ files: FILES, grants: ["~/Movies/**"] });
  await host.command("desk.files.visit", VIDEO);
  await host.command("endue.player.play", {});
  await host.command("endue.player.play", {});
  expect(video.element.play).toHaveBeenCalledTimes(1);
  await host.command("endue.player.seek", { to: 15 });
  press("l");
  await host.command("endue.player.seek", { by: 5 });
  await host.command("endue.player.volume", { level: 0.4 });
  await host.command("endue.player.volume", { mute: true });
  await host.command("endue.player.speed", { rate: 1.5 });
  await host.command("endue.player.subtitles", { track: SUBTITLE, offset: 0.5 });
  await expect(host.command("endue.player.state", {})).resolves.toMatchObject({
    title: "clip.mp4",
    position: 30,
    duration: 100,
    playing: true,
    volume: 0.4,
    muted: true,
    rate: 1.5,
    subtitles: { selected: SUBTITLE, offset: 0.5 },
  });
  await expect(host.command("endue.player.seek", { to: 2, by: 4 })).rejects.toThrow();
  expect(video.element.currentTime).toBe(30);
  await host.command("endue.player.pause", {});
  press("k");
  await expect(host.command("endue.player.state", {})).resolves.toMatchObject({ playing: true });
});

it("uses the playlist hand-off and skips unreadable files without asking per entry", async () => {
  const list = file("~/Music/list.m3u");
  const first = "~/Music/first.wav";
  const missingGrant = "/example/denied.wav";
  const last = "/media-test/last.wav";
  const page = await mountPage({
    files: {
      [list.path]: [first, missingGrant, last, ""].join("\n"),
      [first]: fixture("tone.wav"),
      [missingGrant]: fixture("tone.wav"),
      [last]: fixture("tone.wav"),
    },
    grants: ["~/Music/**", "/media-test/**"],
    prompt: () => false,
  });
  await page.host.command("desk.files.visit", list);
  expect(page.ran("desk.files.playlist-entries")).toEqual([
    { buffer: list.buffer, paths: [first, missingGrant, last] },
  ]);
  page.press("PageDown");
  await page.settle();
  expect(page.params("perm.request")).toEqual([]);
  await expect(page.host.command("endue.player.state", {})).resolves.toMatchObject({
    entry: { index: 3, count: 3, path: last },
  });
  await page.host.command("endue.player.entry", { to: 1 });
  await expect(page.host.command("endue.player.state", {})).resolves.toMatchObject({
    entry: { index: 1, count: 3, path: first },
  });
});
