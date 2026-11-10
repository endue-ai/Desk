//! Windows: the installer cannot replace the files of a running desk, so it runs once the desk has
//! quit. The update keeps the NSIS `-setup.exe` or the `.msi` in the updates folder, and the desk's
//! restart is a hidden PowerShell that waits for the desk's process to end, runs the installer
//! silently, then starts the desk, updated or not. NSIS runs `/S` into the desk's own folder, per
//! user, and through UAC when the person may not write that folder (#99); `msiexec /qn` always runs
//! through UAC, which an MSI under Program Files needs. When UAC was declined or the installer
//! failed, the script leaves a note beside the installer, and the desk that starts says so once
//! (`last_attempt`, ADR 0163). The script goes as `-EncodedCommand`, so no path is ever parsed as
//! part of a command line.

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;

use super::Relaunch;
use super::elevate::declined;
use super::file::{package_path, write};
use crate::status::Chosen;

/// Which Windows installer an update brings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Nsis,
    Msi,
}

/// What the script runs: `installer` of `kind` for the desk at `exe` once process `pid` has ended,
/// through UAC when `elevated`; it leaves its note at `outcome`.
pub struct Run<'a> {
    pub kind: Kind,
    pub installer: &'a Path,
    pub exe: &'a Path,
    pub pid: u32,
    pub elevated: bool,
    pub outcome: &'a Path,
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
    let outcome = outcome_path(scratch, chosen);
    let _ = fs::remove_file(&outcome);
    let elevated = kind == Kind::Msi || !writable(exe.parent().unwrap_or(exe));
    let script = script(&Run {
        kind,
        installer: &installer,
        exe,
        pid: std::process::id(),
        elevated,
        outcome: &outcome,
    });
    Ok(Relaunch::new(powershell(), encoded(&script)))
}

/// Whether this user may write in `dir`: a file made there and removed. Only a refusal says no.
pub fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".desk-update-probe-{}", std::process::id()));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(e) => e.kind() != std::io::ErrorKind::PermissionDenied,
    }
}

/// The script: wait for the desk, run the installer silently, note what went wrong, start the desk.
pub fn script(run: &Run) -> String {
    // The folder by the text, so the script reads the same whichever OS writes it.
    let exe_text = run.exe.display().to_string();
    let dir = exe_text
        .rfind(['\\', '/'])
        .map_or(exe_text.as_str(), |at| &exe_text[..at]);
    let (program, args) = match run.kind {
        // NSIS reads /D= to the end of the line, unquoted: it must be last.
        Kind::Nsis => (
            quote(run.installer.display()),
            format!("'/S',{}", quote(format!("/D={dir}"))),
        ),
        Kind::Msi => (
            "'msiexec.exe'".to_owned(),
            format!(
                "'/i',{},'/qn','/norestart'",
                quote(format!("\"{}\"", run.installer.display()))
            ),
        ),
    };
    let verb = if run.elevated { " -Verb RunAs" } else { "" };
    let note = |value: &str| {
        let outcome = quote(run.outcome.display());
        format!("Set-Content -LiteralPath {outcome} -Encoding UTF8 -Value {value}")
    };
    [
        "$ErrorActionPreference = 'Continue'".to_owned(),
        format!("Wait-Process -Id {} -ErrorAction SilentlyContinue", run.pid),
        "try {".to_owned(),
        format!(
            "$run = Start-Process -FilePath {program} -ArgumentList {args}{verb} -Wait -PassThru -ErrorAction Stop"
        ),
        "if ($null -ne $run.ExitCode -and $run.ExitCode -notin 0, 3010) {".to_owned(),
        note("\"failed $($run.ExitCode)\""),
        "}".to_owned(),
        "} catch {".to_owned(),
        // ERROR_CANCELLED: the person said no to UAC.
        "$code = $_.Exception.NativeErrorCode".to_owned(),
        "if ($null -eq $code) { $code = $_.Exception.InnerException.NativeErrorCode }".to_owned(),
        "if ($code -eq 1223) { $said = 'declined' } else { $said = 'not-run ' + $_.Exception.Message }"
            .to_owned(),
        note("$said"),
        "}".to_owned(),
        format!("Start-Process -FilePath {}", quote(&exe_text)),
    ]
    .join("\n")
}

/// Where the script leaves its note: `<scratch>/<version>/install.outcome`.
pub fn outcome_path(scratch: &Path, chosen: &Chosen) -> PathBuf {
    package_path(scratch, chosen, "outcome")
}

/// The note the script left for `chosen`, in words, once: the note goes as it is read.
pub fn last_attempt(scratch: &Path, chosen: &Chosen) -> Option<String> {
    let path = outcome_path(scratch, chosen);
    let text = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    let text = text.trim_start_matches('\u{feff}').trim();
    let (word, rest) = text.split_once(' ').unwrap_or((text, ""));
    Some(match word {
        "declined" => declined("run the installer"),
        "failed" => format!("the installer exited {rest}; the update stays ready"),
        _ => format!("the installer did not run ({rest}); the update stays ready"),
    })
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
    use super::{Kind, Run, encoded, quote, script};
    use base64::Engine as _;
    use std::path::Path;

    fn run<'a>(kind: Kind, installer: &'a Path, exe: &'a Path, elevated: bool) -> Run<'a> {
        Run {
            kind,
            installer,
            exe,
            pid: 4242,
            elevated,
            outcome: Path::new(
                r"C:\Users\o'neil\AppData\Roaming\ai.endue.desk\updates\0.6.0\install.outcome",
            ),
        }
    }

    #[test]
    fn the_script_waits_installs_silently_and_starts_the_desk() {
        let exe = Path::new(r"C:\Users\o'neil\AppData\Local\endue Desk\endue-desk.exe");
        let setup =
            Path::new(r"C:\Users\o'neil\AppData\Roaming\ai.endue.desk\updates\0.6.0\install.exe");
        let nsis = script(&run(Kind::Nsis, setup, exe, false));
        let lines: Vec<&str> = nsis.lines().collect();
        assert_eq!(
            lines[1],
            "Wait-Process -Id 4242 -ErrorAction SilentlyContinue"
        );
        assert_eq!(
            lines[3],
            r"$run = Start-Process -FilePath 'C:\Users\o''neil\AppData\Roaming\ai.endue.desk\updates\0.6.0\install.exe' -ArgumentList '/S','/D=C:\Users\o''neil\AppData\Local\endue Desk' -Wait -PassThru -ErrorAction Stop"
        );
        assert_eq!(
            lines.last().unwrap(),
            &r"Start-Process -FilePath 'C:\Users\o''neil\AppData\Local\endue Desk\endue-desk.exe'"
        );
        let msi = script(&run(Kind::Msi, Path::new(r"C:\u\install.msi"), exe, true));
        assert!(msi.contains(
            r#"-FilePath 'msiexec.exe' -ArgumentList '/i','"C:\u\install.msi"','/qn','/norestart' -Verb RunAs -Wait -PassThru -ErrorAction Stop"#
        ));
    }

    /// A folder the person may not write: NSIS asks UAC once, and a no or a failed installer leaves
    /// a note for the desk that starts next.
    #[test]
    fn an_elevated_installer_notes_a_declined_prompt_or_a_failure() {
        let exe = Path::new(r"C:\Program Files\endue Desk\endue-desk.exe");
        let nsis = script(&run(Kind::Nsis, Path::new(r"C:\u\install.exe"), exe, true));
        assert!(nsis.contains(
            r"-ArgumentList '/S','/D=C:\Program Files\endue Desk' -Verb RunAs -Wait -PassThru"
        ));
        let note = r"Set-Content -LiteralPath 'C:\Users\o''neil\AppData\Roaming\ai.endue.desk\updates\0.6.0\install.outcome' -Encoding UTF8";
        assert!(
            nsis.contains(&format!("{note} -Value \"failed $($run.ExitCode)\"")),
            "{nsis}"
        );
        assert!(
            nsis.contains("if ($code -eq 1223) { $said = 'declined' }"),
            "{nsis}"
        );
        assert!(nsis.contains(&format!("{note} -Value $said")), "{nsis}");
        // The desk starts again whatever happened: the last line runs after the try.
        let tail: Vec<&str> = nsis.lines().rev().take(2).collect();
        assert_eq!(tail[1], "}");
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
