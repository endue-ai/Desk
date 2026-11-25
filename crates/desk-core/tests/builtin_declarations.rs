//! Every built-in plugin declares what it uses (ADR 0260). The core installs every
//! `plugins/*/plugin.json` as the desk does, built in, and each scope a plugin was found to use (asked
//! for, checked, or granted for it by the runtime's opener grant, ADR 0131, or a dialog) is one its
//! declarations cover, so none is refused as undeclared; a scope it never declares is. Values the
//! person names at run time (any folder, computer, program or command id) stand for themselves
//! through an example or two each. A plugin that runs code is in the table, so a new one is audited.

mod support;

use std::path::{Path, PathBuf};

use desk_bridge::{PluginKind, PluginStatus};
use desk_core::Core;
use serde_json::{Map, Value, json};
use support::*;

/// The openers: ADR 0131's grant of an opened file's folder, anywhere, and their own ask for it.
const OPENERS: &[&str] = &[
    "endue.archives",
    "endue.calendar",
    "endue.data",
    "endue.database",
    "endue.docs",
    "endue.images",
    "endue.notes",
    "endue.player",
    "endue.reader",
    "endue.sheets",
    "endue.slides",
    "endue.web",
];

/// Those that write beside the file they opened, or into a folder the person names.
const SAVERS: &[&str] = &[
    "endue.archives",
    "endue.calendar",
    "endue.data",
    "endue.notes",
    "endue.sheets",
];

/// Those that hand http, https and mailto links to the system in one scope.
const LINKERS: &[&str] = &["endue.docs", "endue.reader", "endue.slides", "endue.web"];

/// Those that show any file they hold in the file manager.
const REVEALERS: &[&str] = &["endue.images", "endue.player", "endue.explorer"];

/// Every other scope in use, by plugin, from the audit of their code (#346). `/Volumes/USB` stands
/// for a folder outside the home folder, the person's choice.
const USES: &str = r#"{
  "endue.agents": [{ "permission": "studio:manage" }, { "permission": "agents:manage" },
    { "permission": "shell:open", "schemes": ["https"] },
    { "permission": "cmd:invoke", "ids": ["desk.account.sign-in"] }],
  "endue.android-emulator": [{ "permission": "proc:spawn", "commands": ["adb", "emulator",
      "Library/Android/sdk/platform-tools/adb", "Library/Android/sdk/emulator/emulator",
      "Android/Sdk/platform-tools/adb", "Android/Sdk/emulator/emulator",
      "AppData/Local/Android/Sdk/platform-tools/adb", "AppData/Local/Android/Sdk/emulator/emulator"] },
    { "permission": "fs:read", "paths": ["~/Downloads/app.apk"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/screen.png"] }],
  "endue.api-studio": [{ "permission": "proc:spawn", "commands": ["curl"] },
    { "permission": "proc:spawn", "commands": ["/opt/homebrew/opt/curl/bin/curl"] },
    { "permission": "brain:ask" }, { "permission": "shell:open", "schemes": ["http", "https"] },
    { "permission": "fs:read", "paths": ["~/API", "~/API/**"] },
    { "permission": "fs:write", "paths": ["~/API", "~/API/**"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/API", "/Volumes/USB/API/**"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/API", "/Volumes/USB/API/**"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/request.json"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/request.json"] }],
  "endue.archives": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed", "desk.palette.pick"] }],
  "endue.browser": [{ "permission": "web:browse" }, { "permission": "web:control" }],
  "endue.calendar": [{ "permission": "fs:read", "paths": ["~/Calendar/**"] },
    { "permission": "fs:write", "paths": ["~/Calendar/**"] },
    { "permission": "cmd:invoke", "ids": ["desk.files.changed", "desk.files.open",
      "desk.buffers.update", "desk.palette.pick"] },
    { "permission": "ui:notify" },
    { "permission": "data:read", "kinds": ["event"], "sources": ["desk.calendar"] }],
  "endue.chat": [{ "permission": "data:read", "kinds": ["message"] },
    { "permission": "cmd:invoke", "ids": ["example.slack.chat.send", "example.slack.chat.react",
      "desk.palette.pick", "desk.connectors.open"] },
    { "permission": "ui:notify" }, { "permission": "connector:manage" },
    { "permission": "shell:open", "schemes": ["http", "https", "mailto"] }],
  "endue.computer": [{ "permission": "computer:see", "apps": ["com.apple.TextEdit"] },
    { "permission": "computer:control", "apps": ["com.apple.TextEdit"] }],
  "endue.data": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed", "desk.palette.pick",
    "desk.buffers.update"] }],
  "endue.database": [{ "permission": "proc:spawn", "commands": ["psql", "mysql", "mariadb", "sqlite3"] },
    { "permission": "proc:spawn", "commands": ["pg_dump", "pg_restore"] },
    { "permission": "proc:spawn", "commands": ["/opt/homebrew/opt/libpq/bin/psql"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/shop-2026-11-21-0905.dump"] },
    { "permission": "fs:read", "paths": ["~/Backups/shop.dump"] },
    { "permission": "fs:write", "paths": ["~/.endue/database/restore/c-1.list"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/query.sql"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/query.sql"] },
    { "permission": "fs:write", "paths": ["~/Downloads/**"] },
    { "permission": "fs:read", "paths": ["~/.endue/database/consoles/k-0123456789.sql"] },
    { "permission": "fs:write", "paths": ["~/.endue/database/consoles/k-0123456789.sql"] },
    { "permission": "cmd:invoke", "ids": ["desk.palette.pick", "desk.buffers.open",
      "desk.buffers.update", "desk.buffers.close", "desk.files.reveal", "desk.files.changed"] },
    { "permission": "db:connect", "hosts": ["db.example.test:5432"] }],
  "endue.docker": [{ "permission": "proc:spawn", "commands": ["docker"] },
    { "permission": "cmd:invoke", "ids": ["desk.palette.pick", "desk.buffers.open",
      "desk.buffers.update", "desk.files.open", "endue.terminal.run"] },
    { "permission": "ui:notify" }, { "permission": "shell:open", "schemes": ["http", "https"] }],
  "endue.docker-studio": [{ "permission": "proc:spawn", "commands": ["docker"] },
    { "permission": "brain:ask" }, { "permission": "shell:open", "schemes": ["http", "https"] },
    { "permission": "cmd:invoke", "ids": ["endue.terminal.run", "desk.files.open"] },
    { "permission": "fs:read", "paths": ["/Users/me/app/**"] },
    { "permission": "fs:write", "paths": ["/Users/me/app/**"] }],
  "endue.docs": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed"] }],
  "endue.eris": [{ "permission": "brain:converse" },
    { "permission": "cmd:invoke", "ids": ["desk.buffers.list", "desk.palette.pick"] },
    { "permission": "fs:read", "paths": ["~/Documents/hello.md"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/notes.md"] }],
  "endue.explorer": [{ "permission": "fs:read", "paths": ["~/Documents/**"] },
    { "permission": "fs:write", "paths": ["~/Documents/**"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/**"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/**"] },
    { "permission": "fs:read", "paths": ["/Users/me/Desktop/**"] },
    { "permission": "cmd:invoke", "ids": ["desk.files.open", "desk.buffers.list", "desk.palette.pick",
      "endue.terminal.new", "endue.git.status", "endue.docker.copy-out"] }],
  "endue.git": [{ "permission": "proc:spawn", "commands": ["git"] },
    { "permission": "cmd:invoke", "ids": ["desk.files.open", "desk.palette.pick", "desk.buffers.open",
      "desk.buffers.update", "endue.git.discard-patch"] }],
  "endue.git-studio": [{ "permission": "proc:spawn", "commands": ["git"] }, { "permission": "brain:ask" }],
  "desk.github": [{ "permission": "net:fetch", "hosts": ["api.github.com"] }],
  "endue.images": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed", "desk.files.open",
    "desk.buffers.close"] }],
  "desk.inspector": [{ "permission": "perm:manage" }, { "permission": "plugin:manage" },
    { "permission": "cmd:invoke", "ids": ["desk.inspect.open"] }],
  "endue.launcher": [{ "permission": "plugin:manage" },
    { "permission": "cmd:invoke", "ids": ["desk.plugins.open"] }],
  "endue.local-agents": [{ "permission": "proc:spawn", "commands": ["claude", "codex", "gemini", "grok",
    "qwen", "copilot", "cursor-agent", "opencode"] }, { "permission": "agents:manage" },
    { "permission": "cmd:invoke", "ids": ["desk.palette.pick"] }],
  "endue.local-models": [{ "permission": "net:connect", "hosts": ["localhost:8080", "127.0.0.1:8080"] },
    { "permission": "net:connect", "hosts": ["studio.local:8080"] },
    { "permission": "net:fetch", "hosts": ["huggingface.co"] },
    { "permission": "proc:spawn", "commands": ["llama-server", "curl", "sysctl", "nvidia-smi"] },
    { "permission": "proc:spawn", "commands": ["/opt/llama/bin/llama-server"] },
    { "permission": "fs:read", "paths": ["~/.endue/local-models/**"] },
    { "permission": "fs:write", "paths": ["~/.endue/local-models/**"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/model.gguf"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/chat.md"] },
    { "permission": "shell:open", "schemes": ["http", "https"] }],
  "endue.mail": [{ "permission": "data:read", "kinds": ["message"] },
    { "permission": "cmd:invoke", "ids": ["example.imap.mail.send", "desk.palette.pick"] },
    { "permission": "ui:notify" }, { "permission": "connector:manage" }],
  "endue.memory": [{ "permission": "memory:read" }, { "permission": "memory:write" }],
  "endue.network": [{ "permission": "proc:spawn", "commands": ["/usr/sbin/arp", "/sbin/ping",
    "/sbin/route", "/sbin/ifconfig", "/usr/bin/dig", "/usr/sbin/system_profiler"] },
    { "permission": "ui:notify" }, { "permission": "brain:ask" },
    { "permission": "net:connect", "hosts": ["192.168.1.20:22", "192.168.1.20:631"] },
    { "permission": "cmd:invoke", "ids": ["endue.network.devices"] }],
  "endue.notes": [{ "permission": "fs:read", "paths": ["~/Notes/**"] },
    { "permission": "fs:write", "paths": ["~/Notes/**"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/todo.md"] },
    { "permission": "fs:write", "paths": ["/Volumes/USB/todo.md"] },
    { "permission": "cmd:invoke", "ids": ["desk.files.changed", "desk.buffers.update",
      "desk.files.open", "desk.buffers.switch"] }],
  "endue.onboarding": [{ "permission": "account:manage" }, { "permission": "audio:capture" },
    { "permission": "brain:converse" }],
  "desk.palette": [{ "permission": "cmd:invoke", "ids": ["*"] },
    { "permission": "cmd:invoke", "ids": ["desk.views.open"] },
    { "permission": "search:read" }, { "permission": "search:system" },
    { "permission": "data:read" }, { "permission": "ui:notify" }],
  "endue.permissions": [{ "permission": "perm:manage" }, { "permission": "plugin:manage" },
    { "permission": "events:subscribe", "names": ["perm.changed"] }],
  "endue.player": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed"] }],
  "endue.projects": [{ "permission": "data:read", "kinds": ["task"] },
    { "permission": "cmd:invoke", "ids": ["desk.github.task.move", "desk.palette.pick",
      "desk.connectors.open"] },
    { "permission": "shell:open", "schemes": ["https"] }, { "permission": "connector:manage" }],
  "endue.reader": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed"] }],
  "endue.screens": [{ "permission": "net:connect", "hosts": ["studio.local:5900"] },
    { "permission": "net:connect", "hosts": ["192.168.1.20:5901"] }],
  "endue.sheets": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed", "desk.buffers.update"] }],
  "endue.sidebar": [{ "permission": "plugin:manage" }],
  "endue.slides": [{ "permission": "cmd:invoke", "ids": ["desk.files.changed"] }],
  "endue.terminal": [{ "permission": "proc:spawn", "commands": ["zsh", "bash", "fish", "sh", "pwsh",
    "powershell", "cmd"], "pty": true },
    { "permission": "proc:spawn", "commands": ["/opt/homebrew/bin/nu"], "pty": true },
    { "permission": "proc:spawn", "commands": ["docker"], "pty": true },
    { "permission": "ui:notify" },
    { "permission": "shell:open", "schemes": ["http", "https", "mailto"] },
    { "permission": "cmd:invoke", "ids": ["desk.buffers.open", "desk.buffers.update",
      "desk.buffers.close"] },
    { "permission": "cmd:invoke", "ids": ["endue.terminal.focus", "endue.git-studio.graph"] }],
  "endue.toolbar": [{ "permission": "plugin:manage" }],
  "desk.universal": [{ "permission": "data:read", "kinds": ["task"], "sources": ["desk.github"] },
    { "permission": "cmd:invoke", "ids": ["endue.chat.show"] }, { "permission": "view:manage" },
    { "permission": "fs:read", "paths": ["~/views/board.yaml"] },
    { "permission": "fs:read", "paths": ["/Volumes/USB/board.yaml"] },
    { "permission": "net:fetch", "hosts": ["status.example.com"] },
    { "permission": "net:fetch", "hosts": ["192.168.1.20:8443"] }],
  "desk.views": [{ "permission": "data:read" }, { "permission": "view:manage" },
    { "permission": "cmd:invoke", "ids": ["desk.universal.open", "desk.palette.pick"] },
    { "permission": "connector:manage" },
    { "permission": "shell:open", "schemes": ["http", "https", "mailto"] }],
  "endue.web": [{ "permission": "fs:read", "paths": ["/Volumes/USB/Site/assets/**"] },
    { "permission": "cmd:invoke", "ids": ["desk.files.open", "desk.files.changed"] }]
}"#;

fn repo_plugins() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins")
}

/// Every scope in use, as (plugin, scope).
fn uses() -> Vec<(String, Value)> {
    let table: Map<String, Value> = serde_json::from_str(USES).unwrap();
    let mut uses: Vec<(String, Value)> = Vec::new();
    let mut add = |plugins: &[&str], scope: Value| {
        uses.extend(plugins.iter().map(|p| (p.to_string(), scope.clone())));
    };
    for folder in [
        "~/Downloads/**",
        "/Volumes/USB/Photos/**",
        "C:/Users/me/Pictures/**",
    ] {
        add(
            OPENERS,
            json!({ "permission": "fs:read", "paths": [folder] }),
        );
    }
    add(
        SAVERS,
        json!({ "permission": "fs:write", "paths": ["/Volumes/USB/Photos/**"] }),
    );
    let links = json!({ "permission": "shell:open", "schemes": ["http", "https", "mailto"] });
    add(LINKERS, links);
    for file in ["~/Pictures/beach.png", "/Volumes/USB/Photos/beach.png"] {
        add(
            REVEALERS,
            json!({ "permission": "shell:open", "paths": [file] }),
        );
    }
    for (plugin, scopes) in table {
        let scopes = scopes.as_array().unwrap().iter().cloned();
        uses.extend(scopes.map(|scope| (plugin.clone(), scope)));
    }
    uses
}

/// Whether a plugin of `kind` runs code under its own id: data and files others load do not.
fn runs_code(kind: PluginKind) -> bool {
    !matches!(
        kind,
        PluginKind::Policy
            | PluginKind::Library
            | PluginKind::View
            | PluginKind::Theme
            | PluginKind::DesignSystem
            | PluginKind::Pack
    )
}

fn request(core: &Core, caller: &str, permission: Value) -> Value {
    let params = json!({ "permission": permission });
    call(core, caller, "perm.request", params).unwrap()
}

#[test]
fn every_builtin_plugin_declares_what_it_uses() {
    let home = home("builtin-declarations");
    let core = Core::new(roots(&home)).with_prompter(SayYes);
    let folders = std::fs::read_dir(repo_plugins()).unwrap().flatten();
    let folders = folders.filter(|e| e.path().join("plugin.json").is_file());
    let installed = core.install_plugins_in(&repo_plugins(), true);
    assert_eq!(
        installed.len(),
        folders.count(),
        "the core reads every plugin.json"
    );
    let uses = uses();
    let never = json!({ "permission": "update:manage" });
    for plugin in &installed {
        let ready = plugin.status == PluginStatus::Ready;
        assert!(ready, "{}: {:?}", plugin.id, plugin.error);
        let kind = plugin.manifest.as_ref().unwrap().kind;
        let audited = uses.iter().any(|(id, _)| *id == plugin.id);
        assert_eq!(
            audited,
            runs_code(kind),
            "{} is in the table if it runs code",
            plugin.id
        );
        // None declares update:manage, so it is refused unasked: the declarations bound each one.
        let refused = request(&core, &plugin.id, never.clone());
        let undeclared = json!({ "granted": false, "reason": "undeclared" });
        assert_eq!(refused, undeclared, "{}", plugin.id);
    }
    for (plugin, scope) in uses {
        assert!(
            installed.iter().any(|p| p.id == plugin),
            "{plugin} is built in"
        );
        let answer = request(&core, &plugin, scope.clone());
        assert_eq!(answer["granted"], true, "{plugin} uses {scope}: {answer}");
    }
}
