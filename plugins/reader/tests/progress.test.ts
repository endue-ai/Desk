// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { defineElements } from "../../../packages/ui/src/elements/index";
import type { DeskProgress } from "../../../packages/ui/src/elements/progress";
import { createView } from "../ui/view.js";
import { loadPage } from "./harness";

defineElements();
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("shows opening and decoding phases after 300 ms and routes Cancel", async () => {
  vi.useFakeTimers();
  loadPage(document);
  const action = () => {};
  const view = createView(document, {
    moved: action,
    zoomed: action,
    bookmark: action,
    note: action,
    forget: action,
    unlock: action,
  });
  const progress = document.querySelector("desk-progress") as DeskProgress;
  expect(progress, "Reader includes the shared progress element").not.toBeNull();
  const cancel = vi.fn();
  view.progress({ label: "Reading", value: 1024, max: 4096, detail: "1024 of 4096 bytes", cancel });
  await vi.advanceTimersByTimeAsync(299);
  expect(progress.shown).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(progress.shown).toBe(true);
  expect([progress.label, progress.value, progress.max]).toEqual(["Reading", 1024, 4096]);
  view.progress({ label: "Decoding", value: null, max: 1, detail: "Page 1", cancel });
  expect(progress.shown).toBe(true);
  expect(progress.label).toBe("Decoding");
  progress.shadowRoot?.querySelector("button")?.click();
  expect(cancel).toHaveBeenCalledOnce();
  view.progress(null);
  expect(progress.hidden).toBe(true);
  expect(progress.shown).toBe(false);
});
