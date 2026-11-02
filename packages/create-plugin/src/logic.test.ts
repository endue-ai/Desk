import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { renderPlugin } from "./template";

const root = join(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const render = () => renderPlugin({ id: "example.my-logic", name: "My logic", kind: "logic" });

describe("renderPlugin with kind logic", () => {
  it("writes a logic manifest whose entry is the component cargo builds", () => {
    const manifest = JSON.parse(render()["plugin.json"] ?? "null") as PluginManifest;
    expect(manifest).toMatchObject({
      id: "example.my-logic",
      kind: "logic",
      entry: "build/wasm32-wasip2/release/my_logic.wasm",
    });
    expect(manifest.permissions ?? []).toEqual([]);
  });

  it("lays out a Rust component folder with one test", () => {
    expect(Object.keys(render()).sort()).toEqual([
      ".cargo/config.toml",
      ".gitignore",
      "Cargo.toml",
      "README.md",
      "plugin.json",
      "src/lib.rs",
      "tests/greet.test.json",
      "wit/desk-host.wit",
    ]);
  });

  it("binds the desk:host world plugin from specs/wit, byte for byte", () => {
    const files = render();
    expect(files["wit/desk-host.wit"]).toBe(read("specs/wit/desk-host.wit"));
    const lib = files["src/lib.rs"] ?? "";
    const generate = /generate!\(\{([^}]*)\}\)/s.exec(lib)?.[1] ?? "";
    expect(generate).toContain('path: "wit"');
    expect(generate).toContain('world: "plugin"');
    for (const name of ["start", "on_command", "on_event"]) {
      expect(lib).toMatch(new RegExp(`\\bfn ${name}\\(`));
    }
    const cargo = files["Cargo.toml"] ?? "";
    expect(cargo).toContain('crate-type = ["cdylib"]');
    expect(cargo).toContain('name = "my_logic"');
    const example = read("examples/plugin-hello-wasm/Cargo.toml");
    const version = /^wit-bindgen = "([^"]+)"$/m.exec(example)?.[1];
    expect(version).toBeDefined();
    expect(cargo).toContain(`wit-bindgen = "${version}"`);
  });

  it("tests the command it registers, on a scripted answer", () => {
    const files = render();
    expect(files["src/lib.rs"]).toContain('const GREET: &str = "example.my-logic.greet";');
    const test = JSON.parse(files["tests/greet.test.json"] ?? "null");
    expect(test.steps).toEqual([
      "start",
      { command: { id: "example.my-logic.greet", args: { name: "Ada" } } },
    ]);
    expect(test.answers).toEqual([
      { method: "settings.get", params: { key: "greeting" }, result: "Hi" },
    ]);
    expect(test.expect.calls).toEqual([
      { method: "cmd.register", params: { id: "example.my-logic.greet" } },
      { method: "cmd.answer", params: { result: "Hi, Ada!" } },
    ]);
  });

  it("writes the name into Rust strings safely", () => {
    const files = renderPlugin({ id: "example.quotes", name: 'Say "hi" \\ bye', kind: "logic" });
    expect(files["src/lib.rs"]).toContain('"Say \\"hi\\" \\\\ bye: say hello"');
  });
});
