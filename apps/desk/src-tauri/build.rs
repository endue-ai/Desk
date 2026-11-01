use std::path::Path;

fn main() {
    // The plugin SDK and the @endue-ai/ui bundle are embedded in the binary and served to plugin
    // frames.
    for (bundle, package, recipe) in [
        (
            "../../../packages/plugin-sdk/dist/plugin-sdk.js",
            "@endue-ai/plugin-sdk",
            "build-sdk",
        ),
        (
            "../../../packages/ui/dist/ui.js",
            "@endue-ai/ui",
            "build-ui",
        ),
    ] {
        println!("cargo:rerun-if-changed={bundle}");
        assert!(
            Path::new(bundle).is_file(),
            "{bundle} is missing: run `just {recipe}` (`pnpm --filter {package} build`) first \
             (just dev, just check-app and just build-app do this)"
        );
    }

    // Declaring the app's commands makes Tauri generate one permission per command, so the
    // capability can allow exactly these three and nothing else.
    let manifest =
        tauri_build::AppManifest::new().commands(&["bridge_call", "desk_ready", "take_open_files"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri build script");
}
