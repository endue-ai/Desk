//! The HTTPS transport against a local origin on 127.0.0.1 (plain HTTP, allowed only when asked):
//! documents whole, artifacts with progress, refusals that name the status, and no `http://` unless
//! the desk allows it.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use desk_update::Transport;
use desk_update::https::{Https, USER_AGENT};

/// A one-file-per-path origin; answers 404 for anything else. Records each request's head.
fn origin(files: Vec<(&'static str, Vec<u8>)>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let heads = Arc::new(Mutex::new(Vec::new()));
    let seen = heads.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                head.push_str(&line);
            }
            seen.lock().unwrap().push(head.clone());
            let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
            let mut stream = stream;
            match files.iter().find(|(p, _)| *p == path) {
                Some((_, body)) => {
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(body);
                }
                None => {
                    let _ = write!(
                        stream,
                        "HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    );
                }
            }
        }
    });
    (base, heads)
}

#[test]
fn reads_a_document_whole_and_names_no_one() {
    let (base, heads) = origin(vec![(
        "/desk/channels/stable/index.json",
        b"{\"serial\":1}".to_vec(),
    )]);
    let https = Https::new(true);
    let body = https
        .get(&format!("{base}/desk/channels/stable/index.json"))
        .unwrap();
    assert_eq!(body, b"{\"serial\":1}");
    let head = heads.lock().unwrap()[0].to_ascii_lowercase();
    assert!(
        head.contains(&format!("user-agent: {USER_AGENT}")),
        "{head}"
    );
    assert!(!head.contains("cookie"), "{head}");
}

#[test]
fn downloads_an_artifact_reporting_progress() {
    let artifact: Vec<u8> = (0..1_000_000u32).map(|n| (n % 251) as u8).collect();
    let (base, _) = origin(vec![(
        "/desk/releases/0.2.0/desk.AppImage",
        artifact.clone(),
    )]);
    let mut seen = Vec::new();
    let bytes = Https::new(true)
        .download(
            &format!("{base}/desk/releases/0.2.0/desk.AppImage"),
            &mut |received, total| {
                seen.push((received, total));
            },
        )
        .unwrap();
    assert_eq!(bytes, artifact);
    assert!(seen.len() >= 2, "{seen:?}");
    assert!(seen.windows(2).all(|w| w[0].0 < w[1].0));
    assert_eq!(seen.last(), Some(&(1_000_000, Some(1_000_000))));
}

#[test]
fn a_missing_file_names_its_status() {
    let (base, _) = origin(vec![]);
    let missing = Https::new(true)
        .get(&format!("{base}/desk/channels/beta/index.json"))
        .unwrap_err();
    assert!(missing.ends_with("answered 404"), "{missing}");
}

#[test]
fn plain_http_needs_the_desk_to_allow_it() {
    let (base, heads) = origin(vec![("/x", b"x".to_vec())]);
    assert!(Https::new(false).get(&format!("{base}/x")).is_err());
    assert!(heads.lock().unwrap().is_empty(), "nothing was sent");
}
