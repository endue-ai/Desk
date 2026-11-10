// The cargo-packager config for one target of the CEF desk (#46), as plain data: the shared part
// (apps/desk/shell/packager/packager.json) with its relative paths made absolute, plus what each OS
// needs. Nothing here touches the disk, so `--dry-run` and the tests render it on any OS.
import { isAbsolute, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const PACKAGER = join(ROOT, "apps/desk/shell/packager");
/** The shell's binaries (apps/desk/shell/Cargo.toml) until the Tauri one goes and takes its name. */
export const MAIN = "endue-desk-cef";
export const HELPER = "endue-desk-cef-helper";
/** The Tauri desk's binary (apps/desk/src-tauri/tauri.conf.json `mainBinaryName`). */
export const TAURI_MAIN = "endue-desk";

/** The five helper apps CEF needs on macOS: name and identifier suffixes. Which entitlements each
 * one is signed with is scripts/cef-sign-macos.sh's to say. */
export const HELPERS = [
  { suffix: "", id: "" },
  { suffix: " (Alerts)", id: ".alerts" },
  { suffix: " (GPU)", id: ".gpu" },
  { suffix: " (Plugin)", id: ".plugin" },
  { suffix: " (Renderer)", id: ".renderer" },
];

/** The formats each OS builds; the first-install images (.dmg, .msi) are not updater artifacts. */
export const FORMATS = {
  macos: ["app", "dmg"],
  windows: ["nsis", "wix"],
  linux: ["deb", "appimage"],
};

export function osOf(target) {
  if (target.endsWith("-apple-darwin")) return "macos";
  if (target.endsWith("-pc-windows-msvc")) return "windows";
  if (target.endsWith("-unknown-linux-gnu")) return "linux";
  throw new Error(`no CEF desk package for ${target}`);
}

/** "0.5.0" of "0.5.0-pre.212": what Apple's version keys take. */
export const numericVersion = (version) => {
  const m = /^(\d+\.\d+\.\d+)(?:[-+].*)?$/u.exec(version);
  if (!m) throw new Error(`${version} is not a version`);
  return m[1];
};

/** The helper app names and identifiers, as CEF looks for them beside the main executable. */
export const helperApps = (identifier) =>
  HELPERS.map((h) => ({
    ...h,
    name: `${MAIN} Helper${h.suffix}`,
    identifier: `${identifier}.helper${h.id}`,
  }));

/** `template` (apps/desk/shell/packager/macos/helper.plist) for one helper. */
export function helperPlist(template, { name, identifier, version, minimum }) {
  const values = {
    EXECUTABLE: name,
    IDENTIFIER: identifier,
    VERSION: numericVersion(version),
    MINIMUM: minimum,
  };
  const out = template.replace(/@([A-Z]+)@/gu, (whole, key) => {
    if (!(key in values)) throw new Error(`helper.plist has an unknown placeholder ${whole}`);
    return escapeXml(values[key]);
  });
  return out;
}

const escapeXml = (text) =>
  String(text).replace(
    /[<>&"']/gu,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c],
  );

/** packager.json's paths, relative to the packager folder, made absolute; its comments dropped. */
export function shared(base) {
  const abs = (path) => (isAbsolute(path) ? path : join(PACKAGER, path));
  const out = structuredClone(base);
  delete out.$comment;
  out.icons = (out.icons ?? []).map(abs);
  if (out.macos?.infoPlistPath) out.macos.infoPlistPath = abs(out.macos.infoPlistPath);
  if (out.deb?.desktopTemplate) out.deb.desktopTemplate = abs(out.deb.desktopTemplate);
  return out;
}

/** The desk's licence and CEF's (BSD-3 asks binaries to carry it), from `cefFiles`. */
export const licences = (pin, cefFiles) => [
  { src: join(ROOT, "LICENSE"), target: "licenses/LICENSE" },
  ...pin.runtime.notices.map((name) => ({
    src: join(cefFiles, name),
    target: `licenses/CEF-${name}`,
  })),
];

/**
 * The built-in plugins a package carries (#47): of `tracked` (the repository's files under
 * `plugins/`, as `git ls-files` lists them), every file of a folder with a plugin.json, without its
 * tests. The shell installs them from `plugins/` among its resources when DESK_PLUGIN_DIRS is unset.
 */
export function pluginFiles(tracked) {
  const plugins = new Set(
    tracked.map((path) => /^plugins\/([^/]+)\/plugin\.json$/u.exec(path)?.[1]).filter(Boolean),
  );
  return tracked.filter((path) => {
    const [top, id, ...rest] = path.split("/");
    return top === "plugins" && plugins.has(id) && rest.length > 0 && !rest.includes("tests");
  });
}

/** The CEF files a Windows or Linux build carries beside its executable. */
export const runtimeResources = (pin, os, cefFiles) =>
  pin.runtime[os].map((name) => {
    const clean = name.replace(/\/$/u, "");
    return { src: join(cefFiles, clean), target: clean };
  });

/**
 * The whole config for `target`. `paths`: `binaries` (the cargo build's folder), `out`, `stage`
 * (where the helpers, the CEF copies, the built-in plugins and the Linux launcher were put), `cef`
 * (the CEF folder), `dist` (the built shell). `hook`: the command cargo-packager runs before each
 * format.
 */
export function packagerConfig({ base, pin, target, version, paths, hook, signCommand }) {
  const os = osOf(target);
  const config = {
    // Named, or cargo-packager 0.11.8 looks for a Cargo.toml by entering the config file as a folder.
    name: "desk-shell",
    ...shared(base),
    version,
    targetTriple: target,
    outDir: paths.out,
    formats: FORMATS[os],
    binaries: [{ path: MAIN, main: true }],
    binariesDir: os === "linux" ? join(paths.stage, "bin") : paths.binaries,
  };
  // The built-in plugins sit beside the shell, where the desk looks when DESK_PLUGIN_DIRS is unset.
  const runtime = [
    { src: paths.dist, target: "shell" },
    { src: join(paths.stage, "plugins"), target: "plugins" },
  ];
  if (os === "macos") {
    const helpers = helperApps(config.identifier).map((h) =>
      join(paths.stage, "helpers", `${h.name}.app`),
    );
    config.macos = {
      ...config.macos,
      frameworks: [join(paths.cef, "Chromium Embedded Framework.framework"), ...helpers],
    };
    config.resources = [...runtime, ...licences(pin, paths.cef)];
    if (hook) config.beforeEachPackageCommand = hook;
  } else {
    const cefFiles = join(paths.stage, "cef");
    config.resources = [
      ...runtimeResources(pin, os, cefFiles),
      ...runtime,
      ...licences(pin, cefFiles),
    ];
    if (os === "linux") {
      // The real executable lives in /usr/lib/endue-desk-cef beside libcef.so; /usr/bin has the launcher.
      config.resources.unshift({ src: join(paths.binaries, MAIN), target: MAIN });
      // A Tauri desk that installed this .deb as its update restarts what it started as,
      // /usr/bin/endue-desk, which dpkg just removed: the same launcher answers there (#47) until the
      // desk's binary takes that name at the end of Stage 1.
      config.deb = {
        ...config.deb,
        files: { [join(paths.stage, "bin", MAIN)]: `/usr/bin/${TAURI_MAIN}` },
      };
    }
    if (os === "windows" && signCommand) {
      config.windows = { ...config.windows, signCommand };
    }
  }
  return config;
}

/** Where each of cargo-packager's outputs goes in the bundle folder release-collect reads. */
export function bundleFolder(name) {
  const rules = [
    [/\.app\.tar\.gz$/u, "macos"],
    [/\.dmg$/u, "dmg"],
    [/-setup\.exe$/u, "nsis"],
    [/\.msi$/u, "msi"],
    [/\.AppImage$/u, "appimage"],
    [/\.deb$/u, "deb"],
  ];
  return rules.find(([pattern]) => pattern.test(name))?.[1];
}
