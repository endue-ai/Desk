//! Chromium's sandbox for the desk's CEF subprocesses (ADR 0148). On macOS every renderer, the GPU
//! process and the sandboxed utilities enter it: the browser process starts them with
//! `--seatbelt-client` (CEF's `no_sandbox` is 0), and each helper calls CEF's
//! `cef_sandbox_initialize` from `libcef_sandbox.dylib` before it loads the framework, as CEF's own
//! helpers do (`cef_sandbox_mac.h`). A helper that cannot enter it exits instead of running bare.
//!
//! Linux and Windows still run without it, behind `no_sandbox()`, until a machine can prove them
//! (#61). Linux: the zygote's namespace sandbox needs unprivileged user namespaces, which Ubuntu
//! 23.10 and later grant only through an AppArmor profile, or the set-uid `chrome-sandbox` CEF ships,
//! which neither a cargo-packager `.deb` nor an AppImage can carry; the `.deb` installs an AppArmor
//! profile for `/usr/lib/endue-desk-cef/endue-desk-cef`, the AppImage relies on user namespaces, and
//! a desk that finds neither refuses to start rather than fall back (`docs/releasing.md`).
//! Windows: CEF 156 sandboxes only an app built as a client DLL that its `bootstrap.exe` loads
//! (`CEF_USE_BOOTSTRAP`), so the desk becomes `endue-desk-cef.dll` beside the bootstrap renamed
//! `endue-desk-cef.exe`, which loads the DLL of its own name.

/// CEF's `no_sandbox`: 0 where the sandbox is on (macOS), 1 where it waits for #61.
pub const fn no_sandbox() -> i32 {
    if cfg!(target_os = "macos") { 0 } else { 1 }
}

/// Where CEF's sandbox library sits from a helper executable
/// (`<app>/Contents/Frameworks/<helper>.app/Contents/MacOS/<helper>`): the framework's
/// `Libraries`, which is where `cef::sandbox` opens it.
pub fn library_path(helper: &std::path::Path) -> Option<std::path::PathBuf> {
    let frameworks = helper.parent()?.parent()?.parent()?.parent()?;
    Some(frameworks.join("Chromium Embedded Framework.framework/Libraries/libcef_sandbox.dylib"))
}

/// The sandbox this helper runs in; kept until the process ends, then destroyed.
#[cfg(target_os = "macos")]
pub struct Entered(#[allow(dead_code)] cef::sandbox::Sandbox);

/// Enter Chromium's sandbox for this helper process, before the CEF framework loads. A process
/// type the browser started unsandboxed (`--no-sandbox` given, or a utility of type `none`) enters
/// nothing and still succeeds; a missing library or a policy the browser did not send fails.
#[cfg(target_os = "macos")]
pub fn enter(args: &cef::args::Args) -> Result<Entered, String> {
    let exe = std::env::current_exe().map_err(|why| format!("no executable path ({why})"))?;
    let library = library_path(&exe).ok_or("the helper is not inside an app bundle")?;
    if !library.is_file() {
        return Err(format!("{} is missing", library.display()));
    }
    // cef::sandbox panics where CEF's C++ returns false: a library that does not load, or
    // cef_sandbox_initialize answering null. Either way this process must not run.
    let main_args = args.as_main_args();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut sandbox = cef::sandbox::Sandbox::new();
        sandbox.initialize(main_args);
        Entered(sandbox)
    }))
    .map_err(|_| format!("cef_sandbox_initialize failed ({})", library.display()))
}

#[cfg(test)]
mod tests {
    use super::{library_path, no_sandbox};
    use std::path::Path;

    #[test]
    fn the_sandbox_is_on_on_macos_and_waits_elsewhere() {
        assert_eq!(no_sandbox(), if cfg!(target_os = "macos") { 0 } else { 1 });
    }

    #[test]
    fn the_library_is_in_the_frameworks_folder_beside_the_helper_apps() {
        let helper = Path::new(
            "/A/endue Desk.app/Contents/Frameworks/endue-desk-cef Helper (Renderer).app/Contents/MacOS/endue-desk-cef Helper (Renderer)",
        );
        assert_eq!(
            library_path(helper).unwrap(),
            Path::new(
                "/A/endue Desk.app/Contents/Frameworks/Chromium Embedded Framework.framework/Libraries/libcef_sandbox.dylib"
            )
        );
        assert_eq!(library_path(Path::new("/helper")), None);
    }
}
