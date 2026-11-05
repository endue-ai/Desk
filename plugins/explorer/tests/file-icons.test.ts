// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fileIcon, iconOf } from "../ui/file-icons.js";
import { drawIcon, GLYPHS } from "../ui/glyphs.js";
import type { Row } from "../ui/tree.js";
import { createView } from "../ui/view.js";

// biome-ignore lint/suspicious/noTemplateCurlyInString: a bridge path root, not a placeholder
const HOME = "${home}";
const at = (name: string) => {
  const icon = fileIcon(name);
  return `${icon.glyph} ${icon.tone}`;
};

describe("the icon a row shows", () => {
  it("draws folders in the theme's primary colour, open when expanded, home for ~", () => {
    const dir = { kind: "dir", name: "src", path: "~/src" } as const;
    expect(iconOf(dir)).toEqual({ glyph: "folder", tone: "accent" });
    expect(iconOf({ ...dir, expanded: true })).toEqual({ glyph: "folder-open", tone: "accent" });
    expect(iconOf({ ...dir, name: "~", path: "~" }).glyph).toBe("home");
    expect(iconOf({ ...dir, name: HOME, path: HOME }).glyph).toBe("home");
  });

  it("shows links and the more row in muted glyphs of their own", () => {
    expect(iconOf({ kind: "symlink", name: "a.ts", path: "/a.ts" })).toEqual({
      glyph: "link",
      tone: "muted",
    });
    expect(iconOf({ kind: "more", name: "3 more", path: "/" })).toEqual({
      glyph: "more",
      tone: "muted",
    });
  });

  it("knows files by their extension, in any case", () => {
    expect(at("main.ts")).toBe("code 4");
    expect(at("utils.js")).toBe("code 3");
    expect(at("lib.rs")).toBe("code 7");
    expect(at("index.html")).toBe("code 7");
    expect(at("styles.css")).toBe("style 4");
    expect(at("tsconfig.json")).toBe("data 3");
    expect(at("notes.md")).toBe("markdown 4");
    expect(at("Contract.PDF")).toBe("text 5");
    expect(at("Budget.xlsx")).toBe("sheet 6");
    expect(at("Pitch.pptx")).toBe("slides 7");
    expect(at("PHOTO.JPG")).toBe("image 2");
    expect(at("cover.psd")).toBe("image 1");
    expect(at("Trip.mov")).toBe("video 1");
    expect(at("Interview.mp3")).toBe("audio 5");
    expect(at("build.sh")).toBe("terminal 6");
    expect(at("app.db")).toBe("database 2");
    expect(at("schema.sql")).toBe("database 7");
    expect(at("Inter.woff2")).toBe("font 8");
    expect(at("book.epub")).toBe("book 7");
    expect(at("server.pem")).toBe("key warning");
    expect(at("fix.patch")).toBe("git 7");
    expect(at("setup.exe")).toBe("package 8");
  });

  it("reads the last extension of a name with several", () => {
    expect(at("backup.tar.gz")).toBe("archive 3");
    expect(at("types.d.ts")).toBe("code 4");
    expect(at("main.test.ts")).toBe("code 4");
    expect(at(".eslintrc.json")).toBe("data 3");
    expect(at("Ubuntu.iso")).toBe("archive 8");
  });

  it("lets a known name win over its extension", () => {
    expect(at("package.json")).toBe("package 6");
    expect(at("Cargo.toml")).toBe("package 6");
    expect(at("pnpm-lock.yaml")).toBe("lock muted");
    expect(at("Cargo.lock")).toBe("lock muted");
    expect(at("Dockerfile")).toBe("package 4");
    expect(at("compose.yaml")).toBe("package 4");
    expect(at("Makefile")).toBe("terminal 6");
    expect(at("justfile")).toBe("terminal 6");
    expect(at(".gitignore")).toBe("git 7");
    expect(at("CODEOWNERS")).toBe("config 8");
  });

  it("marks readmes, licences and env files", () => {
    for (const name of ["README.md", "readme", "README_ko.md", "Readme.txt"])
      expect(at(name)).toBe("readme 4");
    for (const name of ["LICENSE", "LICENCE.txt", "LICENSE-MIT", "COPYING", "NOTICE"])
      expect(at(name)).toBe("license 3");
    for (const name of [".env", ".env.local", ".env.production", ".envrc", "id_ed25519"])
      expect(at(name)).toBe("key warning");
    for (const name of [".env.example", ".env.sample", ".env.template"])
      expect(at(name)).toBe("config 8");
    expect(at("readme-assets.png")).toBe("image 2");
    expect(at("license-checker.js")).toBe("code 3");
    expect(at("licenses.json")).toBe("data 3");
  });

  it("treats other dotfiles as settings and the rest as plain pages", () => {
    expect(at(".editorconfig")).toBe("config 8");
    expect(at(".DS_Store")).toBe("config 8");
    expect(at("unknown.xyz")).toBe("file muted");
    expect(at("notes")).toBe("file muted");
    expect(at("trailing.")).toBe("file muted");
  });
});

describe("the glyphs", () => {
  const names = [
    "a.ts",
    "a.js",
    "a.rs",
    "a.go",
    "a.java",
    "a.kt",
    "a.clj",
    "a.asm",
    "a.html",
    "a.css",
    "a.scss",
    "a.json",
    "a.graphql",
    "a.sh",
    "a.ini",
    "a.md",
    "a.txt",
    "a.rst",
    "a.docx",
    "a.pdf",
    "a.csv",
    "a.pptx",
    "a.png",
    "a.ai",
    "a.mp4",
    "a.mp3",
    "a.zip",
    "a.dmg",
    "a.deb",
    "a.exe",
    "a.ttf",
    "a.db",
    "a.sql",
    "a.epub",
    "a.key",
    "a.diff",
    "a.lock",
    "README",
    "LICENSE",
    ".env",
    ".x",
    "Dockerfile",
    "Makefile",
    ".gitignore",
    "go.sum",
    "x",
  ];

  it("has a shape for every glyph a file can take", () => {
    for (const name of names) expect(GLYPHS[fileIcon(name).glyph], name).toBeDefined();
  });

  it("styles every tone a file can take from the theme", () => {
    const css = readFileSync(join(import.meta.dirname, "../ui/style.css"), "utf8");
    const tones = new Set(names.map((name) => fileIcon(name).tone));
    tones.add("accent");
    tones.delete("muted");
    for (const tone of tones)
      expect(css).toMatch(new RegExp(`\\.icon\\[data-tone="${tone}"\\] \\{ color: var\\(--desk-`));
  });

  it("draws an inline svg hidden from assistive technology", () => {
    const svg = drawIcon(document, { glyph: "markdown", tone: "4" });
    expect(svg.getAttribute("class")).toBe("icon");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("data-glyph")).toBe("markdown");
    expect(svg.getAttribute("data-tone")).toBe("4");
    expect([...svg.querySelectorAll("path")].map((p) => p.getAttribute("class"))).toEqual([
      "body",
      "lines",
    ]);
    const again = drawIcon(document, { glyph: "markdown", tone: "7" });
    expect(again).not.toBe(svg);
    expect(again.getAttribute("data-tone")).toBe("7");
    expect(svg.getAttribute("data-tone")).toBe("4");
  });
});

describe("the tree's rows", () => {
  it("put the icon between the twisty and the name", () => {
    document.documentElement.innerHTML = readFileSync(
      join(import.meta.dirname, "../ui/index.html"),
      "utf8",
    )
      .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
      .replace(/<\/html>\s*$/, "");
    const view = createView(document, {
      select: vi.fn(),
      activate: vi.fn(),
      key: vi.fn(),
      type: vi.fn(() => false),
      addFolder: vi.fn(),
      newFile: vi.fn(),
      refresh: vi.fn(),
      toggleHidden: vi.fn(),
      togglePreview: vi.fn(),
    });
    const base = { depth: 1, root: "/", hidden: false };
    const rows: Row[] = [
      { ...base, id: "/src", path: "/src", name: "src", kind: "dir", expanded: true, depth: 0 },
      { ...base, id: "/src/a.ts", path: "/src/a.ts", name: "a.ts", kind: "file", size: 3 },
      { ...base, id: "/src/l", path: "/src/l", name: "l", kind: "symlink" },
      { ...base, id: "more:/src", path: "/src", name: "2 more", kind: "more", more: 2 },
    ];
    view.tree(rows, null);
    const items = [...document.querySelectorAll<HTMLElement>("[role=treeitem]")];
    expect(items.map((item) => [...item.children].map((child) => child.classList[0]))).toEqual([
      ["twisty", "icon", "name"],
      ["twisty", "icon", "name", "detail"],
      ["twisty", "icon", "name", "detail"],
      ["twisty", "icon", "name"],
    ]);
    expect(items.map((item) => item.querySelector(".icon")?.getAttribute("data-glyph"))).toEqual([
      "folder-open",
      "code",
      "link",
      "more",
    ]);
    expect(items[1]?.textContent).toBe("a.ts3 B");
  });
});
