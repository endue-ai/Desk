//! Setup must own the macOS socket even when the async executor has not polled its tasks yet.
#![cfg(target_os = "macos")]

use std::{io::Write, net::Shutdown, os::unix::net::UnixStream, time::Duration};
use tauri::test::{mock_builder, mock_context, noop_assets};

#[test]
fn setup_binds_before_the_async_listener_runs() {
    // This separate test binary owns Tauri's global runtime. No spawned task can run until
    // block_on below, deterministically reproducing a busy executor during app startup.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    tauri::async_runtime::set(runtime.handle().clone());
    let identifier = format!("com.tauri.ReadyTest.p{}", std::process::id());
    let mut context = mock_context(noop_assets());
    context.config_mut().identifier = identifier.clone();
    context.package_info_mut().version = "1.0.0".parse().unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let app = mock_builder()
        .plugin(tauri_plugin_single_instance::init(move |_, args, cwd| {
            tx.send((args, cwd)).unwrap();
        }))
        .build(context)
        .unwrap();
    let suffix = if cfg!(feature = "semver") {
        "_1_x_x"
    } else {
        ""
    };
    let socket = format!("/tmp/{}{suffix}_si.sock", identifier.replace('.', "_"));
    let mut secondary = UnixStream::connect(&socket)
        .expect("setup returned before the primary bound its single-instance socket");
    secondary.write_all(b"/tmp\0\0test-app\0argument").unwrap();
    secondary.shutdown(Shutdown::Write).unwrap();
    let received = runtime
        .block_on(async { tokio::time::timeout(Duration::from_secs(5), rx.recv()).await })
        .expect("the listener did not forward the queued connection")
        .unwrap();
    assert_eq!(
        received,
        (vec!["test-app".into(), "argument".into()], "/tmp".into())
    );
    tauri_plugin_single_instance::destroy(&app);
    assert!(!std::path::Path::new(&socket).exists());
    app.cleanup_before_exit();
}
