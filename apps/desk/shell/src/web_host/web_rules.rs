//! What a web view's page may reach (#273, ADR 0216), and how its surface is named. A view's
//! surface is `web:<its window's surface host>`: never a plugin surface's host, so nothing that
//! reads a host as a plugin's (the relay, the bridge's sender) takes it for one. Its page loads
//! what the web is made of and nothing of the desk's: no desk scheme, no file, no DevTools page.
//! Its own address is http or https, on a host the core allows (`WebHost::web_may_visit`).

/// A view's surface id: this, then its window's surface host.
pub const SURFACE: &str = "web:";
/// The page a view shows before its first address.
pub const BLANK: &str = "about:blank";

/// The surface of the view in the window whose surface host is `host`.
pub fn surface_of(host: &str) -> String {
    format!("{SURFACE}{host}")
}

/// The surface host of the window a view's surface `surface` lies in, if it is a view's.
pub fn host_of(surface: &str) -> Option<&str> {
    surface
        .strip_prefix(SURFACE)
        .filter(|host| !host.is_empty())
}

/// Whether surface `surface` is a web view.
pub fn is_web_view(surface: &str) -> bool {
    host_of(surface).is_some()
}

/// The scheme of `url`, lowercase.
fn scheme(url: &str) -> Option<String> {
    let (scheme, _) = url.split_once(':')?;
    Some(scheme.to_ascii_lowercase())
}

/// Whether a view's page, or a frame in it, may load `url` at all: the web's own schemes, what a
/// page makes itself (`data:`, `blob:`), an empty frame and Chromium's error page.
pub fn loads(url: &str) -> bool {
    matches!(
        scheme(url).as_deref(),
        Some("http" | "https" | "ws" | "wss" | "data" | "blob" | "about" | "chrome-error")
    )
}

/// Whether `url` is an address a view itself may show: http or https.
pub fn address(url: &str) -> bool {
    matches!(scheme(url).as_deref(), Some("http" | "https"))
}

/// The address a view reports for the page at `url`: its own for a web page, none for an empty
/// page, the desk's error page or anything else it shows meanwhile.
pub fn shown_address(url: &str) -> Option<&str> {
    address(url).then_some(url)
}

/// The page a view shows when `url` did not load (`why`, Chromium's words): plain and its own, so
/// the person reads what happened where the page would be.
pub fn failed_page(url: &str, why: &str) -> String {
    let safe = |text: &str| {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    let page = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>This page did not load</title>\
         <body style=\"font: 15px system-ui; margin: 15vh auto; max-width: 34em; padding: 0 2em; \
         color: #444; background: #fff\"><h1 style=\"font-size: 20px; color: #111\">This page did \
         not load</h1><p style=\"word-break: break-all\">{}</p><p style=\"color: #777\">{}</p>",
        safe(url),
        safe(why)
    );
    let mut out = String::from("data:text/html;charset=utf-8,");
    for byte in page.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(byte));
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_views_surface_names_its_windows_surface_and_is_no_plugin_host() {
        assert_eq!(surface_of("main.endue-browser"), "web:main.endue-browser");
        assert_eq!(
            host_of("web:main--2.endue-browser"),
            Some("main--2.endue-browser")
        );
        assert_eq!(host_of("web:"), None, "no window");
        assert_eq!(host_of("main.endue-browser"), None);
        assert_eq!(host_of("window:endue.browser"), None, "a window's own page");
        assert!(is_web_view("web:main.endue-browser"));
        // Nothing reads it as a plugin surface's host: no bridge caller, no relay.
        let parsed = desk_web::plugin_scheme::hosts::Host::parse(Some("web:main.endue-browser"));
        assert!(!matches!(
            parsed,
            Some(desk_web::plugin_scheme::hosts::Host::Surface { .. })
        ));
    }

    #[test]
    fn a_page_loads_the_web_and_nothing_of_the_desk() {
        for url in [
            "https://example.com/",
            "HTTP://example.com/a.png",
            "wss://example.com/socket",
            "data:image/png;base64,AAAA",
            "blob:https://example.com/1-2",
            "about:blank",
            "about:srcdoc",
            "chrome-error://chromewebdata/",
        ] {
            assert!(loads(url), "{url}");
        }
        for url in [
            "desk-app://app/index.html",
            "desk-plugin://main.endue-notes/endue.notes/ui/index.html",
            "DESK-PLUGIN://main.endue-notes/_desk/plugin-sdk.js",
            "file:///etc/passwd",
            "devtools://devtools/bundled/inspector.html",
            "chrome://settings/",
            "view-source:https://example.com/",
            "javascript:alert(1)",
            "ftp://example.com/",
            "",
            "nocolon",
        ] {
            assert!(!loads(url), "{url}");
        }
    }

    #[test]
    fn a_views_own_address_is_http_or_https() {
        assert!(address("https://example.com/") && address("http://127.0.0.1:8787/"));
        for url in [
            "about:blank",
            "data:text/html,hi",
            "blob:https://example.com/1",
            "mailto:a@b.c",
        ] {
            assert!(!address(url), "{url}");
            assert_eq!(shown_address(url), None, "{url}");
        }
        assert_eq!(
            shown_address("https://example.com/a"),
            Some("https://example.com/a")
        );
    }

    #[test]
    fn a_failed_load_shows_a_page_of_its_own_with_nothing_of_the_address_run() {
        let page = failed_page(
            "https://example.com/<script>alert(1)</script>",
            "ERR_FAILED & co",
        );
        assert!(page.starts_with("data:text/html;charset=utf-8,"));
        assert!(
            !page.contains('<') && !page.contains(' '),
            "percent-encoded whole"
        );
        assert!(
            page.contains("%26lt%3Bscript%26gt%3B"),
            "the address is text, not markup"
        );
        assert!(page.contains("ERR_FAILED%20%26amp%3B%20co"));
        assert!(
            !address(&page),
            "it is never reported as the view's address"
        );
    }
}
