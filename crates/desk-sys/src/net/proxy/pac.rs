//! PAC files: `FindProxyForURL(url, host)` run by boa, a JavaScript engine in Rust, with the standard
//! helpers (`pac.js`; `dnsResolve`, `myIpAddress` and `shExpMatch` here) and runtime limits, so a
//! script that loops forever is stopped.

use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs, UdpSocket};

use boa_engine::error::TryNativeError;
use boa_engine::{Context, JsResult, JsString, JsValue, NativeFunction, Source, js_string};
use url::Url;

use super::Route;
use crate::{Error, ErrorCode};

const HELPERS: &str = include_str!("pac.js");
/// Loop iterations one function call may run before boa stops it: a few milliseconds in a release
/// build, well past the lists of hosts PAC files loop over.
const LOOP_LIMIT: u64 = 300_000;
const RECURSION_LIMIT: usize = 256;

/// A PAC script. Every route runs it in a fresh engine, so one call cannot change the next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pac {
    script: String,
}

/// Why a PAC call gave no route.
pub(super) enum Failure {
    /// The script threw or answered something that is not a route.
    Script(Error),
    /// The script ran into boa's runtime limits: do not run it again soon.
    Limits(Error),
}

impl Pac {
    /// Run `script` once; it must define `FindProxyForURL`, or it is `invalid_params`.
    pub fn new(script: &str) -> Result<Self, Error> {
        let pac = Self {
            script: script.to_owned(),
        };
        pac.engine().map_err(|failure| failure.into_error())?;
        Ok(pac)
    }

    /// The route the script gives `url`: the first entry of its answer (`DIRECT`, `PROXY h:p`,
    /// `HTTPS h:p`, `SOCKS h:p`, `SOCKS4 h:p`, `SOCKS5 h:p`). An empty answer is direct.
    pub fn route(&self, url: &str) -> Result<Route, Error> {
        self.evaluate(url).map_err(Failure::into_error)
    }

    pub(super) fn evaluate(&self, url: &str) -> Result<Route, Failure> {
        let url = Url::parse(url).map_err(|err| {
            Failure::Script(Error::new(
                ErrorCode::InvalidParams,
                format!("{url:?}: {err}"),
            ))
        })?;
        let (pac_url, host) = arguments(&url);
        let (mut context, find) = self.engine()?;
        let args = [
            JsValue::from(JsString::from(pac_url.as_str())),
            JsValue::from(JsString::from(host.as_str())),
        ];
        let answer = find
            .call(&JsValue::undefined(), &args, &mut context)
            .and_then(|answer| answer.to_string(&mut context))
            .map_err(|err| failure(err, &mut context, "FindProxyForURL"))?;
        parse(&answer.to_std_string_escaped()).map_err(Failure::Script)
    }

    /// A fresh engine with the helpers and the script run, and `FindProxyForURL`.
    fn engine(&self) -> Result<(Context, boa_engine::JsObject), Failure> {
        let mut context = Context::default();
        let limits = context.runtime_limits_mut();
        limits.set_loop_iteration_limit(LOOP_LIMIT);
        limits.set_recursion_limit(RECURSION_LIMIT);
        let natives: [(JsString, usize, NativeFunction); 3] = [
            (
                js_string!("dnsResolve"),
                1,
                NativeFunction::from_fn_ptr(dns_resolve),
            ),
            (
                js_string!("myIpAddress"),
                0,
                NativeFunction::from_fn_ptr(my_ip_address),
            ),
            (
                js_string!("shExpMatch"),
                2,
                NativeFunction::from_fn_ptr(sh_exp_match),
            ),
        ];
        for (name, length, function) in natives {
            context
                .register_global_builtin_callable(name, length, function)
                .map_err(|err| failure(err, &mut context, "the PAC helpers"))?;
        }
        context
            .eval(Source::from_bytes(HELPERS))
            .map_err(|err| failure(err, &mut context, "the PAC helpers"))?;
        context
            .eval(Source::from_bytes(&self.script))
            .map_err(|err| failure(err, &mut context, "the PAC file"))?;
        let global = context.global_object();
        let find = global
            .get(js_string!("FindProxyForURL"), &mut context)
            .ok()
            .and_then(|find| find.as_callable());
        match find {
            Some(find) => Ok((context, find)),
            None => Err(Failure::Script(Error::new(
                ErrorCode::InvalidParams,
                "the PAC file defines no FindProxyForURL function",
            ))),
        }
    }
}

impl Failure {
    fn into_error(self) -> Error {
        match self {
            Failure::Script(err) | Failure::Limits(err) => err,
        }
    }
}

fn failure(err: boa_engine::JsError, context: &mut Context, what: &str) -> Failure {
    let error = Error::new(ErrorCode::InvalidParams, format!("{what}: {err}"));
    match err.try_native(context) {
        Err(TryNativeError::EngineError { .. }) => Failure::Limits(error),
        _ => Failure::Script(error),
    }
}

/// What the script is called with: the URL with no credentials or fragment, and for https and wss
/// no path or query either, as browsers do; ws and wss as http and https. The host has no brackets.
fn arguments(url: &Url) -> (String, String) {
    let host = url.host_str().unwrap_or_default();
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    let (scheme, secure) = match url.scheme() {
        "wss" | "https" => ("https", true),
        "ws" | "http" => ("http", false),
        other => (other, false),
    };
    let authority = match url.port() {
        Some(port) => format!("{}:{port}", url.host_str().unwrap_or_default()),
        None => url.host_str().unwrap_or_default().to_owned(),
    };
    let rest = match (secure, url.query()) {
        (true, _) => "/".to_owned(),
        (false, Some(query)) => format!("{}?{query}", url.path()),
        (false, None) => url.path().to_owned(),
    };
    (format!("{scheme}://{authority}{rest}"), host)
}

/// The first entry of a PAC answer as a route.
fn parse(answer: &str) -> Result<Route, Error> {
    let first = answer.split(';').next().unwrap_or_default().trim();
    if first.is_empty() || first.eq_ignore_ascii_case("DIRECT") {
        return Ok(Route::Direct);
    }
    let nonsense = || {
        Error::new(
            ErrorCode::InvalidParams,
            format!("the PAC file answered {answer:?}"),
        )
    };
    let mut words = first.split_whitespace();
    let (Some(kind), Some(address), None) = (words.next(), words.next(), words.next()) else {
        return Err(nonsense());
    };
    let scheme = match kind.to_ascii_uppercase().as_str() {
        "PROXY" => "http",
        "HTTPS" => "https",
        "SOCKS" | "SOCKS4" => "socks4",
        "SOCKS5" => "socks5",
        _ => return Err(nonsense()),
    };
    let url = format!("{scheme}://{address}");
    match Url::parse(&url) {
        Ok(parsed) if parsed.host_str().is_some_and(|h| !h.is_empty()) => Ok(Route::Proxy(url)),
        _ => Err(nonsense()),
    }
}

/// `shExpMatch(str, shexp)`: a shell expression, where `*` matches any run of characters and `?`
/// any one.
fn sh_exp_match(_: &JsValue, args: &[JsValue], context: &mut Context) -> JsResult<JsValue> {
    let mut text = |i: usize| match args.get(i) {
        Some(value) => value
            .to_string(context)
            .map(|text| text.to_std_string_escaped()),
        None => Ok("undefined".to_owned()),
    };
    let (text, pattern) = (text(0)?, text(1)?);
    Ok(JsValue::from(super::bypass::glob(&pattern, &text)))
}

/// `dnsResolve(host)`: the host's first IPv4 address from the OS resolver, or null. An IP literal
/// is its own answer, without a lookup.
fn dns_resolve(_: &JsValue, args: &[JsValue], context: &mut Context) -> JsResult<JsValue> {
    let host = match args.first() {
        Some(host) => host.to_string(context)?.to_std_string_escaped(),
        None => return Ok(JsValue::null()),
    };
    let address = match host.parse::<Ipv4Addr>() {
        Ok(ip) => Some(ip),
        Err(_) => (host.as_str(), 0)
            .to_socket_addrs()
            .ok()
            .and_then(|mut addrs| {
                addrs.find_map(|addr| match addr.ip() {
                    IpAddr::V4(ip) => Some(ip),
                    IpAddr::V6(_) => None,
                })
            }),
    };
    Ok(match address {
        Some(ip) => JsValue::from(JsString::from(ip.to_string().as_str())),
        None => JsValue::null(),
    })
}

/// `myIpAddress()`: the address this computer would send from. Connecting a UDP socket only picks a
/// route; no packet is sent. 127.0.0.1 when there is no route.
fn my_ip_address(_: &JsValue, _: &[JsValue], _: &mut Context) -> JsResult<JsValue> {
    let local = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|socket| {
            // TEST-NET-1 (RFC 5737): routed like any outside address, never answered.
            socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9))?;
            socket.local_addr()
        })
        .map(|addr| addr.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    Ok(JsValue::from(JsString::from(local.to_string().as_str())))
}
