//! Linux: an XDG autostart entry, `<dir>/<id>.desktop`, that the desktop session starts at login.
//! The entry holds `Type=Application`, `Name=endue Desk`, the `Exec` line and
//! `X-GNOME-Autostart-enabled=true`, and nothing else. `Exec` quotes as the Desktop Entry spec says:
//! the program always, an argument when it holds a reserved character; inside quotes `"`, `` ` ``,
//! `$` and `\` take a backslash, `%` is doubled (field codes), and then the value's own escaping
//! doubles every backslash. Reading back undoes both and takes the program and arguments from
//! `Exec`; a person turning the entry off in their desktop's settings is not read.
//!
//! The file backend compiles on every OS, so every CI job tests the file it writes.

use std::path::{Path, PathBuf};

use super::{LoginItems, Registration, file, io_error, text, unreadable};
use crate::Error;

/// The entry's `Name`.
const NAME: &str = "endue Desk";

/// The characters that make the spec require an argument to be quoted.
const RESERVED: &[char] = &[
    ' ', '\t', '\n', '"', '\'', '\\', '>', '<', '~', '|', '&', ';', '$', '*', '?', '#', '`', '=',
    '(', ')',
];

/// The autostart entry of one desktop file id.
#[derive(Debug, Clone)]
pub struct XdgAutostart {
    path: PathBuf,
}

impl XdgAutostart {
    /// The entry `id` in `dir`, as `<dir>/<id>.desktop`. `register` makes `dir` if needed.
    pub fn in_dir(dir: impl Into<PathBuf>, id: &str) -> Self {
        Self {
            path: dir.into().join(format!("{id}.desktop")),
        }
    }

    /// The entry `id` in `$XDG_CONFIG_HOME/autostart`, or `~/.config/autostart` when that is unset
    /// or not absolute (as the Base Directory spec says); `io_error` when neither is known.
    pub fn user(id: &str) -> Result<Self, Error> {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|config| config.is_absolute())
            .or_else(|| {
                std::env::var_os("HOME")
                    .filter(|home| !home.is_empty())
                    .map(|home| Path::new(&home).join(".config"))
            })
            .ok_or_else(|| io_error("neither XDG_CONFIG_HOME nor HOME is set", "autostart"))?;
        Ok(Self::in_dir(config.join("autostart"), id))
    }

    /// The desktop file's path.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl LoginItems for XdgAutostart {
    fn name(&self) -> &'static str {
        "xdg-autostart"
    }

    fn location(&self) -> String {
        self.path.display().to_string()
    }

    fn registered(&self) -> Result<Option<Registration>, Error> {
        Ok(file::read(&self.path)?.map(|text| parse(&text).unwrap_or_else(unreadable)))
    }

    fn register(&self, registration: &Registration) -> Result<(), Error> {
        let (program, args) = text(registration)?;
        let mut words = vec![quote(program)];
        words.extend(args.iter().map(|arg| {
            if arg.is_empty() || arg.contains(RESERVED) {
                quote(arg)
            } else {
                arg.replace('%', "%%")
            }
        }));
        let exec = words.join(" ").replace('\\', "\\\\");
        let entry = format!(
            "[Desktop Entry]\nType=Application\nName={NAME}\nExec={exec}\n\
             X-GNOME-Autostart-enabled=true\n"
        );
        file::write(&self.path, &entry)
    }

    fn unregister(&self) -> Result<(), Error> {
        file::remove(&self.path)
    }
}

/// One argument in double quotes, with the spec's escapes and `%` doubled.
fn quote(word: &str) -> String {
    let mut quoted = String::with_capacity(word.len() + 2);
    quoted.push('"');
    for c in word.chars() {
        match c {
            '"' | '`' | '$' | '\\' => quoted.extend(['\\', c]),
            '%' => quoted.push_str("%%"),
            _ => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

/// The program and arguments of the `[Desktop Entry]` group's `Exec`. `None` without one.
fn parse(entry: &str) -> Option<Registration> {
    let mut group = "";
    let mut exec = None;
    for line in entry.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            group = line;
        } else if group == "[Desktop Entry]"
            && let Some((key, value)) = line.split_once('=')
            && key.trim_end() == "Exec"
        {
            exec = Some(value.trim_start());
        }
    }
    let mut words = split(&unescape(exec?)).into_iter();
    let program = PathBuf::from(words.next()?);
    Some(Registration {
        program,
        args: words.collect(),
    })
}

/// A string value's escapes undone: `\s`, `\n`, `\t`, `\r` and `\\`; any other backslash stays.
fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('s') => out.push(' '),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => out.extend(['\\', other]),
            None => out.push('\\'),
        }
    }
    out
}

/// An unescaped `Exec` split into arguments: quotes undone and `%%` back to `%`.
fn split(exec: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word: Option<String> = None;
    let mut quoted = false;
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match (quoted, c) {
            (true, '"') => quoted = false,
            (true, '\\') => match chars.next() {
                Some(next @ ('"' | '`' | '$' | '\\')) => word.get_or_insert_default().push(next),
                Some(next) => word.get_or_insert_default().extend(['\\', next]),
                None => word.get_or_insert_default().push('\\'),
            },
            (false, ' ' | '\t') => words.extend(word.take()),
            (false, '"') => {
                quoted = true;
                word.get_or_insert_default();
            }
            _ => word.get_or_insert_default().push(c),
        }
    }
    words.extend(word);
    words
        .into_iter()
        .map(|word| word.replace("%%", "%"))
        .collect()
}
