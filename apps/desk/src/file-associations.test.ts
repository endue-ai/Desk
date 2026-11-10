// @vitest-environment jsdom
// The files the OS offers to open with the desk (the CEF desk's packages, #46): common built-in
// formats as a viewer that never takes them from their default app, on macOS (Info.plist) and Linux
// (the desktop entry). Windows registers none yet (#61).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const packager = join(root, "apps/desk/shell/packager");
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

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

type Plist = string | boolean | Plist[] | { [key: string]: Plist };

/** One plist value: a dict, an array, a string or a boolean. */
function plistValue(node: Element): Plist {
  if (node.tagName === "dict") {
    const out: Record<string, Plist> = {};
    const children = [...node.children];
    for (let i = 0; i < children.length; i += 2) {
      const key = children[i];
      const value = children[i + 1];
      expect(key?.tagName).toBe("key");
      if (key && value) out[key.textContent ?? ""] = plistValue(value);
    }
    return out;
  }
  if (node.tagName === "array") return [...node.children].map(plistValue);
  if (node.tagName === "true" || node.tagName === "false") return node.tagName === "true";
  return node.textContent ?? "";
}

function infoPlist(): Record<string, Plist> {
  const text = readFileSync(join(packager, "macos/Info.plist"), "utf8");
  const document = new DOMParser().parseFromString(text, "application/xml");
  expect(document.querySelector("parsererror")).toBeNull();
  const dict = document.querySelector("plist > dict");
  expect(dict).not.toBeNull();
  return plistValue(dict as Element) as Record<string, Plist>;
}

type DocumentType = {
  CFBundleTypeName: string;
  CFBundleTypeRole: string;
  LSHandlerRank: string;
  CFBundleTypeExtensions: string[];
  CFBundleTypeMIMETypes?: string[];
  LSItemContentTypes?: string[];
};

const documentTypes = () => (infoPlist().CFBundleDocumentTypes ?? []) as DocumentType[];

it("registers common built-in formats as viewers without claiming executables or broad types", () => {
  const types = documentTypes();
  const patterns = readdirSync(join(root, "plugins"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "plugins", entry.name, "plugin.json")),
    )
    .flatMap((entry) => json(`plugins/${entry.name}/plugin.json`).contributes?.files ?? [])
    .map((rule: { pattern: string }) => rule.pattern);
  expect(types.flatMap((type) => type.CFBundleTypeExtensions).sort()).toEqual([...expected].sort());
  for (const type of types) {
    expect(type.CFBundleTypeRole, type.CFBundleTypeName).toBe("Viewer");
    expect(type.LSHandlerRank, type.CFBundleTypeName).toBe("Alternate");
    for (const extension of type.CFBundleTypeExtensions)
      expect(patterns).toContain(`*.${extension}`);
    expect(type.LSItemContentTypes ?? []).not.toContain("public.data");
  }
});

it("passes local file lists through the Linux desktop entry the .deb and the AppImage use", () => {
  expect(json("apps/desk/shell/packager/packager.json").deb.desktopTemplate).toBe(
    "linux/desk.desktop",
  );
  const desktop = readFileSync(join(packager, "linux/desk.desktop"), "utf8");
  const lines = desktop.split("\n");
  expect(lines.find((line) => line.startsWith("Exec="))).toBe("Exec={{exec}} %F");
  expect(desktop).toContain("Name={{name}}");
  expect(desktop).toContain("Icon={{icon}}");
  expect(desktop).toContain("Type=Application");
  expect(desktop).toContain("Terminal=false");
  // Every MIME type macOS names is one Linux offers too.
  const mime = (lines.find((line) => line.startsWith("MimeType=")) ?? "")
    .slice("MimeType=".length)
    .split(";")
    .filter(Boolean);
  for (const type of documentTypes().flatMap((t) => t.CFBundleTypeMIMETypes ?? []))
    expect(mime).toContain(type);
});

it("runs the shell's native gates for the shell and the primitives it links", () => {
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const pattern = workflow.match(/grep -qE '([^']+)' <<<"\$files"/)?.[1];
  expect(pattern).toBeDefined();
  const filter = new RegExp(pattern ?? "^$");
  for (const path of [
    "apps/desk/shell/src/main.rs",
    "crates/desk-sys/src/lib.rs",
    "crates/desk-web/src/lib.rs",
  ])
    expect(filter.test(path), path).toBe(true);
  expect(filter.test("packages/runtime/src/main.ts")).toBe(false);
});
