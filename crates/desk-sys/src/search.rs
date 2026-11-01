//! Read the OS index without crawling the disk or passing user text through a shell.
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const MAX_OUTPUT: u64 = 256 * 1024;

pub fn search(query: &str) -> io::Result<Vec<PathBuf>> {
    if query.trim().chars().count() < 2 || query.chars().count() > 256 || query.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Use 2–256 characters",
        ));
    }
    let bytes = output(index_command(query))?;
    Ok(String::from_utf8_lossy(&bytes)
        .split(['\0', '\n', '\r'])
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.exists())
        .take(40)
        .collect())
}

#[cfg(target_os = "macos")]
fn index_command(query: &str) -> Command {
    let literal = query
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('*', "\\*")
        .replace('?', "\\?");
    let mut cmd = Command::new("/usr/bin/mdfind");
    cmd.args([
        "-0",
        &format!(
            "(kMDItemFSName == \"*{literal}*\"cd) || (kMDItemTextContent == \"{literal}*\"cd)"
        ),
    ]);
    cmd
}

#[cfg(target_os = "windows")]
fn index_command(query: &str) -> Command {
    let mut cmd = Command::new("powershell.exe");
    // The query is data in an environment variable, never interpolated into PowerShell source.
    cmd.env("DESK_SEARCH_QUERY", query).args(["-NoProfile", "-NonInteractive", "-Command", r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$q = $env:DESK_SEARCH_QUERY.Replace("'", "''").Replace('[', '[[]').Replace('%', '[%]').Replace('_', '[_]')
$c = [Data.OleDb.OleDbConnection]::new('Provider=Search.CollatorDSO;Extended Properties="Application=Windows";')
$c.Open()
try {
  $cmd = $c.CreateCommand()
  $cmd.CommandText = "SELECT TOP 40 System.ItemPathDisplay FROM SystemIndex WHERE System.FileName LIKE '%$q%'"
  $r = $cmd.ExecuteReader()
  while ($r.Read()) { [Console]::WriteLine($r.GetString(0)) }
} finally { $c.Dispose() }
"#]);
    cmd
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn index_command(query: &str) -> Command {
    let mut cmd = Command::new("locate");
    cmd.args(["-0", "-i", "-l", "40", "--", query]);
    cmd
}

/// Hard bounds on both time and bytes, including an index service that stops answering.
fn output(mut command: Command) -> io::Result<Vec<u8>> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("No index output"))?;
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(MAX_OUTPUT)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = tx.send(result);
    });
    let result = rx.recv_timeout(Duration::from_secs(3));
    // The byte cap can stop the reader before the producer exits. Reap in every case.
    let status = child.try_wait()?;
    if status.is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
    if status.is_some_and(|s| !s.success() && s.code() != Some(1)) {
        return Err(io::Error::other("The OS search index is unavailable"));
    }
    result.map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "The OS search index timed out"))?
}

/// Only the core calls this, with a path from a recent index result owned by the caller.
pub fn open(path: &Path) -> io::Result<()> {
    if !path.is_absolute() || !path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "The result no longer exists",
        ));
    }
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut cmd = Command::new("powershell.exe");
        cmd.env("DESK_OPEN_PATH", path).args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Invoke-Item -LiteralPath $env:DESK_OPEN_PATH",
        ]);
        cmd
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = Command::new("xdg-open");
    #[cfg(not(target_os = "windows"))]
    cmd.arg(path);
    let mut child = cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn()?;
    // Reap without blocking the bridge while the default application runs.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_queries_never_start_an_index_process() {
        for q in [
            "a".to_owned(),
            "  ".to_owned(),
            "x".repeat(257),
            "bad\0query".to_owned(),
        ] {
            assert_eq!(search(&q).unwrap_err().kind(), io::ErrorKind::InvalidInput);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn spotlight_receives_a_single_escaped_expression_without_shell_expansion() {
        let cmd = index_command("quote\" OR * $(touch /tmp/never)");
        assert_eq!(cmd.get_program(), "/usr/bin/mdfind");
        let args: Vec<_> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], "-0");
        assert!(args[1].contains("quote\\\" OR \\* $(touch /tmp/never)"));
    }

    #[cfg(unix)]
    #[test]
    fn index_output_is_bounded_and_a_stuck_index_is_reaped() {
        let mut large = Command::new("/usr/bin/yes");
        large.arg("index-result");
        assert!(output(large).unwrap().len() <= MAX_OUTPUT as usize);
        let mut stuck = Command::new("/bin/sleep");
        stuck.arg("10");
        let start = std::time::Instant::now();
        assert_eq!(output(stuck).unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
