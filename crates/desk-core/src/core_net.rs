//! The net side of `Core`: net.fetch over desk-sys `net`. The permission engine checks the URL's host
//! against the `net:fetch` scope before anything connects; the scope's hosts then go to desk-sys as
//! the allowlist, which checks every redirect the same way. Any status is a result; a body that is not
//! UTF-8 comes back as base64. The call waits for the whole response on the caller's thread, as
//! fs.read does: hosts call `Core::handle` off their UI thread.

use std::time::Duration;

use base64::Engine as _;
use desk_bridge::{Encoding, ErrorCode, HttpMethod, NetFetchParams, NetFetchResult, Permission};
use desk_sys::net::{self as sysnet, Method, Request};

use crate::handler::{Answer, Core, error, json, sys_error};
use crate::perm::Target;

impl Core {
    pub(crate) fn net_fetch(&self, caller: &str, params: NetFetchParams) -> Answer {
        let allowed_hosts = params.scope.hosts.clone();
        let scope = Permission::NetFetch(params.scope);
        self.check(caller, &scope, &Target::Url(&params.url))?;
        let body = match (params.body, params.body_encoding.unwrap_or(Encoding::Utf8)) {
            (None, _) => None,
            (Some(text), Encoding::Utf8) => Some(text.into_bytes()),
            (Some(text), Encoding::Base64) => Some(
                base64::engine::general_purpose::STANDARD
                    .decode(text)
                    .map_err(|e| error(ErrorCode::InvalidParams, format!("not base64: {e}")))?,
            ),
        };
        let request = Request {
            url: params.url,
            method: method_of(params.method.unwrap_or(HttpMethod::GET)),
            headers: params.headers.unwrap_or_default(),
            body,
            timeout: params.timeout_ms.map(Duration::from_millis),
            allowed_hosts,
        };
        let response = sysnet::fetch(&request).map_err(sys_error)?;
        let (body, body_encoding) = match String::from_utf8(response.body) {
            Ok(text) => (text, Encoding::Utf8),
            Err(err) => (
                base64::engine::general_purpose::STANDARD.encode(err.into_bytes()),
                Encoding::Base64,
            ),
        };
        json(NetFetchResult {
            status: u64::from(response.status),
            headers: response.headers,
            body,
            body_encoding,
        })
    }
}

fn method_of(method: HttpMethod) -> Method {
    match method {
        HttpMethod::GET => Method::Get,
        HttpMethod::HEAD => Method::Head,
        HttpMethod::POST => Method::Post,
        HttpMethod::PUT => Method::Put,
        HttpMethod::PATCH => Method::Patch,
        HttpMethod::DELETE => Method::Delete,
        HttpMethod::OPTIONS => Method::Options,
    }
}
