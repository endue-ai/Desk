// What the two Rust templates share: a Wasm component crate that `cargo build --release` builds
// for wasm32-wasip2 (rustc links the component itself; ADR 0019), as examples/plugin-hello-wasm
// and examples/plugin-hello-connector do.

import { FENCE } from "./readme";
import type { PluginOptions } from "./template";

/** The wit-bindgen version the examples build with. */
export const WIT_BINDGEN = "0.63";

/** The crate's names: the id's last segment is the package; the library, and so the component, has `_`. */
export interface Crate {
  pkg: string;
  lib: string;
  /** Where the component lands, which plugin.json's `entry` names. */
  entry: string;
}

export function crateOf(id: string): Crate {
  const pkg = id.slice(id.lastIndexOf(".") + 1);
  const lib = pkg.replaceAll("-", "_");
  return { pkg, lib, entry: `build/wasm32-wasip2/release/${lib}.wasm` };
}

/** Cargo.toml with wit-bindgen and these more dependency lines. */
export function cargoToml(
  { name, description }: PluginOptions,
  { pkg, lib }: Crate,
  more: string[] = [],
): string {
  const dependencies = [...more, `wit-bindgen = "${WIT_BINDGEN}"`].join("\n");
  return `[package]
name = "${pkg}"
description = ${JSON.stringify(description ?? name)}
version = "0.1.0"
edition = "2024"
publish = false

[lib]
name = "${lib}"
crate-type = ["cdylib"]

[dependencies]
${dependencies}

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
panic = "abort"
strip = true

# Its own workspace, so it builds alone wherever the folder lives.
[workspace]
`;
}

export const CARGO_CONFIG = `# The README's build command (\`cargo build --release\`) in this folder builds the component
# plugin.json's entry names.
[build]
target = "wasm32-wasip2"
target-dir = "build"
`;

export function gitignore(lib: string): string {
  return `# Everything cargo builds except the component the entry names, so the folder installs as it is.
/build/*
!/build/wasm32-wasip2/
/build/wasm32-wasip2/*
!/build/wasm32-wasip2/release/
/build/wasm32-wasip2/release/*
!/build/wasm32-wasip2/release/${lib}.wasm
`;
}

/** The README's "Build it" section. */
export function buildSection(entry: string): string[] {
  return [
    "## Build it",
    "",
    "Once, add the Wasm target; then build in this folder:",
    "",
    `${FENCE}bash`,
    "rustup target add wasm32-wasip2",
    "cargo build --release",
    FENCE,
    "",
    `The component lands in \`${entry}\`, where \`plugin.json\` points.`,
    "",
  ];
}

/** `text` as a Rust string literal. */
export function rustString(text: string): string {
  const escaped = [...text]
    .map((c) => {
      if (c === "\\" || c === '"') return `\\${c}`;
      const code = c.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? `\\u{${code.toString(16)}}` : c;
    })
    .join("");
  return `"${escaped}"`;
}

/** The name on one line, for a doc comment. */
export function oneLine(name: string): string {
  return name.replaceAll(/\s+/g, " ");
}
