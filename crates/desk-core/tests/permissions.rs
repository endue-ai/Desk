//! Permission engine: deny by default, grant, revoke, and path scopes.

use desk_bridge::{FsReadPermission, NetFetchPermission, Permission};
use desk_core::{PermissionEngine, Target};

fn fs_read(paths: &[&str]) -> Permission {
    Permission::FsRead(FsReadPermission {
        permission: Default::default(),
        paths: paths.iter().map(|p| p.to_string()).collect(),
    })
}

fn net(hosts: &[&str]) -> Permission {
    Permission::NetFetch(NetFetchPermission {
        permission: Default::default(),
        hosts: hosts.iter().map(|h| h.to_string()).collect(),
    })
}

#[test]
fn everything_is_denied_by_default() {
    let engine = PermissionEngine::new();
    let scope = fs_read(&["~/Documents/**"]);
    assert!(
        engine
            .authorize("desk", &scope, &Target::Path("~/Documents/a.md"))
            .is_err()
    );
}

#[test]
fn a_grant_allows_and_a_revoke_denies_again() {
    let mut engine = PermissionEngine::new();
    let scope = fs_read(&["~/Documents/**"]);
    let grant = engine.grant("desk", scope.clone());
    let target = Target::Path("~/Documents/notes/a.md");
    assert_eq!(
        engine.authorize("desk", &scope, &target),
        Ok(grant.grant_id.clone())
    );
    assert!(engine.revoke("desk", &grant.grant_id));
    assert!(engine.authorize("desk", &scope, &target).is_err());
    assert!(
        !engine.revoke("desk", &grant.grant_id),
        "revoking twice reports nothing revoked"
    );
}

#[test]
fn a_path_outside_the_scope_is_denied() {
    let mut engine = PermissionEngine::new();
    let scope = fs_read(&["~/Documents/**"]);
    engine.grant("desk", scope.clone());
    assert!(
        engine
            .authorize("desk", &scope, &Target::Path("~/Desktop/a.md"))
            .is_err()
    );
    assert!(
        engine
            .authorize("desk", &scope, &Target::Path("/etc/passwd"))
            .is_err()
    );
}

#[test]
fn a_dot_dot_escape_is_denied() {
    let mut engine = PermissionEngine::new();
    let scope = fs_read(&["~/Documents/**"]);
    engine.grant("desk", scope.clone());
    let escape = Target::Path("~/Documents/../.ssh/id_ed25519");
    assert!(engine.authorize("desk", &scope, &escape).is_err());
    let inside = Target::Path("~/Documents/a/../b.md");
    assert!(engine.authorize("desk", &scope, &inside).is_ok());
}

#[test]
fn a_scope_wider_than_the_grant_is_denied() {
    let mut engine = PermissionEngine::new();
    engine.grant("desk", fs_read(&["~/Documents/notes/**"]));
    let wider = fs_read(&["~/Documents/**"]);
    let err = engine
        .authorize("desk", &wider, &Target::Path("~/Documents/notes/a.md"))
        .unwrap_err();
    assert_eq!(
        err.permission, wider,
        "the denial names the scope that was missing"
    );
}

#[test]
fn grants_belong_to_one_caller_and_one_kind() {
    let mut engine = PermissionEngine::new();
    let scope = fs_read(&["~/**"]);
    engine.grant("plugin-a", scope.clone());
    assert!(
        engine
            .authorize("plugin-b", &scope, &Target::Path("~/a"))
            .is_err()
    );
    let hosts = net(&["api.example.com"]);
    assert!(
        engine
            .authorize("plugin-a", &hosts, &Target::Host("api.example.com"))
            .is_err()
    );
}

#[test]
fn host_scopes_match_exact_hosts_and_subdomain_wildcards() {
    let mut engine = PermissionEngine::new();
    let scope = net(&["*.example.com"]);
    engine.grant("desk", scope.clone());
    assert!(
        engine
            .authorize("desk", &scope, &Target::Host("api.example.com"))
            .is_ok()
    );
    assert!(
        engine
            .authorize("desk", &scope, &Target::Host("example.org"))
            .is_err()
    );
}
