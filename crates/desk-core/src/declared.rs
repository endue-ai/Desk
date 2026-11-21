//! A plugin is asked for, granted and allowed only what its manifest declares (ADR 0260). The core
//! reads an installed plugin's `permissions` at every ask (`capped`: perm.request, the calls that ask
//! by themselves, perm.grant, a prompt's wider offer, a dialog's grant) and at every check, so a
//! grant kept from before, or one the host made, allows nothing they do not cover. A declared `*`
//! host or program, or `/**` path, covers any the person names at run time; a scope that itself
//! holds `*` is never covered, so `*` widens what may be asked, never what is held, and an install
//! grants no declaration holding `*` or `/**`. Callers the core did not install as plugins (the
//! desk, the CLI, agents, MCP servers) are not bounded here.

use desk_bridge::Permission;

use crate::handler::Core;
use crate::paths::{endpoint_covers, normalize, pattern_covers};
use crate::perm::covers;

/// A declared host or program that stands for any named at run time.
const ANY: &str = "*";
/// A declared path that stands for any path named at run time.
const ANY_PATH: &str = "/**";

impl Core {
    /// Whether `caller` is an installed plugin and no permission its manifest declares covers
    /// `scope`. Any other caller declares nothing and is not bounded by it.
    pub(crate) fn undeclared(&self, caller: &str, scope: &Permission) -> bool {
        let registry = self.registry();
        let declared = registry.declared(caller);
        declared.is_some_and(|declared| !declared.iter().any(|d| declares(d, scope)))
    }

    /// What installing `plugin` grants of `permissions`: each one but those that hold a `*` host or
    /// program or a `/**` path, which say only what the plugin may be asked for at run time.
    pub(crate) fn grant_installed(&self, plugin: &str, permissions: Vec<Permission>) {
        for permission in permissions.into_iter().filter(|p| !open_ended(p)) {
            self.grant(plugin, permission);
        }
    }
}

/// Whether a permission a manifest declares lets its plugin have `scope`: as a grant covers it
/// (`perm::covers`), and a declared `*` host or program, or `/**` path, covers any, though never a
/// scope that holds `*` itself.
pub(crate) fn declares(declared: &Permission, scope: &Permission) -> bool {
    use Permission as P;
    if holds_star(scope) {
        return false;
    }
    match (declared, scope) {
        (P::FsRead(d), P::FsRead(s)) => paths(&d.paths, &s.paths),
        (P::FsWrite(d), P::FsWrite(s)) => paths(&d.paths, &s.paths),
        (P::ShellOpen(d), P::ShellOpen(s)) => {
            let schemes: Vec<_> = d.schemes.iter().flatten().collect();
            s.schemes.iter().flatten().all(|a| schemes.contains(&a))
                && paths(
                    d.paths.as_deref().unwrap_or_default(),
                    s.paths.as_deref().unwrap_or_default(),
                )
        }
        (P::ProcSpawn(d), P::ProcSpawn(s)) => {
            let any = d.commands.iter().any(|c| c == ANY);
            s.commands.iter().all(|c| any || d.commands.contains(c))
                && (s.pty != Some(true) || d.pty == Some(true))
        }
        (P::NetFetch(d), P::NetFetch(s)) => hosts(&d.hosts, &s.hosts),
        (P::NetConnect(d), P::NetConnect(s)) => hosts(&d.hosts, &s.hosts),
        (P::DbConnect(d), P::DbConnect(s)) => hosts(&d.hosts, &s.hosts),
        (P::WebBrowse(d), P::WebBrowse(s)) => sites(d.hosts.as_deref(), s.hosts.as_deref()),
        (P::WebControl(d), P::WebControl(s)) => sites(d.hosts.as_deref(), s.hosts.as_deref()),
        _ => covers(declared, scope),
    }
}

/// Whether a permission holds a `*` host or program or a `/**` path: it says what may be asked.
pub(crate) fn open_ended(permission: &Permission) -> bool {
    use Permission as P;
    let any_path = |paths: &[String]| {
        let any = normalize(ANY_PATH);
        paths.iter().any(|path| normalize(path) == any)
    };
    holds_star(permission)
        || match permission {
            P::FsRead(p) => any_path(&p.paths),
            P::FsWrite(p) => any_path(&p.paths),
            P::ShellOpen(p) => any_path(p.paths.as_deref().unwrap_or_default()),
            _ => false,
        }
}

/// Whether a scope holds a `*` host (with a port or without) or program.
fn holds_star(scope: &Permission) -> bool {
    use Permission as P;
    let star = |host: &String| host == ANY || host.starts_with("*:");
    match scope {
        P::NetFetch(s) => s.hosts.iter().any(star),
        P::NetConnect(s) => s.hosts.iter().any(star),
        P::DbConnect(s) => s.hosts.iter().any(star),
        P::WebBrowse(s) => s.hosts.iter().flatten().any(star),
        P::WebControl(s) => s.hosts.iter().flatten().any(star),
        P::ProcSpawn(s) => s.commands.iter().any(|c| c == ANY),
        _ => false,
    }
}

/// Every asked path pattern is under a declared one; a declared `/**` holds every rooted path.
fn paths(declared: &[String], asked: &[String]) -> bool {
    let any = normalize(ANY_PATH);
    asked.iter().all(|a| {
        declared
            .iter()
            .any(|d| (normalize(d) == any && normalize(a).is_some()) || pattern_covers(d, a))
    })
}

/// Every asked host is under a declared one: the name as a grant's covers it, and a declared host
/// without a port holds every port of it, as the net calls match hosts; a declared `*` holds any.
fn hosts(declared: &[String], asked: &[String]) -> bool {
    let any = declared.iter().any(|h| h == ANY);
    asked
        .iter()
        .all(|a| any || declared.iter().any(|d| endpoint_covers(d, a)))
}

/// web:browse and web:control: no declared list holds every site, and only it an asked absent list.
fn sites(declared: Option<&[String]>, asked: Option<&[String]>) -> bool {
    match (declared, asked) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(declared), Some(asked)) => hosts(declared, asked),
    }
}
