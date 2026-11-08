//! Hosts that skip a proxy: `no_proxy` read as curl reads it, and the system's bypass lists. No DNS
//! lookup decides either: names match names and IP entries match IP literals.

use std::net::{IpAddr, Ipv4Addr};

use url::Host;

/// Whether `host` matches the comma-separated `no_proxy` list: `*` for every host, a name for itself
/// and its subdomains (a leading dot is optional), an IP for itself and an IP/prefix for its network.
pub(super) fn no_proxy(list: &str, host: &Host<&str>) -> bool {
    list.split([',', ' ', '\t'])
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .any(|entry| {
            if entry == "*" {
                return true;
            }
            match host {
                Host::Domain(name) => {
                    let entry = entry.trim_start_matches('.');
                    let (name, entry) = (name.to_ascii_lowercase(), entry.to_ascii_lowercase());
                    name == entry || name.ends_with(&format!(".{entry}"))
                }
                Host::Ipv4(ip) => in_network(IpAddr::V4(*ip), entry),
                Host::Ipv6(ip) => in_network(IpAddr::V6(*ip), entry),
            }
        })
}

/// Whether `host` matches a system bypass entry: `simple` for names without a dot, `*` wildcards on
/// names, IPv4 prefixes with `*` (`10.*`) and CIDRs whose address may be short (`169.254/16`).
pub(super) fn system(entries: &[String], simple: bool, host: &Host<&str>) -> bool {
    if simple && matches!(host, Host::Domain(name) if !name.contains('.')) {
        return true;
    }
    entries
        .iter()
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .any(|entry| match host {
            Host::Domain(name) => {
                !is_ip_pattern(entry)
                    && glob(&entry.to_ascii_lowercase(), &name.to_ascii_lowercase())
            }
            Host::Ipv4(ip) => {
                in_network(IpAddr::V4(*ip), &pad_v4(entry))
                    || (is_ip_pattern(entry) && glob(entry, &ip.to_string()))
            }
            Host::Ipv6(ip) => {
                let entry = entry.trim_start_matches('[').replace(']', "");
                in_network(IpAddr::V6(*ip), &entry) || glob(&entry, &ip.to_string())
            }
        })
}

/// Whether `entry` (an IP, or an IP/prefix) covers `ip`. Anything else covers nothing.
fn in_network(ip: IpAddr, entry: &str) -> bool {
    let entry = entry.trim_start_matches('[').replace(']', "");
    let (address, bits) = match entry.split_once('/') {
        Some((address, bits)) => match bits.parse::<u32>() {
            Ok(bits) => (address, Some(bits)),
            Err(_) => return false,
        },
        None => (entry.as_str(), None),
    };
    let Ok(network) = address.parse::<IpAddr>() else {
        return false;
    };
    match (ip, network) {
        (IpAddr::V4(ip), IpAddr::V4(network)) => {
            let bits = bits.unwrap_or(32).min(32);
            let mask = u32::MAX.checked_shl(32 - bits).unwrap_or(0);
            u32::from(ip) & mask == u32::from(network) & mask
        }
        (IpAddr::V6(ip), IpAddr::V6(network)) => {
            let bits = bits.unwrap_or(128).min(128);
            let mask = u128::MAX.checked_shl(128 - bits).unwrap_or(0);
            u128::from(ip) & mask == u128::from(network) & mask
        }
        _ => false,
    }
}

/// `169.254/16` as `169.254.0.0/16`: the macOS form of a CIDR leaves the zero octets out.
fn pad_v4(entry: &str) -> String {
    let Some((address, bits)) = entry.split_once('/') else {
        return entry.to_owned();
    };
    let octets: Vec<&str> = address.split('.').collect();
    if octets.len() >= 4 || octets.iter().any(|o| o.parse::<u8>().is_err()) {
        return entry.to_owned();
    }
    let mut padded: Vec<&str> = octets;
    padded.resize(4, "0");
    let address = padded.join(".");
    match address.parse::<Ipv4Addr>() {
        Ok(_) => format!("{address}/{bits}"),
        Err(_) => entry.to_owned(),
    }
}

/// Digits, dots and `*` only: an IPv4 entry, matched against IP literals and never against names.
fn is_ip_pattern(entry: &str) -> bool {
    let address = entry.split_once('/').map_or(entry, |(address, _)| address);
    address.contains('.')
        && address
            .chars()
            .all(|c| c.is_ascii_digit() || c == '.' || c == '*')
}

/// `*` matches any run of characters, `?` any one, every other character itself.
pub(super) fn glob(pattern: &str, text: &str) -> bool {
    let (pattern, text): (Vec<char>, Vec<char>) =
        (pattern.chars().collect(), text.chars().collect());
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        match pattern.get(p) {
            Some('*') => {
                star = Some((p, t));
                p += 1;
            }
            Some(&c) if c == '?' || c == text[t] => {
                p += 1;
                t += 1;
            }
            _ => match star {
                Some((star_p, star_t)) => {
                    p = star_p + 1;
                    t = star_t + 1;
                    star = Some((star_p, star_t + 1));
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|&c| c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs_and_short_cidrs() {
        assert!(glob("*.corp", "a.b.corp"));
        assert!(!glob("*.corp", "corp"));
        assert!(glob("10.*", "10.1.2.3"));
        assert!(glob("a*b*c", "aXXbYc"));
        assert!(!glob("a*b*c", "aXXbY"));
        assert!(glob("?.*", "a.b"));
        assert!(!glob("a?b", "ab"));
        assert_eq!(pad_v4("169.254/16"), "169.254.0.0/16");
        assert_eq!(pad_v4("10/8"), "10.0.0.0/8");
        assert!(in_network("169.254.9.9".parse().unwrap(), "169.254.0.0/16"));
        assert!(!in_network(
            "169.255.9.9".parse().unwrap(),
            "169.254.0.0/16"
        ));
        assert!(in_network("0.0.0.1".parse().unwrap(), "0.0.0.0/0"));
    }
}
