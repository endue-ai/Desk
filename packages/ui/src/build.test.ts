import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../vite.config";
import { tokensCss } from "./index";

describe("build", () => {
  const outDir = mkdtempSync(join(tmpdir(), "desk-ui-"));

  beforeAll(async () => {
    await build({
      ...config,
      configFile: false,
      logLevel: "silent",
      build: { ...config.build, outDir },
    });
  }, 60_000);
  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  it("writes ui.js, ui.iife.js and tokens.css", () => {
    expect(readdirSync(outDir).sort()).toEqual(["tokens.css", "ui.iife.js", "ui.js"]);
    expect(readFileSync(join(outDir, "tokens.css"), "utf8")).toBe(tokensCss());
    expect(readFileSync(join(outDir, "ui.iife.js"), "utf8")).toMatch(/\bvar DeskUI = /);
  });

  it("ui.js is one ES module with the elements and the tokens", async () => {
    // Imported in Node, where there is no DOM: it must load and leave defining to the browser.
    const ui = await import(pathToFileURL(join(outDir, "ui.js")).href);
    expect(typeof ui.defineElements).toBe("function");
    expect(Object.keys(ui.elements)).toHaveLength(11);
    expect(ui.elements["desk-table"]).toBe(ui.DeskTable);
    expect(ui.elements["desk-markdown"]).toBe(ui.DeskMarkdown);
    expect(ui.elements["desk-dialog"]).toBe(ui.DeskDialog);
    expect(ui.tokensCss()).toBe(tokensCss());
  });
});
