//! desk-sys proxies (feature `net`): the environment's variables first, then the system's PAC and
//! manual proxy, loopback always direct; and fetch and the streams going through the proxy chosen.
//!
//! Routes are proven on a fixed `Env` and `Settings`, and PAC files are served from 127.0.0.1. The
//! process environment is proven in a child process, the test binary again: the `child` test acts
//! only when `DESK_SYS_TEST_CHILD` names a role. Proxies are reached through `.test` names that are
//! never resolved; nothing here touches the network.

#[path = "net_proxy/child.rs"]
mod child;
#[path = "net_proxy/os.rs"]
mod os;
#[path = "net_proxy/servers.rs"]
mod servers;

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use desk_sys::net::proxy::{Env, Pac, Resolver, Route, Settings};
use servers::{assert_no_connection, untouched};

const PAC: &str = include_str!("net_proxy/proxy.pac");

fn env(vars: &[(&str, &str)]) -> Env {
    vars.iter().copied().collect()
}

/// `DIRECT`, or the proxy URL.
fn route(text: &str) -> Route {
    match text {
        "DIRECT" => Route::Direct,
        url => Route::Proxy(url.to_owned()),
    }
}

/// Each URL goes the way its row says.
fn expect(resolver: &Resolver, rows: &[(&str, &str)]) {
    for (url, wanted) in rows {
        assert_eq!(resolver.route(url), route(wanted), "{url}");
    }
}

fn manual(http: Option<&str>, https: Option<&str>) -> Settings {
    Settings {
        http: http.map(str::to_owned),
        https: https.map(str::to_owned),
        ..Settings::default()
    }
}

/// The child program; see `child::run`.
#[test]
fn child() {
    if let Ok(role) = std::env::var(child::ROLE) {
        child::run(&role);
    }
}

#[test]
fn environment_proxies_win_and_follow_the_scheme() {
    // The PAC URL is a listener nobody answers: the environment decides without it.
    let (pac, pac_port) = untouched();
    let system = Settings {
        pac_url: Some(format!("http://127.0.0.1:{pac_port}/proxy.pac")),
        ..manual(Some("http://system.test:1"), Some("http://system.test:2"))
    };
    let both = env(&[
        ("http_proxy", "http://env-http.test:3128"),
        ("HTTPS_PROXY", "env-https.test:3129"),
    ]);
    expect(
        &Resolver::new(both, system.clone()),
        &[
            ("http://site.example/", "http://env-http.test:3128"),
            ("ws://site.example/", "http://env-http.test:3128"),
            ("https://site.example/", "http://env-https.test:3129"),
            ("wss://site.example/", "http://env-https.test:3129"),
        ],
    );
    let all = env(&[
        ("ALL_PROXY", "socks5h://all.test:1080"),
        ("http_proxy", "http://env-http.test:3128"),
    ]);
    expect(
        &Resolver::new(all, system.clone()),
        &[
            ("https://site.example/", "socks5h://all.test:1080"),
            ("http://site.example/", "http://env-http.test:3128"),
        ],
    );
    // Lowercase first.
    let cases = env(&[
        ("http_proxy", "http://lower.test:1"),
        ("HTTP_PROXY", "http://upper.test:1"),
    ]);
    expect(
        &Resolver::new(cases, system.clone()),
        &[("http://site.example/", "http://lower.test:1")],
    );
    let http_only = env(&[("http_proxy", "http://env-http.test:3128")]);
    expect(
        &Resolver::new(http_only, system.clone()),
        &[
            ("https://site.example/", "DIRECT"),
            ("wss://site.example/", "DIRECT"),
        ],
    );
    // An empty variable is unset: the system decides, here with its manual proxy.
    let without_pac = Settings {
        pac_url: None,
        ..system
    };
    expect(
        &Resolver::new(env(&[("HTTP_PROXY", "")]), without_pac),
        &[("http://site.example/", "http://system.test:1")],
    );
    assert_no_connection(&pac);
}

#[test]
fn no_proxy_sends_matching_hosts_direct() {
    let vars = env(&[
        ("HTTP_PROXY", "http://env.test:3128"),
        (
            "no_proxy",
            "example.com, .dot.test,192.168.1.5 ,10.0.0.0/8,fd00::/8",
        ),
    ]);
    let through = "http://env.test:3128";
    expect(
        &Resolver::new(vars, Settings::default()),
        &[
            ("http://example.com/", "DIRECT"),
            ("http://API.example.com/", "DIRECT"),
            ("http://dot.test/", "DIRECT"),
            ("http://a.b.dot.test/", "DIRECT"),
            ("http://192.168.1.5/", "DIRECT"),
            ("http://10.2.3.4:8080/", "DIRECT"),
            ("http://[fd00::1]/", "DIRECT"),
            ("http://notexample.com/", through),
            ("http://example.com.evil.test/", through),
            ("http://192.168.1.6/", through),
            ("http://11.0.0.1/", through),
            ("http://[fe80::1]/", through),
        ],
    );
    let everything = env(&[("HTTP_PROXY", "http://env.test:3128"), ("NO_PROXY", "*")]);
    expect(
        &Resolver::new(everything, Settings::default()),
        &[("http://anything.example/", "DIRECT")],
    );
}

#[test]
fn system_settings_choose_the_scheme_proxy_and_honour_bypass() {
    let (web, secure) = ("http://web.test:8080", "http://secure.test:8443");
    let mut settings = Settings {
        bypass: ["*.corp.example", "10.*", "169.254/16", "exact.example"]
            .map(String::from)
            .to_vec(),
        bypass_simple: true,
        ..manual(Some(web), Some(secure))
    };
    expect(
        &Resolver::new(Env::default(), settings.clone()),
        &[
            ("http://example.com/", web),
            ("ws://example.com/", web),
            ("https://example.com/", secure),
            ("wss://example.com/", secure),
            ("http://a.corp.example/", "DIRECT"),
            ("https://deep.a.corp.example/", "DIRECT"),
            ("http://10.1.2.3/", "DIRECT"),
            ("http://169.254.3.4/", "DIRECT"),
            ("http://exact.example/", "DIRECT"),
            ("http://intranet/", "DIRECT"),
            ("http://corp.example/", web),
            ("http://11.1.2.3/", web),
            ("http://169.255.0.1/", web),
            ("http://sub.exact.example/", web),
        ],
    );
    settings.bypass_simple = false;
    expect(
        &Resolver::new(Env::default(), settings),
        &[("http://intranet/", web)],
    );
    expect(
        &Resolver::new(Env::default(), manual(None, Some(secure))),
        &[("http://example.com/", "DIRECT")],
    );
}

#[test]
fn windows_registry_values_become_settings() {
    let one = Some("http://proxy.test:8080");
    assert_eq!(
        Settings::from_windows(1, "proxy.test:8080", "", ""),
        manual(one, one)
    );
    assert_eq!(
        Settings::from_windows(
            1,
            "http=a.test:1;https=b.test:2;socks=c.test:3",
            "<local>;*.corp",
            ""
        ),
        Settings {
            bypass: vec!["*.corp".to_owned()],
            bypass_simple: true,
            ..manual(Some("http://a.test:1"), Some("http://b.test:2"))
        }
    );
    assert_eq!(
        Settings::from_windows(0, "proxy.test:8080", "", "http://wpad.test/proxy.pac"),
        Settings {
            pac_url: Some("http://wpad.test/proxy.pac".to_owned()),
            ..Settings::default()
        }
    );
}

#[test]
fn a_pac_file_chooses_the_proxy() {
    let pac = Pac::new(PAC).unwrap();
    for (url, wanted) in [
        ("http://intranet/", "DIRECT"),
        (
            "https://a.corp.example/path?q=1",
            "http://corp-proxy.test:3128",
        ),
        ("http://10.20.30.40/", "http://ten-proxy.test:8080"),
        ("http://11.20.30.40/", "DIRECT"),
        ("wss://chat.socks.example/", "socks5://socks.test:1080"),
        ("https://secure.example/", "https://tls-proxy.test:443"),
        ("http://many.example/a", "http://first.test:1"),
        ("http://levels.example/", "socks4://old-socks.test:1081"),
        ("http://www.public.example/", "DIRECT"),
    ] {
        assert_eq!(pac.route(url), Ok(route(wanted)), "{url}");
    }

    let helpers = Pac::new(
        r#"function FindProxyForURL(url, host) {
            var ok = isPlainHostName("www") && !isPlainHostName("www.example")
              && dnsDomainIs("www.example", ".example") && !dnsDomainIs("www.other", ".example")
              && localHostOrDomainIs("www", "www.example") && !localHostOrDomainIs("ftp", "www.example")
              && dnsDomainLevels("a.b.example") == 2 && shExpMatch("a.b", "?.*") && !shExpMatch("ab", "a?b")
              && isInNet("192.168.1.9", "192.168.0.0", "255.255.0.0")
              && !isInNet("192.169.1.9", "192.168.0.0", "255.255.0.0")
              && dnsResolve("10.1.2.3") == "10.1.2.3" && isResolvable("127.0.0.1")
              && typeof myIpAddress() == "string" && weekdayRange("SUN", "SAT") && timeRange(0, 23)
              && dateRange(1, 31);
            return ok ? "PROXY helpers.test:1" : "DIRECT";
        }"#,
    )
    .unwrap();
    assert_eq!(
        helpers.route("http://any.example/"),
        Ok(route("http://helpers.test:1"))
    );
    assert!(Pac::new("function FindProxyForURL(url, host) {").is_err());
    assert!(Pac::new("var nothing = 1;").is_err());
}

#[test]
fn a_pac_url_is_fetched_once_and_used() {
    let (port, downloads) = servers::files(vec![("/proxy.pac", 200, PAC.to_owned())]);
    let settings = Settings {
        pac_url: Some(format!("http://127.0.0.1:{port}/proxy.pac")),
        ..manual(Some("http://manual.test:1"), None)
    };
    expect(
        &Resolver::new(Env::default(), settings),
        &[
            ("http://a.corp.example/", "http://corp-proxy.test:3128"),
            ("http://x.socks.example/", "socks5://socks.test:1080"),
            ("http://www.public.example/", "DIRECT"),
        ],
    );
    assert_eq!(downloads.load(Ordering::SeqCst), 1);
}

#[test]
fn a_failing_pac_falls_back_to_the_manual_proxy_then_direct() {
    let script = |body: &str| format!("function FindProxyForURL(url, host) {{ {body} }}");
    let (port, _downloads) = servers::files(vec![
        ("/throws.pac", 200, script("throw new Error('no');")),
        ("/loops.pac", 200, script("while (true) {}")),
        ("/nonsense.pac", 200, script("return 'BOGUS x';")),
    ]);
    for path in ["/missing.pac", "/throws.pac", "/loops.pac", "/nonsense.pac"] {
        let pac_url = Some(format!("http://127.0.0.1:{port}{path}"));
        let with_manual = Settings {
            pac_url: pac_url.clone(),
            ..manual(Some("http://manual.test:8080"), None)
        };
        let started = Instant::now();
        let routed = Resolver::new(Env::default(), with_manual).route("http://site.example/");
        assert_eq!(routed, route("http://manual.test:8080"), "{path}");
        let took = started.elapsed();
        assert!(took < Duration::from_secs(5), "{path} took {took:?}");
        let alone = Settings {
            pac_url,
            ..Settings::default()
        };
        let routed = Resolver::new(Env::default(), alone).route("http://site.example/");
        assert_eq!(routed, Route::Direct, "{path}");
    }
}

#[test]
fn loopback_is_always_direct() {
    let vars = env(&[
        ("HTTP_PROXY", "http://env.test:1"),
        ("ALL_PROXY", "http://env.test:2"),
    ]);
    let system = manual(Some("http://system.test:1"), Some("http://system.test:2"));
    for resolver in [
        Resolver::new(vars, Settings::default()),
        Resolver::new(Env::default(), system),
    ] {
        expect(
            &resolver,
            &[
                ("http://localhost:8080/", "DIRECT"),
                ("https://LOCALHOST/", "DIRECT"),
                ("ws://app.localhost/", "DIRECT"),
                ("http://127.0.0.1/", "DIRECT"),
                ("http://127.8.9.10:81/", "DIRECT"),
                ("wss://[::1]:9/", "DIRECT"),
            ],
        );
    }
}

#[test]
fn fetch_sse_and_ws_go_through_the_environment_proxy() {
    let answer = "HTTP/1.1 200 OK\r\ncontent-length: 7\r\nconnection: close\r\n\r\nproxied";
    let backends = vec![
        ("/", servers::http_backend(answer)),
        ("/events", servers::sse_backend()),
        ("/ws", servers::ws_backend()),
    ];
    let (port, seen) = servers::connect_proxy(backends);
    let stdout = child::spawn("through-proxy", "desk.test", port);
    for line in ["fetch:200:proxied", "sse:through", "ws:echo"] {
        assert!(
            stdout.lines().any(|l| l == line),
            "{line} missing in\n{stdout}"
        );
    }
    let targets: Vec<String> = seen.try_iter().collect();
    assert_eq!(targets, ["desk.test:80"; 3], "{stdout}");
}

#[test]
fn the_allowlist_is_checked_before_the_proxy_is_reached() {
    let (listener, port) = untouched();
    let stdout = child::spawn("outside", "outside.test", port);
    for line in [
        "fetch:PermissionDenied",
        "sse:PermissionDenied",
        "ws:PermissionDenied",
    ] {
        assert!(
            stdout.lines().any(|l| l == line),
            "{line} missing in\n{stdout}"
        );
    }
    assert_no_connection(&listener);
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "reads this Mac's proxy settings; run with -- --ignored"]
fn on_macos_system_settings_match_scutil() {
    let (expected, printed) = os::scutil();
    assert_eq!(Settings::system(), expected, "scutil --proxy:\n{printed}");
}

#[cfg(windows)]
#[test]
#[ignore = "reads this computer's Internet Settings; run with -- --ignored"]
fn on_windows_system_settings_match_the_registry() {
    let (expected, printed) = os::registry();
    assert_eq!(Settings::system(), expected, "reg query:\n{printed}");
}
