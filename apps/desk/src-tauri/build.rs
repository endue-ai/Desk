fn main() {
    // Declaring the app's commands makes Tauri generate one permission per command, so the
    // capability can allow exactly these two and nothing else.
    let manifest = tauri_build::AppManifest::new().commands(&["bridge_call", "desk_ready"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri build script");
}
