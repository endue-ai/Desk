use std::path::Path;

fn main() {
    // The plugin SDK is embedded in the binary and served to plugin frames.
    let sdk = "../../../packages/plugin-sdk/dist/plugin-sdk.js";
    println!("cargo:rerun-if-changed={sdk}");
    assert!(
        Path::new(sdk).is_file(),
        "{sdk} is missing: run `pnpm --filter @endue-ai/plugin-sdk build` first \
         (just dev, just check-app and just build-app do this)"
    );

    // Declaring the app's commands makes Tauri generate one permission per command, so the
    // capability can allow exactly these and nothing else.
    let manifest =
        tauri_build::AppManifest::new().commands(&["bridge_call", "desk_boot", "desk_ready"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri build script");
}
