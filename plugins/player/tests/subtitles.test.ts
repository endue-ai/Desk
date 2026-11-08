// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseSubtitles, sameName, shift } from "../ui/subtitles.js";
import { decodeText } from "../ui/text.js";
import { file, fixture, mount } from "./harness";

const CUES = [
  { start: 1, end: 2.5, text: "Hello" },
  { start: 3, end: 4, text: "Two lines\nsecond line" },
  { start: 65.25, end: 67, text: "Last one" },
];

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello

2
00:00:03,000 --> 00:00:04,000
Two lines
second line

3
00:01:05,250 --> 00:01:07,000
Last <i>one</i>
`;

const VTT = `WEBVTT

NOTE a comment that is not a cue

intro
00:01.000 --> 00:02.500 align:start
Hello

00:00:03.000 --> 00:00:04.000
<v Ann>Two lines</v>
second line

00:01:05.250 --> 00:01:07.000
Last <i>one</i>
`;

const EVENTS = `[Script Info]
Title: Test

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\an8}Hello
Comment: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,not shown
Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Two lines\\Nsecond line
Dialogue: 0,0:01:05.25,0:01:07.00,Default,,0,0,0,,Last {\\i1}one{\\i0}
`;

const SSA = EVENTS.replace("[V4+ Styles]", "[V4 Styles]")
  .replace("Format: Layer,", "Format: Marked,")
  .replaceAll("Dialogue: 0,", "Dialogue: Marked=0,");

const SBV = `0:00:01.000,0:00:02.500
Hello

0:00:03.000,0:00:04.000
Two lines
second line

0:01:05.250,0:01:07.000
Last one
`;

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="en">
  <body><div>
    <p begin="00:00:01.000" end="00:00:02.500">Hello</p>
    <p begin="3s" dur="1s">Two lines<br/>second line</p>
    <p begin="00:01:05.250" end="00:01:07.000">Last <span tts:fontStyle="italic">one</span></p>
  </div></body>
</tt>`;

const DFXP = TTML.replace("http://www.w3.org/ns/ttml", "http://www.w3.org/2006/10/ttaf1");

const sami = (lines: string) => `<SAMI>
<HEAD>
<STYLE TYPE="text/css"><!--
P { margin-left: 8pt; }
.ENCC { Name: English; lang: en-US; }
.KRCC { Name: Korean; lang: ko-KR; }
--></STYLE>
</HEAD>
<BODY>
${lines}
</BODY>
</SAMI>`;

const SAMI = sami(`<SYNC Start=1000><P Class=ENCC>Hello
<SYNC Start=2500><P Class=ENCC>&nbsp;
<SYNC Start=3000><P Class=ENCC>Two lines<br>second line
<SYNC Start=4000><P Class=ENCC>&nbsp;
<SYNC Start=65250><P Class=ENCC>Last <i>one</i>
<SYNC Start=67000><P Class=ENCC>&nbsp;`);

describe("subtitle formats", () => {
  it.each([
    ["srt", SRT],
    ["srt", SRT.replaceAll("\n", "\r\n")],
    ["vtt", VTT],
    ["ass", EVENTS],
    ["ssa", SSA],
    ["sbv", SBV],
    ["ttml", TTML],
    ["dfxp", DFXP],
    ["smi", SAMI],
  ])("%s gives the same three cues", (format, text) => {
    expect(parseSubtitles(text, format).cues).toEqual(CUES);
  });

  it("the format comes from the text when the extension says nothing", () => {
    expect(parseSubtitles(VTT, "txt").format).toBe("vtt");
    expect(parseSubtitles(EVENTS, "txt").format).toBe("ass");
    expect(parseSubtitles(SAMI, "txt").format).toBe("sami");
    expect(parseSubtitles(TTML, "xml").format).toBe("ttml");
    expect(parseSubtitles(SRT, "txt").format).toBe("srt");
  });

  it("an EUC-KR SAMI file with two language classes", () => {
    const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
    const hello = [190, 200, 179, 231, 199, 207, 188, 188, 191, 228];
    const head = sami("@").split("@");
    const bytes = Uint8Array.from([
      ...ascii(`${head[0]}<SYNC Start=1000><P Class=ENCC>Hello\n<P Class=KRCC>`),
      ...hello,
      ...ascii(`\n<SYNC Start=2500><P Class=ENCC>&nbsp;\n<P Class=KRCC>&nbsp;${head[1]}`),
    ]);
    const decoded = decodeText(bytes);
    expect(decoded.encoding).toBe("euc-kr");
    const parsed = parseSubtitles(decoded.text, "smi");
    expect(parsed.languages).toEqual([
      { id: "ENCC", name: "English", lang: "en-US" },
      { id: "KRCC", name: "Korean", lang: "ko-KR" },
    ]);
    expect(parsed.cues).toEqual([{ start: 1, end: 2.5, text: "Hello" }]);
    expect(parseSubtitles(decoded.text, "smi", { language: "KRCC" }).cues).toEqual([
      { start: 1, end: 2.5, text: "안녕하세요" },
    ]);
  });

  it("UTF-8 and UTF-16 with a byte order mark", () => {
    const utf8 = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("é")]);
    expect(decodeText(utf8)).toEqual({ text: "é", encoding: "utf-8" });
    const le = Uint8Array.from([0xff, 0xfe, 0xe9, 0x00]);
    expect(decodeText(le)).toEqual({ text: "é", encoding: "utf-16le" });
    const be = Uint8Array.from([0xfe, 0xff, 0x00, 0xe9]);
    expect(decodeText(be)).toEqual({ text: "é", encoding: "utf-16be" });
    expect(decodeText(new TextEncoder().encode("plain"))).toEqual({
      text: "plain",
      encoding: "utf-8",
    });
  });

  it("the offset moves every cue", () => {
    expect(shift(CUES, 0.3)).toEqual([
      { start: 1.3, end: 2.8, text: "Hello" },
      { start: 3.3, end: 4.3, text: "Two lines\nsecond line" },
      { start: 65.55, end: 67.3, text: "Last one" },
    ]);
    expect(shift(CUES, -1.5)[0]).toEqual({ start: 0, end: 1, text: "Hello" });
  });
});

describe("subtitles next to a video", () => {
  it("same-name subtitles are found in the folder listing", () => {
    const names = ["film.mp4", "film.srt", "film.ko.srt", "film.en.vtt", "other.srt", "film.txt"];
    expect(sameName("film.mp4", names)).toEqual([
      { name: "film.srt", language: "" },
      { name: "film.en.vtt", language: "en" },
      { name: "film.ko.srt", language: "ko" },
    ]);
    expect(sameName("Film.MKV", ["FILM.SRT", "film.ass"])).toEqual([
      { name: "FILM.SRT", language: "" },
      { name: "film.ass", language: "" },
    ]);
  });

  it("the player offers them, draws the chosen one and moves it in 0.1 s steps", async () => {
    const V = file("~/Movies/film.mp4");
    const { host, app, shown, settle } = await mount({
      grants: ["~/Movies/**"],
      files: {
        [V.path]: fixture("clip.mp4"),
        "~/Movies/film.srt": SRT,
        "~/Movies/film.ko.srt": SRT.replace("Hello", "안녕"),
        "~/Movies/other.srt": SRT,
      },
    });
    await host.command("desk.files.visit", V);
    await settle();
    expect(shown()?.subtitles).toEqual({
      options: [
        { id: "~/Movies/film.srt", label: "film.srt" },
        { id: "~/Movies/film.ko.srt", label: "film.ko.srt (ko)" },
      ],
      selected: "~/Movies/film.srt",
      offset: 0,
    });
    expect(shown()?.cues).toEqual(CUES);

    app.offset(0.1);
    app.offset(0.1);
    await settle();
    expect(shown()?.subtitles?.offset).toBe(0.2);
    expect(shown()?.cues?.[0]).toEqual({ start: 1.2, end: 2.7, text: "Hello" });

    app.subtitle("~/Movies/film.ko.srt");
    await settle();
    expect(shown()?.cues?.[0]?.text).toBe("안녕");
    app.subtitle("");
    await settle();
    expect(shown()?.cues).toEqual([]);
  });

  it("a subtitle file opened alone shows its cues with times", async () => {
    const S = file("~/Movies/film.vtt");
    const { host, shown } = await mount({ grants: ["~/Movies/**"], files: { [S.path]: VTT } });
    await host.command("desk.files.visit", S);
    expect(shown()).toMatchObject({ mode: "cues", format: "WebVTT", cues: CUES });
  });
});
