// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rows } from "../ui/model.js";
import { createView, STATUS_MS } from "../ui/view.js";
import { fixture, longEpisode } from "./fixtures";

const page = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const body = page.slice(page.indexOf("<body>") + 6, page.indexOf('<script type="module"'));

describe("the memory inspector's page", () => {
  const actions = {
    filter: vi.fn(),
    search: vi.fn(),
    edit: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    add: vi.fn(),
    forget: vi.fn(),
    forgetAll: vi.fn(),
  };
  let view: ReturnType<typeof createView>;

  const show = (editing: string | null = null, filter: "all" | "fact" | "episode" = "all") =>
    view.show({
      rows: rows(fixture().reverse()),
      filter,
      query: "",
      editing,
      empty: "",
      more: false,
    });

  beforeEach(() => {
    for (const spy of Object.values(actions)) spy.mockReset();
    document.body.innerHTML = body;
    view = createView(document, actions);
  });

  it("draws each entry with Edit on facts and Forget on all", () => {
    show();
    const items = [...document.querySelectorAll("#entries li")];
    expect(items.map((li) => li.getAttribute("data-id"))).toEqual([
      "fact_0003",
      "ep_0002",
      "fact_0001",
    ]);
    const labels = (li: Element) => [...li.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels(items[0] as Element)).toEqual(["Edit", "Forget"]);
    expect(labels(items[1] as Element)).toEqual(["Forget"]);
    expect(items[1]?.querySelector(".text")?.textContent).toBe("“check my latest mail”");
    ((items[1] as Element).querySelector("button") as HTMLButtonElement).click();
    expect(actions.forget).toHaveBeenCalledWith("ep_0002");
    for (const control of document.querySelectorAll("button, input, textarea"))
      expect(control.className).toMatch(/desk-(btn|field|tab)/);
  });

  it("sets text as text, never as HTML", () => {
    const fact = {
      kind: "fact",
      id: "fact_x",
      text: "<img src=x onerror=alert(1)>",
      by: "person",
      at: "2026-11-05T00:00:00Z",
    } as const;
    view.show({
      rows: rows([fact]),
      filter: "all",
      query: "",
      editing: null,
      empty: "",
      more: false,
    });
    expect(document.querySelector("#entries img")).toBeNull();
    expect(document.querySelector("#entries .text")?.textContent).toBe(fact.text);
  });

  it("edits a fact in a field, saves on submit and cancels on Escape", async () => {
    show("fact_0001");
    const field = document.querySelector("#entries textarea") as HTMLTextAreaElement;
    expect(field.value).toBe("Reviews pull requests in the morning");
    field.value = "After lunch";
    (field.closest("form") as HTMLFormElement).requestSubmit();
    expect(actions.save).toHaveBeenCalledWith("fact_0001", "After lunch");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(actions.cancel).toHaveBeenCalled();
  });

  it("offers the kinds as tabs that arrow keys move between", () => {
    show(null, "fact");
    const tabs = [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    expect(tabs.map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([
      ["All", "false"],
      ["Facts", "true"],
      ["Conversations", "false"],
    ]);
    tabs[1]?.focus();
    tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(actions.filter).toHaveBeenCalledWith("episode");
  });

  it("searches as the person types, adds a fact, and forgets everything from the footer", () => {
    show();
    const search = document.querySelector("#search") as HTMLInputElement;
    search.value = "mail";
    search.dispatchEvent(new Event("input"));
    expect(actions.search).toHaveBeenCalledWith("mail");
    const fact = document.querySelector("#new-fact") as HTMLInputElement;
    fact.value = "Likes tea";
    (document.querySelector("#remember-form") as HTMLFormElement).requestSubmit();
    expect(actions.add).toHaveBeenCalledWith("Likes tea");
    expect(fact.value).toBe("");
    (document.querySelector("#forget-all") as HTMLButtonElement).click();
    expect(actions.forgetAll).toHaveBeenCalled();
  });

  it("offers Forget everything only when there is something to forget", () => {
    const forgetAll = document.querySelector("#forget-all") as HTMLButtonElement;
    show();
    expect(forgetAll.disabled).toBe(false);
    const empty = { rows: [], filter: "fact" as const, editing: null, empty: "", more: false };
    view.show({ ...empty, query: "" });
    expect(forgetAll.disabled).toBe(true);
    // A search that matches nothing may still hide entries of the kind.
    view.show({ ...empty, query: "tea" });
    expect(forgetAll.disabled).toBe(false);
  });

  it("shows a long entry in a few lines until the person asks for all of it", () => {
    view.show({
      rows: rows([longEpisode(), ...fixture()]),
      filter: "all",
      query: "",
      editing: null,
      empty: "",
      more: false,
    });
    const entry = () => document.querySelector('[data-id="ep_0009"]') as HTMLElement;
    const toggle = () => entry().querySelector(".more") as HTMLButtonElement;
    expect(entry().classList.contains("clamped")).toBe(true);
    expect([toggle().textContent, toggle().getAttribute("aria-expanded")]).toEqual([
      "Show all",
      "false",
    ]);
    expect(document.querySelectorAll(".more")).toHaveLength(1);
    toggle().click();
    expect(entry().classList.contains("clamped")).toBe(false);
    expect([toggle().textContent, toggle().getAttribute("aria-expanded")]).toEqual([
      "Show less",
      "true",
    ]);
    // A redraw (memory.changed, a status) keeps it open.
    view.show({
      rows: rows([longEpisode()]),
      filter: "all",
      query: "",
      editing: null,
      empty: "",
      more: false,
    });
    expect(entry().classList.contains("clamped")).toBe(false);
    toggle().click();
    expect(entry().classList.contains("clamped")).toBe(true);
  });

  it("says how a write went for a few seconds, and an error until the next status", () => {
    vi.useFakeTimers();
    try {
      const status = document.querySelector("#status") as HTMLElement;
      view.status("Eris will remember that.");
      expect(status.textContent).toBe("Eris will remember that.");
      vi.advanceTimersByTime(STATUS_MS);
      expect(status.textContent).toBe("");
      view.status("That did not go through: offline", true);
      vi.advanceTimersByTime(STATUS_MS * 2);
      expect(status.textContent).toBe("That did not go through: offline");
    } finally {
      vi.useRealTimers();
    }
  });
});
