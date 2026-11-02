// endue.archives reads 7z, RAR, disk images, DMGs, SquashFS and WIM and decodes streams with
// endue.formats (#181, #194): the page maps the library's folder in its import map, the readers
// import it by its bare specifier, and the library worker by its URL.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { openArchive } from "../ui/formats/index.js";
import { memorySource } from "../ui/source.js";

const root = join(import.meta.dirname, "../../..");
const ui = join(root, "plugins/archives/ui");
const library = join(root, "plugins/formats");

/** Every module of the plugin's page, relative to ui/. */
function modules(dir = ui): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return modules(path);
    return name.endsWith(".js") ? [relative(ui, path)] : [];
  });
}

describe("endue.archives on endue.formats", () => {
  it("maps @endue-ai/formats/ to the library's lib/ folder in its page's import map", () => {
    const html = readFileSync(join(ui, "index.html"), "utf8");
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "{}";
    expect(JSON.parse(map).imports).toEqual({
      "@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js",
      "@endue-ai/ui": "/_desk/ui.js",
      "@endue-ai/formats/": "/endue.formats/lib/",
    });
  });

  it("keeps no copy of the library's readers, and imports only files the library has", () => {
    expect(existsSync(join(ui, "codecs"))).toBe(false);
    expect(existsSync(join(ui, "formats/sevenzip"))).toBe(false);
    for (const reader of ["rar", "disk", "dmg", "vdisk", "squashfs", "wim"])
      expect(existsSync(join(ui, `formats/${reader}.js`)), reader).toBe(false);
    const imported = new Set<string>();
    for (const module of modules()) {
      const source = readFileSync(join(ui, module), "utf8");
      for (const [, path] of source.matchAll(/"@endue-ai\/formats\/([^"]+)"/g)) {
        expect(existsSync(join(library, "lib", path ?? "")), `${module}: ${path}`).toBe(true);
        imported.add(path ?? "");
      }
    }
    expect([...imported]).toEqual(
      expect.arrayContaining([
        "codecs/index.js",
        "codecs/input.js",
        "sevenzip/index.js",
        "rar/index.js",
        "disk/index.js",
        "apple/index.js",
        "packs/index.js",
      ]),
    );
  });

  it("opens a 7z and decodes an xz stream through the library", async () => {
    const fixture = (path: string) => new Uint8Array(readFileSync(join(library, "tests", path)));
    const seven = await openArchive(memorySource(fixture("sevenzip/fixtures/plain.7z")), "a.7z");
    expect(seven.format).toBe("7z");
    const hello = seven.entries.find((e) => e.path === "hello.txt");
    expect(hello && new TextDecoder().decode(await seven.read(hello))).toBe("Hello, archives!\n");

    const xz = await openArchive(memorySource(fixture("codecs/fixtures/text.xz")), "text.xz");
    const text = xz.entries.find((e) => e.kind === "file");
    expect(text && (await xz.read(text, 6))).toEqual(new TextEncoder().encode("00001 "));
  });
});
