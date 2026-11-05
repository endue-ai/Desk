import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const manifest = JSON.parse(
  readFileSync(join(root, "plugins/design/plugin.json"), "utf8"),
) as PluginManifest;

describe("desk.design", () => {
  it("is a policy that declares which design system is in force, the endue one by default", () => {
    expect(manifest.kind).toBe("policy");
    expect(manifest.contributes?.settings?.["desk.design.active"]).toMatchObject({
      kind: "string",
      default: "",
    });
  });
});
