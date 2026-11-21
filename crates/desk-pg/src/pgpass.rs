//! The person's password file, read as libpq reads it: `PGPASSFILE`, else `~/.pgpass`
//! (`%APPDATA%\postgresql\pgpass.conf` on Windows). Each line is
//! `hostname:port:database:username:password`; `*` matches anything, `\:` and `\\` escape, `#`
//! starts a comment and the first line that matches answers. A file others can read is ignored.

use std::fs;
use std::path::{Path, PathBuf};

/// Where the password file is for a person whose home is `home`.
pub fn default_file(home: &Path) -> PathBuf {
    if let Some(file) = std::env::var_os("PGPASSFILE").filter(|f| !f.is_empty()) {
        return PathBuf::from(file);
    }
    if cfg!(windows)
        && let Some(appdata) = std::env::var_os("APPDATA")
    {
        return PathBuf::from(appdata)
            .join("postgresql")
            .join("pgpass.conf");
    }
    home.join(".pgpass")
}

/// The password `file` holds for the connection, if a line matches and the file is private.
pub fn lookup(file: &Path, host: &str, port: u16, database: &str, user: &str) -> Option<String> {
    if !private(file) {
        return None;
    }
    let text = fs::read_to_string(file).ok()?;
    let port = port.to_string();
    let wanted = [host, port.as_str(), database, user];
    text.lines().find_map(|line| {
        let fields = fields(line)?;
        let matches = fields[..4]
            .iter()
            .zip(wanted)
            .all(|(field, value)| field == "*" || field == value);
        matches.then(|| fields[4].clone())
    })
}

/// A line's five fields, unescaped; none for a comment, a blank line or one with fewer fields.
fn fields(line: &str) -> Option<[String; 5]> {
    let line = line.strip_suffix('\r').unwrap_or(line);
    if line.starts_with('#') || line.trim().is_empty() {
        return None;
    }
    let mut out: Vec<String> = vec![String::new()];
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(next) = chars.next() {
                    out.last_mut()?.push(next);
                }
            }
            // The password is the rest of the line, colons and all.
            ':' if out.len() < 5 => out.push(String::new()),
            other => out.last_mut()?.push(other),
        }
    }
    out.try_into().ok()
}

/// A regular file only its owner can read or write, as libpq requires on Unix.
#[cfg(unix)]
fn private(file: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(file).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o077 == 0)
}

#[cfg(not(unix))]
fn private(file: &Path) -> bool {
    fs::metadata(file).is_ok_and(|m| m.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, text: &str, mode: u32) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("desk-pg-pgpass-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        }
        let _ = mode;
        path
    }

    #[test]
    fn the_first_matching_line_answers() {
        let path = file(
            "first",
            "# a comment\n\ndb.example.com:5432:app:ada:first\n*:*:*:ada:second\n",
            0o600,
        );
        let at = |host, port, db| lookup(&path, host, port, db, "ada");
        assert_eq!(at("db.example.com", 5432, "app"), Some("first".to_owned()));
        assert_eq!(at("db.example.com", 5433, "app"), Some("second".to_owned()));
        assert_eq!(at("other", 5432, "app"), Some("second".to_owned()));
        assert_eq!(lookup(&path, "other", 5432, "app", "grace"), None);
    }

    #[test]
    fn escapes_and_colons_in_the_password() {
        let path = file("escapes", "my\\:host:*:*:ada:pa\\\\ss:word\r\n", 0o600);
        assert_eq!(
            lookup(&path, "my:host", 5432, "app", "ada"),
            Some("pa\\ss:word".to_owned())
        );
    }

    #[test]
    fn a_short_line_matches_nothing() {
        let path = file("short", "db.example.com:5432:app\n", 0o600);
        assert_eq!(lookup(&path, "db.example.com", 5432, "app", "ada"), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_others_can_read_is_ignored() {
        let path = file("open", "*:*:*:*:secret\n", 0o644);
        assert_eq!(lookup(&path, "h", 5432, "d", "u"), None);
    }

    #[test]
    fn a_missing_file_has_no_password() {
        let path = std::env::temp_dir().join("desk-pg-no-such-pgpass");
        assert_eq!(lookup(&path, "h", 5432, "d", "u"), None);
    }
}
