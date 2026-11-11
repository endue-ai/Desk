//! What the `desk-plugin` scheme answers differently for plugin surfaces (#52, ADR 0160):
//!
//! - A plugin surface's document at the top of a browser (only a surface's own is) gets the sandbox
//!   its frame had (`sandbox allow-scripts`, ADR 0040) from its CSP: an opaque origin, no popups, no
//!   forms, no modals, no navigating anything but itself.
//! - The runtime's page (the desk's system surface) frames no plugin: every plugin surface renders
//!   in a browser of its own, and the runtime reaches it through the relay. A plugin document asked
//!   for as a frame of that page is refused, so no plugin ever runs in the system surface's process.

use std::sync::atomic::{AtomicI32, Ordering};

use desk_web::Reply;

/// The runtime page's browser; -1 for none.
static SHELL_PAGE: AtomicI32 = AtomicI32::new(-1);

/// The sandbox a plugin frame had, for a plugin document at the top of its own browser.
pub const SANDBOX: &str = "sandbox allow-scripts";

/// The runtime's page is browser `id`, or there is none (`None`).
pub fn set_shell_page(id: Option<i32>) {
    SHELL_PAGE.store(id.unwrap_or(-1), Ordering::Release);
}

/// Whether browser `id` is the runtime's page.
pub fn is_shell_page(id: i32) -> bool {
    SHELL_PAGE.load(Ordering::Acquire) == id
}

/// Whether a document request of `browser` for a frame (`main` or not) at a plugin surface's host
/// is a frame of the runtime's page, which may not have one.
pub fn framed_in_page(browser: i32, main: bool, sub_frame: bool, surface_host: bool) -> bool {
    let page = SHELL_PAGE.load(Ordering::Acquire);
    page >= 0 && browser == page && !main && sub_frame && surface_host
}

/// What the runtime's page gets for a plugin frame: nothing.
pub fn refused() -> Reply {
    Reply::status(403)
}

/// Sandbox an HTML `reply` for the top of a browser: its CSP gains `sandbox allow-scripts` (one CSP
/// header, since the shell sets headers by name).
pub fn sandbox_top(reply: &mut Reply) {
    if !reply.mime.starts_with("text/html") {
        return;
    }
    let csp = reply
        .headers
        .iter_mut()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-security-policy"));
    match csp {
        Some((_, value)) => {
            value.push_str("; ");
            value.push_str(SANDBOX);
        }
        None => reply
            .headers
            .push(("Content-Security-Policy".to_owned(), SANDBOX.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::{SANDBOX, framed_in_page, refused, sandbox_top, set_shell_page};
    use desk_web::Reply;

    #[test]
    fn the_runtimes_page_frames_no_plugin() {
        set_shell_page(None);
        assert!(!framed_in_page(4, false, true, true), "no page yet");
        set_shell_page(Some(4));
        assert!(framed_in_page(4, false, true, true));
        assert!(!framed_in_page(5, false, true, true), "another browser");
        assert!(!framed_in_page(4, true, false, true), "the page itself");
        assert!(
            !framed_in_page(4, false, false, true),
            "a fetch from the page"
        );
        assert!(!framed_in_page(4, false, true, false), "the shared host");
        set_shell_page(None);
        let refused = refused();
        assert_eq!(refused.status, 403);
        assert!(refused.body.is_empty());
    }

    #[test]
    fn a_top_level_surface_document_keeps_its_csp_and_gains_the_frames_sandbox() {
        let mut html = Reply {
            status: 200,
            mime: "text/html; charset=utf-8".into(),
            headers: vec![(
                "content-security-policy".into(),
                "default-src 'none'".into(),
            )],
            body: Vec::new(),
        };
        sandbox_top(&mut html);
        assert_eq!(html.headers[0].1, format!("default-src 'none'; {SANDBOX}"));
        let mut script = Reply {
            mime: "text/javascript".into(),
            ..Reply::status(200)
        };
        sandbox_top(&mut script);
        assert!(script.headers.is_empty(), "only documents");
    }
}
