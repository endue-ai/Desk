//! macOS: a per-user LaunchAgent, `<dir>/<id>.plist`, that launchd loads at the next login and runs
//! once (`RunAtLoad`) in the graphical session only (`LimitLoadToSessionType` `Aqua`). Written as
//! XML text, with no plist crate; reading back takes `ProgramArguments` and nothing else. Writing it
//! does not load it now, and removing it does not stop a desk that is running.
//!
//! Not `SMAppService.mainApp`: it cannot pass `BACKGROUND`, so a start at login could not be told
//! from a click. The file backend compiles on every OS, so every CI job tests the file it writes.

use std::path::{Path, PathBuf};

use super::{LoginItems, Registration, file, io_error, text, unreadable};
use crate::Error;

const HEADER: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
"#;

/// The LaunchAgent plist of one label.
#[derive(Debug, Clone)]
pub struct LaunchAgent {
    label: String,
    path: PathBuf,
}

impl LaunchAgent {
    /// The agent labelled `id` in `dir`, as `<dir>/<id>.plist`. `register` makes `dir` if needed.
    pub fn in_dir(dir: impl Into<PathBuf>, id: &str) -> Self {
        Self {
            label: id.to_owned(),
            path: dir.into().join(format!("{id}.plist")),
        }
    }

    /// The agent labelled `id` in `~/Library/LaunchAgents`; `io_error` when `HOME` is not set.
    pub fn user(id: &str) -> Result<Self, Error> {
        let home = std::env::var_os("HOME")
            .filter(|home| !home.is_empty())
            .ok_or_else(|| io_error("HOME is not set", "~/Library/LaunchAgents"))?;
        Ok(Self::in_dir(
            Path::new(&home).join("Library/LaunchAgents"),
            id,
        ))
    }

    /// The plist's path.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl LoginItems for LaunchAgent {
    fn name(&self) -> &'static str {
        "launch-agent"
    }

    fn location(&self) -> String {
        self.path.display().to_string()
    }

    fn registered(&self) -> Result<Option<Registration>, Error> {
        Ok(file::read(&self.path)?.map(|text| parse(&text).unwrap_or_else(unreadable)))
    }

    fn register(&self, registration: &Registration) -> Result<(), Error> {
        let (program, args) = text(registration)?;
        let mut plist = String::from(HEADER);
        entry(&mut plist, "Label", &string(&self.label));
        let mut array = String::from("<array>\n");
        for word in std::iter::once(program).chain(args.iter().map(String::as_str)) {
            array.push_str("\t\t");
            array.push_str(&string(word));
            array.push('\n');
        }
        array.push_str("\t</array>");
        entry(&mut plist, "ProgramArguments", &array);
        entry(&mut plist, "RunAtLoad", "<true/>");
        entry(&mut plist, "LimitLoadToSessionType", &string("Aqua"));
        plist.push_str("</dict>\n</plist>\n");
        file::write(&self.path, &plist)
    }

    fn unregister(&self) -> Result<(), Error> {
        file::remove(&self.path)
    }
}

fn entry(plist: &mut String, key: &str, value: &str) {
    plist.push_str(&format!("\t<key>{key}</key>\n\t{value}\n"));
}

/// `<string>` with `&`, `<` and `>` escaped.
fn string(value: &str) -> String {
    let escaped = value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    format!("<string>{escaped}</string>")
}

/// The `ProgramArguments` of a plist: program first. `None` when the key, its array of strings or
/// a program is missing.
fn parse(plist: &str) -> Option<Registration> {
    let (_, rest) = plist.split_once("<key>ProgramArguments</key>")?;
    let mut rest = rest.trim_start().strip_prefix("<array>")?;
    let mut words = Vec::new();
    loop {
        rest = rest.trim_start();
        if rest.starts_with("</array>") {
            break;
        }
        let (word, after) = rest.strip_prefix("<string>")?.split_once("</string>")?;
        words.push(unescape(word)?);
        rest = after;
    }
    let mut words = words.into_iter();
    let program = PathBuf::from(words.next()?);
    Some(Registration {
        program,
        args: words.collect(),
    })
}

/// XML text with its five named entities and character references undone; `None` for any other.
fn unescape(text: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let (entity, after) = rest[at + 1..].split_once(';')?;
        out.push(match entity {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            _ => {
                let code = match entity.strip_prefix("#x") {
                    Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                    None => entity.strip_prefix('#')?.parse().ok()?,
                };
                char::from_u32(code)?
            }
        });
        rest = after;
    }
    out.push_str(rest);
    Some(out)
}
