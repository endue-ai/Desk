//! What the app grants the caller `cli` at start (ADR 0030): exactly four permissions, nothing more.

use serde_json::json;

#[test]
fn the_cli_gets_the_permissions_adr_0030_lists_and_update_manage() {
    let granted: Vec<serde_json::Value> = desk_ipc::grants()
        .iter()
        .map(|permission| serde_json::to_value(permission).unwrap())
        .collect();
    assert_eq!(
        granted,
        [
            json!({ "permission": "cmd:invoke", "ids": ["*"] }),
            json!({ "permission": "plugin:manage" }),
            json!({ "permission": "perm:manage" }),
            json!({ "permission": "log:read" }),
            json!({ "permission": "update:manage" }),
        ]
    );
}

#[test]
fn the_socket_lives_in_the_desk_data_folder() {
    assert_eq!(desk_ipc::APP_ID, "ai.endue.desk");
    assert_eq!(desk_ipc::SOCKET_FILE, "desk.sock");
    if std::env::var_os(desk_ipc::SOCKET_ENV).is_none() {
        let path = desk_ipc::socket_path().expect("a data folder");
        assert!(
            path.ends_with("ai.endue.desk/desk.sock"),
            "{}",
            path.display()
        );
    }
}
