#!/usr/bin/env node
// Release configuration: what a release build adds to tauri.conf.json (ADR 0021). The updater gets
// its public key and the stable channel's manifest, bundles get updater signatures, and Windows
// binaries are signed with Azure Artifact Signing (trusted-signing-cli). Printed as JSON for
// `tauri build --config`.
//
// usage: node scripts/release-config.mjs > release.conf.json
//   env: DESK_UPDATER_PUBKEY, REPO (owner/name); on Windows AZURE_SIGNING_ENDPOINT,
//   AZURE_SIGNING_ACCOUNT and AZURE_SIGNING_PROFILE.
import { fileURLToPath } from "node:url";

/** The configuration for `env`, or the names of the settings it lacks. */
export function releaseConfig(env, platform = process.platform) {
  const missing = [];
  const need = (name) => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? "";
  };
  const pubkey = need("DESK_UPDATER_PUBKEY");
  const repo = need("REPO");
  const config = {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey,
        endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
        // The manifest is not signed; tie each artifact to the version it was signed for.
        requireSignedVersion: true,
      },
    },
  };
  if (platform === "win32") {
    config.bundle.windows = {
      signCommand: {
        cmd: "trusted-signing-cli",
        args: [
          "-e",
          need("AZURE_SIGNING_ENDPOINT"),
          "-a",
          need("AZURE_SIGNING_ACCOUNT"),
          "-c",
          need("AZURE_SIGNING_PROFILE"),
          "-d",
          "endue Desk",
          "%1",
        ],
      },
    };
  }
  return missing.length > 0 ? { missing } : { config };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { config, missing } = releaseConfig(process.env);
  if (missing) {
    console.error(`release-config: set ${missing.join(", ")} (see docs/release.md)`);
    process.exit(1);
  }
  console.log(JSON.stringify(config, null, 2));
}
