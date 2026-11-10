import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  binaryPath,
  downloadUrl,
  ensureChromedriver,
  ensureHeadlessShell,
  type Manifest,
  platformKey,
  readManifest,
} from "./chrome-for-testing";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const zip = new TextEncoder().encode("a zip of chromedriver");
const shellZip = new TextEncoder().encode("a zip of the headless shell");
const manifest: Manifest = {
  chromium: "156.0.8078.88",
  builds: {
    chromedriver: { "mac-arm64": { version: "156.0.8078.88", sha256: sha(zip) } },
    "chrome-headless-shell": { win64: { version: "156.0.8078.88", sha256: sha(shellZip) } },
  },
};

/** A fake unzip that writes the binary where the real archive keeps it. */
const unzip = async (_file: string, into: string) => {
  mkdirSync(join(into, "chromedriver-mac-arm64"), { recursive: true });
  writeFileSync(join(into, "chromedriver-mac-arm64", "chromedriver"), "#!/bin/sh\n");
};

describe("Chrome for Testing's builds for the app's Chromium", () => {
  it("names Chrome for Testing's platforms and its download URLs", () => {
    expect(platformKey("darwin", "arm64")).toBe("mac-arm64");
    expect(platformKey("darwin", "x64")).toBe("mac-x64");
    expect(platformKey("linux", "x64")).toBe("linux64");
    expect(platformKey("win32", "x64")).toBe("win64");
    expect(() => platformKey("linux", "arm64")).toThrow(/no build/);
    expect(downloadUrl("chromedriver", "156.0.8078.88", "mac-arm64")).toBe(
      "https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.88/mac-arm64/chromedriver-mac-arm64.zip",
    );
    expect(downloadUrl("chrome-headless-shell", "156.0.8078.80", "linux64")).toBe(
      "https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.80/linux64/chrome-headless-shell-linux64.zip",
    );
    expect(binaryPath("chromedriver", "/c", "win64")).toBe(
      join("/c", "chromedriver-win64", "chromedriver.exe"),
    );
    expect(binaryPath("chrome-headless-shell", "/c", "mac-x64")).toBe(
      join("/c", "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
    );
  });

  it("pins both builds on every platform the runner supports to the app's Chromium, with a SHA-256 each", () => {
    const pinned = readManifest();
    const cargo = readFileSync(new URL("../../Cargo.toml", import.meta.url), "utf8");
    const cef = /^cef = \{ version = "=(\d+)\./m.exec(cargo)?.[1];
    expect(pinned.chromium.split(".")[0]).toBe(cef);
    for (const build of ["chromedriver", "chrome-headless-shell"] as const) {
      for (const key of ["mac-arm64", "mac-x64", "linux64", "win64"]) {
        const pin = pinned.builds[build][key];
        expect(pin?.sha256, `${build} ${key}`).toMatch(/^[0-9a-f]{64}$/);
        expect(pin?.version.split(".").slice(0, 3), `${build} ${key}`).toEqual(
          pinned.chromium.split(".").slice(0, 3),
        );
      }
      // The runtime e2e runs the very build the app ships where Chrome for Testing has it.
      expect(pinned.builds[build]["mac-arm64"]?.version).toBe(pinned.chromium);
    }
  });

  it("downloads once, checks the zip's SHA-256 and unpacks it into the cache", async () => {
    const cache = mkdtempSync(join(tmpdir(), "desk-chromedriver-"));
    const asked: string[] = [];
    const fetchZip = async (url: string) => {
      asked.push(url);
      return zip;
    };
    const options = { cache, manifest, key: "mac-arm64", fetchZip, unzip };
    const binary = await ensureChromedriver(options);
    expect(binary).toBe(
      join(cache, "156.0.8078.88", "mac-arm64", "chromedriver-mac-arm64", "chromedriver"),
    );
    expect(existsSync(binary)).toBe(true);
    expect(await ensureChromedriver(options)).toBe(binary);
    expect(asked).toEqual([downloadUrl("chromedriver", "156.0.8078.88", "mac-arm64")]);
  });

  it("fetches the headless shell by its own pin into its own place", async () => {
    const cache = mkdtempSync(join(tmpdir(), "desk-headless-shell-"));
    const asked: string[] = [];
    const fetchZip = async (url: string) => {
      asked.push(url);
      return shellZip;
    };
    const unzipShell = async (_file: string, into: string) => {
      mkdirSync(join(into, "chrome-headless-shell-win64"), { recursive: true });
      writeFileSync(join(into, "chrome-headless-shell-win64", "chrome-headless-shell.exe"), "");
    };
    const binary = await ensureHeadlessShell({
      cache,
      manifest,
      key: "win64",
      fetchZip,
      unzip: unzipShell,
    });
    expect(binary).toBe(
      join(
        cache,
        "156.0.8078.88",
        "win64",
        "chrome-headless-shell-win64",
        "chrome-headless-shell.exe",
      ),
    );
    expect(asked).toEqual([downloadUrl("chrome-headless-shell", "156.0.8078.88", "win64")]);
    await expect(ensureHeadlessShell({ cache, manifest, key: "mac-arm64" })).rejects.toThrow(
      /pins nothing for mac-arm64/,
    );
  });

  it("refuses a zip whose SHA-256 is not the pinned one and unpacks nothing", async () => {
    const cache = mkdtempSync(join(tmpdir(), "desk-chromedriver-"));
    const fetchZip = async () => new TextEncoder().encode("something else");
    await expect(
      ensureChromedriver({ cache, manifest, key: "mac-arm64", fetchZip, unzip }),
    ).rejects.toThrow(/SHA-256/);
    expect(existsSync(join(cache, "156.0.8078.88", "mac-arm64", "chromedriver-mac-arm64"))).toBe(
      false,
    );
  });
});
