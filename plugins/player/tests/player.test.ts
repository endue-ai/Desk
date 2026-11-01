import { describe, expect, it } from "vitest";
import { file, fixture, mount } from "./harness";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const SONG = Uint8Array.from([
  ...ascii("MThd"),
  ...be32(6),
  0,
  0,
  0,
  1,
  0,
  96,
  ...ascii("MTrk"),
  ...be32(12),
  ...[0, 0x90, 69, 80, 96, 0x80, 69, 0, 0, 0xff, 0x2f, 0],
]);

/** An OfflineAudioContext that renders silence at once. */
const silence = (channels: number, length: number, sampleRate: number) => {
  const node = () => ({
    connect: () => {},
    start: () => {},
    stop: () => {},
    type: "",
    buffer: null as unknown,
    gain: param(),
    frequency: param(),
    Q: param(),
  });
  const buffer = (n: number, l: number, r: number) => {
    const data = Array.from({ length: n }, () => new Float32Array(l));
    return {
      length: l,
      sampleRate: r,
      getChannelData: (c: number) => data[c] ?? new Float32Array(0),
    };
  };
  return {
    destination: {},
    sampleRate,
    createOscillator: node,
    createGain: node,
    createBiquadFilter: node,
    createBufferSource: node,
    createBuffer: buffer,
    startRendering: async () => buffer(channels, length, sampleRate),
  };
};
const param = () => ({
  setValueAtTime: () => {},
  linearRampToValueAtTime: () => {},
  exponentialRampToValueAtTime: () => {},
  setTargetAtTime: () => {},
});

describe("files the player plays itself", () => {
  it("a MIDI file is rendered, then plays as a WAV through a blob: URL", async () => {
    const M = file("~/Music/song.mid");
    const { host, shown, settle, view } = await mount({
      grants: ["~/Music/**"],
      files: { [M.path]: SONG },
      options: { audioContext: silence },
    });
    await host.command("desk.files.visit", M);
    // A song renders after the visit has answered; a quick one may be ready by then.
    expect(view.models.at(-1)?.mode).toMatch(/^(loading|media)$/);
    await settle();
    expect(shown()).toMatchObject({ mode: "media", element: "audio", src: "blob:endue.player/1" });
    expect(shown()?.info).toMatchObject({ container: "Standard MIDI File", duration: 0.5 });
  });

  it("without Web Audio a MIDI file opens as details", async () => {
    const M = file("~/Music/song.midi");
    const { host, shown } = await mount({ grants: ["~/Music/**"], files: { [M.path]: SONG } });
    await host.command("desk.files.visit", M);
    expect(shown()).toMatchObject({
      mode: "details",
      why: "This system has no Web Audio to play MIDI with.",
    });
  });

  it("an AU file is decoded into a WAV", async () => {
    const S = file("~/Music/tone.snd");
    const { host, shown } = await mount({
      grants: ["~/Music/**"],
      files: { [S.path]: fixture("tone.au") },
    });
    await host.command("desk.files.visit", S);
    expect(shown()).toMatchObject({
      mode: "media",
      element: "audio",
      src: "blob:endue.player/1",
      format: "Sun AU",
    });
    expect(shown()?.info?.tracks[0]).toMatchObject({ codec: "μ-law", sampleRate: 8000 });
  });
});

describe("what the readers and the webview decide", () => {
  it("unknown bytes with a media extension go to the webview, and its error opens details", async () => {
    const X = file("~/Movies/odd.mov");
    const { host, app, shown, settle } = await mount({
      grants: ["~/Movies/**"],
      files: { [X.path]: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) },
    });
    await host.command("desk.files.visit", X);
    expect(shown()).toMatchObject({ mode: "media", element: "video" });
    app.failed();
    await settle();
    expect(shown()).toMatchObject({
      mode: "details",
      why: "This system's WebKit cannot play odd.mov.",
    });
  });

  it("a codec canPlayType refuses is named on its own", async () => {
    const V = file("~/Movies/clip.mp4");
    const { host, view, shown } = await mount({
      grants: ["~/Movies/**"],
      files: { [V.path]: fixture("clip.mp4") },
    });
    view.playable = (type) => (type.includes("avc1") ? "" : "maybe");
    await host.command("desk.files.visit", V);
    expect(shown()?.why).toBe("This system's WebKit cannot play MP4 with H.264.");
    expect(view.asked).toEqual(["video/mp4", expect.stringMatching(/^video\/mp4; codecs="avc1\./)]);
  });

  it("revert keeps the position; the store is left alone for a short file", async () => {
    const V = file("~/Movies/clip.mp4");
    const { host, app, shown, store } = await mount({
      grants: ["~/Movies/**"],
      files: { [V.path]: fixture("clip.mp4") },
    });
    await host.command("desk.files.visit", V);
    app.progress({ time: 0.6, duration: 1, paused: true });
    await host.command("desk.files.revert", V);
    expect(shown()).toMatchObject({ mode: "media", start: 0.6 });
    expect(store).toEqual({});
  });

  it("a SAMI file next to a video offers each of its languages", async () => {
    const V = file("~/Movies/film.mp4");
    const sami = `<SAMI><HEAD><STYLE TYPE="text/css"><!--
.ENCC { Name: English; lang: en-US; }
.KRCC { Name: Korean; lang: ko-KR; }
--></STYLE></HEAD><BODY>
<SYNC Start=1000><P Class=ENCC>Hello<P Class=KRCC>안녕
<SYNC Start=2000><P Class=ENCC>&nbsp;<P Class=KRCC>&nbsp;
</BODY></SAMI>`;
    const { host, app, shown, settle } = await mount({
      grants: ["~/Movies/**"],
      files: { [V.path]: fixture("clip.mp4"), "~/Movies/film.smi": sami },
    });
    await host.command("desk.files.visit", V);
    await settle();
    expect(shown()?.subtitles?.options).toEqual([
      { id: "~/Movies/film.smi#ENCC", label: "film.smi (English)" },
      { id: "~/Movies/film.smi#KRCC", label: "film.smi (Korean)" },
    ]);
    expect(shown()?.cues).toEqual([{ start: 1, end: 2, text: "Hello" }]);
    app.subtitle("~/Movies/film.smi#KRCC");
    await settle();
    expect(shown()?.cues).toEqual([{ start: 1, end: 2, text: "안녕" }]);
  });

  it("a playlist entry is picked by its index", async () => {
    const P = file("~/Music/list.pls");
    const { host, app, shown, settle } = await mount({
      grants: ["~/Music/**"],
      files: {
        [P.path]: "[playlist]\nFile1=a.mp3\nFile2=b.flac\nFile3=c.wav\n",
        "~/Music/a.mp3": fixture("tone-v24.mp3"),
        "~/Music/b.flac": fixture("tone.flac"),
        "~/Music/c.wav": fixture("tone.wav"),
      },
    });
    await host.command("desk.files.visit", P);
    app.pick(2);
    await settle();
    expect(shown()).toMatchObject({
      item: { path: "~/Music/c.wav", name: "c.wav" },
      format: "WAV",
    });
    expect(shown()?.playlist?.index).toBe(2);
  });

  it("a stall is said in words", async () => {
    const V = file("~/Movies/clip.mp4");
    const { host, app, view } = await mount({
      grants: ["~/Movies/**"],
      files: { [V.path]: fixture("clip.mp4") },
    });
    await host.command("desk.files.visit", V);
    app.stalled();
    expect(view.statuses.at(-1)).toMatch(/^Playback stopped: clip\.mp4 can no longer be read\./);
  });
});
