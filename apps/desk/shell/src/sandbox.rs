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
//!
//! A release build drops `--no-sandbox` and the other switches that weaken isolation (`WEAKENING`)
//! from its own command line before Chromium reads it, so no launcher, shortcut or pasted command
//! turns them off (#104); a development build keeps them for debugging.

/// CEF's `no_sandbox`: 0 where the sandbox is on (macOS), 1 where it waits for #61.
pub const fn no_sandbox() -> i32 {
    if cfg!(target_os = "macos") { 0 } else { 1 }
}

/// Switches that weaken the desk's isolation as they would Chrome's (#104): the sandbox off for
/// every subprocess or the GPU process, the web's origin checks or site isolation off, every page
/// in one process, the GPU in the browser process, or DevTools open to anything on the machine
/// (the shell opens DevTools only through `DESK_REMOTE_DEBUGGING_PORT`, in a development build).
pub const WEAKENING: [&str; 8] = [
    "no-sandbox",
    "disable-web-security",
    "remote-debugging-port",
    "remote-debugging-pipe",
    "single-process",
    "disable-site-isolation-trials",
    "disable-gpu-sandbox",
    "in-process-gpu",
];

/// Whether this is a release build, whose own command line cannot weaken its isolation.
pub const RELEASE: bool = !cfg!(debug_assertions);

/// The switches of a desk's own command line (`switches`, by name as Chromium parsed them) that it
/// drops before Chromium reads them (#104, ADR 0148). A release build drops every weakening one,
/// `no-sandbox` only where the sandbox is on (`sandboxed`): where it waits for #61, CEF put it there
/// itself from `no_sandbox`. A development build keeps them all, for debugging.
pub fn ignored(switches: &[String], release: bool, sandboxed: bool) -> Vec<&str> {
    if !release {
        return Vec::new();
    }
    switches
        .iter()
        .map(String::as_str)
        .filter(|name| WEAKENING.contains(name) && (sandboxed || *name != "no-sandbox"))
        .collect()
}

/// Drop from the browser process's command line, before Chromium reads it, the switches `ignored`
/// names, each with a line on stderr. CEF has already added what its settings ask for.
pub fn drop_weakening(command_line: &mut cef::CommandLine) {
    use cef::ImplCommandLine;
    let mut map = cef::CefStringMap::new();
    command_line.switches(Some(&mut map));
    let given: Vec<String> = map.into_iter().map(|(name, _)| name).collect();
    for name in ignored(&given, RELEASE, no_sandbox() == 0) {
        command_line.remove_switch(Some(&name.into()));
        eprintln!("endue Desk: a release build ignores --{name} (ADR 0148)");
    }
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
    use super::{WEAKENING, ignored, library_path, no_sandbox};
    use std::path::Path;

    /// A desk's own command line as Chromium parsed it: its switches by name.
    fn switches(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    /// What the shell itself puts on the browser's command line (`app.rs`), and what CEF adds.
    const THE_SHELLS: [&str; 8] = [
        "no-startup-window",
        "noerrdialogs",
        "hide-crash-restore-bubble",
        "use-mock-keychain",
        "site-per-process",
        "renderer-process-limit",
        "enable-features",
        "lang",
    ];

    #[test]
    fn the_sandbox_is_on_on_macos_and_waits_elsewhere() {
        assert_eq!(no_sandbox(), if cfg!(target_os = "macos") { 0 } else { 1 });
    }

    #[test]
    fn a_release_build_ignores_every_switch_that_weakens_isolation() {
        let given = switches(&[
            "no-startup-window",
            "no-sandbox",
            "disable-web-security",
            "remote-debugging-port",
            "remote-debugging-pipe",
            "single-process",
            "disable-site-isolation-trials",
            "disable-gpu-sandbox",
            "in-process-gpu",
            "site-per-process",
        ]);
        assert_eq!(
            ignored(&given, true, true),
            [
                "no-sandbox",
                "disable-web-security",
                "remote-debugging-port",
                "remote-debugging-pipe",
                "single-process",
                "disable-site-isolation-trials",
                "disable-gpu-sandbox",
                "in-process-gpu",
            ]
        );
        let all = switches(&WEAKENING);
        assert_eq!(ignored(&all, true, true), WEAKENING);
    }

    #[test]
    fn a_development_build_keeps_them_for_debugging() {
        let all = switches(&WEAKENING);
        assert!(ignored(&all, false, true).is_empty());
        assert!(ignored(&all, false, false).is_empty());
    }

    #[test]
    fn no_sandbox_stays_where_the_sandbox_waits_since_cef_set_it_there() {
        let given = switches(&["no-sandbox", "disable-gpu-sandbox", "remote-debugging-port"]);
        assert_eq!(
            ignored(&given, true, false),
            ["disable-gpu-sandbox", "remote-debugging-port"]
        );
    }

    #[test]
    fn the_shells_own_switches_and_anything_else_pass() {
        let given = switches(&THE_SHELLS);
        assert!(ignored(&given, true, true).is_empty());
        // A switch is matched by its whole name, as Chromium parsed it.
        let near = switches(&["no-sandbox-x", "remote-debugging-portal", "sandbox", "type"]);
        assert!(ignored(&near, true, true).is_empty());
        assert!(ignored(&[], true, true).is_empty());
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
