// @vitest-environment jsdom
import type { UniversalData, UniversalView } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { viewOf } from "./views";

// The shell's calendar, tomorrow and notes samples are universal views with inline data (ADR
// 0103), drawn in their pane by <desk-universal-view> on the shell's language and wall clock.
const WALL = Date.parse("2026-10-28T09:00:00.000Z"); // a Wednesday

function ctx(lang: "ko" | "en"): ShellCtx {
  const store = new Store(sampleState(lang, 0));
  return {
    store,
    wall: () => WALL,
    tr: (key: string) => (key === "overlap" ? "Overlap" : key),
  } as unknown as ShellCtx;
}

type Drawn = HTMLElement & { view: Omit<UniversalView, "source">; data: UniversalData };

function drawn(view: string, lang: "ko" | "en" = "en"): Drawn {
  const { el } = viewOf(ctx(lang), view).mount({ surface: "s", pane: "p" });
  return el as Drawn;
}

describe("the shell's sample panes", () => {
  it("draws the calendar as this week of events, Monday to Friday, the overlapping two tagged", () => {
    const el = drawn("calendar");
    expect(el.localName).toBe("desk-universal-view");
    expect(el.view).toEqual({ type: "calendar", options: { range: "week", zone: "UTC" } });
    expect(el.getAttribute("now")).toBe("2026-10-28T09:00:00.000Z");
    expect(el.getAttribute("locale")).toBe("en-US");
    const entries = el.data.entries.map((e) => [e.title, e.start, e.end, e.tags]);
    expect(entries).toEqual([
      ["Standup", "2026-10-26T09:30:00Z", "2026-10-26T10:30:00Z", undefined],
      ["Design review", "2026-10-27T11:00:00Z", "2026-10-27T12:30:00Z", undefined],
      ["Client call", "2026-10-28T14:00:00Z", "2026-10-28T15:00:00Z", ["Overlap"]],
      ["Budget sync", "2026-10-28T14:30:00Z", "2026-10-28T16:00:00Z", ["Overlap"]],
      ["1:1 Theo", "2026-10-29T10:00:00Z", "2026-10-29T11:00:00Z", undefined],
      ["Focus", "2026-10-30T13:00:00Z", "2026-10-30T14:00:00Z", undefined],
    ]);
    // Drawn as a calendar in the element's own shadow root.
    expect(el.shadowRoot?.querySelector(".body")?.childElementCount).toBeGreaterThan(0);
  });

  it("draws tomorrow's list as four entries in order, in the shell's language", () => {
    const en = drawn("tomorrow");
    expect(en.view).toEqual({ type: "list" });
    expect(en.data.entries.map((e) => e.title)).toEqual([
      "Prepare for the 09:30 standup",
      "Send the meeting notes to Theo",
      "Pick one of the two flights",
      "Decide the 14:00 overlap",
    ]);
    const ko = drawn("tomorrow", "ko");
    expect(ko.getAttribute("locale")).toBe("ko-KR");
    expect(ko.data.entries[0]?.title).toBe("09:30 스탠드업 준비");
  });

  it("draws the notes as a text view under a line that adds one on Enter", () => {
    const { el } = viewOf(ctx("en"), "notes").mount({ surface: "s", pane: "p" });
    const view = el.querySelector("desk-universal-view") as Drawn;
    expect(view.view).toEqual({ type: "text" });
    const texts = () => view.data.entries.map((e) => e.text);
    expect(texts()).toEqual(["Keep profile names short.", "Surfaces live at the edges."]);
    const line = el.querySelector<HTMLTextAreaElement>("textarea.notes-input");
    if (!line) throw new Error("no line to write a note");
    line.value = "Ship the one view language";
    const enter = (shiftKey: boolean) =>
      line.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey, cancelable: true }),
      );
    // Shift+Enter breaks the line; Enter adds the note and empties the line.
    expect(enter(true)).toBe(true);
    expect(enter(false)).toBe(false);
    expect(texts()).toEqual([
      "Keep profile names short.",
      "Surfaces live at the edges.",
      "Ship the one view language",
    ]);
    expect(line.value).toBe("");
  });
});
