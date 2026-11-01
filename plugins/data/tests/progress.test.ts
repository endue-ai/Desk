// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createView } from "../ui/view.js";
import { loadPage } from "./harness";

it("keeps one delayed, cancellable progress element across Reading and Parsing then hides it", () => {
  loadPage();
  const cancel = vi.fn();
  const view = createView(document, { validateWith() {}, cancel });
  const progress = document.querySelector("desk-progress")!;
  expect(progress).not.toBeNull();
  expect(progress.hasAttribute("hidden")).toBe(true);
  view.progress({ phase: "Reading", done: 100, total: 1000 });
  expect(progress.hasAttribute("hidden")).toBe(false);
  expect(progress.getAttribute("label")).toMatch(/Reading.*100.*1,000/);
  expect(progress.getAttribute("value")).toBe("0.1");
  view.progress({ phase: "Parsing", done: 500, total: 1000 });
  expect(document.querySelector("desk-progress")).toBe(progress);
  expect(progress.getAttribute("label")).toMatch(/Parsing/);
  expect(progress.getAttribute("value")).toBe("0.5");
  progress.dispatchEvent(new CustomEvent("desk-cancel"));
  expect(cancel).toHaveBeenCalledOnce();
  view.progress(null);
  expect(progress.hasAttribute("hidden")).toBe(true);
});
