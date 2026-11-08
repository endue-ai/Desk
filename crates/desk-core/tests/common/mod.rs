//! examples/brain-echo for the integration tests: started with no pause between events and one lease
//! second lasting 20 ms, stopped when dropped.
#![allow(dead_code)]

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};

pub struct Echo {
    child: Child,
    url: String,
}

impl Echo {
    pub fn start() -> Self {
        Self::start_on(0)
    }

    /// Start on `port` (0: a free one).
    pub fn start_on(port: u16) -> Self {
        let server =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/brain-echo/server.mjs");
        let mut child = Command::new("node")
            .arg(server)
            .args(["--port", &port.to_string()])
            .env("BRAIN_ECHO_DELAY_MS", "0")
            .env("BRAIN_ECHO_SECOND_MS", "20")
            .stdout(Stdio::piped())
            .spawn()
            .expect("node runs examples/brain-echo (Node 22 or later)");
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let url = line
            .split_whitespace()
            .find(|word| word.starts_with("http://"))
            .unwrap_or_else(|| panic!("brain-echo printed no URL: {line:?}"))
            .to_owned();
        Self { child, url }
    }

    pub fn url(&self) -> &str {
        &self.url
    }
}

impl Drop for Echo {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A port nothing listens on (yet).
pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
