//! With `--features cef` on Linux, let the binary find `libcef.so` next to itself: cef-dll-sys copies
//! CEF's runtime files into the target directory but gives the binary no run path.

fn main() {
    let cef = std::env::var_os("CARGO_FEATURE_CEF").is_some();
    let typecheck = std::env::var_os("CARGO_FEATURE_TYPECHECK_ONLY").is_some();
    let linux = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "linux");
    if cef && linux && !typecheck {
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,$ORIGIN");
    }
}
