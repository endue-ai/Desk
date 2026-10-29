import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { main } from "./cli";

let cwd: string;
let out: string[];
let err: string[];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "create-plugin-"));
  out = [];
  err = [];
});

const run = (...argv: string[]) =>
  main(argv, { cwd, out: (line) => out.push(line), err: (line) => err.push(line) });

const manifestIn = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8")) as Record<string, unknown>;

describe("main", () => {
  it("creates a plugin folder named after its argument", async () => {
    expect(await run("my-plugin")).toBe(0);
    const dir = join(cwd, "my-plugin");
    expect(manifestIn(dir)).toMatchObject({ id: "local.my-plugin", name: "My plugin" });
    expect(existsSync(join(dir, "ui/index.html"))).toBe(true);
    expect(err).toEqual([]);
    expect(out[0]).toBe(`Created local.my-plugin in ${dir}`);
    // The folder is quoted on Windows, where the temporary path holds backslashes.
    expect(out.find((line) => line.includes("plugin validate"))).toContain(dir);
    expect(out.find((line) => line.includes("DESK_DEV_PLUGINS="))).toContain(dir);
    expect(out.join("\n")).toContain("Change the id");
  });

  it("quotes a folder with a space in the next commands", async () => {
    expect(await run("my notes")).toBe(0);
    const dir = join(cwd, "my notes");
    expect(manifestIn(dir)).toMatchObject({ id: "local.my-notes", name: "My notes" });
    expect(out).toContain(`  cargo run -p desk-cli -- plugin validate '${dir}'`);
    expect(out).toContain(`  DESK_DEV_PLUGINS='${dir}' just dev`);
  });

  it("takes the id, name and description from options", async () => {
    const code = await run(
      "notes",
      "--id",
      "example.notes",
      "--name",
      "Notes",
      "--description",
      "Notes.",
    );
    expect(code).toBe(0);
    expect(manifestIn(join(cwd, "notes"))).toMatchObject({
      id: "example.notes",
      name: "Notes",
      description: "Notes.",
    });
    expect(out.join("\n")).not.toContain("Change the id");
  });

  it("accepts an absolute folder and creates missing parents", async () => {
    const dir = join(cwd, "deep/er/tags");
    expect(await run(dir)).toBe(0);
    expect(manifestIn(dir)).toMatchObject({ id: "local.tags" });
  });

  it("fills an existing empty folder", async () => {
    mkdirSync(join(cwd, "empty"));
    expect(await run("empty")).toBe(0);
    expect(manifestIn(join(cwd, "empty"))).toMatchObject({ id: "local.empty" });
  });

  it("refuses a folder that is not empty and writes nothing", async () => {
    const dir = join(cwd, "taken");
    mkdirSync(dir);
    writeFileSync(join(dir, "notes.txt"), "mine");
    expect(await run("taken")).toBe(1);
    expect(readdirSync(dir)).toEqual(["notes.txt"]);
    expect(err.join("\n")).toContain("is not empty");
  });

  it("refuses a path that is a file", async () => {
    writeFileSync(join(cwd, "file"), "");
    expect(await run("file")).toBe(1);
    expect(err.join("\n")).toContain("is not a folder");
  });

  it("refuses an id the manifest schema would reject", async () => {
    expect(await run("notes", "--id", "Notes")).toBe(2);
    expect(existsSync(join(cwd, "notes"))).toBe(false);
    expect(err.join("\n")).toContain("id Notes");
  });

  it("refuses an empty name", async () => {
    expect(await run("notes", "--name", "")).toBe(2);
    expect(existsSync(join(cwd, "notes"))).toBe(false);
  });

  it.each([[[]], [["a", "b"]], [["a", "--kind", "logic"]], [["a", "--id"]]])(
    "prints the usage for %j",
    async (argv) => {
      expect(await run(...argv)).toBe(2);
      expect(err.join("\n")).toContain("usage: create-plugin <folder>");
      expect(readdirSync(cwd)).toEqual([]);
    },
  );

  it("prints the usage on --help", async () => {
    expect(await run("--help")).toBe(0);
    expect(out.join("\n")).toContain("usage: create-plugin <folder>");
  });
});
