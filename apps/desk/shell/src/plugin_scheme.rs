//! The `desk-plugin` scheme in the CEF shell (#42): `desk_web::plugin_scheme` answers, with the
//! bundles this binary embeds; this adapts CEF's requests and resource handlers to it. Requests run
//! on CEF's IO thread; a file URL reads at most one 2 MiB part (ADR 0048).

use std::sync::{Arc, Mutex};

use cef::*;
use desk_core::Core;
use desk_web::Reply;
use desk_web::plugin_scheme::{self, Bundled};
use http::header;

use crate::scheme::{ReplyHandler, Sending};

/// The SDK, the UI bundle and the shared sheets (`just build-sdk build-ui`, which `just build-shell`
/// runs first). The palette's own files come with the palette (#45).
static BUNDLED: Bundled = Bundled {
    sdk: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/plugin-sdk/dist/plugin-sdk.js"
    )),
    ui: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/ui/dist/ui.js"
    )),
    tokens: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/ui/dist/tokens.css"
    )),
    base: include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/ui/dist/base.css"
    )),
    extra: |_| None,
};

/// Serve `desk-plugin` from `core`; call once the desk has booted.
pub fn register(core: Arc<Core>) {
    let mut factory = PluginSchemeFactory::new(core);
    register_scheme_handler_factory(
        Some(&plugin_scheme::SCHEME.into()),
        None,
        Some(&mut factory),
    );
}

/// The answer to one request, as `desk_web` gives it, in the shell's reply shape.
fn answer(core: &Core, method: &str, url: &str, range: Option<&str>) -> Reply {
    let mut request = http::Request::builder().method(method).uri(url);
    if let Some(range) = range {
        request = request.header(header::RANGE, range);
    }
    let Ok(request) = request.body(Vec::new()) else {
        return Reply::status(400);
    };
    let response = plugin_scheme::respond(&request, core, &BUNDLED);
    if cfg!(debug_assertions) {
        eprintln!(
            "desk-plugin: {} {url} {}",
            response.status().as_u16(),
            range.unwrap_or("-")
        );
    }
    reply(response)
}

/// An `http` response as a reply: the type as the MIME type, the other headers as they are.
fn reply(response: http::Response<Vec<u8>>) -> Reply {
    let status = response.status().as_u16();
    let mut mime = "application/octet-stream".to_owned();
    let mut headers = Vec::new();
    for (name, value) in response.headers() {
        let value = value.to_str().unwrap_or_default().to_owned();
        if name == header::CONTENT_TYPE {
            mime = value;
        } else if name != header::CONTENT_LENGTH {
            headers.push((name.as_str().to_owned(), value));
        }
    }
    Reply {
        status,
        mime,
        headers,
        body: response.into_body(),
    }
}

wrap_scheme_handler_factory! {
    struct PluginSchemeFactory {
        core: Arc<Core>,
    }

    impl SchemeHandlerFactory {
        fn create(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _scheme_name: Option<&CefString>,
            request: Option<&mut Request>,
        ) -> Option<ResourceHandler> {
            let request = request?;
            let url = CefString::from(&request.url()).to_string();
            let method = CefString::from(&request.method()).to_string();
            let range = CefString::from(&request.header_by_name(Some(&"Range".into()))).to_string();
            let range = (!range.is_empty()).then_some(range);
            let reply = answer(&self.core, &method, &url, range.as_deref());
            Some(ReplyHandler::new(Arc::new(Mutex::new(Sending { reply, sent: 0 }))))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::reply;

    #[test]
    fn a_response_becomes_a_reply_with_its_type_apart() {
        let response = http::Response::builder()
            .status(206)
            .header("Content-Type", "video/mp4")
            .header("Content-Range", "bytes 0-9/100")
            .header("Content-Length", "10")
            .body(vec![0u8; 10])
            .unwrap();
        let reply = reply(response);
        assert_eq!(reply.status, 206);
        assert_eq!(reply.mime, "video/mp4");
        assert!(
            reply
                .headers
                .iter()
                .any(|(n, v)| n == "content-range" && v == "bytes 0-9/100")
        );
        assert!(reply.headers.iter().all(|(n, _)| n != "content-length"));
        assert_eq!(reply.body.len(), 10);
    }
}
