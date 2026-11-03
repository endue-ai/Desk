// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { createView } from "../ui/view.js";

beforeEach(() => {
  document.documentElement.innerHTML = readFileSync(resolve("plugins/notes/ui/index.html"), "utf8");
});

it("shows the word and character counts for the shown note and updates while typing", () => {
  const view = createView(document, { edit() {} });
  view.note({ buffer: "a", path: "~/a.md", name: "a.md", text: "hello world", modified: false });
  const detail = document.getElementById("note-detail") as HTMLElement;
  expect(detail.textContent).toContain("2 words · 11 characters");

  const textarea = document.getElementById("note-text") as HTMLTextAreaElement;
  textarea.value = "안녕하세요 여러분 반갑습니다";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  expect(detail.textContent).toContain("3 words · 15 characters");

  view.note({ buffer: "b", path: "~/b.md", name: "b.md", text: "hello world", modified: false });
  expect(detail.textContent).toContain("2 words · 11 characters");
  view.note(null);
  expect(detail.textContent).not.toContain("words");
});
