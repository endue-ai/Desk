//! Windows: a value named by the app identifier under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
//! whose command line Windows runs at login. The command line quotes the program, which a Windows
//! path cannot hold a `"` in, and quotes an argument as `CommandLineToArgvW` reads it back; both
//! halves are pure functions, tested on every OS. `RunKey` writes it with `windows-registry`, no
//! `unsafe`. Task Manager's switch for it (`StartupApproved`) is not read.

use std::iter::repeat_n;
use std::path::PathBuf;

use super::Registration;

/// The key, under `HKEY_CURRENT_USER`, whose values Windows runs at login.
pub const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// `"<program>" <args>`: the program always in quotes, an argument in quotes only when it is empty
/// or holds a space, tab, newline or `"`.
pub fn command_line(registration: &Registration) -> String {
    let mut line = format!("\"{}\"", registration.program.to_string_lossy());
    for arg in &registration.args {
        line.push(' ');
        if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '"']) {
            line.push_str(arg);
            continue;
        }
        line.push('"');
        let mut backslashes = 0;
        for c in arg.chars() {
            match c {
                '\\' => backslashes += 1,
                '"' => {
                    line.extend(repeat_n('\\', backslashes * 2 + 1));
                    line.push('"');
                    backslashes = 0;
                }
                _ => {
                    line.extend(repeat_n('\\', backslashes));
                    line.push(c);
                    backslashes = 0;
                }
            }
        }
        line.extend(repeat_n('\\', backslashes * 2));
        line.push('"');
    }
    line
}

/// A command line read back as `CommandLineToArgvW` does: the program up to its closing quote (or
/// the first space when it is not quoted), then the arguments. An empty line has an empty program.
pub fn parse(line: &str) -> Registration {
    let line = line.trim_start();
    let (program, rest) = match line.strip_prefix('"') {
        Some(quoted) => quoted.split_once('"').unwrap_or((quoted, "")),
        None => line.split_once([' ', '\t']).unwrap_or((line, "")),
    };
    Registration {
        program: PathBuf::from(program),
        args: split(rest),
    }
}

/// Arguments: `2n` backslashes and a quote are `n` backslashes and a quote that opens or closes,
/// `2n + 1` are `n` and a literal quote, `""` inside quotes is a literal quote, and other
/// backslashes are literal.
fn split(rest: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut arg: Option<String> = None;
    let mut quoted = false;
    let mut backslashes = 0;
    let mut chars = rest.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                backslashes += 1;
                continue;
            }
            '"' => {
                let word = arg.get_or_insert_default();
                word.extend(repeat_n('\\', backslashes / 2));
                if backslashes % 2 == 1 {
                    word.push('"');
                } else if quoted && chars.peek() == Some(&'"') {
                    chars.next();
                    word.push('"');
                } else {
                    quoted = !quoted;
                }
            }
            _ => {
                if backslashes > 0 {
                    arg.get_or_insert_default()
                        .extend(repeat_n('\\', backslashes));
                }
                if !quoted && (c == ' ' || c == '\t') {
                    args.extend(arg.take());
                } else {
                    arg.get_or_insert_default().push(c);
                }
            }
        }
        backslashes = 0;
    }
    if backslashes > 0 {
        arg.get_or_insert_default()
            .extend(repeat_n('\\', backslashes));
    }
    args.extend(arg);
    args
}

#[cfg(windows)]
pub use self::registry::RunKey;

#[cfg(windows)]
mod registry {
    use windows_registry::CURRENT_USER;

    use super::{RUN, command_line, parse};
    use crate::login::{LoginItems, Registration, io_error, text, unreadable};
    use crate::{Error, ErrorCode};

    /// `ERROR_FILE_NOT_FOUND` and `ERROR_PATH_NOT_FOUND` as HRESULTs.
    const NOT_FOUND: [u32; 2] = [0x8007_0002, 0x8007_0003];

    /// One value under a key of `HKEY_CURRENT_USER`.
    #[derive(Debug, Clone)]
    pub struct RunKey {
        key: String,
        value: String,
    }

    impl RunKey {
        /// The value `id` under `key` (a path under `HKEY_CURRENT_USER`); `register` makes the key.
        pub fn at(key: &str, id: &str) -> Self {
            Self {
                key: key.to_owned(),
                value: id.to_owned(),
            }
        }

        /// The value `id` under the Run key.
        pub fn user(id: &str) -> Self {
            Self::at(RUN, id)
        }

        /// `None` for a key or value that does not exist, `io_error` for any other failure.
        fn found<T>(&self, result: windows_registry::Result<T>) -> Result<Option<T>, Error> {
            match result {
                Ok(found) => Ok(Some(found)),
                Err(err) if NOT_FOUND.contains(&(err.code().0 as u32)) => Ok(None),
                Err(err) => Err(io_error(err, self.location())),
            }
        }
    }

    impl LoginItems for RunKey {
        fn name(&self) -> &'static str {
            "run-key"
        }

        fn location(&self) -> String {
            format!(r"HKCU\{}\{}", self.key, self.value)
        }

        fn registered(&self) -> Result<Option<Registration>, Error> {
            let Some(key) = self.found(CURRENT_USER.open(&self.key))? else {
                return Ok(None);
            };
            if self.found(key.get_type(&self.value))?.is_none() {
                return Ok(None);
            }
            let line = key.get_string(&self.value);
            Ok(Some(
                line.map_or_else(|_| unreadable(), |line| parse(&line)),
            ))
        }

        fn register(&self, registration: &Registration) -> Result<(), Error> {
            let (program, _) = text(registration)?;
            if program.contains('"') {
                return Err(Error::new(
                    ErrorCode::InvalidParams,
                    format!("{program:?} is not a Windows path"),
                ));
            }
            let key = CURRENT_USER.create(&self.key);
            let key = key.map_err(|err| io_error(err, self.location()))?;
            key.set_string(&self.value, command_line(registration))
                .map_err(|err| io_error(err, self.location()))
        }

        fn unregister(&self) -> Result<(), Error> {
            let key = CURRENT_USER.options().read().write().open(&self.key);
            let Some(key) = self.found(key)? else {
                return Ok(());
            };
            self.found(key.remove_value(&self.value)).map(|_| ())
        }
    }
}
