//! Approvals (ADR 0078) beyond writes: an agent's spawn shows its command line and a fetch its URL,
//! a fetch waits even with an `always` grant, a command its manifest marks `irreversible`
//! waits while others do not, and a person's own calls never wait.

mod support;

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const MIRA: &str = "agent:mira";
const MAIL: &str = "example.mail";

/// A core with an empty init.yaml (no allowlist), `desk` holding perm:manage and a router listening.
fn core_with(home: &Path) -> (Core, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, "").unwrap();
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn notes(home: &Path) {
    fs::create_dir_all(home.join("Notes")).unwrap();
    fs::write(home.join("Notes/a.md"), "old\n").unwrap();
}

fn fs_write(paths: &[&str]) -> Value {
    json!({ "permission": "fs:write", "paths": paths })
}

fn write(core: &Core, caller: &str, path: &str, content: &str) -> Result<Value, BridgeError> {
    let params = json!({ "path": path, "content": content, "scope": fs_write(&["~/Notes/**"]) });
    call(core, caller, "fs.write", params)
}

/// A server on 127.0.0.1 that answers every request `200 ok` once it has read the whole request:
/// on Windows, a socket closed with bytes left unread resets the connection before the client reads.
fn ok_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(&stream);
            let (mut line, mut length) = (String::new(), 0);
            while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
                if let Some((name, value)) = line.split_once(':')
                    && name.eq_ignore_ascii_case("content-length")
                {
                    length = value.trim().parse().unwrap_or(0);
                }
                line.clear();
            }
            let _ = reader.read_exact(&mut vec![0; length]);
            let answer = "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 2\r\n\r\nok";
            let _ = (&stream).write_all(answer.as_bytes());
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
    notes(&home);
    let (core, deliveries) = core_with(&home);
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

    // A lasting grant covers the program's scope, but a fetch still waits for the reviewed act.
    call(&core, MIRA, "perm.revoke", json!({ "grantId": session })).unwrap();
    granted_for(&core, &deliveries, MIRA, hosts.clone());
    assert_eq!(
        approved_once(&core, &deliveries, fetch).unwrap()["status"],
        200
    );
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
    let (core, deliveries) = core_with(&home);
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
fn the_desk_can_mark_a_command_for_every_agent_invocation_to_wait() {
    let (core, deliveries) = core_with(&home("approve-desk"));
    let id = "desk.example.clear";
    let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
    grant(&core, "desk", scope.clone());
    grant(&core, MIRA, scope.clone());
    call(
        &core,
        "desk",
        "cmd.register",
        json!({
            "id": id, "title": "Clear examples", "description": "Clear example history.",
            "agent": true, "irreversible": true
        }),
    )
    .unwrap();
    let list = call(&core, "desk", "cmd.list", json!({ "scope": scope })).unwrap();
    assert_eq!(list["commands"][0]["irreversible"], true);
    let tools = call(&core, MIRA, "cmd.tools", json!({})).unwrap();
    assert_eq!(tools["tools"][0]["irreversible"], true);

    let args = json!({ "group": "fixture" });
    for _ in 0..2 {
        let (approval, invoked) = held(&core, &deliveries, "once", || {
            call(
                &core,
                MIRA,
                "cmd.invoke",
                json!({ "id": id, "args": args, "scope": scope }),
            )
        });
        assert!(invoked.unwrap()["invocationId"].is_string());
        assert_eq!(approval.data()["target"], id);
        let preview = approval.data()["preview"]["text"].as_str().unwrap();
        assert_eq!(serde_json::from_str::<Value>(preview).unwrap(), args);
        assert_eq!(wait_for(&deliveries, "cmd.invoked").data()["id"], id);
    }
    let error = call(
        &core,
        "desk",
        "cmd.register",
        json!({
            "id": id, "title": "Clear examples", "readOnly": true, "irreversible": true
        }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidParams);
}

#[test]
fn a_plugin_registration_keeps_the_manifest_in_charge_of_irreversibility() {
    let home = home("approve-plugin-marker");
    let (core, _) = core_with(&home);
    mail_plugin(&core, &home);
    let scope = json!({ "permission": "cmd:invoke", "ids": ["example.mail.*"] });
    grant(&core, "desk", scope.clone());
    for (id, requested) in [("example.mail.send", false), ("example.mail.open", true)] {
        call(
            &core,
            MAIL,
            "cmd.register",
            json!({
                "id": id, "title": id, "irreversible": requested
            }),
        )
        .unwrap();
    }
    let list = call(&core, "desk", "cmd.list", json!({ "scope": scope })).unwrap();
    assert_eq!(list["commands"][0]["irreversible"], true);
    assert!(list["commands"][1].get("irreversible").is_none());
}

#[test]
fn a_persons_own_calls_are_never_held() {
    let home = home("approve-person");
    notes(&home);
    let (core, deliveries) = core_with(&home);
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
fn eris_can_change_reversible_desk_preferences_but_clear_and_remove_wait() {
    let home = home("desk-preference-approval");
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    let reversible = [
        "desk.settings.set",
        "desk.theme.use",
        "desk.theme.set",
        "desk.notify.dnd",
        "desk.notify.dismiss",
        "desk.profiles.switch",
        "desk.profiles.save",
        "desk.customize.style",
        "desk.customize.clear",
        "desk.customize.restore-style",
    ];
    let ask = |id: &str| {
        let params = json!({ "id": id, "scope": { "permission": "cmd:invoke", "ids": [id] } });
        call(&core, "agent:eris", "cmd.invoke", params)
    };
    let irreversible = [
        "desk.notify.clear",
        "desk.profiles.remove",
        "desk.customize.script",
    ];
    for (ids, irreversible) in [(&reversible[..], false), (&irreversible[..], true)] {
        for id in ids {
            call(
                &core,
                "desk",
                "cmd.register",
                json!({
                    "id": id, "title": id, "agent": true, "description": "Desk preference test",
                    "irreversible": irreversible,
                }),
            )
            .unwrap();
        }
    }
    for id in reversible {
        ask(id).unwrap_or_else(|e| panic!("{id}: {e:?}"));
    }

    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    for id in irreversible {
        let (approval, denied) = held(&core, &deliveries, "deny", || ask(id));
        assert_eq!(approval.data()["target"], id);
        assert_eq!(denied.unwrap_err().code, ErrorCode::PermissionDenied);
    }
}

#[test]
fn eris_runs_explicit_workspace_commands_without_a_scope_prompt() {
    let home = home("eris-workspace-tool");
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    for id in [
        "desk.shell.desktop-new",
        "desk.shell.desktop-go",
        "desk.shell.desktop-rename",
        "desk.shell.desktop-remove",
        "desk.buffers.switch",
        "desk.buffers.close",
        "desk.files.save",
        "desk.session.save",
        "desk.undo",
        "desk.redo",
    ] {
        call(
            &core,
            "desk",
            "cmd.register",
            json!({
                "id": id, "title": id, "agent": true, "description": "Workspace command"
            }),
        )
        .unwrap();
        let params = json!({ "id": id, "scope": { "permission": "cmd:invoke", "ids": [id] } });
        call(&core, "agent:eris", "cmd.invoke", params).unwrap_or_else(|e| panic!("{id}: {e:?}"));
    }
}
