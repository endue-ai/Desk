//! The macOS helper executable: every CEF subprocess (renderer, GPU, utility) starts here.

fn main() {
    let args = cef::args::Args::new();
    #[cfg(target_os = "macos")]
    let _loader = {
        let loader =
            cef::library_loader::LibraryLoader::new(&std::env::current_exe().unwrap(), true);
        assert!(loader.load(), "the CEF framework loads");
        loader
    };
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
    cef::execute_process(
        Some(args.as_main_args()),
        None::<&mut cef::App>,
        std::ptr::null_mut(),
    );
}
