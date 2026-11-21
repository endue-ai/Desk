//! Connection values from a `postgresql://` URI: user, password, host, port, database, and the TLS
//! mode with its trusted certificate (`sslmode`, `sslrootcert`), as libpq reads them.

use std::fmt;

/// libpq's TLS modes, less `allow` (plain first, TLS only when the server insists).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

impl SslMode {
    pub fn parse(text: &str) -> Result<SslMode, String> {
        Ok(match text {
            "disable" => SslMode::Disable,
            "prefer" => SslMode::Prefer,
            "require" => SslMode::Require,
            "verify-ca" => SslMode::VerifyCa,
            "verify-full" => SslMode::VerifyFull,
            other => return Err(format!("sslmode {other} is not one the spike speaks")),
        })
    }
}

impl fmt::Display for SslMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            SslMode::Disable => "disable",
            SslMode::Prefer => "prefer",
            SslMode::Require => "require",
            SslMode::VerifyCa => "verify-ca",
            SslMode::VerifyFull => "verify-full",
        })
    }
}

#[derive(Clone)]
pub struct ConnInfo {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    pub sslmode: SslMode,
    /// The PEM of the certificate authorities to trust; the OS's store when absent.
    pub ca_pem: Option<Vec<u8>>,
}

impl fmt::Debug for ConnInfo {
    /// Never prints the password.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}@{}:{}/{} sslmode={}",
            self.user, self.host, self.port, self.database, self.sslmode
        )
    }
}

impl ConnInfo {
    /// Read the URI in the environment variable `name`.
    pub fn from_env(name: &str) -> Result<ConnInfo, String> {
        let uri = std::env::var(name).map_err(|_| format!("{name} is not set"))?;
        ConnInfo::parse(&uri)
    }

    pub fn parse(uri: &str) -> Result<ConnInfo, String> {
        let rest = uri
            .strip_prefix("postgresql://")
            .or_else(|| uri.strip_prefix("postgres://"))
            .ok_or("not a postgresql:// URI")?;
        let (main, query) = rest.split_once('?').unwrap_or((rest, ""));
        let (auth, place) = main.rsplit_once('@').ok_or("the URI names no user")?;
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (hostport, database) = place.split_once('/').unwrap_or((place, ""));
        let (host, port) = hostport.rsplit_once(':').unwrap_or((hostport, "5432"));
        let mut info = ConnInfo {
            host: decode(host),
            port: port.parse().map_err(|_| format!("port {port}"))?,
            user: decode(user),
            password: decode(password),
            database: decode(if database.is_empty() { user } else { database }),
            sslmode: SslMode::Prefer,
            ca_pem: None,
        };
        for pair in query.split('&').filter(|pair| !pair.is_empty()) {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            match key {
                "sslmode" => info.sslmode = SslMode::parse(&decode(value))?,
                "sslrootcert" => {
                    let path = decode(value);
                    info.ca_pem = Some(std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?);
                }
                _ => {}
            }
        }
        Ok(info)
    }
}

/// Percent-decoding, as URIs carry user names and passwords.
fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16)
        {
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
