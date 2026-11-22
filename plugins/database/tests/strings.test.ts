// @vitest-environment jsdom
// The plugin's words (PG-108, ADR 0366): one catalog of named keys (ui/strings/en.json) in the
// messages format, every key the code names in it and none left over, plural-aware counts,
// numbers and dates of the plugin's own interface in the language's way while a result's values
// stay as the server sent them (NF-10), the server's words passed through and marked, and a
// language added as one file next to English.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { formatCount } from "../ui/format.js";
import {
  clock,
  day,
  has,
  loadLanguage,
  nodes,
  number,
  serverWords,
  t,
  useLanguage,
} from "../ui/strings/index.js";
import { createGrid } from "../ui/view-grid.js";

const ui = join(import.meta.dirname, "..", "ui");
const en = JSON.parse(readFileSync(join(ui, "strings", "en.json"), "utf8")) as Record<
  string,
  string | Record<string, string>
>;

/** Every source of the plugin's page, vendored code aside. */
function sources(dir = ui): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "vendor" ? [] : sources(path);
    return name.endsWith(".js") || name.endsWith(".mjs") ? [readFileSync(path, "utf8")] : [];
  });
}

afterEach(() => useLanguage("en", undefined));

describe("the catalog", () => {
  it("fits the messages schema, and the manifest names its folder", () => {
    const schema = JSON.parse(
      readFileSync(join(ui, "../../../specs/plugin/v0/messages.schema.json"), "utf8"),
    );
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(en), JSON.stringify(validate.errors)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(ui, "..", "plugin.json"), "utf8"));
    expect(manifest.messages).toBe("ui/strings");
  });

  it("holds every key the code names, and no key the code does not", () => {
    const all = sources().join("\n");
    const named = [...all.matchAll(/\b(?:t|nodes)\(\s*"([a-z][\w.]*)"/g)].map((m) => m[1] ?? "");
    expect(named.filter((key) => !has(key))).toEqual([]);
    const unused = Object.keys(en).filter((key) => !all.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });

  it("keeps the same placeholders in every form of a plural message", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, message] of Object.entries(en))
      if (typeof message === "object") {
        expect(Object.keys(message), key).toContain("one");
        for (const form of Object.values(message))
          expect(holes(form), key).toEqual(holes(message.other ?? ""));
      }
  });
});

describe("a message", () => {
  it("fills its placeholders and picks its plural form by the count", () => {
    expect(t("view.noConsole", { name: "shop" })).toBe(
      "No console is open on shop: Enter or a double click on it opens one.",
    );
    expect(t("bars.pendingChanges", { count: 1 })).toBe("1 pending change");
    expect(t("bars.pendingChanges", { count: 3 })).toBe("3 pending changes");
    expect(t("bars.pendingChanges", { count: 12345 })).toBe("12,345 pending changes");
    expect(t("no.suchKey")).toBe("no.suchKey");
  });

  it("reads a language's own catalog, and English for a key it lacks", async () => {
    const seen: string[] = [];
    await loadLanguage("fr", async (url) => {
      seen.push(String(url));
      return {
        "grid.noRows": "Aucune ligne.",
        "bars.pendingChanges": { one: "{count} modification", other: "{count} modifications" },
      };
    });
    expect(seen.map((url) => url.replace(/^.*\/ui\//, "ui/"))).toEqual(["ui/strings/fr.json"]);
    expect(t("grid.noRows")).toBe("Aucune ligne.");
    expect(t("bars.pendingChanges", { count: 1500 })).toBe(`${number(1500)} modifications`);
    expect(t("grid.noMatch")).toBe("No row holds that.");
    // A language with no file reads in English.
    await loadLanguage("ko", async () => {
      throw new Error("404");
    });
    expect(t("grid.noRows")).toBe("No rows.");
  });
});

describe("numbers and dates of the plugin's own interface", () => {
  it("follow the language", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    useLanguage("de", {});
    expect(formatCount(1234567)).toBe("1.234.567");
    expect(t("bars.pendingChanges", { count: 1234 })).toBe("1.234 pending changes");
  });

  it("place a moment's parts by the catalog's patterns, on the 24-hour clock", () => {
    const at = new Date(2026, 10, 20, 14, 5, 9);
    expect(clock(at)).toBe("14:05");
    expect(clock(at, true)).toBe("14:05:09");
    expect(day(at)).toBe("2026-11-20");
  });

  it("leave a result's values as the server sent them (NF-10)", () => {
    useLanguage("de", {});
    document.body.innerHTML = `<div id="result"></div>`;
    const host = document.getElementById("result") as HTMLElement;
    const grid = createGrid(document, host, () => undefined);
    const set = { columns: ["n"], rows: [["1234.5"], ["1234567"]], truncated: false };
    grid.render({ label: "Result", kind: "rows", statement: 0, set }, true, {
      edit: null,
      server: false,
      key: "result:x:1:0",
    });
    const cells = [...host.querySelectorAll(".body [role=gridcell]")].map((c) => c.textContent);
    expect(cells).toEqual(["1234.5", "1234567"]);
  });
});

describe("the server's words", () => {
  it("pass through untranslated, marked as the server's", () => {
    useLanguage("fr", { "copyImport.server": "Le serveur : {error}" });
    const said = serverWords(document, 'relation "x" does not exist');
    const p = document.createElement("p");
    p.append(...nodes("copyImport.server", { error: said }));
    expect(p.textContent).toBe('Le serveur : relation "x" does not exist');
    const span = p.querySelector("[data-words=server]") as HTMLElement;
    expect(span.textContent).toBe('relation "x" does not exist');
    expect(span.getAttribute("translate")).toBe("no");
  });
});
