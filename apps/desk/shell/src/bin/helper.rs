//! The macOS helper executable: every CEF subprocess (renderer, GPU, utility) of the shell. It
//! enters Chromium's sandbox before anything else, the CEF framework included (`sandbox.rs`).

use std::process::ExitCode;

fn main() -> ExitCode {
    let args = cef::args::Args::new();
    // Dropped last, after the framework: CEF destroys the sandbox context just before the end.
    #[cfg(target_os = "macos")]
    let _sandbox = match desk_shell::sandbox::enter(&args) {
        Ok(sandbox) => sandbox,
        Err(why) => {
            eprintln!("endue Desk helper: Chromium's sandbox did not start: {why}");
            return ExitCode::FAILURE;
        }
    };
    #[cfg(target_os = "macos")]
    let _framework = {
        let exe = std::env::current_exe().unwrap_or_default();
        let loader = cef::library_loader::LibraryLoader::new(&exe, true);
        if !loader.load() {
            return ExitCode::FAILURE;
        }
        loader
    };
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
    let mut app = desk_shell::app::ShellApp::subprocess();
    let code = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    ExitCode::from(code.clamp(0, 255) as u8)
}
