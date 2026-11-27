import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { main } from "./cli";

let cwd: string;
let err: string[];
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "desk-ui-install-"));
  err = [];
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});
const run = (...args: string[]) => main(args, { cwd, out() {}, err: (line) => err.push(line) });

it("adds the web-only scaffold to the Desk folder and preserves installed files on a repeat", async () => {
  expect(await run("source", "--preset", "visualization")).toBe(0);
  await mkdir(join(cwd, "source/node_modules"));
  expect(await run("install", "source", "--plugins-dir", "plugins")).toBe(0);
  const installed = join(cwd, "plugins/local.source");
  const manifest = JSON.parse(await readFile(join(installed, "plugin.json"), "utf8"));
  expect(manifest).toMatchObject({ id: "local.source", kind: "ui", entry: "ui/index.html" });
  expect(await readdir(installed)).not.toContain("node_modules");
  await writeFile(join(installed, "ui/index.html"), "My edited plugin");
  expect(await run("install", "source", "--plugins-dir", "plugins")).toBe(1);
  expect(err.join(" ")).toContain("already exists");
  expect(await readFile(join(installed, "ui/index.html"), "utf8")).toBe("My edited plugin");
  expect(await readdir(join(cwd, "plugins"))).toEqual(["local.source"]);
});

it.skipIf(process.platform === "win32")(
  "does not follow links from a plugin into other files",
  async () => {
    expect(await run("source")).toBe(0);
    await writeFile(join(cwd, "private.txt"), "private");
    await symlink(join(cwd, "private.txt"), join(cwd, "source/ui/linked.txt"));
    expect(await run("install", "source", "--plugins-dir", "plugins")).toBe(1);
    expect(err.join(" ")).toContain("regular file");
    expect(await readdir(join(cwd, "plugins"))).toEqual([]);
  },
);
