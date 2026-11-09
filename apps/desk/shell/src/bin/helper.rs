//! The macOS helper executable: every CEF subprocess (renderer, GPU, utility) of the shell.

fn main() {
    let args = cef::args::Args::new();
    #[cfg(target_os = "macos")]
    let _framework = {
        let exe = std::env::current_exe().unwrap_or_default();
        let loader = cef::library_loader::LibraryLoader::new(&exe, true);
        if !loader.load() {
            std::process::exit(1);
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
    std::process::exit(code.max(0));
}
