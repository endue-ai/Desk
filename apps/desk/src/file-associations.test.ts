import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

it("registers common built-in formats as viewers without claiming executables or broad types", () => {
  const config = json("apps/desk/src-tauri/tauri.conf.json");
  const associations = config.bundle.fileAssociations ?? [];
  const expected = [
    "md",
    "txt",
    "csv",
    "xlsx",
    "docx",
    "pptx",
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "mp3",
    "mp4",
    "zip",
    "html",
  ];
  const patterns = readdirSync(join(root, "plugins"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "plugins", entry.name, "plugin.json")),
    )
    .flatMap((entry) => json(`plugins/${entry.name}/plugin.json`).contributes?.files ?? [])
    .map((rule) => rule.pattern);
  expect(associations.flatMap((a: { ext: string[] }) => a.ext).sort()).toEqual(
    [...expected].sort(),
  );
  for (const association of associations) {
    expect(association.role).toBe("Viewer");
    expect(association.rank).toBe("Alternate");
    for (const extension of association.ext) expect(patterns).toContain(`*.${extension}`);
    expect(association.contentTypes ?? []).not.toContain("public.data");
  }
});

it("exposes only the named host queue drain to the main window alongside existing capabilities", () => {
  const capability = json("apps/desk/src-tauri/capabilities/default.json");
  expect(capability.windows).toEqual(["main"]);
  expect(capability.permissions).toEqual([
    "allow-bridge-call",
    "allow-desk-ready",
    "allow-take-open-files",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "dialog:allow-open",
  ]);
  const build = readFileSync(join(root, "apps/desk/src-tauri/build.rs"), "utf8");
  expect(build).toContain('"take_open_files"');
});
