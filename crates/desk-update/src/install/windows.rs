//! Windows: the installer cannot replace the files of a running desk, so it runs once the desk has
//! quit. The update keeps the NSIS `-setup.exe` or the `.msi` in the updates folder, and the desk's
//! restart is a hidden PowerShell that waits for the desk's process to end, runs the installer
//! silently (NSIS `/S` into the desk's own folder, per user; `msiexec /qn` with the elevation prompt
//! an MSI under Program Files needs), then starts the desk, updated or not. The script goes as
//! `-EncodedCommand`, so no path is ever parsed as part of a command line.

use std::path::{Path, PathBuf};

use base64::Engine as _;

use super::Relaunch;
use super::file::{package_path, write};
use crate::status::Chosen;

/// Which Windows installer an update brings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Nsis,
    Msi,
}

/// Keep the installer in `bytes` for the desk at `exe`; answers the script that runs it once the
/// desk has quit.
pub fn stage(
    exe: &Path,
    kind: Kind,
    chosen: &Chosen,
    bytes: &[u8],
    scratch: &Path,
) -> Result<Relaunch, String> {
    let (magic, ext): (&[u8], _) = match kind {
        Kind::Nsis => (b"MZ", "exe"),
        Kind::Msi => (&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], "msi"),
    };
    if !bytes.starts_with(magic) {
        let what = if kind == Kind::Nsis {
            "an NSIS installer"
        } else {
            "an MSI"
        };
        return Err(format!("the update for {} is not {what}", chosen.target));
    }
    let installer = package_path(scratch, chosen, ext);
    write(&installer, bytes)?;
    let script = script(kind, &installer, exe, std::process::id());
    Ok(Relaunch::new(powershell(), encoded(&script)))
}

/// The script: wait for process `pid`, run `installer` silently for the desk at `exe`, start `exe`.
pub fn script(kind: Kind, installer: &Path, exe: &Path, pid: u32) -> String {
    // The folder by the text, so the script reads the same whichever OS writes it.
    let exe_text = exe.display().to_string();
    let dir = exe_text
        .rfind(['\\', '/'])
        .map_or(exe_text.as_str(), |at| &exe_text[..at]);
    let run = match kind {
        // NSIS reads /D= to the end of the line, unquoted: it must be last.
        Kind::Nsis => format!(
            "Start-Process -FilePath {} -ArgumentList '/S',{} -Wait",
            quote(installer.display()),
            quote(format!("/D={dir}"))
        ),
        Kind::Msi => format!(
            "Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i',{},'/qn','/norestart' -Verb RunAs -Wait",
            quote(format!("\"{}\"", installer.display()))
        ),
    };
    [
        "$ErrorActionPreference = 'Continue'".to_owned(),
        format!("Wait-Process -Id {pid} -ErrorAction SilentlyContinue"),
        run,
        format!("Start-Process -FilePath {}", quote(exe_text)),
    ]
    .join("\n")
}

/// `text` as a PowerShell string that takes nothing from its contents: single quotes, doubled inside.
pub fn quote(text: impl std::fmt::Display) -> String {
    format!("'{}'", text.to_string().replace('\'', "''"))
}

/// PowerShell's arguments for `script`: hidden, no profile, the script in UTF-16LE base64.
pub fn encoded(script: &str) -> Vec<String> {
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let script = base64::engine::general_purpose::STANDARD.encode(utf16);
    [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
    ]
    .into_iter()
    .map(str::to_owned)
    .chain([script])
    .collect()
}

/// Windows PowerShell, from the system folder rather than whatever `PATH` finds first.
fn powershell() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join(r"System32\WindowsPowerShell\v1.0\powershell.exe"))
        .unwrap_or_else(|| PathBuf::from("powershell.exe"))
}

#[cfg(test)]
mod tests {
    use super::{Kind, encoded, quote, script};
    use base64::Engine as _;
    use std::path::Path;

    #[test]
    fn the_script_waits_installs_silently_and_starts_the_desk() {
        let exe = Path::new(r"C:\Users\o'neil\AppData\Local\endue Desk\endue-desk-cef.exe");
        let setup =
            Path::new(r"C:\Users\o'neil\AppData\Roaming\ai.endue.desk\updates\0.6.0\install.exe");
        let nsis = script(Kind::Nsis, setup, exe, 4242);
        let lines: Vec<&str> = nsis.lines().collect();
        assert_eq!(
            lines[1],
            "Wait-Process -Id 4242 -ErrorAction SilentlyContinue"
        );
        assert_eq!(
            lines[2],
            r"Start-Process -FilePath 'C:\Users\o''neil\AppData\Roaming\ai.endue.desk\updates\0.6.0\install.exe' -ArgumentList '/S','/D=C:\Users\o''neil\AppData\Local\endue Desk' -Wait"
        );
        assert_eq!(
            lines[3],
            r"Start-Process -FilePath 'C:\Users\o''neil\AppData\Local\endue Desk\endue-desk-cef.exe'"
        );
        let msi = script(Kind::Msi, Path::new(r"C:\u\install.msi"), exe, 7);
        assert!(msi.contains(
            r#"-FilePath 'msiexec.exe' -ArgumentList '/i','"C:\u\install.msi"','/qn','/norestart' -Verb RunAs -Wait"#
        ));
    }

    #[test]
    fn the_script_goes_as_utf16_base64() {
        let args = encoded("Write-Output 'ü'");
        assert_eq!(
            args[..5],
            [
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-EncodedCommand"
            ]
        );
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&args[5])
            .unwrap();
        let units: Vec<u16> = bytes
            .chunks(2)
            .map(|p| u16::from_le_bytes([p[0], p[1]]))
            .collect();
        assert_eq!(String::from_utf16(&units).unwrap(), "Write-Output 'ü'");
        assert_eq!(quote("it's"), "'it''s'");
    }
}
