// @vitest-environment jsdom
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
    "allow-palette-reveal-main",
    "dialog:allow-open",
  ]);
  const build = readFileSync(join(root, "apps/desk/src-tauri/build.rs"), "utf8");
  expect(build).toContain('"take_open_files"');
});

const progid = "ai.endue.desk.file";
const classes = "Software\\Classes\\";
type Operation = {
  action: "write" | "delete" | "deleteKey";
  key: string;
  name: string;
  value: string;
};
const expectedExtensions = json("apps/desk/src-tauri/tauri.conf.json")
  .bundle.fileAssociations.flatMap((association: { ext: string[] }) => association.ext)
  .sort();
const source = (file: string) => readFileSync(join(root, "apps/desk/src-tauri", file), "utf8");

it("uses supported Windows overrides instead of generated default-association installers", () => {
  const config = json("apps/desk/src-tauri/tauri.windows.conf.json");
  expect(config.bundle.fileAssociations).toEqual([]);
  expect(config.bundle.windows.nsis.installerHooks).toBe("windows/file-associations.nsh");
  expect(config.bundle.windows.wix.fragmentPaths).toEqual(["windows/file-associations.wxs"]);
  expect(config.bundle.windows.wix.componentRefs).toEqual(["DeskFileAssociations"]);
});

function nsisOperations(hook: string): Operation[] {
  const body = source("windows/file-associations.nsh")
    .split(`!macro ${hook}\n`)[1]
    ?.split("!macroend")[0];
  expect(body).toBeDefined();
  return (body ?? "")
    .split("\n")
    .filter((line) => /(?:WriteRegStr|DeleteRegValue|DeleteRegKey)/.test(line))
    .map((line) => {
      expect(line).toContain("SHELL_CONTEXT");
      const values = [...line.matchAll(/"([^"]*)"|'([^']*)'/g)].map(
        (match) => match[1] ?? match[2],
      );
      const action = line.includes("WriteRegStr")
        ? "write"
        : line.includes("DeleteRegValue")
          ? "delete"
          : "deleteKey";
      return { action, key: values[0] ?? "", name: values[1] ?? "", value: values[2] ?? "" };
    });
}

function wixOperations(): Operation[] {
  const document = new DOMParser().parseFromString(
    source("windows/file-associations.wxs"),
    "application/xml",
  );
  expect(document.querySelector("parsererror")).toBeNull();
  expect(document.querySelector("ProgId, Extension, RemoveRegistryKey, RegistryKey")).toBeNull();
  expect(document.querySelector('Component[Id="DeskFileAssociations"]')).not.toBeNull();
  return [...document.querySelectorAll("RegistryValue")].map((entry) => {
    expect(entry.getAttribute("Root")).toBe("HKMU");
    expect(entry.getAttribute("Type")).toBe("string");
    return {
      action: "write",
      key: entry.getAttribute("Key") ?? "",
      name: entry.getAttribute("Name") ?? "",
      value: entry.getAttribute("Value") ?? "",
    };
  });
}

for (const installer of ["nsis", "wix"]) {
  it(`${installer} install, upgrade and removal preserve existing defaults and other applications`, () => {
    const install =
      installer === "nsis" ? nsisOperations("NSIS_HOOK_POSTINSTALL") : wixOperations();
    const remove: Operation[] =
      installer === "nsis"
        ? nsisOperations("NSIS_HOOK_POSTUNINSTALL")
        : install.map((operation) => ({ ...operation, action: "delete" }));
    const advertised = install.filter((operation) => operation.key.endsWith("\\OpenWithProgids"));
    expect(
      advertised.map((operation) => operation.key.slice(classes.length + 1).split("\\")[0]).sort(),
    ).toEqual(expectedExtensions);
    for (const operation of [...install, ...remove]) {
      const ownClass =
        operation.key === classes + progid || operation.key.startsWith(`${classes}${progid}\\`);
      const ownOpenWith =
        operation.key.startsWith(`${classes}.`) &&
        operation.key.endsWith("\\OpenWithProgids") &&
        operation.name === progid &&
        operation.action !== "deleteKey";
      expect(ownClass || ownOpenWith, JSON.stringify(operation)).toBe(true);
    }
    expect(
      advertised.every((operation) => operation.name === progid && operation.value === ""),
    ).toBe(true);
    const command = install.find((operation) =>
      operation.key.endsWith("\\shell\\open\\command"),
    )?.value;
    if (installer === "nsis")
      expect(command).toMatch(/^"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe" "%1"$/);
    else expect(command).toBe('"[#Path]" "%1"');
    const registry = new Map<string, string>();
    const address = (key: string, name: string) => `${key}|${name}`;
    for (const extension of expectedExtensions) {
      registry.set(address(`${classes}.${extension}`, ""), "OtherApp.File");
      registry.set(address(`${classes}.${extension}\\OpenWithProgids`, "OtherApp.File"), "");
      registry.set(
        address(
          `Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${extension}\\UserChoice`,
          "ProgId",
        ),
        "OtherApp.File",
      );
    }
    const before = new Map(registry);
    const apply = (operations: Operation[]) => {
      for (const operation of operations) {
        if (operation.action === "write")
          registry.set(address(operation.key, operation.name), operation.value);
        else if (operation.action === "delete")
          registry.delete(address(operation.key, operation.name));
        else
          for (const key of registry.keys())
            if (key.startsWith(`${operation.key}|`) || key.startsWith(`${operation.key}\\`))
              registry.delete(key);
      }
    };
    apply(install);
    apply(install);
    for (const [key, value] of before) expect(registry.get(key)).toBe(value);
    expect(registry.size).toBe(before.size + install.length);
    apply(remove);
    expect(registry).toEqual(before);
  });
}

it("restores the NSIS installation context before deleting associations, even after app-data cleanup", () => {
  const hooks = source("windows/file-associations.nsh");
  const cleanup = hooks.split("!macro NSIS_HOOK_POSTUNINSTALL\n")[1]?.split("!macroend")[0] ?? "";
  expect(cleanup.indexOf("!insertmacro DeskAssociationContext")).toBeLessThan(
    cleanup.indexOf("DeleteRegValue"),
  );
  expect(cleanup).toContain("!insertmacro DeskAssociationContext");
  const context = hooks.split("!macro DeskAssociationContext\n")[1]?.split("!macroend")[0] ?? "";
  for (const [mode, user, expected] of [
    ["currentUser", "", "current"],
    ["perUser", "", "current"],
    ["perMachine", "", "all"],
    ["both", "AllUsers", "all"],
    ["both", "CurrentUser", "current"],
  ]) {
    // Execute the small conditional context block against all supported installer modes.
    let active = true;
    const stack: { parent: boolean; matched: boolean }[] = [];
    let actual = "current"; // Tauri's DeleteAppData branch always leaves this context.
    for (const sourceLine of context.split("\n")) {
      const line = sourceLine.trim();
      const condition = (expression: string) => {
        const [left, right] = expression.split(" == ").map((part) => part.replaceAll('"', ""));
        return (
          (left === "$" + "{INSTALLMODE}"
            ? mode
            : left === "$MultiUser.InstallMode"
              ? user
              : left) === right
        );
      };
      if (line.startsWith("!if ") || line.startsWith("$" + "{If} ")) {
        const matched = condition(line.replace(/^(?:!if|\$\{If\}) /, ""));
        stack.push({ parent: active, matched });
        active = active && matched;
      } else if (line.startsWith("!else if ")) {
        const top = stack.at(-1);
        if (!top) throw new Error("Missing condition");
        const matched = condition(line.slice(9));
        active = top.parent && !top.matched && matched;
        top.matched ||= matched;
      } else if (line === "!else" || line === "$" + "{Else}") {
        const top = stack.at(-1);
        if (!top) throw new Error("Missing condition");
        active = top.parent && !top.matched;
      } else if (line === "!endif" || line === "$" + "{EndIf}")
        active = stack.pop()?.parent ?? true;
      else if (active && line.startsWith("SetShellVarContext ")) actual = line.slice(19);
    }
    expect(actual, `${mode}/${user}`).toBe(expected);
  }
});

it("passes local file lists through the Linux desktop entry used by deb, rpm and AppImage", () => {
  const config = json("apps/desk/src-tauri/tauri.conf.json");
  expect(config.bundle.linux.deb.desktopTemplate).toBe("linux/desk.desktop");
  expect(config.bundle.linux.rpm.desktopTemplate).toBe("linux/desk.desktop");
  const desktop = source("linux/desk.desktop");
  expect(desktop.split("\n").find((line) => line.startsWith("Exec="))).toBe("Exec={{exec}} %F");
  expect(desktop).toContain("MimeType={{mime_type}}");
  expect(desktop).toContain("Name={{name}}");
  expect(desktop).toContain("Icon={{icon}}");
  expect(desktop).toContain("Type=Application");
  expect(desktop).toContain("Terminal=false");
});

it("runs native app gates for vendored single-instance changes", () => {
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const pattern = workflow.match(/grep -qE '([^']+)' <<<"\$files"/)?.[1];
  expect(pattern).toBeDefined();
  const filter = new RegExp(pattern ?? "^$");
  for (const path of [
    "vendor/tauri-plugin-single-instance/src/platform_impl/linux.rs",
    "vendor/tauri-plugin-single-instance/Cargo.toml",
    "apps/desk/src-tauri/src/lib.rs",
    "crates/desk-sys/src/lib.rs",
  ])
    expect(filter.test(path), path).toBe(true);
  expect(filter.test("packages/runtime/src/main.ts")).toBe(false);
});
