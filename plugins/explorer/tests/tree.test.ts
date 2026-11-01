import { describe, expect, it } from "vitest";
import {
  type Folder,
  foldersBetween,
  isRoot,
  isUnder,
  joinPath,
  jump,
  move,
  nameOf,
  normalizePath,
  order,
  parentOf,
  patternOf,
  rows,
} from "../ui/tree.js";
import { dir, file, link } from "./harness";

// biome-ignore lint/suspicious/noTemplateCurlyInString: a bridge path root, not a placeholder
const HOME = "${home}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a bridge path root, not a placeholder
const WORKSPACE = "${workspace}";

describe("paths", () => {
  it("names, parents and roots", () => {
    expect(nameOf("~/Documents/a.md")).toBe("a.md");
    expect(nameOf("~")).toBe("~");
    expect(nameOf("/")).toBe("/");
    expect(nameOf("C:/")).toBe("C:/");
    expect(parentOf("~/Documents/a.md")).toBe("~/Documents");
    expect(parentOf("~/Documents")).toBe("~");
    expect(parentOf("~")).toBeUndefined();
    expect(parentOf("/etc")).toBe("/");
    expect(parentOf("/")).toBeUndefined();
    expect(parentOf("C:/Users")).toBe("C:/");
    expect(parentOf("C:/")).toBeUndefined();
    expect(parentOf(`${HOME}/x`)).toBe(HOME);
    expect(isRoot(HOME)).toBe(true);
    expect(joinPath("~", "a")).toBe("~/a");
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath("C:/", "x")).toBe("C:/x");
  });

  it("containment, the folders between, and the pattern that covers a folder", () => {
    expect(isUnder("~/Documents", "~/Documents")).toBe(true);
    expect(isUnder("~/Documents", "~/Documents/a.md")).toBe(true);
    expect(isUnder("~/Documents", "~/Documents2/a.md")).toBe(false);
    expect(isUnder("/", "/etc/hosts")).toBe(true);
    expect(foldersBetween("~/Documents", "~/Documents/Work/deep/x.md")).toEqual([
      "~/Documents/Work",
      "~/Documents/Work/deep",
    ]);
    expect(foldersBetween("~/Documents", "~/Documents/a.md")).toEqual([]);
    expect(foldersBetween("~/Documents", "~/Elsewhere/a.md")).toEqual([]);
    expect(patternOf("~/Documents")).toBe("~/Documents/**");
    expect(patternOf("/")).toBe("/**");
    expect(patternOf("C:/")).toBe("C:/**");
  });

  it("a typed path is normalised or refused", () => {
    expect(normalizePath(" ~/Projects/ ")).toBe("~/Projects");
    expect(normalizePath("C:\\Users\\me\\")).toBe("C:/Users/me");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("C:/")).toBe("C:/");
    expect(normalizePath(`${WORKSPACE}/src`)).toBe(`${WORKSPACE}/src`);
    expect(normalizePath("")).toBeUndefined();
    expect(normalizePath("relative/path")).toBeUndefined();
    expect(normalizePath("~/a/../b")).toBeUndefined();
  });
});

describe("order", () => {
  it("folders first, then files and links in natural order, case ignored, dotfiles on request", () => {
    const entries = [
      file("b.txt"),
      file("a10.md"),
      dir(".git"),
      file("A2.md"),
      dir("Work"),
      link("zed"),
    ];
    expect(order(entries, false).map((e) => e.name)).toEqual([
      "Work",
      "A2.md",
      "a10.md",
      "b.txt",
      "zed",
    ]);
    expect(order(entries, true).map((e) => e.name)).toEqual([
      ".git",
      "Work",
      "A2.md",
      "a10.md",
      "b.txt",
      "zed",
    ]);
  });

  it("names that differ only by case keep one order", () => {
    expect(order([file("b"), file("B")], false).map((e) => e.name)).toEqual(["B", "b"]);
    expect(order([file("B"), file("b")], false).map((e) => e.name)).toEqual(["B", "b"]);
  });
});

const folders = (map: Record<string, Folder>) => new Map(Object.entries(map));
const options = { showHidden: false, page: 500 };

describe("rows", () => {
  it("lists every root, and the entries of expanded folders a page at a time", () => {
    const loaded = folders({
      "~/Documents": { entries: [file("a.md"), dir("Work"), file("b.md"), file("c.md")] },
      "~/Documents/Work": { entries: [file("w.md")] },
      "~/Other": { loading: true },
    });
    const expanded = new Set(["~/Documents", "~/Documents/Work"]);
    const list = rows(["~/Documents", "~/Other"], loaded, expanded, options);
    expect(list.map((r) => `${r.depth}:${r.kind}:${r.name}`)).toEqual([
      "0:dir:Documents",
      "1:dir:Work",
      "2:file:w.md",
      "1:file:a.md",
      "1:file:b.md",
      "1:file:c.md",
      "0:dir:Other",
    ]);
    expect(list[0]).toMatchObject({ id: "~/Documents", root: "~/Documents", expanded: true });
    expect(list[2]).toMatchObject({ id: "~/Documents/Work/w.md", root: "~/Documents", size: 1 });
    expect(list[6]).toMatchObject({ expanded: false, loading: true });

    const paged = rows(["~/Documents"], loaded, expanded, { ...options, page: 2 });
    expect(paged.map((r) => `${r.depth}:${r.kind}:${r.name}`)).toEqual([
      "0:dir:Documents",
      "1:dir:Work",
      "2:file:w.md",
      "1:file:a.md",
      "1:more:2 more",
    ]);
    expect(paged[4]).toMatchObject({ id: "more:~/Documents", path: "~/Documents", more: 2 });
    const shown = folders({ "~/Documents": { ...loaded.get("~/Documents"), shown: 4 } });
    expect(
      rows(["~/Documents"], shown, new Set(["~/Documents"]), { ...options, page: 2 }),
    ).toHaveLength(5);
  });

  it("a collapsed folder shows no entries and an error travels on the row", () => {
    const loaded = folders({ "~/Documents": { entries: [file("a.md")], error: "Not allowed." } });
    expect(rows(["~/Documents"], loaded, new Set(), options)).toEqual([
      expect.objectContaining({ name: "Documents", expanded: false, error: "Not allowed." }),
    ]);
  });
});

describe("move and jump", () => {
  const loaded = folders({
    "~/Documents": { entries: [dir("Work"), file("a.md"), file("b.md")] },
    "~/Documents/Work": { entries: [file("w.md")] },
  });
  const open = rows(["~/Documents"], loaded, new Set(["~/Documents", "~/Documents/Work"]), options);
  const closed = rows(["~/Documents"], loaded, new Set(["~/Documents"]), options);

  it("arrows step, Home and End jump, and the ends hold", () => {
    expect(move(open, null, "ArrowDown")).toEqual({ select: "~/Documents" });
    expect(move(open, "~/Documents", "ArrowDown")).toEqual({ select: "~/Documents/Work" });
    expect(move(open, "~/Documents", "ArrowUp")).toEqual({ select: "~/Documents" });
    expect(move(open, "~/Documents/b.md", "ArrowDown")).toEqual({ select: "~/Documents/b.md" });
    expect(move(open, "~/Documents/a.md", "Home")).toEqual({ select: "~/Documents" });
    expect(move(open, "~/Documents/a.md", "End")).toEqual({ select: "~/Documents/b.md" });
    expect(move(open, "~/Documents", "Tab")).toBeUndefined();
    expect(move([], null, "ArrowDown")).toBeUndefined();
  });

  it("right expands a closed folder, then steps into it; left collapses or goes to the parent", () => {
    expect(move(closed, "~/Documents/Work", "ArrowRight")).toEqual({ expand: "~/Documents/Work" });
    expect(move(open, "~/Documents/Work", "ArrowRight")).toEqual({
      select: "~/Documents/Work/w.md",
    });
    expect(move(open, "~/Documents/a.md", "ArrowRight")).toEqual({});
    expect(move(open, "~/Documents/Work", "ArrowLeft")).toEqual({ collapse: "~/Documents/Work" });
    expect(move(open, "~/Documents/Work/w.md", "ArrowLeft")).toEqual({
      select: "~/Documents/Work",
    });
    expect(move(open, "~/Documents/a.md", "ArrowLeft")).toEqual({ select: "~/Documents" });
    expect(move(closed, "~/Documents", "ArrowLeft")).toEqual({ collapse: "~/Documents" });
    expect(move(open, null, "ArrowLeft")).toEqual({ select: "~/Documents" });
  });

  it("type-ahead finds the next name that starts with the letters, wrapping around", () => {
    expect(jump(open, null, "a")).toBe("~/Documents/a.md");
    expect(jump(open, "~/Documents/a.md", "b")).toBe("~/Documents/b.md");
    expect(jump(open, "~/Documents/b.md", "w")).toBe("~/Documents/Work");
    expect(jump(open, "~/Documents/Work", "W")).toBe("~/Documents/Work/w.md");
    expect(jump(open, "~/Documents/b.md", "d")).toBe("~/Documents");
    expect(jump(open, null, "zz")).toBeUndefined();
    expect(jump(open, null, "")).toBeUndefined();
  });
});
