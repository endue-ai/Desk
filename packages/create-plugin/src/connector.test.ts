import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { renderPlugin } from "./template";

const root = join(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

// plugin.schema.json references the item, view and connector schemas, which reference it back.
function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const folder of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", folder);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(JSON.parse(read(join("specs", folder, name))) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const render = () => renderPlugin({ id: "example.my-notes", name: "My notes", kind: "connector" });

describe("renderPlugin with kind connector", () => {
  it("writes a connector manifest that specs/plugin v0 accepts", () => {
    const manifest = JSON.parse(render()["plugin.json"] ?? "null") as PluginManifest;
    const validate = manifestValidator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      id: "example.my-notes",
      name: "My notes",
      kind: "connector",
      entry: "build/wasm32-wasip2/release/my_notes.wasm",
      connector: {
        binding: "wasm",
        auth: { kind: "none" },
        resources: [{ kind: "note" }],
        sync: { mode: "pull" },
      },
    });
    expect(manifest.connector?.resources).toHaveLength(1);
    expect(manifest.permissions ?? []).toEqual([]);
  });

  it("lays out a Rust component folder", () => {
    const files = render();
    expect(Object.keys(files).sort()).toEqual([
      ".cargo/config.toml",
      ".gitignore",
      "Cargo.toml",
      "README.md",
      "plugin.json",
      "src/lib.rs",
      "wit/desk-connector.wit",
      "wit/desk-host.wit",
    ]);
    expect(files[".cargo/config.toml"]).toBe(
      read("examples/plugin-hello-connector/.cargo/config.toml"),
    );
  });

  it("carries specs/wit byte for byte", () => {
    const files = render();
    expect(files["wit/desk-host.wit"]).toBe(read("specs/wit/desk-host.wit"));
    expect(files["wit/desk-connector.wit"]).toBe(read("specs/wit/desk-connector.wit"));
  });

  it("binds the desk:connector world and exports its four functions", () => {
    const files = render();
    const lib = files["src/lib.rs"] ?? "";
    const generate = /generate!\(\{([^}]*)\}\)/s.exec(lib)?.[1] ?? "";
    expect(generate).toContain('path: "wit"');
    expect(generate).toContain('world: "desk:connector/connector"');
    expect(generate).toContain("generate_all");
    for (const name of ["sync", "query", "act", "status"]) {
      expect(lib).toMatch(new RegExp(`\\bfn ${name}\\(`));
    }
    const cargo = files["Cargo.toml"] ?? "";
    expect(cargo).toContain('crate-type = ["cdylib"]');
    expect(cargo).toContain('name = "my_notes"');
    const example = read("examples/plugin-hello-connector/Cargo.toml");
    const version = /^wit-bindgen = "([^"]+)"$/m.exec(example)?.[1];
    expect(version).toBeDefined();
    expect(cargo).toContain(`wit-bindgen = "${version}"`);
  });
});
