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

    // Declaring the app's commands makes Tauri generate one permission per command, so each
    // capability can allow exactly the ones its window needs and nothing else.
    println!("cargo:rerun-if-changed=../../../plugins/palette/ui");
    let manifest = tauri_build::AppManifest::new().commands(&[
        "bridge_call",
        "desk_ready",
        "desk_start",
        "desk_relaunch",
        "desk_trace",
        "take_open_files",
        "desk_crash",
        "take_last_crash",
        "palette_hide",
        "palette_reveal_main",
        "palette_prepare_main",
        "palette_present",
    ]);
    // The floating Eris window's own commands, as the inline plugin `eris-window` (ADR 0121).
    let eris = tauri_build::InlinedPlugin::new().commands(&[
        "state",
        "dismiss",
        "expand",
        "drag",
        "reveal_main",
    ]);
    let attributes = tauri_build::Attributes::new()
        .app_manifest(manifest)
        .plugin("eris-window", eris);
    tauri_build::try_build(attributes).expect("tauri build script");
}
