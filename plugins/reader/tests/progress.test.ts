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

it("stops decoding and does not let a discarded view overwrite the next opening status", async () => {
  const { createProgress } = await import("../ui/progress.js");
  const element = document.createElement("desk-progress") as DeskProgress;
  const status = vi.fn();
  const progress = createProgress(element, status);
  let signal!: AbortSignal;
  const pending = progress
    .run("Page 1", (next: AbortSignal) => {
      signal = next;
      return new Promise(() => {});
    })
    .catch((error) => error);
  element.dispatchEvent(new Event("desk-cancel"));
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(signal.aborted).toBe(true);
  expect(status).toHaveBeenLastCalledWith("Decoding Page 1 was cancelled.");
  status.mockClear();
  const previous = progress.run("Page 2", () => new Promise(() => {})).catch((e) => e);
  progress.clear();
  progress.set({ label: "Reading", value: null, max: 1, detail: "Next.pdf", cancel: () => {} });
  expect(await previous).toMatchObject({ name: "AbortError" });
  expect(status).not.toHaveBeenCalled();
  expect(element.label).toBe("Reading");
  expect(element.hidden).toBe(false);
});
