//! Approvals (ADR 0078): an agent's irreversible call waits for the person even when a grant covers
//! it: `perm.approval` to the `perm:manage` holder with a preview, answered once, task or deny with
//! `perm.approve`, and `perm.approval.done` once the call ran. A person's own calls never wait.

mod support;

use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::mpsc::Receiver;

use base64::Engine as _;
use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const MIRA: &str = "agent:mira";
const MAIL: &str = "example.mail";
const NOTES_ONLY: &str =
    "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n";

/// A core reading `init` from `home/init.yaml`, with `desk` holding perm:manage and a router listening.
fn core_with(home: &Path, init: &str) -> (Core, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, init).unwrap();
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn notes(home: &Path, name: &str, text: &str) {
    fs::create_dir_all(home.join("Notes")).unwrap();
    fs::write(home.join("Notes").join(name), text).unwrap();
}

fn fs_write(paths: &[&str]) -> Value {
    json!({ "permission": "fs:write", "paths": paths })
}

fn write(core: &Core, caller: &str, path: &str, content: &str) -> Result<Value, BridgeError> {
    let params = json!({ "path": path, "content": content, "scope": fs_write(&["~/Notes/**"]) });
    call(core, caller, "fs.write", params)
}

/// perm.approve as `desk`.
fn approve(core: &Core, approval: &Seen, answer: &str) -> Result<Value, BridgeError> {
    let params = json!({ "approvalId": approval.data()["approvalId"], "answer": answer,
        "scope": manage() });
    call(core, "desk", "perm.approve", params)
}

/// Run `act` on another thread, wait for its `perm.approval`, answer it, and return both.
fn held<T: Send>(
    core: &Core,
    deliveries: &Receiver<Delivery>,
    answer: &str,
    act: impl FnOnce() -> T + Send,
) -> (Seen, T) {
    std::thread::scope(|s| {
        let acting = s.spawn(act);
        let approval = wait_for(deliveries, "perm.approval");
        approve(core, &approval, answer).unwrap();
        (approval, acting.join().unwrap())
    })
}

fn perm_log(core: &Core) -> Vec<Value> {
    grant(core, "desk", json!({ "permission": "log:read" }));
    let tail = call(
        core,
        "desk",
        "log.tail",
        json!({ "channel": "perm", "count": 1000, "scope": { "permission": "log:read" } }),
    );
    tail.unwrap()["entries"].as_array().unwrap().clone()
}

#[test]
fn an_agents_write_waits_for_approval_even_with_a_session_grant() {
    let home = home("approve-write");
    notes(&home, "a.md", "# Today\nBuy milk\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    std::thread::scope(|s| {
        let writing = s.spawn(|| write(&core, MIRA, "~/Notes/a.md", "# Today\nBuy oat milk\n"));
        let approval = wait_for(&deliveries, "perm.approval");
        assert_eq!(approval.to, strings(&["desk"]));
        let data = approval.data();
        assert_eq!(data["caller"], MIRA);
        assert_eq!(data["action"], "fs.write");
        assert_eq!(data["target"], "~/Notes/a.md");
        assert_eq!(data["permission"], fs_write(&["~/Notes/**"]));
        assert_eq!(data["size"], 21);
        assert!(
            data.get("task").is_none(),
            "a call outside a turn has no task"
        );
        assert_eq!(data["preview"]["kind"], "diff");
        let diff = data["preview"]["text"].as_str().unwrap();
        assert!(
            diff.starts_with("--- ~/Notes/a.md\n+++ ~/Notes/a.md\n@@ "),
            "{diff}"
        );
        assert!(
            diff.contains("\n # Today\n-Buy milk\n+Buy oat milk\n"),
            "{diff}"
        );
        let unchanged = fs::read_to_string(home.join("Notes/a.md")).unwrap();
        assert_eq!(
            unchanged, "# Today\nBuy milk\n",
            "nothing is written while it waits"
        );
        approve(&core, &approval, "once").unwrap();
        assert_eq!(writing.join().unwrap().unwrap()["bytesWritten"], 21);
        let done = wait_for(&deliveries, "perm.approval.done");
        assert_eq!(done.to, strings(&["desk"]));
        assert_eq!(
            done.data(),
            &json!({ "approvalId": data["approvalId"], "ok": true, "bytesWritten": 21 })
        );
    });
    let written = fs::read_to_string(home.join("Notes/a.md")).unwrap();
    assert_eq!(written, "# Today\nBuy oat milk\n");
    let log = perm_log(&core);
    let approved: Vec<&Value> = log
        .iter()
        .filter(|e| e["fields"]["decision"] == "approved")
        .collect();
    assert_eq!(approved.len(), 1, "{log:?}");
    assert_eq!(approved[0]["fields"]["caller"], MIRA);
    assert_eq!(approved[0]["fields"]["approval"], "once");
    assert_eq!(approved[0]["fields"]["target"], "~/Notes/a.md");
}

#[test]
fn allow_once_covers_one_call_and_the_same_write_asks_again() {
    let home = home("approve-once");
    notes(&home, "a.md", "old\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    let (first, written) = held(&core, &deliveries, "once", || {
        write(&core, MIRA, "~/Notes/a.md", "new\n")
    });
    written.unwrap();
    let (second, refused) = held(&core, &deliveries, "deny", || {
        write(&core, MIRA, "~/Notes/a.md", "new\n")
    });
    assert_ne!(first.data()["approvalId"], second.data()["approvalId"]);
    assert_eq!(refused.unwrap_err().code, ErrorCode::PermissionDenied);
}

#[test]
fn deny_refuses_the_call_with_the_reason() {
    let home = home("approve-deny");
    notes(&home, "a.md", "keep me\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    let (_, refused) = held(&core, &deliveries, "deny", || {
        write(&core, MIRA, "~/Notes/a.md", "gone\n")
    });
    let refused = refused.unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert!(refused.message.contains("did not approve"), "{refused:?}");
    assert_eq!(
        serde_json::to_value(&refused.permission).unwrap(),
        fs_write(&["~/Notes/**"])
    );
    assert_eq!(
        fs::read_to_string(home.join("Notes/a.md")).unwrap(),
        "keep me\n"
    );
    assert!(named(&deliveries, "perm.approval.done").is_empty());
    let log = perm_log(&core);
    let refusal = log
        .iter()
        .find(|e| e["fields"]["decision"] == "refused")
        .expect("the denial is logged");
    assert_eq!(refusal["fields"]["reason"], "not-approved");
    assert_eq!(refusal["fields"]["target"], "~/Notes/a.md");
}

/// A server on 127.0.0.1 that answers every request `200 ok`.
fn ok_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let _ = stream.read(&mut [0; 4096]);
            let answer = "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 2\r\n\r\nok";
            let _ = stream.write_all(answer.as_bytes());
        }
    });
    port
}

/// An `always` grant that `desk` gives `caller` through a prompt.
fn granted_for(core: &Core, deliveries: &Receiver<Delivery>, caller: &str, permission: Value) {
    std::thread::scope(|s| {
        let asking = s.spawn(|| {
            let params = json!({ "permission": permission, "duration": "always" });
            call(core, caller, "perm.request", params)
        });
        let prompt = wait_for(deliveries, "perm.prompt");
        let params = json!({ "promptId": prompt.data()["promptId"], "granted": true,
            "duration": "always", "scope": manage() });
        call(core, "desk", "perm.answer", params).unwrap();
        assert_eq!(asking.join().unwrap().unwrap()["granted"], true);
    });
}

#[test]
fn a_spawn_shows_its_command_line_and_a_fetch_its_url() {
    let home = home("approve-actions");
    let (core, deliveries) = core_with(&home, "");
    grant(
        &core,
        MIRA,
        json!({ "permission": "proc:spawn", "commands": ["git"] }),
    );
    let (approval, refused) = held(&core, &deliveries, "deny", || {
        let params = json!({ "command": "git", "args": ["commit", "-m", "it's done"],
            "scope": { "permission": "proc:spawn", "commands": ["git"] } });
        call(&core, MIRA, "proc.spawn", params)
    });
    assert_eq!(refused.unwrap_err().code, ErrorCode::PermissionDenied);
    assert_eq!(approval.data()["action"], "proc.spawn");
    assert_eq!(approval.data()["target"], "git");
    assert_eq!(
        approval.data()["preview"],
        json!({ "kind": "command", "text": "git commit -m 'it'\\''s done'" })
    );

    let port = ok_server();
    let url = format!("http://127.0.0.1:{port}/notes?q=1");
    let hosts = json!({ "permission": "net:fetch", "hosts": ["127.0.0.1"] });
    let session = grant(&core, MIRA, hosts.clone());
    let fetch = || {
        let params = json!({ "url": url, "method": "POST", "body": "hi", "scope": hosts });
        call(&core, MIRA, "net.fetch", params)
    };
    let (approval, refused) = held(&core, &deliveries, "deny", fetch);
    assert_eq!(refused.unwrap_err().code, ErrorCode::PermissionDenied);
    assert_eq!(approval.data()["action"], "net.fetch");
    assert_eq!(approval.data()["target"], url.as_str());
    assert_eq!(
        approval.data()["preview"],
        json!({ "kind": "url", "text": format!("POST {url}") })
    );

    // A host and a folder an always grant covers are allowed already: nothing waits.
    call(&core, MIRA, "perm.revoke", json!({ "grantId": session })).unwrap();
    granted_for(&core, &deliveries, MIRA, hosts.clone());
    assert_eq!(fetch().unwrap()["status"], 200);
    granted_for(&core, &deliveries, MIRA, fs_write(&["~/Notes/**"]));
    write(&core, MIRA, "~/Notes/b.md", "kept\n").unwrap();
    assert!(named(&deliveries, "perm.approval").is_empty());
}

/// `example.mail`, whose manifest marks `example.mail.send` irreversible, registers its commands.
fn mail_plugin(core: &Core, home: &Path) {
    let dir = home.join("plugins/mail");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>mail</p>").unwrap();
    let manifest = json!({ "id": MAIL, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "contributes": { "commands": [
            { "id": "example.mail.send", "title": "Send", "irreversible": true },
            { "id": "example.mail.open", "title": "Open" } ] } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    for id in ["example.mail.send", "example.mail.open"] {
        call(core, MAIL, "cmd.register", json!({ "id": id, "title": id })).unwrap();
    }
}

fn invoke(core: &Core, caller: &str, id: &str) -> Result<Value, BridgeError> {
    let params = json!({ "id": id, "args": { "to": "kai@example.com" },
        "scope": { "permission": "cmd:invoke", "ids": ["example.mail.*"] } });
    call(core, caller, "cmd.invoke", params)
}

#[test]
fn an_irreversible_command_waits_and_other_commands_do_not() {
    let home = home("approve-command");
    let (core, deliveries) = core_with(&home, "");
    mail_plugin(&core, &home);
    grant(
        &core,
        MIRA,
        json!({ "permission": "cmd:invoke", "ids": ["example.mail.*"] }),
    );
    let (approval, invoked) = held(&core, &deliveries, "once", || {
        invoke(&core, MIRA, "example.mail.send")
    });
    assert!(invoked.unwrap()["invocationId"].is_string());
    assert_eq!(approval.data()["action"], "cmd.invoke");
    assert_eq!(approval.data()["target"], "example.mail.send");
    assert_eq!(approval.data()["preview"]["kind"], "args");
    let args = approval.data()["preview"]["text"].as_str().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(args).unwrap(),
        json!({ "to": "kai@example.com" })
    );
    let sent = wait_for(&deliveries, "cmd.invoked");
    assert_eq!(sent.data()["id"], "example.mail.send");

    invoke(&core, MIRA, "example.mail.open").unwrap();
    assert!(named(&deliveries, "perm.approval").is_empty());
}

#[test]
fn a_persons_own_calls_are_never_held() {
    let home = home("approve-person");
    notes(&home, "a.md", "old\n");
    let (core, deliveries) = core_with(&home, "");
    mail_plugin(&core, &home);
    let program = std::env::current_exe().unwrap().display().to_string();
    for caller in ["desk", "cli", NOTES] {
        grant(&core, caller, fs_write(&["~/Notes/**"]));
        let spawn = json!({ "permission": "proc:spawn", "commands": [program] });
        grant(&core, caller, spawn.clone());
        grant(
            &core,
            caller,
            json!({ "permission": "cmd:invoke", "ids": ["example.mail.*"] }),
        );
        write(&core, caller, "~/Notes/a.md", "mine\n").unwrap();
        let params = json!({ "command": program, "args": ["--exact", "no-such-test"],
            "scope": spawn });
        call(&core, caller, "proc.spawn", params).unwrap();
        invoke(&core, caller, "example.mail.send").unwrap();
    }
    assert!(named(&deliveries, "perm.approval").is_empty());
    // The same write by an agent holding the same grant waits.
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    let (approval, _) = held(&core, &deliveries, "deny", || {
        write(&core, MIRA, "~/Notes/a.md", "agent\n")
    });
    assert_eq!(approval.data()["caller"], MIRA);
    assert_eq!(
        fs::read_to_string(home.join("Notes/a.md")).unwrap(),
        "mine\n"
    );
}

#[test]
fn a_task_answer_needs_a_task_and_nobody_to_ask_means_the_prompter() {
    let home = home("approve-task");
    notes(&home, "a.md", "old\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    std::thread::scope(|s| {
        let writing = s.spawn(|| write(&core, MIRA, "~/Notes/a.md", "new\n"));
        let approval = wait_for(&deliveries, "perm.approval");
        let wrong = approve(&core, &approval, "task").unwrap_err();
        assert_eq!(wrong.code, ErrorCode::InvalidParams);
        approve(&core, &approval, "once").unwrap();
        writing.join().unwrap().unwrap();
    });

    // Nobody holds perm:manage: the Prompter decides, and the default one refuses.
    let quiet = Core::new(roots(&home));
    grant(&quiet, MIRA, fs_write(&["~/Notes/**"]));
    let refused = write(&quiet, MIRA, "~/Notes/a.md", "quiet\n").unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    let yes = Core::new(roots(&home)).with_prompter(SayYes);
    grant(&yes, MIRA, fs_write(&["~/Notes/**"]));
    write(&yes, MIRA, "~/Notes/a.md", "yes\n").unwrap();
    assert_eq!(
        fs::read_to_string(home.join("Notes/a.md")).unwrap(),
        "yes\n"
    );
}

#[test]
fn the_diff_is_bounded_and_binary_files_have_none() {
    let home = home("approve-bounded");
    let old: String = (1..=300).map(|n| format!("line {n}\n")).collect();
    let new: String = (1..=300).map(|n| format!("row {n}\n")).collect();
    notes(&home, "long.txt", &old);
    fs::write(home.join("Notes/blob.bin"), [0xff, 0x00, 0xfe]).unwrap();
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    let (approval, _) = held(&core, &deliveries, "deny", || {
        write(&core, MIRA, "~/Notes/long.txt", &new)
    });
    let preview = &approval.data()["preview"];
    assert_eq!(preview["truncated"], true);
    let changed = preview["text"]
        .as_str()
        .unwrap()
        .lines()
        .filter(|l| !l.starts_with("+++") && !l.starts_with("---"))
        .filter(|l| l.starts_with('+') || l.starts_with('-'))
        .count();
    assert_eq!(changed, 200);

    let bytes = base64::engine::general_purpose::STANDARD.encode([0u8, 1, 2, 3]);
    let (approval, _) = held(&core, &deliveries, "deny", || {
        let params = json!({ "path": "~/Notes/blob.bin", "content": bytes, "encoding": "base64",
            "scope": fs_write(&["~/Notes/**"]) });
        call(&core, MIRA, "fs.write", params)
    });
    assert!(
        approval.data().get("preview").is_none(),
        "{:?}",
        approval.data()
    );
    assert_eq!(approval.data()["size"], 4);
}
