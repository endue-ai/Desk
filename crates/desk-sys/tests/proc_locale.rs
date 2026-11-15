//! desk-sys proc (feature `proc`): a PTY started without a locale gets a UTF-8 `LANG`, one with a
//! locale keeps it, and pipes are left alone (#323).
//!
//! Three generations of this test binary: the test starts a `pty-parent` with `std::process` and
//! `LANG`, `LC_ALL` and `LC_CTYPE` removed (or set as the test asks), so no test changes its own
//! environment; the parent spawns a `locale` child through `desk_sys::proc::spawn` and prints the
//! line it printed.
#![cfg(unix)]

use std::collections::BTreeMap;
use std::io::Write;
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use desk_sys::proc::{Event, PtySize, SpawnOptions, spawn};

const ROLE: &str = "DESK_SYS_TEST_CHILD";
/// Whether the parent spawns its child in a PTY (`1`) or in pipes.
const PTY: &str = "DESK_SYS_TEST_PTY";
/// `NAME=value` the parent adds to its child's `env`, if any.
const ADD: &str = "DESK_SYS_TEST_ADD";
const VARS: [&str; 3] = ["LANG", "LC_ALL", "LC_CTYPE"];
const WAIT: Duration = Duration::from_secs(30);

#[test]
fn child() {
    let Ok(role) = std::env::var(ROLE) else {
        return;
    };
    match role.as_str() {
        "locale" => {
            let seen: Vec<String> = VARS
                .iter()
                .map(|name| match std::env::var(name) {
                    Ok(value) => format!("{name}={value}"),
                    Err(_) => format!("{name}-"),
                })
                .collect();
            println!("locale:{}:end", seen.join("|"));
        }
        "pty-parent" => println!("seen:{}", spawn_locale_child()),
        other => panic!("unknown role {other}"),
    }
    std::io::stdout().flush().unwrap();
    std::process::exit(0);
}

fn self_args() -> Vec<String> {
    ["--exact", "child", "--nocapture", "--test-threads=1"]
        .map(String::from)
        .to_vec()
}

/// The `locale` line of a child spawned through desk-sys, as this process's environment says.
fn spawn_locale_child() -> String {
    let mut env = BTreeMap::from([(ROLE.to_owned(), "locale".to_owned())]);
    if let Some((name, value)) = std::env::var(ADD)
        .ok()
        .as_deref()
        .and_then(|a| a.split_once('='))
    {
        env.insert(name.to_owned(), value.to_owned());
    }
    let options = SpawnOptions {
        program: std::env::current_exe().unwrap().display().to_string(),
        args: self_args(),
        env,
        pty: (std::env::var(PTY).as_deref() == Ok("1")).then_some(PtySize {
            cols: 200,
            rows: 24,
        }),
        ..SpawnOptions::default()
    };
    let (sender, events) = mpsc::channel();
    let _process = spawn(&options, move |event| {
        let _ = sender.send(event);
    })
    .unwrap();
    let deadline = Instant::now() + WAIT;
    let mut text = String::new();
    while let Ok(event) = events.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        match event {
            Event::Output { data, .. } => text.push_str(&String::from_utf8_lossy(&data)),
            Event::Exit(_) => break,
        }
    }
    let start = text.find("locale:").expect("no locale line");
    let end = text[start..]
        .find(":end")
        .expect("no end of the locale line");
    text[start + "locale:".len()..start + end].to_owned()
}

/// What a child of a desk with `inherited` (none of the three otherwise) saw: name → value, absent
/// when unset.
fn seen(inherited: &[(&str, &str)], pty: bool, add: Option<&str>) -> BTreeMap<String, String> {
    let mut parent = Command::new(std::env::current_exe().unwrap());
    parent.args(self_args()).env(ROLE, "pty-parent");
    for name in VARS {
        parent.env_remove(name);
    }
    for (name, value) in inherited {
        parent.env(name, value);
    }
    parent.env(PTY, if pty { "1" } else { "0" });
    if let Some(add) = add {
        parent.env(ADD, add);
    }
    let output = parent.output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find_map(|line| line.split_once("seen:").map(|(_, seen)| seen))
        .unwrap_or_else(|| {
            panic!(
                "no seen line: {stdout} {}",
                String::from_utf8_lossy(&output.stderr)
            )
        });
    line.split('|')
        .filter_map(|pair| pair.split_once('='))
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
        .collect()
}

fn assert_utf8_lang(seen: &BTreeMap<String, String>) {
    let lang = seen
        .get("LANG")
        .unwrap_or_else(|| panic!("no LANG: {seen:?}"));
    assert!(lang.ends_with(".UTF-8"), "{seen:?}");
    if cfg!(target_os = "macos") {
        assert!(
            std::path::Path::new("/usr/share/locale")
                .join(lang)
                .is_dir(),
            "{lang} is not a macOS locale"
        );
    } else {
        assert_eq!(lang, "C.UTF-8");
    }
    assert!(
        !seen.contains_key("LC_ALL") && !seen.contains_key("LC_CTYPE"),
        "{seen:?}"
    );
}

#[test]
fn pty_without_a_locale_gets_a_utf8_lang() {
    assert_utf8_lang(&seen(&[], true, None));
}

#[test]
fn pty_keeps_an_inherited_locale() {
    let only_ctype = seen(&[("LC_CTYPE", "en_US.UTF-8")], true, None);
    assert_eq!(
        only_ctype.get("LC_CTYPE").map(String::as_str),
        Some("en_US.UTF-8")
    );
    assert!(!only_ctype.contains_key("LANG"), "{only_ctype:?}");

    let lang = seen(&[("LANG", "fr_FR.UTF-8")], true, None);
    assert_eq!(lang.get("LANG").map(String::as_str), Some("fr_FR.UTF-8"));
}

#[test]
fn pty_keeps_a_locale_given_in_env() {
    let given = seen(&[], true, Some("LC_ALL=C"));
    assert_eq!(given.get("LC_ALL").map(String::as_str), Some("C"));
    assert!(!given.contains_key("LANG"), "{given:?}");
}

#[test]
fn pty_ignores_an_empty_locale_variable() {
    assert_utf8_lang(&seen(&[("LANG", "")], true, None));
}

#[test]
fn pipes_get_no_locale() {
    let piped = seen(&[], false, None);
    assert!(!piped.contains_key("LANG"), "{piped:?}");
}
