import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  binaryPath,
  downloadUrl,
  ensureChromedriver,
  type Manifest,
  platformKey,
  readManifest,
} from "./chromedriver";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const zip = new TextEncoder().encode("a zip of chromedriver");
const manifest: Manifest = {
  chromium: "156.0.8078.88",
  downloads: { "mac-arm64": { version: "156.0.8078.88", sha256: sha(zip) } },
};

/** A fake unzip that writes the binary where the real archive keeps it. */
const unzip = async (_file: string, into: string) => {
  mkdirSync(join(into, "chromedriver-mac-arm64"), { recursive: true });
  writeFileSync(join(into, "chromedriver-mac-arm64", "chromedriver"), "#!/bin/sh\n");
};

describe("the chromedriver the app e2e attaches with", () => {
  it("names Chrome for Testing's platforms and its download URLs", () => {
    expect(platformKey("darwin", "arm64")).toBe("mac-arm64");
    expect(platformKey("darwin", "x64")).toBe("mac-x64");
    expect(platformKey("linux", "x64")).toBe("linux64");
    expect(platformKey("win32", "x64")).toBe("win64");
    expect(() => platformKey("linux", "arm64")).toThrow(/no chromedriver/);
    expect(downloadUrl("156.0.8078.88", "mac-arm64")).toBe(
      "https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.88/mac-arm64/chromedriver-mac-arm64.zip",
    );
    expect(binaryPath("/c", "win64")).toBe(join("/c", "chromedriver-win64", "chromedriver.exe"));
  });

  it("pins every platform the runner supports to the app's Chromium, with a SHA-256 each", () => {
    const pinned = readManifest();
    const cargo = readFileSync(new URL("../../Cargo.toml", import.meta.url), "utf8");
    const cef = /^cef = \{ version = "=(\d+)\./m.exec(cargo)?.[1];
    expect(pinned.chromium.split(".")[0]).toBe(cef);
    for (const key of ["mac-arm64", "mac-x64", "linux64", "win64"]) {
      const pin = pinned.downloads[key];
      expect(pin?.sha256, key).toMatch(/^[0-9a-f]{64}$/);
      expect(pin?.version.split(".").slice(0, 3), key).toEqual(
        pinned.chromium.split(".").slice(0, 3),
      );
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
    expect(asked).toEqual([downloadUrl("156.0.8078.88", "mac-arm64")]);
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
