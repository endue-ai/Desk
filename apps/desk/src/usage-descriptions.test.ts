// What macOS says when the desk first asks for the microphone (#378, ADR 0245): who can hear it,
// the desk and the plugins the person allows, and no promise of where the sound goes, which a plugin
// that may both capture and reach the network decides for itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const PLIST = join(import.meta.dirname, "../shell/packager/macos/Info.plist");

/** The string under `key` in the Info.plist cargo-packager merges into the app's. */
function usage(key: string): string | undefined {
  const text = readFileSync(PLIST, "utf8");
  return text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
}

it("says the desk and the plugins you allow can hear the microphone, and promises nothing of where the sound goes", () => {
  const said = usage("NSMicrophoneUsageDescription");
  expect(said).toMatch(/^endue /);
  expect(said).toMatch(/\bplugins you allow\b/);
  expect(said).toMatch(/\bhear\b/);
  expect(said).not.toMatch(/stays|leaves|never|only|on this Mac/i);
});
