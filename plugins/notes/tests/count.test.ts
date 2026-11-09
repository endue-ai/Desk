// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { countText } from "../ui/count.js";
import { createView } from "../ui/view.js";

beforeEach(() => {
  document.documentElement.innerHTML = readFileSync(resolve("plugins/notes/ui/index.html"), "utf8");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The counting worker's answers, a turn later, as the real worker's would come. */
const inPlace = () => ({
  texts: [] as string[],
  count(text: string) {
    this.texts.push(text);
    return Promise.resolve().then(() => countText(text));
  },
  cancel() {},
});
const detail = () => (document.getElementById("note-detail") as HTMLElement).textContent ?? "";

it("shows the word and character counts for the shown note and updates while typing", async () => {
  const view = createView(document, { edit() {} }, inPlace());
  view.note({ buffer: "a", path: "~/a.md", name: "a.md", text: "hello world", modified: false });
  await vi.waitFor(() => expect(detail()).toContain("2 words · 11 characters"));

  const textarea = document.getElementById("note-text") as HTMLTextAreaElement;
  textarea.value = "안녕하세요 여러분 반갑습니다";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(detail()).toContain("3 words · 15 characters"));

  view.note({ buffer: "b", path: "~/b.md", name: "b.md", text: "hello world", modified: false });
  await vi.waitFor(() => expect(detail()).toContain("2 words · 11 characters"));
  view.note(null);
  expect(detail()).not.toContain("words");
});

it("never segments text on the frame's thread: the counter does", async () => {
  const segmenter = vi.spyOn(Intl, "Segmenter");
  // A counter that answers without segmenting: whatever segments here, the view did.
  const counter = {
    texts: [] as string[],
    count(text: string) {
      this.texts.push(text);
      return Promise.resolve({ words: text.split(" ").length, characters: text.length });
    },
    cancel() {},
  };
  const view = createView(document, { edit() {} }, counter);
  view.note({ buffer: "a", path: "~/a.md", name: "a.md", text: "one two", modified: false });
  const textarea = document.getElementById("note-text") as HTMLTextAreaElement;
  textarea.value = "one two three";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(detail()).toContain("3 words"));
  expect(segmenter).not.toHaveBeenCalled();
  expect(counter.texts).toEqual(["one two", "one two three"]);
});

it("typing counts once the keys pause, the last text only", async () => {
  vi.useFakeTimers();
  const counter = inPlace();
  const view = createView(document, { edit() {} }, counter);
  view.note({ buffer: "a", path: "~/a.md", name: "a.md", text: "a", modified: false });
  const textarea = document.getElementById("note-text") as HTMLTextAreaElement;
  for (const value of ["a b", "a b c", "a b c d"]) {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(100);
  }
  expect(counter.texts).toEqual(["a"]);
  vi.advanceTimersByTime(100);
  expect(counter.texts).toEqual(["a", "a b c d"]);
  await vi.waitFor(() => expect(detail()).toContain("4 words · 7 characters"));
});

it("a long count says so after 300 ms, and a newer text's counts win over an older one's", async () => {
  vi.useFakeTimers();
  const answers = new Map<string, (counts: { words: number; characters: number }) => void>();
  const counter = {
    count: (text: string) =>
      new Promise<{ words: number; characters: number }>((done) => answers.set(text, done)),
    cancel: vi.fn(),
  };
  const view = createView(document, { edit() {} }, counter);
  view.note({ buffer: "a", path: "~/a.md", name: "a.md", text: "big", modified: false });
  vi.advanceTimersByTime(299);
  expect(detail()).not.toContain("Counting");
  vi.advanceTimersByTime(1);
  expect(detail()).toContain("Counting…");

  view.note({ buffer: "b", path: "~/b.md", name: "b.md", text: "small", modified: false });
  answers.get("small")?.({ words: 1, characters: 5 });
  answers.get("big")?.({ words: 999, characters: 9999 });
  await vi.waitFor(() => expect(detail()).toContain("1 words · 5 characters"));
  expect(detail()).not.toContain("999");

  view.note(null);
  expect(counter.cancel).toHaveBeenCalledTimes(1);
});
