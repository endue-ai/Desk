#!/usr/bin/env node
// OS declarations: what the operating systems must be told before Desk's features work. Without the
// microphone sentence and entitlement, macOS stops the app the moment audio.capture opens the
// microphone; without the virtualization entitlement the tool VM cannot start; Linux packages need
// ALSA for the microphone. The release workflow runs this before it bundles (`just os-declarations`).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const APP = "apps/desk/src-tauri";

/** macOS entitlements the app must be signed with, and the feature that needs each. */
export const ENTITLEMENTS = {
  "com.apple.security.device.audio-input": "the microphone (audio.capture)",
  "com.apple.security.virtualization": "the tool VM (desk-vm)",
};

/** Info.plist sentences macOS shows when Desk first asks. */
export const USAGE = { NSMicrophoneUsageDescription: "the microphone (audio.capture)" };

const plistTrue = (text, key) =>
  new RegExp(`<key>${key.replaceAll(".", "\\.")}</key>\\s*<true\\s*/>`).test(text);
const plistString = (text, key) =>
  new RegExp(`<key>${key}</key>\\s*<string>([^<]*\\S[^<]*)</string>`).exec(text)?.[1];

/** Problems with the declarations of the app in `root`; empty when they are complete. */
export function check(root = ROOT) {
  const app = join(root, APP);
  const problems = [];
  const config = JSON.parse(readFileSync(join(app, "tauri.conf.json"), "utf8"));
  const mac = config.bundle?.macOS ?? {};
  const read = (file, what) => {
    if (!file) {
      problems.push(`bundle.macOS.${what} is not set`);
      return "";
    }
    if (!existsSync(join(app, file))) {
      problems.push(`${APP}/${file} (bundle.macOS.${what}) does not exist`);
      return "";
    }
    return readFileSync(join(app, file), "utf8");
  };

  if (mac.hardenedRuntime === false) problems.push("bundle.macOS.hardenedRuntime is off");
  const entitlements = read(mac.entitlements, "entitlements");
  for (const [key, why] of Object.entries(ENTITLEMENTS)) {
    if (entitlements && !plistTrue(entitlements, key))
      problems.push(`entitlement ${key} is missing; ${why} needs it`);
  }
  const info = read(mac.infoPlist, "infoPlist");
  for (const [key, why] of Object.entries(USAGE)) {
    if (info && !plistString(info, key))
      problems.push(`Info.plist ${key} is missing; ${why} needs it`);
  }
  const deb = config.bundle?.linux?.deb?.depends ?? [];
  if (!deb.some((d) => d.includes("libasound2")))
    problems.push("bundle.linux.deb.depends lacks libasound2 (the microphone)");
  const rpm = config.bundle?.linux?.rpm?.depends ?? [];
  if (!rpm.includes("alsa-lib")) problems.push("bundle.linux.rpm.depends lacks alsa-lib");
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = check();
  for (const problem of problems) console.error(`os-declarations: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log("os-declarations: complete");
}
