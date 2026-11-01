import { describe, expect, it } from "vitest";
import { probe } from "../ui/probe/index.js";
import { type Caps, route, routeUnread } from "../ui/route.js";
import { memorySource } from "../ui/source.js";
import { file, fixture, mount } from "./harness";

/** What WKWebView on macOS answered in the live check (canPlayType and MSE's isTypeSupported). */
const CONTAINERS: Record<string, string> = {
  "video/mp4": "maybe",
  "audio/mp4": "maybe",
  "video/quicktime": "maybe",
  "video/webm": "maybe",
  "audio/webm": "maybe",
  "audio/ogg": "maybe",
  "audio/mpeg": "maybe",
  "audio/aac": "maybe",
  "audio/wav": "maybe",
  "audio/flac": "maybe",
  "audio/aiff": "maybe",
  "audio/x-caf": "maybe",
  "video/x-msvideo": "maybe",
  "video/mp2t": "maybe",
  "video/mpeg": "maybe",
  "video/3gpp": "maybe",
};
const CODECS = /^(avc1|hvc1|hev1|mp4a|vp09|vp8|vp9|av01|opus|vorbis|flac|ac-3|ec-3|alac|mp3)/;

const webkit: Caps = {
  canPlay(type) {
    const [mime = "", rest] = type.split(";");
    const container = CONTAINERS[mime.trim()] ?? "";
    if (!rest || container === "") return container;
    const codecs = /codecs="([^"]*)"/.exec(rest)?.[1] ?? "";
    return codecs.split(",").every((c) => CODECS.test(c.trim())) ? "probably" : "";
  },
  canRemux: (type) => /(avc1|hvc1|vp09|av01|mp4a\.40|Opus|fLaC|alac|ac-3|ec-3|ipcm)/.test(type),
  software: true,
};

const engines = async (name: string, caps: Caps = webkit) =>
  route(await probe(memorySource(fixture(name)), name), caps).engines;

describe("which engine plays each extension", () => {
  it("what WebKit plays itself stays native", async () => {
    expect(await engines("clip.mp4")).toEqual(["native"]);
    expect(await engines("clip.mov")).toEqual(["native"]);
    // The decoder is the fallback for the sound it also decodes.
    expect(await engines("tone-v23.mp3")).toEqual(["native", "software"]);
    expect(await engines("tone.m4a")).toEqual(["native", "software"]);
    expect(await engines("tone.flac")).toEqual(["native", "software"]);
    // WebM and Ogg Opus play natively; the remuxer is the next engine.
    expect(await engines("remux/vp9-opus.webm")).toEqual(["native", "remux"]);
    expect(await engines("tone.opus")).toEqual(["native", "remux"]);
    expect(await engines("tone.ogg")).toEqual(["native", "software"]);
  });

  it("MKV, FLV, MXF and MPEG-TS with codecs WebKit decodes remux to MSE", async () => {
    expect(await engines("remux/h264-aac.mkv")).toEqual(["remux"]);
    expect(await engines("remux/hevc-ac3.mkv")).toEqual(["remux"]);
    expect(await engines("clip.mkv")).toEqual(["remux"]);
    expect(await engines("remux/h264-aac.flv")).toEqual(["remux"]);
    // MXF's reader names no tracks: the remuxer looks first, the decoder after.
    expect(await engines("remux/h264-pcm.mxf")).toEqual(["remux", "software"]);
    // canPlayType says "maybe" for AVI and MPEG-TS on macOS: the element is the last resort.
    expect(await engines("remux/h264-mp3.avi")).toEqual(["remux", "native"]);
    expect(await engines("remux/h264-ac3.m2ts")).toEqual(["remux", "native"]);
  });

  it("codecs WebKit lacks go to the software decoder", async () => {
    expect(await engines("clip.avi")).toEqual(["software", "native"]);
    expect(await engines("clip.wmv")).toEqual(["software"]);
    expect(await engines("decode/vc1.wmv")).toEqual(["software"]);
    expect(await engines("decode/theora.ogv")).toEqual(["software"]);
    expect(await engines("clip.rm")).toEqual(["software"]);
    expect(await engines("decode/clip.rmvb")).toEqual(["software"]);
    expect(await engines("clip.vob")).toEqual(["software", "native"]);
    expect(await engines("tone.wma")).toEqual(["software"]);
    expect(await engines("tone.wv")).toEqual(["software"]);
    expect(await engines("decode/tone.dsf")).toEqual(["software"]);
    expect(await engines("decode/tone.dff")).toEqual(["software"]);
    expect(await engines("tone-vorbis.mka")).toEqual(["software"]);
    expect(await engines("tone-aac.mka")).toEqual(["remux", "software"]);
  });

  it("without MSE or the decoder, what WebKit refuses has no engine", async () => {
    const bare: Caps = { ...webkit, canRemux: () => false, software: false };
    expect(await engines("remux/hevc-ac3.mkv", bare)).toEqual([]);
    expect(await engines("clip.wmv", bare)).toEqual([]);
    expect(await engines("clip.avi", bare)).toEqual(["native"]);
    const info = await probe(memorySource(fixture("clip.wmv")), "clip.wmv");
    expect(route(info, bare).why).toBe(
      "This system's WebKit cannot play Windows Media with Windows Media Video 8 and Windows Media Audio 2.",
    );
  });

  it("HEVC on a system whose MSE lacks it is not remuxed", async () => {
    const noHevc: Caps = { ...webkit, canRemux: (t) => !t.includes("hvc1") && webkit.canRemux(t) };
    expect(await engines("remux/hevc-ac3.mkv", noHevc)).toEqual([]);
    expect(await engines("remux/h264-aac.mkv", noHevc)).toEqual(["remux"]);
  });
});

/** A copy of `bytes` with every `from` (ASCII or bytes) replaced by `to` of the same length. */
function patch(bytes: Uint8Array, from: number[], to: number[]) {
  const out = bytes.slice();
  for (let i = 0; i + from.length <= out.length; i++)
    if (from.every((b, j) => out[i + j] === b)) out.set(to, i);
  return out;
}
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
/** An ASF GUID's bytes as written (the first three fields little-endian). */
const guid = (text: string) => {
  const hex = text.replace(/-/g, "");
  const bytes = [...hex.matchAll(/../g)].map((m) => Number.parseInt(m[0], 16));
  return [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => bytes[i] ?? 0);
};

describe("protected and damaged files open the details view", () => {
  it("an encrypted MP4 (Common Encryption) is said to be protected", async () => {
    const bytes = patch(fixture("clip.mp4"), ascii("avc1"), ascii("encv"));
    const info = await probe(memorySource(bytes), "locked.mp4");
    expect(info.drm).toBe("Common Encryption");
    expect(route(info, webkit)).toEqual({
      engines: [],
      why: "This MP4 file is protected with Common Encryption: the player cannot play it.",
    });
  });

  it("a Windows Media file with DRM is said to be protected", async () => {
    const content = guid("75B22633-668E-11CF-A6D9-00AA0062CE6C");
    const drm = guid("2211B3FB-BD23-11D2-B4B7-00A0C955FC6E");
    const info = await probe(memorySource(patch(fixture("tone.wma"), content, drm)), "x.wma");
    expect(route(info, webkit).why).toBe(
      "This Windows Media file is protected with Windows Media DRM: the player cannot play it.",
    );
  });

  it("a damaged container goes to the decoder alone, or straight to the details", () => {
    const why = "The EBML header is damaged.";
    expect(routeUnread("matroska", why, webkit)).toEqual({ engines: ["software"], why });
    expect(routeUnread("matroska", why, { ...webkit, software: false })).toEqual({
      engines: [],
      why,
    });
    expect(routeUnread("", why, webkit).engines).toEqual(["native", "software"]);
  });

  it("visiting a damaged MKV opens the details with the reader's reason", async () => {
    const M = file("~/Movies/broken.mkv");
    const bytes = fixture("remux/hevc-ac3.mkv").slice(0, 4096);
    bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0, 0, 0], 0);
    const { host, shown } = await mount({ files: { [M.path]: bytes }, grants: ["~/Movies/**"] });
    await host.command("desk.files.visit", M);
    expect(shown()).toMatchObject({ mode: "details", name: "broken.mkv", format: "Matroska" });
    expect(shown()?.why).toMatch(/Matroska|EBML|segment/);
    expect(shown()?.src).toBeUndefined();
  });
});

describe("the player follows the route", () => {
  const caps = { remuxable: webkit.canRemux, decodes: true };

  it("an MKV with HEVC plays through the remuxer", async () => {
    const M = file("~/Movies/clip.mkv");
    const { host, view, shown } = await mount({
      files: { [M.path]: fixture("remux/hevc-ac3.mkv") },
      grants: ["~/Movies/**"],
    });
    Object.assign(view, caps, { playable: (t: string) => webkit.canPlay(t) });
    await host.command("desk.files.visit", M);
    expect(shown()).toMatchObject({
      mode: "media",
      element: "video",
      engine: "remux",
      target: { path: M.path, format: "matroska" },
    });
    expect(shown()?.src).toBeTruthy();
  });

  it("a WMV plays in software, and a failure of the last engine opens the details", async () => {
    const W = file("~/Movies/clip.wmv");
    const { host, app, view, shown, settle } = await mount({
      files: { [W.path]: fixture("clip.wmv") },
      grants: ["~/Movies/**"],
    });
    Object.assign(view, caps, { playable: (t: string) => webkit.canPlay(t) });
    await host.command("desk.files.visit", W);
    expect(shown()).toMatchObject({ mode: "media", element: "video", engine: "software" });
    app.failed("The player's decoders cannot decode this file.");
    await settle();
    expect(shown()).toMatchObject({
      mode: "details",
      why: "The player's decoders cannot decode this file.",
    });
  });

  it("an AVI the element fails on goes to the next engine", async () => {
    const A = file("~/Movies/clip.avi");
    const { host, app, view, shown, settle } = await mount({
      files: { [A.path]: fixture("clip.avi") },
      grants: ["~/Movies/**"],
    });
    Object.assign(view, caps, { decodes: false, playable: (t: string) => webkit.canPlay(t) });
    await host.command("desk.files.visit", A);
    expect(shown()).toMatchObject({ mode: "media", engine: "native" });
    app.failed();
    await settle();
    expect(shown()).toMatchObject({
      mode: "details",
      why: "This system's WebKit cannot play AVI with MPEG-4 Part 2 and MP3.",
    });
  });
});
