// What Eris reads through Archives (ADR 0088): the open archive's entries, one folder of them, and
// one entry's text, bounded, with nothing extracted to disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { zipOf } from "./fixtures";
import { file, mount, READ, WRITE } from "./harness";

const PATH = "~/Downloads/notes.zip";
const ZIP = zipOf([
  { name: "readme.txt", data: "Hello from the zip" },
  { name: "docs/plan.md", data: "# Plan\nShip it", deflate: true },
]);

async function opened() {
  const mounted = await mount({ files: { [PATH]: ZIP }, grants: [READ("~/Downloads")] });
  return mounted;
}

describe("an agent's archives commands", () => {
  it("lists the entries, or one folder's, and refuses with nothing open", async () => {
    const { host, params } = await opened();
    await expect(host.command("endue.archives.list")).rejects.toThrow(/No archive is open/);
    await host.command("desk.files.visit", file(PATH));
    const all = (await host.command("endue.archives.list")) as {
      entries: Array<{ path: string; kind: string }>;
      total: number;
    };
    expect(all.entries.map((e) => e.path)).toEqual(
      expect.arrayContaining(["readme.txt", "docs/plan.md"]),
    );
    const docs = (await host.command("endue.archives.list", { under: "docs" })) as {
      entries: Array<{ path: string }>;
    };
    expect(docs.entries.map((e) => e.path).filter((p) => p !== "docs")).toEqual(["docs/plan.md"]);
    expect(params("fs.write")).toEqual([]);
  });

  it("reads an entry's text, a deflated one too, and part of it", async () => {
    const { host } = await opened();
    await host.command("desk.files.visit", file(PATH));
    await expect(
      host.command("endue.archives.read", { entry: "docs/plan.md" }),
    ).resolves.toMatchObject({ text: "# Plan\nShip it", binary: false, truncated: false });
    await expect(
      host.command("endue.archives.read", { entry: "readme.txt", maxBytes: 5 }),
    ).resolves.toMatchObject({ text: "Hello", truncated: true });
    await expect(host.command("endue.archives.read", { entry: "nope.txt" })).rejects.toThrow(
      /holds no nope.txt/,
    );
  });

  it("shows an entry and extracts only the named file to the explicit destination", async () => {
    const dest = "~/Downloads/unpacked";
    const { host, params } = await mount({
      files: { [PATH]: ZIP },
      grants: [READ("~/Downloads"), WRITE(dest)],
    });
    await host.command("desk.files.visit", file(PATH));
    await expect(
      host.command("endue.archives.show", { entry: "readme.txt" }),
    ).resolves.toMatchObject({ entry: "readme.txt" });
    await expect(
      host.command("endue.archives.extract", { path: PATH, entries: ["docs/plan.md"], to: dest }),
    ).resolves.toMatchObject({ written: 1, to: dest });
    expect(params("fs.write")).toMatchObject([{ path: `${dest}/docs/plan.md` }]);
    expect(params("perm.request")).toEqual([]);
  });

  it("are offered to agents as reads", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
    ) as PluginManifest;
    for (const id of ["endue.archives.list", "endue.archives.read"])
      expect(
        manifest.contributes?.commands?.find((c) => c.id === id),
        id,
      ).toMatchObject({
        agent: true,
        readOnly: true,
        args: { additionalProperties: false },
      });
  });
});
