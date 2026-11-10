//! The `desk-app` scheme: the shell's own files, answered by `desk_web` and handed to CEF through a
//! resource handler. Built-in pages under `/_desk/` come from the binary itself.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use cef::*;
use desk_web::Reply;

/// The scheme of the shell's own files.
pub const APP_SCHEME: &str = "desk-app";
/// The only host on it.
pub const APP_HOST: &str = "app";

const HELLO: &str = include_str!("hello.html");
const HELLO_JS: &str = include_str!("hello.js");

/// Register the `desk-app` handler; call once CEF's context is ready.
pub fn register(dist: PathBuf) {
    let mut factory = AppSchemeFactory::new(Arc::new(dist));
    register_scheme_handler_factory(
        Some(&APP_SCHEME.into()),
        Some(&APP_HOST.into()),
        Some(&mut factory),
    );
}

/// The reply for `url` on `desk-app://app/`, with the shell's files under `dist`.
pub fn answer(dist: &std::path::Path, url: &str) -> Reply {
    let Some(path) = path_of(url) else {
        return Reply::status(400);
    };
    let bare = path.split(['?', '#']).next().unwrap_or_default();
    match bare {
        "/_desk/hello.html" => Reply {
            status: 200,
            mime: "text/html".to_owned(),
            headers: vec![(
                "Content-Security-Policy".to_owned(),
                desk_web::assets::SHELL_CSP.to_owned(),
            )],
            body: HELLO.as_bytes().to_vec(),
        },
        "/_desk/hello.js" => Reply {
            status: 200,
            mime: "text/javascript".to_owned(),
            headers: Vec::new(),
            body: HELLO_JS.as_bytes().to_vec(),
        },
        "/_desk/status.json" => Reply {
            status: 200,
            mime: "application/json".to_owned(),
            headers: vec![("Cache-Control".to_owned(), "no-store".to_owned())],
            body: status_json().into_bytes(),
        },
        _ => desk_web::assets::serve(dist, path),
    }
}

/// The path of a `desk-app://app/...` URL, `None` for another scheme or host.
fn path_of(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("desk-app://")?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    (host == APP_HOST).then_some(if path.is_empty() {
        "/"
    } else {
        &rest[host.len()..]
    })
}

/// What the shell says about itself, from Rust: the proof the scheme and the process work.
fn status_json() -> String {
    format!(
        "{{\"shell\":\"desk-shell\",\"version\":\"{}\",\"cef\":\"{}\",\"chromium\":\"{}.{}.{}.{}\",\"pid\":{}}}",
        crate::release::version(),
        std::str::from_utf8(
            sys::CEF_VERSION
                .strip_suffix(b"\0")
                .unwrap_or(sys::CEF_VERSION)
        )
        .unwrap_or("?"),
        sys::CHROME_VERSION_MAJOR,
        sys::CHROME_VERSION_MINOR,
        sys::CHROME_VERSION_BUILD,
        sys::CHROME_VERSION_PATCH,
        std::process::id()
    )
}

/// A `Content-Type` value as the MIME type and its charset, if it names one.
pub fn split_mime(value: &str) -> (&str, Option<&str>) {
    let mut parts = value.split(';').map(str::trim);
    let mime = parts.next().unwrap_or_default();
    let charset = parts.find_map(|p| {
        p.split_once('=')
            .filter(|(k, _)| k.trim().eq_ignore_ascii_case("charset"))
            .map(|(_, v)| v.trim().trim_matches('"'))
    });
    (mime, charset)
}

wrap_scheme_handler_factory! {
    struct AppSchemeFactory {
        dist: Arc<PathBuf>,
    }

    impl SchemeHandlerFactory {
        fn create(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _scheme_name: Option<&CefString>,
            request: Option<&mut Request>,
        ) -> Option<ResourceHandler> {
            let url = request.map(|r| CefString::from(&r.url()).to_string()).unwrap_or_default();
            let reply = answer(&self.dist, &url);
            Some(ReplyHandler::new(Arc::new(Mutex::new(Sending { reply, sent: 0 }))))
        }
    }
}

/// A reply on its way to CEF: how much of the body is sent.
pub struct Sending {
    pub reply: Reply,
    pub sent: usize,
}

wrap_resource_handler! {
    pub struct ReplyHandler {
        state: Arc<Mutex<Sending>>,
    }

    impl ResourceHandler {
        fn open(
            &self,
            _request: Option<&mut Request>,
            handle_request: Option<&mut ::std::os::raw::c_int>,
            _callback: Option<&mut Callback>,
        ) -> ::std::os::raw::c_int {
            if let Some(handle) = handle_request {
                *handle = 1;
            }
            1
        }

        fn response_headers(
            &self,
            response: Option<&mut Response>,
            response_length: Option<&mut i64>,
            _redirect_url: Option<&mut CefString>,
        ) {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let reply = &state.reply;
            if let Some(response) = response {
                response.set_status(reply.status as _);
                response.set_status_text(Some(&reply.status_text().into()));
                // CEF takes the type and its charset apart: `text/html; charset=utf-8` as one
                // MIME type would show the page as text.
                let (mime, charset) = split_mime(&reply.mime);
                response.set_mime_type(Some(&mime.into()));
                if let Some(charset) = charset {
                    response.set_charset(Some(&charset.into()));
                }
                for (name, value) in &reply.headers {
                    response.set_header_by_name(Some(&name.as_str().into()), Some(&value.as_str().into()), 1);
                }
            }
            if let Some(length) = response_length {
                *length = reply.body.len() as i64;
            }
        }

        // A request with a Range header from byte 1 on: CEF skips to that byte itself before it
        // asks for the headers, and fails the request when nothing is skipped. The reply has the
        // range applied already (`desk_web` answers 206 with the range's bytes alone, 416, or 200
        // where it ignores Range), so it starts where CEF wants it: everything counts as skipped.
        fn skip(
            &self,
            bytes_to_skip: i64,
            bytes_skipped: Option<&mut i64>,
            _callback: Option<&mut ResourceSkipCallback>,
        ) -> ::std::os::raw::c_int {
            if let Some(skipped) = bytes_skipped {
                *skipped = bytes_to_skip;
            }
            1
        }

        // CEF's C signature hands a raw buffer; it is valid for `bytes_to_read` bytes.
        #[allow(clippy::not_unsafe_ptr_arg_deref)]
        fn read(
            &self,
            data_out: *mut u8,
            bytes_to_read: ::std::os::raw::c_int,
            bytes_read: Option<&mut ::std::os::raw::c_int>,
            _callback: Option<&mut ResourceReadCallback>,
        ) -> ::std::os::raw::c_int {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let remaining = state.reply.body.len() - state.sent;
            let count = remaining.min(bytes_to_read.max(0) as usize);
            if count > 0 && !data_out.is_null() {
                let start = state.sent;
                let chunk = &state.reply.body[start..start + count];
                // SAFETY: CEF hands a buffer of at least `bytes_to_read` bytes, valid for this call.
                #[allow(unsafe_code)]
                unsafe {
                    std::ptr::copy_nonoverlapping(chunk.as_ptr(), data_out, count);
                }
                state.sent += count;
            }
            if let Some(read) = bytes_read {
                *read = count as _;
            }
            (count > 0) as _
        }

        fn cancel(&self) {}
    }
}

#[cfg(test)]
mod tests {
    use super::{answer, path_of};

    #[test]
    fn a_content_type_splits_into_its_mime_type_and_charset() {
        use super::split_mime;
        assert_eq!(
            split_mime("text/html; charset=utf-8"),
            ("text/html", Some("utf-8"))
        );
        assert_eq!(
            split_mime("text/css;Charset=\"UTF-8\""),
            ("text/css", Some("UTF-8"))
        );
        assert_eq!(split_mime("video/mp4"), ("video/mp4", None));
    }

    #[test]
    fn paths_come_only_from_the_app_host() {
        assert_eq!(path_of("desk-app://app/index.html"), Some("/index.html"));
        assert_eq!(path_of("desk-app://app/"), Some("/"));
        assert_eq!(path_of("desk-app://app"), Some("/"));
        assert_eq!(path_of("desk-app://other/index.html"), None);
        assert_eq!(path_of("https://app/index.html"), None);
    }

    #[test]
    fn the_built_in_pages_answer_from_the_binary() {
        let dist = std::env::temp_dir().join("desk-shell-no-dist");
        let hello = answer(&dist, "desk-app://app/_desk/hello.html");
        assert_eq!(hello.status, 200);
        assert!(String::from_utf8_lossy(&hello.body).contains("/_desk/hello.js"));
        let script = answer(&dist, "desk-app://app/_desk/hello.js");
        assert_eq!(script.mime, "text/javascript");
        assert!(String::from_utf8_lossy(&script.body).contains("/_desk/status.json"));
        let status = answer(&dist, "desk-app://app/_desk/status.json?t=1");
        assert_eq!(status.mime, "application/json");
        assert!(String::from_utf8_lossy(&status.body).contains("\"shell\":\"desk-shell\""));
        assert_eq!(answer(&dist, "desk-app://app/index.html").status, 404);
        assert_eq!(answer(&dist, "desk-app://nope/x").status, 400);
    }
}
