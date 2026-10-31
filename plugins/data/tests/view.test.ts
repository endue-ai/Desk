// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Shown } from "../ui/data.js";
import { openFile } from "../ui/formats.js";
import { createView } from "../ui/view.js";
import { bytesOf, loadPage } from "./harness";
import { rootOf } from "./nodes";

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const rows = () => [...document.querySelectorAll<HTMLElement>("#tree [role=treeitem]")];
const keyText = (row?: HTMLElement) => row?.querySelector(".key")?.textContent;
const toggle = (key: string) => {
  const twisty = rowOf(key).querySelector<HTMLElement>(".twisty");
  if (!twisty) throw new Error(`no twisty on ${key}`);
  twisty.click();
};
const rowOf = (key: string) => {
  const row = rows().find((r) => keyText(r) === key);
  if (!row) throw new Error(`no row ${key}: ${rows().map(keyText).join(" ")}`);
  return row;
};
const selected = () => rows().find((r) => r.getAttribute("aria-selected") === "true");
const press = (key: string, init: KeyboardEventInit = {}, target: Element = $("#tree")) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

let view: ReturnType<typeof createView>;
const show = (name: string, text: string | Uint8Array) => {
  const bytes = typeof text === "string" ? bytesOf(text) : text;
  const opened = openFile(name, bytes);
  const model: Shown = {
    buffer: `file:~/data/${name}`,
    path: `~/data/${name}`,
    name,
    size: bytes.length,
    opened,
    schema: { state: "none", errors: [] },
    maskKeys: true,
  };
  view.show(model);
  return opened;
};

beforeEach(() => {
  loadPage();
  view = createView(document, { validateWith: () => {} });
});

describe("the tree", () => {
  it("builds children only when a node opens, and a collapsed node shows its count", () => {
    const opened = show("a.json", '{ "list": [1, 2, 3], "obj": { "x": 1 }, "s": "text" }');
    const root = rootOf(opened.doc);
    expect(rows().map(keyText)).toEqual(["root", "list", "obj", "s"]);
    const list = root.children?.[0];
    expect(list?.children).toBeUndefined();
    expect(rowOf("list").getAttribute("aria-expanded")).toBe("false");
    expect(rowOf("list").textContent).toContain("3 items");
    expect(rowOf("obj").textContent).toContain("1 key");
    toggle("list");
    expect(list?.children).toHaveLength(3);
    expect(rowOf("list").getAttribute("aria-expanded")).toBe("true");
    expect(rows().map(keyText)).toEqual(["root", "list", "0", "1", "2", "obj", "s"]);
  });

  it("opens arrays in groups of 100", () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    show("big.json", JSON.stringify({ items }));
    toggle("items");
    expect(rows().map(keyText)).toEqual([
      "root",
      "items",
      "[0 … 99]",
      "[100 … 199]",
      "[200 … 249]",
    ]);
    toggle("[100 … 199]");
    expect(rows()).toHaveLength(105);
    expect(keyText(rows()[4])).toBe("100");
    expect(keyText(rows()[103])).toBe("199");
  });

  it("Up, Down, Right and Left move and open; the path of the selected node shows", () => {
    show("a.json", '{\n  "list": [1, 2, { "deep": true }],\n  "name": "desk"\n}\n');
    $("#tree").focus();
    expect(selected()?.querySelector(".key")?.textContent).toBe("root");
    press("ArrowDown");
    expect(keyText(selected())).toBe("list");
    press("ArrowRight");
    expect(rowOf("list").getAttribute("aria-expanded")).toBe("true");
    expect(keyText(selected())).toBe("list");
    press("ArrowRight");
    expect(keyText(selected())).toBe("0");
    press("ArrowDown");
    press("ArrowDown");
    expect(keyText(selected())).toBe("2");
    expect($("#pointer").textContent).toBe("/list/2");
    expect($("#dotted").textContent).toBe("list[2]");
    expect($("#tree").getAttribute("aria-activedescendant")).toBe(selected()?.id);
    press("ArrowRight");
    press("ArrowRight");
    expect(keyText(selected())).toBe("deep");
    expect($("#pointer").textContent).toBe("/list/2/deep");
    press("ArrowLeft");
    expect(keyText(selected())).toBe("2");
    press("ArrowLeft");
    expect(rowOf("2").getAttribute("aria-expanded")).toBe("false");
    press("End");
    expect(keyText(selected())).toBe("name");
    press("Home");
    expect(keyText(selected())).toBe("root");
  });

  it("Expand all and Collapse all", () => {
    show("a.yaml", "a:\n  b:\n    c: [1, 2]\nd: 1\n");
    $("#expand-all").click();
    expect(rows().map(keyText)).toEqual(["root", "a", "b", "c", "0", "1", "d"]);
    $("#collapse-all").click();
    expect(rows().map(keyText)).toEqual(["root"]);
  });

  it("never keeps the desk's chords, and keeps Mod+F for search", () => {
    show("a.json", "[1]");
    for (const key of ["s", "o", "w", "k"])
      expect(press(key, { metaKey: true }).defaultPrevented).toBe(false);
    expect(press("f", { metaKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe($("#search"));
  });
});

describe("search", () => {
  it("finds keys and values and opens the tree down to the match", () => {
    const opened = show(
      "a.json",
      '{ "a": { "b": { "c": [1, { "needle": true }] } }, "z": "needle too" }',
    );
    expect(rootOf(opened.doc).children?.[0]?.children).toBeUndefined();
    const input = $("#search") as HTMLInputElement;
    press("f", { metaKey: true });
    input.value = "needle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    press("Enter", {}, input);
    expect($("#search-count").textContent).toMatch(/1 of 2/);
    expect(keyText(selected())).toBe("needle");
    expect($("#pointer").textContent).toBe("/a/b/c/1/needle");
    press("g", { metaKey: true }, input);
    expect($("#search-count").textContent).toMatch(/2 of 2/);
    expect(keyText(selected())).toBe("z");
    press("g", { metaKey: true }, input);
    expect(keyText(selected())).toBe("needle");
  });
});

describe("the raw view", () => {
  it("has line numbers and token colours, and scrolls to the selected node's line", () => {
    const keys = Array.from({ length: 200 }, (_, i) => `  "k${i}": ${i}`);
    show("long.json", `{\n${keys.join(",\n")}\n}\n`);
    const first = $('#raw .line[data-line="2"]');
    expect(first.querySelector(".ln")?.textContent).toBe("2");
    expect(first.querySelector(".tok-key")?.textContent).toBe('"k0"');
    expect(first.querySelector(".tok-number")?.textContent).toBe("0");
    const input = $("#search") as HTMLInputElement;
    input.value = "k138";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    press("Enter", {}, input);
    expect(keyText(selected())).toBe("k138");
    const line = $('#raw .line[data-line="140"]');
    expect(line.classList.contains("current")).toBe(true);
    expect($("#raw").scrollTop).toBeGreaterThan(0);
  });

  it("an error shows its message with line and column, marks its line, and the tree keeps what parsed", () => {
    const opened = show("bad.json", '{\n  "a": 1,\n  "b": [1, 2,,3]\n}\n');
    const error = opened.doc?.errors[0];
    expect($("#problems").textContent).toContain(`Line ${error?.line}, column ${error?.col}`);
    expect($('#raw .line[data-line="3"]').classList.contains("error")).toBe(true);
    expect(rows().map(keyText)).toEqual(["root", "a", "b"]);
  });

  it("toggles between the tree, the raw text and both", () => {
    show("a.json", "[1]");
    expect($("#mode-both").getAttribute("aria-pressed")).toBe("true");
    $("#mode-raw").click();
    expect($("#tree-pane").hidden).toBe(true);
    expect($("#raw-pane").hidden).toBe(false);
    $("#mode-tree").click();
    expect($("#raw-pane").hidden).toBe(true);
    expect($("#mode-tree").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("files it cannot show", () => {
  it("open as a details view", () => {
    show("broken.plist", bytesOf("bplist00\x00\x01"));
    expect($("#details").hidden).toBe(false);
    expect($("#details").textContent).toContain("broken.plist");
    expect($("#details").textContent).toContain("10 bytes");
    expect($("#details").textContent).toContain("Property list (binary)");
    expect($("#panes").hidden).toBe(true);
  });
});

describe("a 50 MB JSON file", () => {
  it("opens without building more than the first rows", () => {
    const parts: string[] = [];
    let size = 0;
    for (let i = 0; size < 50 * 1024 * 1024; i++) {
      const next = `{"id":${i},"name":"item ${i}","tags":["a","b"],"ok":true}`;
      parts.push(next);
      size += next.length + 2;
    }
    const bytes = bytesOf(`[\n${parts.join(",\n")}\n]\n`);
    const started = performance.now();
    show("big.json", bytes);
    const took = performance.now() - started;
    console.info(`50 MB JSON opened in the view in ${Math.round(took)} ms`);
    expect(rows().length).toBeLessThan(200);
    expect(document.querySelectorAll("#raw .line").length).toBeLessThan(400);
    expect(took).toBeLessThan(30_000);
  }, 90_000);
});
