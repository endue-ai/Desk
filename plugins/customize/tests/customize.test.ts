import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  readFileSync(join(root, "plugins/customize/plugin.json"), "utf8"),
) as PluginManifest;

describe("desk.customize", () => {
  it("is a policy that applies the person's changes to plugin pages by default", () => {
    expect(manifest.kind).toBe("policy");
    expect(manifest.contributes?.settings?.["desk.customize.enabled"]).toMatchObject({
      kind: "boolean",
      default: true,
    });
  });
});
