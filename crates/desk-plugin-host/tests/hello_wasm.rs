//! examples/plugin-hello-wasm runs on the host: it reads one file, notifies, and counts its runs in
//! the store, which outlives the instance.

mod common;

use common::{MockHost, hello_wasm};
use desk_plugin_host::{Limits, LogicHost, NotifyLevel};
use serde_json::json;

const ID: &str = "example.hello-wasm";
const FILE: &str = "${plugin}/hello.txt";

#[test]
fn hello_wasm_reads_its_file_and_notifies() {
    let host = MockHost::with_file(FILE, b"Hello from a file.\n");
    let mut logic = LogicHost::new(host.clone(), Limits::default()).unwrap();
    let id = logic.install(&hello_wasm()).unwrap();
    assert_eq!(id, ID);
    logic.start(&id).unwrap();

    let reads: Vec<_> = host
        .calls()
        .into_iter()
        .filter(|c| c.1 == "fs.read")
        .collect();
    assert_eq!(
        reads,
        [(ID.to_owned(), "fs.read".to_owned(), FILE.to_owned())]
    );
    assert_eq!(
        host.notes(),
        [(
            ID.to_owned(),
            "Hello from Wasm".to_owned(),
            Some("Hello from a file. (run 1)".to_owned()),
            NotifyLevel::Info
        )]
    );
}

#[test]
fn state_lives_in_the_store_across_a_reload() {
    let host = MockHost::with_file(FILE, b"Hi");
    let mut logic = LogicHost::new(host.clone(), Limits::default()).unwrap();
    let id = logic.install(&hello_wasm()).unwrap();
    logic.start(&id).unwrap();
    logic.reload(&id).unwrap();
    logic.reload(&id).unwrap();

    let bodies: Vec<_> = host.notes().into_iter().map(|n| n.2).collect();
    assert_eq!(
        bodies,
        [
            Some("Hi (run 1)".to_owned()),
            Some("Hi (run 2)".to_owned()),
            Some("Hi (run 3)".to_owned())
        ]
    );
    assert_eq!(host.stored(ID, "runs"), Some(json!(3)));
}
