//! A fake Ollama on std's TcpListener for the brain-choice tests: `/api/version` answers, and every
//! `/api/chat` streams "Hi from <model>" and stops. It runs until the test process ends.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use serde_json::{Value, json};

pub struct FakeOllama {
    pub url: String,
}

impl FakeOllama {
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                thread::spawn(move || answer(stream));
            }
        });
        Self { url }
    }
}

fn answer(mut stream: TcpStream) {
    let Some((path, body)) = read_request(&stream) else {
        return;
    };
    if path.ends_with("/api/version") {
        let body = json!({ "version": "0.12.0" }).to_string();
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
             Connection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(format!("{head}{body}").as_bytes());
        return;
    }
    let model = body["model"].as_str().unwrap_or_default().to_owned();
    let chunk = |content: &str, done: bool| {
        let mut line = json!({ "model": model, "created_at": "2026-11-05T00:00:00Z",
            "message": { "role": "assistant", "content": content }, "done": done });
        if done {
            line["done_reason"] = json!("stop");
        }
        format!("{line}\n")
    };
    let head = "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n\
                Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(head.as_bytes());
    for data in [chunk(&format!("Hi from {model}"), false), chunk("", true)] {
        let _ = stream.write_all(format!("{:x}\r\n{data}\r\n", data.len()).as_bytes());
    }
    let _ = stream.write_all(b"0\r\n\r\n");
    let _ = stream.flush();
}

fn read_request(stream: &TcpStream) -> Option<(String, Value)> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let path = line.split_whitespace().nth(1)?.to_owned();
    let mut length = 0;
    loop {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.trim().eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().ok()?;
        }
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    Some((path, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}
