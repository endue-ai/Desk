//! What a desk page may load at all, before any CSP (#42): the desk's own schemes, `data:` and
//! `blob:` it made itself, `about:` frames, and Chromium's error and DevTools pages. Everything else
//! (`https:`, `http:`, `file:`, `ws:`) is refused in the browser process, so a page that slips past
//! its CSP still reaches nothing; plugins reach the network only through the bridge's `net.fetch`.

/// Whether a desk page may load `url`.
pub fn allows(url: &str) -> bool {
    let Some((scheme, _)) = url.split_once(':') else {
        return false;
    };
    matches!(
        scheme.to_ascii_lowercase().as_str(),
        "desk-app" | "desk-plugin" | "data" | "blob" | "about" | "chrome-error" | "devtools"
    )
}

#[cfg(test)]
mod tests {
    use super::allows;

    #[test]
    fn the_desk_schemes_and_page_made_urls_load_and_the_network_does_not() {
        for url in [
            "desk-app://app/index.html",
            "desk-plugin://main.endue-notes/endue.notes/ui/index.html",
            "data:text/plain,hi",
            "blob:desk-plugin://main.x-y/123",
            "about:blank",
            "about:srcdoc",
            "chrome-error://chromewebdata/",
        ] {
            assert!(allows(url), "{url}");
        }
        for url in [
            "https://example.com/",
            "http://127.0.0.1:8787/v0",
            "http://desk-plugin.main.x-y.localhost/x",
            "file:///etc/passwd",
            "ws://localhost/",
            "javascript:alert(1)",
            "",
            "nocolon",
        ] {
            assert!(!allows(url), "{url}");
        }
    }
}
