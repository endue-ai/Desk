//! One desk per data folder: the first start claims it, a second hands its arguments over and quits,
//! a stranger without the token is refused, and nothing a desk leaves behind blocks the next one.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use super::{Claim, Handoff, INFO_FILE, Info, LOCK_FILE, claim, claim_within};

fn folder(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("desk-instance-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn start(args: &[&str]) -> Handoff {
    Handoff {
        args: args.iter().map(|a| (*a).to_owned()).collect(),
        cwd: "/Users/person".to_owned(),
    }
}

#[test]
fn a_second_start_hands_its_arguments_to_the_first_and_quits() {
    let dir = folder("handoff");
    let (heard, hear) = mpsc::channel();
    let first = claim(&dir, &start(&["endue-desk"]), move |h| {
        let _ = heard.send(h);
    })
    .unwrap();
    let Claim::First(instance) = first else {
        panic!("the first start is the desk");
    };
    let second = start(&["endue-desk", "/Docs/한 글.md", "--flag"]);
    let outcome = claim(&dir, &second, |_| panic!("a second start never listens")).unwrap();
    assert!(matches!(outcome, Claim::HandedOff));
    assert_eq!(hear.recv_timeout(Duration::from_secs(5)).unwrap(), second);
    drop(instance);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_stranger_without_the_token_is_refused() {
    let dir = folder("token");
    let (heard, hear) = mpsc::channel::<Handoff>();
    let Claim::First(instance) = claim(&dir, &start(&["desk"]), move |h| {
        let _ = heard.send(h);
    })
    .unwrap() else {
        panic!("the first start is the desk");
    };
    let info: Info = serde_json::from_slice(&std::fs::read(dir.join(INFO_FILE)).unwrap()).unwrap();
    assert_eq!(info.token.len(), 32, "128 random bits as hex");
    let stream = TcpStream::connect(("127.0.0.1", info.port)).unwrap();
    (&stream)
        .write_all(b"{\"token\":\"guess\",\"args\":[\"x\",\"/etc/passwd\"],\"cwd\":\"/\"}\n")
        .unwrap();
    let mut answer = String::new();
    BufReader::new(&stream).read_line(&mut answer).unwrap();
    assert_eq!(answer.trim(), "refused");
    assert!(hear.recv_timeout(Duration::from_millis(300)).is_err());
    drop(instance);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn what_a_desk_leaves_behind_never_blocks_the_next_start() {
    let dir = folder("stale");
    std::fs::create_dir_all(&dir).unwrap();
    // A desk that crashed: its files are there, its lock and its port are not.
    std::fs::write(dir.join(LOCK_FILE), b"").unwrap();
    std::fs::write(dir.join(INFO_FILE), br#"{"port":1,"token":"00"}"#).unwrap();
    let Claim::First(instance) = claim(&dir, &start(&["desk"]), |_| {}).unwrap() else {
        panic!("a lock nobody holds is free");
    };
    // A desk that quit: the next start claims the folder again.
    drop(instance);
    assert!(!dir.join(INFO_FILE).exists(), "quitting removes the port");
    let again = claim(&dir, &start(&["desk"]), |_| {}).unwrap();
    assert!(matches!(again, Claim::First(_)));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_desk_that_holds_the_lock_but_never_answers_is_an_error_not_a_second_desk() {
    let dir = folder("silent");
    std::fs::create_dir_all(&dir).unwrap();
    let held = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOCK_FILE))
        .unwrap();
    held.lock().unwrap();
    let outcome = claim_within(&dir, &start(&["desk"]), |_| {}, Duration::from_millis(300));
    let why = outcome.err().expect("no desk answered").to_string();
    assert!(why.contains("did not answer"), "{why}");
    drop(held);
    let _ = std::fs::remove_dir_all(dir);
}
