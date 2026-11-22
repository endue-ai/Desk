// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { findView } from "../ui/find-view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const previous = { folder: "~/Documents", query: "ph", below: true, busy: true };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = html;
});
afterEach(() => vi.useRealTimers());

function startTyping() {
  const actions = {
    below: vi.fn(),
    filter: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    openFound: vi.fn(),
    revealFound: vi.fn(),
  };
  const view = findView(document, actions, vi.fn());
  view.render(previous);
  const input = document.querySelector<HTMLInputElement>("#find-query")!;
  input.value = "pic";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return { actions, view, input };
}

it.each(["Enter", "typing delay"])(
  "submits the latest edit on %s after an older search completes",
  (how) => {
    const { actions, view, input } = startTyping();
    view.render({ ...previous, busy: false, results: [] });
    expect(input.value).toBe("pic");
    if (how === "Enter")
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    vi.runAllTimers();
    expect(actions.below.mock.calls).toEqual([["pic"]]);
  },
);

it("an explicit search can replace an edit and cancel its pending submit", () => {
  const { actions, view, input } = startTyping();
  view.render({ ...previous, folder: "~/Pictures", query: "sun" });
  expect(input.value).toBe("sun");
  vi.runAllTimers();
  expect(actions.below).not.toHaveBeenCalled();
});
