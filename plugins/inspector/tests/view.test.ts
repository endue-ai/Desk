// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";

const SECTIONS = [
  { id: "tree", label: "Render tree" },
  { id: "surfaces", label: "Surfaces and buffers" },
  { id: "commands", label: "Commands" },
  { id: "grants", label: "Grants" },
  { id: "settings", label: "Settings" },
  { id: "plugins", label: "Plugins" },
  { id: "calls", label: "Bridge calls" },
];

/** The page's body as index.html declares it, without its script. */
function page() {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
}

function setup() {
  page();
  const asked: { shown: string[]; filters: string[]; exports: number } = {
    shown: [],
    filters: [],
    exports: 0,
  };
  const view = createView(document, {
    show: (id) => {
      asked.shown.push(id);
      view.sections(SECTIONS, id);
    },
    filter: (query) => void asked.filters.push(query),
    exportJson: () => {
      asked.exports++;
    },
  });
  view.sections(SECTIONS, "commands");
  return { view, asked };
}

const tabs = () => [...document.querySelectorAll<HTMLElement>("[role=tab]")];
const key = (target: EventTarget, name: string) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const byId = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the inspector's page", () => {
  it("names the sections as tabs, the one in view selected and the only one in the tab order", () => {
    setup();
    expect(document.querySelector("[role=tablist]")?.getAttribute("aria-label")).toBe("Sections");
    expect(tabs().map((t) => t.textContent)).toEqual(SECTIONS.map((s) => s.label));
    const selected = tabs().filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected.map((t) => t.textContent)).toEqual(["Commands"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1, -1]);
    expect(byId("panel").getAttribute("role")).toBe("tabpanel");
    expect(byId("panel").getAttribute("aria-labelledby")).toBe(selected[0]?.id);
  });

  it("moves between sections with the arrow keys, Home and End", () => {
    const { asked } = setup();
    tabs()[2]?.focus();
    expect(key(document.activeElement as HTMLElement, "ArrowRight").defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe("Grants");
    key(document.activeElement as HTMLElement, "Home");
    expect(document.activeElement?.textContent).toBe("Render tree");
    key(document.activeElement as HTMLElement, "ArrowLeft");
    expect(document.activeElement?.textContent).toBe("Bridge calls");
    key(document.activeElement as HTMLElement, "End");
    expect(asked.shown).toEqual(["grants", "tree", "calls", "calls"]);
    tabs()[4]?.click();
    expect(asked.shown.at(-1)).toBe("settings");
  });

  it("focuses the filter with / and clears it with Escape", () => {
    const { asked } = setup();
    const filter = byId("filter") as HTMLInputElement;
    expect(document.querySelector("label[for=filter]")?.textContent).toBe("Filter");
    expect(key(document.body, "/").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(filter);
    filter.value = "palette";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
    expect(asked.filters).toEqual(["palette"]);
    key(filter, "Escape");
    expect(filter.value).toBe("");
    expect(asked.filters).toEqual(["palette", ""]);
  });

  it("draws each group as a table with a caption and column headers", () => {
    const { view } = setup();
    view.table({
      summary: "1 surface, 0 views, 1 buffer",
      groups: [
        {
          title: "Surfaces",
          columns: ["Surface", "Plugin", "Placement", "State"],
          rows: [["desk.inspector", "desk.inspector", "window", "visible · focused"]],
        },
        { title: "Buffers", columns: ["Buffer", "Plugin", "File", "State"], rows: [] },
      ],
    });
    expect(byId("summary").textContent).toBe("1 surface, 0 views, 1 buffer");
    const tables = [...document.querySelectorAll("#groups table")];
    expect(tables.map((t) => t.querySelector("caption")?.textContent)).toEqual([
      "Surfaces",
      "Buffers",
    ]);
    const headers = [...(tables[0]?.querySelectorAll("th") ?? [])];
    expect(headers.map((h) => [h.textContent, h.getAttribute("scope")])).toEqual([
      ["Surface", "col"],
      ["Plugin", "col"],
      ["Placement", "col"],
      ["State", "col"],
    ]);
    expect(tables[0]?.querySelector("tbody td")?.textContent).toBe("desk.inspector");
    expect(byId("panel").tabIndex).toBe(0);
  });

  it("shows the export in a dialog that takes the focus, and Escape gives it back", () => {
    const { view, asked } = setup();
    const button = byId("export");
    button.focus();
    button.click();
    expect(asked.exports).toBe(1);
    view.exported('{\n  "calls": {}\n}');
    const dialog = byId("export-panel");
    expect(dialog.hidden).toBe(false);
    expect(dialog.getAttribute("role")).toBe("dialog");
    const text = byId("export-text") as HTMLTextAreaElement;
    expect(text.value).toBe('{\n  "calls": {}\n}');
    expect(text.readOnly).toBe(true);
    expect(document.activeElement).toBe(text);
    key(text, "Escape");
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });
});
