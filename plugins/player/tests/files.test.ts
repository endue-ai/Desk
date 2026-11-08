import { describe, expect, it } from "vitest";
import { file, fixture, folderScope, mount } from "./harness";

const MOVIES = folderScope("~/Movies");
const A = file("~/Movies/clip.mp4");
const B = file("~/Movies/tone.m4a");
const files = () => ({ [A.path]: fixture("clip.mp4"), [B.path]: fixture("tone.m4a") });

/** Every fs.read the player made: ranges, never a whole media file through the bridge. */
const ranged = (reads: unknown[]) =>
  reads.every((params) => {
    const { offset, length } = params as { offset?: number; length?: number };
    return typeof offset === "number" && typeof length === "number" && length <= 1 << 20;
  });

describe("the desk's file requests", () => {
  it("visit asks fs.url for a video and sets the element's source to the answer", async () => {
    const { host, view, shown, params } = await mount({ files: files(), grants: ["~/Movies/**"] });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(params("fs.url")).toEqual([{ path: A.path, scope: MOVIES }]);
    const answer = (await host.call("fs.url", { path: A.path, scope: MOVIES }, "endue.player")).url;
    expect(shown()).toMatchObject({
      buffer: A.buffer,
      path: A.path,
      name: "clip.mp4",
      mode: "media",
      element: "video",
      src: answer,
    });
    expect(ranged(params("fs.read"))).toBe(true);
    expect(params("fs.read").length).toBeGreaterThan(0);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: MOVIES }]);
    expect(view.focused).toBeGreaterThan(0);
    expect(view.statuses.filter((s) => s !== "")).toEqual([]);
  });

  it("an audio file plays in the audio element with its tags", async () => {
    const { host, shown } = await mount({ files: files(), grants: ["~/Movies/**"] });
    await host.command("desk.files.visit", B);
    expect(shown()).toMatchObject({ mode: "media", element: "audio", name: "tone.m4a" });
    expect(shown()?.info?.tags).toMatchObject({ title: "Test Tone", artist: "Endue Player" });
    expect(shown()?.cover).toMatch(/^data:image\/png;base64,/);
  });

  it("revert asks for a new URL and probes the file again", async () => {
    const { host, shown, params } = await mount({ files: files(), grants: ["~/Movies/**"] });
    await host.command("desk.files.visit", A);
    const reads = params("fs.read").length;
    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.url")).toHaveLength(2);
    expect(params("fs.read").length).toBeGreaterThan(reads);
    expect(shown()).toMatchObject({ buffer: A.buffer, mode: "media" });
  });

  it("show switches between open files and closed forgets one", async () => {
    const { host, shown, view } = await mount({ files: files(), grants: ["~/Movies/**"] });
    expect(shown()).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", B);
    expect(shown()).toMatchObject({ buffer: B.buffer, element: "audio" });

    const focused = view.focused;
    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(shown()).toMatchObject({ buffer: A.buffer, element: "video" });
    expect(view.focused).toBe(focused + 1);

    await host.command("desk.buffers.closed", A);
    expect(shown()).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(`No file ${A.buffer}.`);
    await host.command("desk.buffers.show", B);
    expect(shown()).toMatchObject({ buffer: B.buffer });
  });

  it("save is refused: the player opens files read-only", async () => {
    const { host, view, params } = await mount({ files: files(), grants: ["~/Movies/**"] });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow(
      "Player opens files read-only.",
    );
    expect(view.statuses.at(-1)).toBe("Player opens files read-only.");
    expect(params("fs.write")).toEqual([]);
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({ files: files(), grants: ["~/Movies/**"] });
    await host.command("desk.files.visit", A);
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
    host.emit({ event: "fs.changed", data: { watchId: "w9", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toHaveLength(1);
  });
});

describe("files outside the grants", () => {
  const X = file("~/Documents/x.mp4");
  const DOCS = folderScope("~/Documents");

  it("a refused fs.url asks once for the file's folder and tries again", async () => {
    const { host, shown, params } = await mount({ files: { [X.path]: fixture("clip.mp4") } });
    await expect(host.command("desk.files.visit", X)).resolves.toBeUndefined();
    expect(params("perm.request")).toEqual([
      { permission: DOCS, reason: "To open ~/Documents/x.mp4 in Player" },
    ]);
    expect(params("fs.url")).toEqual([
      { path: X.path, scope: DOCS },
      { path: X.path, scope: DOCS },
    ]);
    expect(shown()).toMatchObject({ mode: "media", path: X.path });
  });

  it("a refusal is said in words and nothing else is read", async () => {
    const { host, view, shown, params } = await mount({
      files: { [X.path]: fixture("clip.mp4") },
      prompt: () => false,
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.mp4.",
    );
    expect(params("perm.request")).toHaveLength(1);
    expect(params("fs.read")).toEqual([]);
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.mp4.");
    expect(shown()).toBeNull();
  });

  it("a missing file is reported with its code and no ask", async () => {
    const { host, params } = await mount({ grants: ["~/Movies/**"] });
    await expect(host.command("desk.files.visit", file("~/Movies/gone.mp4"))).rejects.toThrow(
      "Could not read ~/Movies/gone.mp4: not_found.",
    );
    expect(params("perm.request")).toEqual([]);
  });
});

describe("what the webview cannot play", () => {
  it("canPlayType's refusal opens the details with the container and codecs", async () => {
    const M = file("~/Movies/clip.mkv");
    const { host, view, shown } = await mount({
      files: { [M.path]: fixture("clip.mkv") },
      grants: ["~/Movies/**"],
    });
    view.playable = (type) => (type.startsWith("video/x-matroska") ? "" : "maybe");
    await expect(host.command("desk.files.visit", M)).resolves.toBeUndefined();
    expect(view.asked[0]).toMatch(/^video\/x-matroska/);
    expect(shown()).toMatchObject({
      mode: "details",
      name: "clip.mkv",
      format: "Matroska",
      why: "This system's WebKit cannot play Matroska with HEVC and AC-3.",
    });
    expect(shown()?.size).toBe(fixture("clip.mkv").length);
    expect(shown()?.src).toBeUndefined();
  });

  it("a damaged subtitle file opens as details, never an error", async () => {
    const S = file("~/Movies/broken.srt");
    const { host, shown } = await mount({
      files: { [S.path]: Uint8Array.from([0, 1, 2, 3, 0xff, 0xfe, 9, 9]) },
      grants: ["~/Movies/**"],
    });
    await expect(host.command("desk.files.visit", S)).resolves.toBeUndefined();
    expect(shown()).toMatchObject({ mode: "details", name: "broken.srt", size: 8 });
    expect(shown()?.why).toMatch(/no cues/);
  });
});
