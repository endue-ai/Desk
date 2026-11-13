//! The endue Desk shell on CEF: the browser process, and on Linux and Windows every CEF subprocess.

use std::process::ExitCode;

use cef::{CefString, ImplCommandLine};
use desk_boot::BootInput;
use desk_shell::host::{self, Desk};
use desk_shell::instance::{self, Claim, Handoff, Instance};
use desk_shell::{app::ShellApp, computer, open_files, paths, pump::Pump, window::Shell};
use desk_shell::{release, update};
use winit::event_loop::EventLoop;

fn main() -> ExitCode {
    // Process start for the start-up trace (DESK_TRACE=1): its clock reads 0 when the OS started
    // this process, so what comes before `main` counts too (#112).
    let origin = desk_shell::process_start::origin();
    #[cfg(target_os = "macos")]
    let _framework = {
        let exe = std::env::current_exe().unwrap_or_default();
        let loader = cef::library_loader::LibraryLoader::new(&exe, false);
        if !loader.load() {
            eprintln!("endue Desk: the CEF framework did not load (run the bundle: just dev)");
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
    // The surface probe (#52): the web host and the compositor's import without a desk or a window.
    if let Some(scenario) = desk_shell::probe::requested() {
        return desk_shell::probe::run(&args, &scenario);
    }

    let mut builder = EventLoop::with_user_event();
    // The shell sets its own menu bar (`menu.rs`), with Edit and its own Quit.
    #[cfg(target_os = "macos")]
    winit::platform::macos::EventLoopBuilderExtMacOS::with_default_menu(&mut builder, false);
    let event_loop = match builder.build() {
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
    // One desk per data folder: a second start hands its files to this one and quits, before CEF,
    // whose profile only one process can hold.
    let instance = match claim(&pump) {
        Ok(Some(instance)) => Some(instance),
        Ok(None) => return ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("endue Desk: {why}; starting anyway");
            None
        }
    };
    desk_shell::run_event::listen(&pump);
    let mut app = ShellApp::browser(pump.clone(), paths::dist());
    let _ = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    let root = paths::cef_root();
    let _ = std::fs::create_dir_all(&root);
    let settings = cef::Settings {
        // The desk's main window renders every page off screen (#52, #83).
        windowless_rendering_enabled: 1,
        external_message_pump: 1,
        // Chromium's sandbox: on for every subprocess on macOS, off on Linux and Windows until
        // #61 proves them there (`sandbox.rs`, ADR 0148).
        no_sandbox: desk_shell::sandbox::no_sandbox(),
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
    let (desk, events, watch) = boot(origin, pump, instance);
    desk_shell::plugin_scheme::register(std::sync::Arc::clone(&desk.core));
    host::forward_events(events, desk.pages.clone());
    // The desk's own updates (ADR 0054): checks by the schedule, `update.changed`, the tray's item.
    desk.core.start_updates();
    if let Some(updater) = &desk.updater {
        update::follow(updater, &desk.pump);
    }
    let kept = std::sync::Arc::clone(&desk);
    let mut shell = Shell::new(desk, paths::start_url(), watch);
    let outcome = event_loop.run_app(&mut shell);
    let restart = shell.restarts_for_stall();
    drop(shell);
    cef::shutdown();
    // Every quit the desk agrees to ends here (ADR 0187): the next start then has nothing to say.
    if outcome.is_ok() {
        kept.start.quit();
    }
    // An applied update quit the desk: start the new one once this one has let go.
    let updated = update::relaunch_if_asked(&paths::data_dir(), || kept.let_go());
    // The desk's own page stopped painting and nothing was unsaved: start a new desk (ADR 0202).
    if restart && !updated && outcome.is_ok() {
        desk_shell::stall_restart::relaunch(|| kept.let_go());
    }
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("endue Desk: the event loop failed ({why})");
            ExitCode::FAILURE
        }
    }
}

/// Be the desk for the data folder, or hand this start's arguments to the one that is (`None`).
fn claim(pump: &Pump) -> std::io::Result<Option<Instance>> {
    let pump = pump.clone();
    let claimed = instance::claim(
        &paths::data_dir(),
        &Handoff::this_process(),
        move |handed| {
            pump.run(move |shell, _| shell.handed(handed.args));
        },
    )?;
    match claimed {
        Claim::First(instance) => Ok(Some(instance)),
        Claim::HandedOff => {
            eprintln!("endue Desk: the desk already running took this start's files");
            Ok(None)
        }
    }
}

/// Start the desk through desk-boot, as the Tauri shell's `setup` did.
fn boot(
    origin: desk_trace::Origin,
    pump: Pump,
    instance: Option<Instance>,
) -> (
    std::sync::Arc<Desk>,
    std::sync::mpsc::Receiver<desk_core::Delivery>,
    std::sync::Arc<std::sync::Mutex<computer::Watch>>,
) {
    let data = paths::data_dir();
    let _ = std::fs::create_dir_all(&data);
    let watch = std::sync::Arc::new(std::sync::Mutex::new(None));
    let (attached, computer_data, computer_pump) =
        (std::sync::Arc::clone(&watch), data.clone(), pump.clone());
    // The desk's own updates (ADR 0054), when this build carries an updater key.
    let updater = update::updater(&data, &pump);
    let booted = desk_boot::boot(BootInput {
        data,
        home: paths::home_dir(),
        version: release::version().to_owned(),
        origin,
        updater: updater.clone(),
        // Computer use (ADR 0120, ADR 0123): the OS driver, and the banner while agents act.
        attach: Some(Box::new(move |core: &std::sync::Arc<desk_core::Core>| {
            let watching = computer::attach(core, &computer_pump, &computer_data);
            *attached.lock().unwrap_or_else(|e| e.into_inner()) = Some(watching);
        })),
        // The repository's plugins/ in development (DESK_PLUGIN_DIRS), else the package's copy.
        plugin_dirs: paths::plugin_dirs(),
        dev_plugins: desk_boot::boot::env_paths("DESK_DEV_PLUGINS"),
    });
    let opened = open_files::argument_paths(std::env::args());
    let (desk, events) = Desk::new(booted, opened, pump, instance, updater);
    let watching = watch
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .unwrap_or_default();
    (desk, events, watching)
}
