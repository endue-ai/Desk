//! The renderer side of an off-screen plugin surface (#52): before its page's scripts run, the page's
//! `window.parent` becomes the desk (`shim.js`), so `@endue-ai/plugin-sdk` talks to the runtime
//! unchanged. Only the top frame of a browser at a plugin surface's host gets it, which only an
//! off-screen surface's page is (plugin frames in the shell page are never the top).

use cef::*;

use super::relay::surface_host;

const SHIM: &str = include_str!("shim.js");

/// Whether the script context of `frame`, now at `url`, is an off-screen plugin surface's page.
pub fn wanted(main: bool, url: &str) -> bool {
    main && surface_host(url).is_some()
}

/// Run the shim in `context`, which `__deskNative` is in already.
pub fn install(context: &V8Context) {
    let mut result = None;
    let mut exception = None;
    let ok = context.eval(
        Some(&SHIM.into()),
        Some(&"desk-shell://surface-shim.js".into()),
        1,
        Some(&mut result),
        Some(&mut exception),
    );
    if ok != 1 {
        let why = exception
            .map(|e| CefString::from(&e.message()).to_string())
            .unwrap_or_default();
        eprintln!("endue Desk: the surface shim did not run ({why})");
    }
}

#[cfg(test)]
mod tests {
    use super::wanted;

    #[test]
    fn only_the_top_of_a_browser_at_a_surface_host_gets_the_shim() {
        let page = "desk-plugin://main.endue-notes/endue.notes/ui/index.html?v=1";
        assert!(wanted(true, page));
        assert!(!wanted(false, page), "a plugin frame in the shell page");
        assert!(!wanted(true, "desk-app://app/index.html"));
        assert!(!wanted(
            true,
            "desk-plugin://localhost/_desk/palette/index.html"
        ));
    }
}
