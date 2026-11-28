// @vitest-environment jsdom
// The page on jsdom: before the first read only the words and the button; a pick shows its details
// and marks the page so a narrow window lays them over the graph; the filters open on request;
// every control is a design system one.
import { describe, expect, it } from "vitest";
import { buildGraph, repositories } from "../ui/graph.js";
import { counts, panelFor, timeline } from "../ui/model.js";
import { createView } from "../ui/view.js";
import { sample } from "./fixtures";

const graph = buildGraph(sample(), { hub: 20 });
const filters = {
  agents: { claude: true, codex: true, hermes: true },
  kinds: {},
  subagents: true,
  orphans: false,
  shared: 2,
  repo: "",
};

function screen(selected: string | null, status = "ready") {
  return {
    status,
    message: "",
    counts: counts(graph),
    repos: repositories(graph),
    filters,
    mode: "graph",
    query: "",
    scene: undefined,
    only: undefined,
    selected: -1,
    selectedId: selected,
    marked: new Set<number>(),
    panel: panelFor(graph, selected),
    note: undefined,
    days: timeline(graph, new Set(graph.sessions.keys()), selected),
    fitKey: 0,
  };
}

function mount() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
    };
  const actions = {
    connect: record("connect"),
    sync: record("sync"),
    select: record("select"),
    focus: record("focus"),
    mode: record("mode"),
    search: record("search"),
    filter: record("filter"),
    writeNotes: async () => ({ folder: "~/.desk/knowledge", written: 0 }),
    openNote: async () => {},
  };
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const view = createView(root, actions);
  return { root, view, calls };
}

describe("the page", () => {
  it("asks to connect before anything is read", () => {
    const { root, view, calls } = mount();
    view.render(screen(null, "off"));
    const button = [...root.querySelectorAll("button")].find(
      (b) => b.textContent === "Read agent sessions",
    );
    button?.click();
    expect(calls).toEqual(["connect()"]);
    const page = root.querySelector(".kb");
    expect(page?.classList.contains("is-empty"), "no filters or details yet").toBe(true);
    expect(root.querySelector<HTMLElement>(".count")?.hidden, "no empty badge").toBe(true);
    view.render(screen(null));
    expect(page?.classList.contains("is-empty")).toBe(false);
  });

  it("shows a pick's details and marks the page for a narrow window", () => {
    const { root, view, calls } = mount();
    view.render(screen("ticket:ACME-2001"));
    const page = root.querySelector(".kb");
    expect(page?.classList.contains("has-selection")).toBe(true);
    expect(root.querySelector(".panel .title")?.textContent).toBe("ACME-2001");
    root.querySelector<HTMLButtonElement>(".panel .close")?.click();
    expect(calls).toContain("select(null)");
    view.render(screen(null));
    expect(page?.classList.contains("has-selection")).toBe(false);
  });

  it("opens the filters on request and hands a change to the controller", () => {
    const { root, view, calls } = mount();
    view.render(screen(null));
    const toggle = root.querySelector<HTMLButtonElement>(".filters");
    toggle?.click();
    expect(root.querySelector(".kb")?.classList.contains("show-filters")).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const codex = [...root.querySelectorAll<HTMLInputElement>(".rail input[type=checkbox]")][1];
    codex?.click();
    expect(calls).toContain('filter("agent:codex",false)');
  });

  it("uses design system controls only", () => {
    const { root, view } = mount();
    view.render(screen("codex:b"));
    const kit = /\bdesk-(btn|icon-btn|field|check|tab|row)\b/;
    for (const control of root.querySelectorAll("button, input"))
      expect(control.className, control.outerHTML.slice(0, 80)).toMatch(kit);
  });
});
