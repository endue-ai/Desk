//! The endue Desk shell on CEF: the browser process, and on Linux and Windows every CEF subprocess.

use std::process::ExitCode;

use cef::{CefString, ImplCommandLine};
use desk_boot::BootInput;
use desk_shell::host::{self, Desk, EventTarget};
use desk_shell::{app::ShellApp, paths, pump::Pump, window::Shell};
use winit::event_loop::EventLoop;

fn main() -> ExitCode {
    // Process start for the start-up trace (DESK_TRACE=1): its clock reads 0 here.
    let origin = desk_trace::Origin::now();
    #[cfg(target_os = "macos")]
    let _framework = {
        let exe = std::env::current_exe().unwrap_or_default();
        let loader = cef::library_loader::LibraryLoader::new(&exe, false);
        if !loader.load() {
            eprintln!(
                "endue Desk: the CEF framework did not load (run the bundle: just dev-shell)"
            );
            return ExitCode::FAILURE;
        }
        loader
    };
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
    let args = cef::args::Args::new();
    let is_browser = args
        .as_cmd_line()
        .is_some_and(|cmd| cmd.has_switch(Some(&CefString::from("type"))) != 1);
    if !is_browser {
        let mut app = ShellApp::subprocess();
        let code = cef::execute_process(
            Some(args.as_main_args()),
            Some(&mut app),
            std::ptr::null_mut(),
        );
        return ExitCode::from(code.clamp(0, 255) as u8);
    }

    let event_loop = match EventLoop::with_user_event().build() {
        Ok(event_loop) => event_loop,
        Err(why) => {
            eprintln!("endue Desk: no event loop ({why})");
            return ExitCode::FAILURE;
        }
    };
    #[cfg(target_os = "macos")]
    if let Some(mtm) = objc2_foundation::MainThreadMarker::new() {
        desk_shell::mac::adopt_cef_protocols(mtm);
    }
    let pump = Pump::new(Some(event_loop.create_proxy()));
    let mut app = ShellApp::browser(pump.clone(), paths::dist());
    let _ = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    let root = paths::cef_root();
    let _ = std::fs::create_dir_all(&root);
    let settings = cef::Settings {
        external_message_pump: 1,
        // The sandbox needs the bundle's helpers signed for it; it comes with packaging (#46).
        no_sandbox: 1,
        root_cache_path: root.to_string_lossy().as_ref().into(),
        log_severity: cef::LogSeverity::WARNING,
        ..Default::default()
    };
    if cef::initialize(
        Some(args.as_main_args()),
        Some(&settings),
        Some(&mut app),
        std::ptr::null_mut(),
    ) != 1
    {
        eprintln!(
            "endue Desk: CEF did not start (another desk may hold {})",
            root.display()
        );
        return ExitCode::FAILURE;
    }
    let desk = boot(origin);
    let (desk, events) = desk;
    let target = EventTarget::default();
    host::forward_events(events, target.clone());
    let mut shell = Shell::new(pump, desk, target, paths::start_url());
    let outcome = event_loop.run_app(&mut shell);
    drop(shell);
    cef::shutdown();
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("endue Desk: the event loop failed ({why})");
            ExitCode::FAILURE
        }
    }
}

/// Start the desk through desk-boot, as the Tauri shell's `setup` does.
fn boot(
    origin: desk_trace::Origin,
) -> (
    std::sync::Arc<Desk>,
    std::sync::mpsc::Receiver<desk_core::Delivery>,
) {
    let data = paths::data_dir();
    let _ = std::fs::create_dir_all(&data);
    let computer = data.join("computer");
    let booted = desk_boot::boot(BootInput {
        data,
        home: paths::home_dir(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        origin,
        // The CEF build's own updater comes with #47.
        updater: None,
        // Computer use (ADR 0120): the core serves computer.* through the OS driver; the overlay
        // window the Tauri shell shows comes with #45.
        attach: Some(Box::new(move |core: &std::sync::Arc<desk_core::Core>| {
            core.serve_computer(desk_computer::os(), Some(computer));
        })),
        plugin_dirs: desk_boot::boot::env_paths("DESK_PLUGIN_DIRS"),
        dev_plugins: desk_boot::boot::env_paths("DESK_DEV_PLUGINS"),
    });
    let opened = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-') && std::path::Path::new(arg).is_file())
        .collect();
    Desk::new(booted, opened)
}
