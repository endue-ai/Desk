//! What this build is (#46, #47): the release workflow builds the CEF desk with `DESK_VERSION`, the
//! updater's public key `DESK_UPDATER_PUBKEY`, the release origin `DESK_UPDATE_URL` and the commit
//! `DESK_BUILD_COMMIT` in its environment, and the binary keeps them. A development build has none
//! and reports the workspace's 0.0.0; it may take the key and the origin at run time to try a local
//! origin, as the Tauri desk's debug builds do. A build without a key never updates itself.

/// Where builds come from unless the build says otherwise.
pub const DEFAULT_ORIGIN: &str = "https://releases.endue.ai/desk";

/// The version this build reports: `DESK_VERSION` at compile time, else the workspace's.
pub fn version() -> &'static str {
    pick_version(option_env!("DESK_VERSION"), env!("CARGO_PKG_VERSION"))
}

fn pick_version(built: Option<&'static str>, workspace: &'static str) -> &'static str {
    built
        .map(str::trim)
        .map(|v| v.strip_prefix('v').unwrap_or(v))
        .filter(|v| !v.is_empty())
        .unwrap_or(workspace)
}

/// The build's commit as the bridge takes it: 7 to 40 hex digits, lowercase.
pub fn commit() -> Option<String> {
    valid_commit(option_env!("DESK_BUILD_COMMIT"))
}

fn valid_commit(built: Option<&str>) -> Option<String> {
    let commit = built?.trim().to_ascii_lowercase();
    let hex = commit.chars().all(|c| c.is_ascii_hexdigit());
    (hex && (7..=40).contains(&commit.len())).then_some(commit)
}

/// The updater key and the origin this build updates from; none when it carries no key.
pub fn origin() -> Option<(String, String)> {
    let run = |name| {
        cfg!(debug_assertions)
            .then(|| std::env::var(name).ok())
            .flatten()
    };
    let key = pick(
        run("DESK_UPDATER_PUBKEY"),
        option_env!("DESK_UPDATER_PUBKEY"),
    )?;
    let base = pick(run("DESK_UPDATE_URL"), option_env!("DESK_UPDATE_URL"))
        .unwrap_or_else(|| DEFAULT_ORIGIN.to_owned());
    Some((key, base))
}

/// The run-time value over the built-in one; empty counts as none.
fn pick(run: Option<String>, built: Option<&str>) -> Option<String> {
    run.or_else(|| built.map(str::to_owned))
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Whether the updater may use plain `http://`: in a development build, or when the build's own
/// origin is `http://` on this machine (a rehearsal against a local file server,
/// `e2e/smoke/update-two-hops.sh`). A build whose origin is `https://` never follows a link to `http://`.
pub fn allows_http(base: &str) -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    url::Url::parse(base).is_ok_and(|url| {
        url.scheme() == "http"
            && match url.host() {
                Some(url::Host::Domain(name)) => name == "localhost",
                Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
                Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
                None => false,
            }
    })
}

#[cfg(test)]
mod tests {
    use super::{allows_http, pick, pick_version, valid_commit};

    #[test]
    fn the_version_is_the_one_the_build_was_given() {
        assert_eq!(pick_version(Some("0.5.0-rc.3"), "0.0.0"), "0.5.0-rc.3");
        assert_eq!(pick_version(Some(" v0.5.0 "), "0.0.0"), "0.5.0");
        assert_eq!(pick_version(Some(""), "0.0.0"), "0.0.0");
        assert_eq!(pick_version(None, "0.0.0"), "0.0.0");
    }

    #[test]
    fn a_commit_is_hex_of_seven_to_forty_and_the_run_time_value_wins() {
        assert_eq!(valid_commit(Some("C46D12B")).as_deref(), Some("c46d12b"));
        assert_eq!(valid_commit(Some("main")), None);
        assert_eq!(
            pick(Some("run".into()), Some("built")).as_deref(),
            Some("run")
        );
        assert_eq!(pick(Some("  ".into()), None), None);
    }

    #[test]
    fn plain_http_only_to_this_machine() {
        assert!(allows_http("http://127.0.0.1:8123/desk"));
        assert!(allows_http("http://localhost:8123/desk"));
        assert!(allows_http("http://[::1]:8123/desk"));
        if !cfg!(debug_assertions) {
            assert!(!allows_http("http://releases.endue.ai/desk"));
            assert!(!allows_http("https://releases.endue.ai/desk"));
        }
    }
}
