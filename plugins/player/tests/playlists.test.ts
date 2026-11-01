// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parsePlaylist, resolvePath } from "../ui/playlists.js";
import { file, fixture, mount } from "./harness";

const LIST = "~/Music/lists/mix.m3u";

describe("playlist formats", () => {
  it("M3U with #EXTINF titles; relative paths resolve against the playlist", () => {
    const text = `#EXTM3U
#EXTINF:123,Artist - First
first.mp3
#EXTINF:-1,Second
../albums/second.flac
/Users/someone/Music/third.ogg
file:///Users/someone/Music/My%20Song.m4a
#EXTINF:0,Radio
https://radio.example/stream.mp3
sub\\fourth.wav
`;
    expect(parsePlaylist(text, "m3u", LIST)).toEqual({
      format: "m3u",
      entries: [
        { path: "~/Music/lists/first.mp3", title: "Artist - First", duration: 123 },
        { path: "~/Music/albums/second.flac", title: "Second" },
        { path: "/Users/someone/Music/third.ogg", title: "third.ogg" },
        { path: "/Users/someone/Music/My Song.m4a", title: "My Song.m4a" },
        { url: "https://radio.example/stream.mp3", title: "Radio", remote: true },
        { path: "~/Music/lists/sub/fourth.wav", title: "fourth.wav" },
      ],
    });
  });

  it("PLS", () => {
    const text = `[playlist]
File1=one.mp3
Title1=One
Length1=61
File2=http://radio.example/live
Title2=Live
NumberOfEntries=2
Version=2
`;
    expect(parsePlaylist(text, "pls", LIST).entries).toEqual([
      { path: "~/Music/lists/one.mp3", title: "One", duration: 61 },
      { url: "http://radio.example/live", title: "Live", remote: true },
    ]);
  });

  it("XSPF", () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <trackList>
    <track><location>one.mp3</location><title>One</title><creator>Band</creator><duration>61000</duration></track>
    <track><location>file:///Users/someone/Music/two%20b.flac</location></track>
    <track><location>https://radio.example/three.ogg</location><title>Three</title></track>
  </trackList>
</playlist>`;
    expect(parsePlaylist(text, "xspf", LIST).entries).toEqual([
      { path: "~/Music/lists/one.mp3", title: "Band - One", duration: 61 },
      { path: "/Users/someone/Music/two b.flac", title: "two b.flac" },
      { url: "https://radio.example/three.ogg", title: "Three", remote: true },
    ]);
  });

  it("CUE: one file with track indexes becomes chapters", () => {
    const text = `REM GENRE Test
PERFORMER "Band"
TITLE "Album"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Opening"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Second"
    PERFORMER "Guest"
    INDEX 00 03:24:00
    INDEX 01 03:25:37
`;
    const list = parsePlaylist(text, "cue", "~/Music/album.cue");
    expect(list.entries).toEqual([
      {
        path: "~/Music/album.flac",
        title: "Band - Album",
        chapters: [
          { title: "Opening", start: 0 },
          { title: "Guest - Second", start: 205 + 37 / 75 },
        ],
      },
    ]);
  });

  it("resolves paths the way the desk writes them", () => {
    expect(resolvePath("~/a/b/list.m3u", "../c.mp3")).toBe("~/a/c.mp3");
    expect(resolvePath("~/a/list.m3u", "./x/./y.mp3")).toBe("~/a/x/y.mp3");
    expect(resolvePath("/srv/list.m3u", "../../z.mp3")).toBe("/z.mp3");
    expect(resolvePath("~/list.m3u", "~/Music/q.mp3")).toBe("~/Music/q.mp3");
  });
});

describe("playing a playlist", () => {
  it("plays local entries in order with next and previous; remote ones are listed, not played", async () => {
    const P = file("~/Music/mix.m3u");
    const { host, app, shown, params, settle } = await mount({
      grants: ["~/Music/**"],
      files: {
        [P.path]: "#EXTM3U\none.mp3\nhttps://radio.example/live\n#EXTINF:5,Two\ntwo.flac\n",
        "~/Music/one.mp3": fixture("tone-v23.mp3"),
        "~/Music/two.flac": fixture("tone.flac"),
      },
    });
    await host.command("desk.files.visit", P);
    expect(shown()).toMatchObject({ mode: "media", element: "audio", path: P.path });
    expect(shown()?.playlist?.index).toBe(0);
    expect(shown()?.playlist?.rows).toEqual([
      { title: "one.mp3", detail: "", state: "playing" },
      { title: "https://radio.example/live", detail: "Remote: not played", state: "remote" },
      { title: "Two", detail: "0:05", state: "queued" },
    ]);
    expect(params("fs.url").map((p) => (p as { path: string }).path)).toEqual(["~/Music/one.mp3"]);

    app.next();
    await settle();
    expect(shown()?.playlist?.index).toBe(2);
    expect(shown()?.info?.container).toBe("FLAC");
    app.next();
    await settle();
    expect(shown()?.playlist?.index).toBe(2);
    app.previous();
    await settle();
    expect(shown()?.playlist?.index).toBe(0);

    app.ended();
    await settle();
    expect(shown()?.playlist?.index).toBe(2);
  });

  it("a CUE sheet plays its file with the tracks as chapters", async () => {
    const C = file("~/Music/album.cue");
    const { host, shown } = await mount({
      grants: ["~/Music/**"],
      files: {
        [C.path]:
          'FILE "album.flac" WAVE\n TRACK 01 AUDIO\n  TITLE "A"\n  INDEX 01 00:00:00\n TRACK 02 AUDIO\n  TITLE "B"\n  INDEX 01 00:00:30\n',
        "~/Music/album.flac": fixture("tone.flac"),
      },
    });
    await host.command("desk.files.visit", C);
    expect(shown()).toMatchObject({ mode: "media", element: "audio" });
    expect(shown()?.chapters).toEqual([
      { title: "A", start: 0 },
      { title: "B", start: 0.4 },
    ]);
  });

  it("an entry that is gone is marked and skipped", async () => {
    const P = file("~/Music/gone.m3u");
    const { host, shown } = await mount({
      grants: ["~/Music/**"],
      files: { [P.path]: "missing.mp3\none.mp3\n", "~/Music/one.mp3": fixture("tone-v24.mp3") },
    });
    await host.command("desk.files.visit", P);
    expect(shown()?.playlist?.index).toBe(1);
    expect(shown()?.playlist?.rows[0]).toEqual({
      title: "missing.mp3",
      detail: "Not found",
      state: "missing",
    });
  });
});
