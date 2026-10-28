import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releaseConfig } from "./release-config.mjs";

const env = { DESK_UPDATER_PUBKEY: "dW50cnVzdGVk", REPO: "endue-ai/Desk" };

describe("release-config", () => {
  it("points the updater at the stable manifest and signs updater bundles", () => {
    const { config } = releaseConfig(env, "darwin");
    assert.deepEqual(config, {
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          pubkey: "dW50cnVzdGVk",
          endpoints: ["https://github.com/endue-ai/Desk/releases/latest/download/latest.json"],
          requireSignedVersion: true,
        },
      },
    });
  });

  it("signs Windows binaries with Artifact Signing", () => {
    const { config } = releaseConfig(
      {
        ...env,
        AZURE_SIGNING_ENDPOINT: "https://wus2.codesigning.azure.net",
        AZURE_SIGNING_ACCOUNT: "endue",
        AZURE_SIGNING_PROFILE: "desk",
      },
      "win32",
    );
    assert.deepEqual(config.bundle.windows.signCommand.args, [
      "-e",
      "https://wus2.codesigning.azure.net",
      "-a",
      "endue",
      "-c",
      "desk",
      "-d",
      "endue Desk",
      "%1",
    ]);
  });

  it("names every missing setting", () => {
    assert.deepEqual(releaseConfig({ REPO: "endue-ai/Desk" }, "win32").missing, [
      "DESK_UPDATER_PUBKEY",
      "AZURE_SIGNING_ENDPOINT",
      "AZURE_SIGNING_ACCOUNT",
      "AZURE_SIGNING_PROFILE",
    ]);
  });
});
