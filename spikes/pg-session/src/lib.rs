//! Throwaway spike for #439. `session` and `query` speak PostgreSQL's protocol 3.0 with the messages
//! and SCRAM of `postgres-protocol`; each check in `src/bin/` measures one thing the ADR quotes.

pub mod conninfo;
pub mod query;
pub mod session;
pub mod tls;

use std::fmt::Display;
use std::process::ExitCode;

pub use conninfo::{ConnInfo, SslMode};
pub use session::{Error, Session};

/// The URI of the plain server the checks use (`SPIKE_PG_URI`).
pub fn plain() -> ConnInfo {
    ConnInfo::from_env("SPIKE_PG_URI").unwrap_or_else(|e| panic!("{e}"))
}

pub fn title(name: &str) {
    println!("== {name}");
}

pub fn line(key: &str, value: impl Display) {
    println!("   {key}: {value}");
}

/// The check's verdict line, and its exit code.
pub fn verdict(failures: &[String]) -> ExitCode {
    if failures.is_empty() {
        println!("   PASS");
        ExitCode::SUCCESS
    } else {
        for failure in failures {
            println!("   FAIL {failure}");
        }
        ExitCode::FAILURE
    }
}

/// Record a failure when `ok` is false.
pub fn expect(failures: &mut Vec<String>, ok: bool, what: impl Into<String>) {
    if !ok {
        failures.push(what.into());
    }
}

pub fn mib(bytes: u64) -> String {
    format!("{:.1} MiB", bytes as f64 / (1024.0 * 1024.0))
}

/// The process's peak resident memory so far.
pub fn peak_rss() -> u64 {
    // SAFETY: getrusage fills the struct it is given.
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) };
    let value = usage.ru_maxrss as u64;
    if cfg!(target_os = "macos") {
        value
    } else {
        value * 1024
    }
}

/// A process's resident memory now: this one with `std::process::id()`.
pub fn rss_of(pid: u32) -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_taskinfo>() as i32;
        // SAFETY: proc_pidinfo writes at most `size` bytes into `info`.
        let got = unsafe {
            libc::proc_pidinfo(
                pid as i32,
                libc::PROC_PIDTASKINFO,
                0,
                (&raw mut info).cast(),
                size,
            )
        };
        if got == size {
            info.pti_resident_size
        } else {
            0
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::fs::read_to_string(format!("/proc/{pid}/statm"))
            .ok()
            .and_then(|s| {
                s.split_whitespace()
                    .nth(1)
                    .and_then(|p| p.parse::<u64>().ok())
            })
            .map_or(0, |pages| pages * 4096)
    }
}
