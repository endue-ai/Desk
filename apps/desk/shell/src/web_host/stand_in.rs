//! What the `desk-plugin` scheme answers differently for off-screen surfaces (#52):
//!
//! - In compositor mode, a plugin surface's frame inside the shell page loads a stand-in
//!   (`stand_in.html`) instead of the plugin, which renders in a browser of its own; the stand-in
//!   relays the runtime's messages (`relay.rs`).
//! - A plugin surface's document at the top of a browser (only an off-screen surface's is) gets the
//!   sandbox its frame had (`sandbox allow-scripts`, ADR 0040) from its CSP: an opaque origin, no
//!   popups, no forms, no modals, no navigating anything but itself.

use std::sync::atomic::{AtomicI32, Ordering};

use desk_web::Reply;

/// The shell page's browser in compositor mode, whose plugin frames are stand-ins; -1 for none.
static SHELL_PAGE: AtomicI32 = AtomicI32::new(-1);

/// The sandbox a plugin frame had, for a plugin document at the top of its own browser.
pub const SANDBOX: &str = "sandbox allow-scripts";

const STAND_IN: &str = include_str!("stand_in.html");
/// The stand-in runs its one inline script and loads nothing.
const STAND_IN_CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

/// The shell page's browser is `id` (compositor mode), or there is none (`None`).
pub fn set_shell_page(id: Option<i32>) {
    SHELL_PAGE.store(id.unwrap_or(-1), Ordering::Release);
}

/// Whether a document request of `browser` for a frame (`main` or not) at a plugin surface's host
/// is a stand-in's: a sub-frame of the compositor's shell page.
pub fn is_stand_in(browser: i32, main: bool, sub_frame: bool, surface_host: bool) -> bool {
    let page = SHELL_PAGE.load(Ordering::Acquire);
    page >= 0 && browser == page && !main && sub_frame && surface_host
}

/// The stand-in document.
pub fn reply() -> Reply {
    Reply {
        status: 200,
        mime: "text/html; charset=utf-8".to_owned(),
        headers: vec![
            (
                "Content-Security-Policy".to_owned(),
                STAND_IN_CSP.to_owned(),
            ),
            ("Cache-Control".to_owned(), "no-store".to_owned()),
        ],
        body: STAND_IN.as_bytes().to_vec(),
    }
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
    use super::{SANDBOX, is_stand_in, reply, sandbox_top, set_shell_page};
    use desk_web::Reply;

    #[test]
    fn only_a_surface_frame_of_the_compositors_shell_page_is_a_stand_in() {
        set_shell_page(None);
        assert!(!is_stand_in(4, false, true, true), "no compositor");
        set_shell_page(Some(4));
        assert!(is_stand_in(4, false, true, true));
        assert!(!is_stand_in(5, false, true, true), "another browser");
        assert!(!is_stand_in(4, true, false, true), "the page itself");
        assert!(!is_stand_in(4, false, false, true), "a fetch from the page");
        assert!(!is_stand_in(4, false, true, false), "the shared host");
        set_shell_page(None);
        let page = reply();
        assert!(String::from_utf8_lossy(&page.body).contains("native.post"));
        assert!(page.headers.iter().any(|(n, v)| n == "Content-Security-Policy" && v.starts_with("default-src 'none'")));
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
