// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defineElements } from "../../../packages/ui/src/elements/index";

defineElements();

import type { DeskProgress } from "../../../packages/ui/src/elements/progress";
import { createView } from "../ui/view.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
it("shows Reading after 300 ms, updates Parsing and hides on the first sheet", async () => {
  vi.useFakeTimers();
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  const view = createView(document);
  const progress = document.querySelector("desk-progress") as DeskProgress;
  expect(progress, "the surface includes the shared progress component").not.toBeNull();
  const cancel = vi.fn();
  view.progress({ label: "Reading", value: 12, max: 24, detail: "12 of 24 bytes", cancel });
  await vi.advanceTimersByTimeAsync(299);
  expect(progress.shown).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(progress.shown).toBe(true);
  expect([progress.label, progress.value, progress.max, progress.detail]).toEqual([
    "Reading",
    12,
    24,
    "12 of 24 bytes",
  ]);
  view.progress({ label: "Parsing", value: 1, max: 2, detail: "1 of 2 sheets", cancel });
  expect(progress.shown).toBe(true);
  progress.shadowRoot?.querySelector("button")?.click();
  expect(cancel).toHaveBeenCalledOnce();
  view.progress(null);
  expect(progress.hidden).toBe(true);
  expect(progress.shown).toBe(false);
});
