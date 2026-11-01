// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as ui from "../../../packages/ui/src/bundle";
import { createView } from "../ui/view.js";
import { loadPage } from "./harness";

it("keeps one delayed, cancellable progress element across Reading and Parsing then hides it", () => {
  vi.useFakeTimers();
  ui.defineElements();
  loadPage();
  const cancel = vi.fn();
  const view = createView(document, { validateWith() {}, cancel });
  const progress = document.querySelector("desk-progress");
  expect(progress).not.toBeNull();
  if (!progress) throw new Error("Missing progress element");
  expect(progress.hasAttribute("hidden")).toBe(true);
  view.progress({ phase: "Reading", done: 100, total: 1000 });
  expect(progress.hasAttribute("hidden")).toBe(false);
  expect(progress.getAttribute("label")).toMatch(/Reading.*100.*1,000/);
  expect(progress.getAttribute("value")).toBe("0.1");
  expect(progress.hasAttribute("shown")).toBe(false);
  vi.advanceTimersByTime(299);
  view.progress({ phase: "Parsing", done: 500, total: 1000 });
  expect(document.querySelector("desk-progress")).toBe(progress);
  expect(progress.getAttribute("label")).toMatch(/Parsing/);
  expect(progress.getAttribute("value")).toBe("0.5");
  vi.advanceTimersByTime(1);
  expect(progress.hasAttribute("shown")).toBe(true);
  progress.dispatchEvent(new CustomEvent("desk-cancel"));
  expect(cancel).toHaveBeenCalledOnce();
  view.progress(null);
  expect(progress.hasAttribute("hidden")).toBe(true);
  vi.useRealTimers();
});

it("imports existing public UI exports in the browser entrypoint", () => {
  const source = readFileSync(join(import.meta.dirname, "../ui/main.js"), "utf8");
  const names = /import \{([^}]+)\} from "@endue-ai\/ui"/.exec(source)?.[1];
  expect(names).toBeDefined();
  for (const name of names?.split(",") ?? [])
    expect(ui).toHaveProperty(name.trim(), expect.any(Function));
});
