//! Which host a `desk-plugin` request names (#36): the shared host, or one surface of one plugin.
//!
//! A surface's host is `<surface>.<plugin label>`: the surface's id from its plugin's manifest (`main`
//! when it declares none), then the plugin id as one label, every `-` doubled and then every `.` one
//! `-` (`example.hello-ui` is `example-hello--ui`). The path keeps its shape, `/<plugin id>/<path>`.
//! Two labels make the whole host the site, so an engine that isolates sites gives each surface its
//! own process. Windows (WebView2) reaches the scheme as `http://desk-plugin.<host>.localhost`, which
//! wry hands over as `desk-plugin://<host>.localhost`. `packages/runtime/src/plugin-origins.ts` builds
//! these hosts.

/// The desk's own pages (the palette and banner windows) and files it loads itself (theme fonts).
const SHARED: &str = "localhost";
/// Windows' form of a surface host ends in this.
const LOCAL: &str = ".localhost";
/// The scheme in both forms, which every plugin page may load from.
const SOURCES: &str = "desk-plugin: http://desk-plugin.localhost";

/// Who a request's host says is asking.
#[derive(Debug, PartialEq, Eq)]
pub enum Host<'a> {
    Shared,
    /// One surface of the plugin `plugin`, whose host labels are `surface` and `label`.
    Surface {
        surface: &'a str,
        label: &'a str,
        plugin: String,
    },
}

impl<'a> Host<'a> {
    /// The host of a request, if it is the shared one or names a surface of a plugin.
    pub fn parse(host: Option<&'a str>) -> Option<Self> {
        let host = host?;
        if host == SHARED {
            return Some(Host::Shared);
        }
        let host = host.strip_suffix(LOCAL).unwrap_or(host);
        let (surface, label) = host.split_once('.')?;
        let plugin = plugin_of(label)?;
        is_surface_id(surface).then_some(Host::Surface {
            surface,
            label,
            plugin,
        })
    }

    /// Whether files under `/<id>/` may load on this host: any on the shared host, a surface's own
    /// plugin's on a surface's.
    pub fn serves(&self, id: &str) -> bool {
        match self {
            Host::Shared => true,
            Host::Surface { plugin, .. } => plugin == id,
        }
    }

    /// The CSP sources of a page on this host: the scheme in both forms, and a surface's own origin
    /// in Windows' form, which no single source of the shared form covers.
    pub fn sources(&self) -> String {
        match self {
            Host::Shared => SOURCES.to_owned(),
            Host::Surface { surface, label, .. } => {
                format!("{SOURCES} http://desk-plugin.{surface}.{label}{LOCAL}")
            }
        }
    }
}

/// The plugin id a label names, if it names one: the label undone (`pluginLabel` in the runtime made
/// it). Each part of an id starts with a letter, so in a run of hyphens each pair is one of the id's
/// own and an odd last one is a dot.
fn plugin_of(label: &str) -> Option<String> {
    let mut id = String::with_capacity(label.len());
    let mut chars = label.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '-' if chars.next_if_eq(&'-').is_some() => id.push('-'),
            '-' => id.push('.'),
            'a'..='z' | '0'..='9' => id.push(c),
            _ => return None,
        }
    }
    let mut parts = id.split('.');
    let named = parts.clone().count() > 1 && parts.all(is_surface_id);
    named.then_some(id)
}

/// A surface id, and each part of a plugin id: a lowercase letter, then letters, digits and `-`.
fn is_surface_id(part: &str) -> bool {
    let mut chars = part.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A plugin id as one host label, as `pluginLabel` in the runtime makes it.
    fn plugin_label(id: &str) -> String {
        id.replace('-', "--").replace('.', "-")
    }

    fn surface<'a>(surface: &'a str, label: &'a str, plugin: &str) -> Option<Host<'a>> {
        let plugin = plugin.to_owned();
        Some(Host::Surface {
            surface,
            label,
            plugin,
        })
    }

    #[test]
    fn a_label_is_the_id_with_hyphens_doubled_and_dots_as_one_hyphen() {
        for (id, label) in [
            ("endue.notes", "endue-notes"),
            ("example.hello-ui", "example-hello--ui"),
            ("a.b.c", "a-b-c"),
            ("a-.b", "a---b"),
            ("a.b-", "a-b--"),
        ] {
            assert_eq!(plugin_label(id), label);
            assert_eq!(plugin_of(label).as_deref(), Some(id), "{label}");
        }
    }

    #[test]
    fn parses_the_shared_host_and_a_surface_host_in_both_forms() {
        assert_eq!(Host::parse(Some("localhost")), Some(Host::Shared));
        let main = surface("main", "example-hello--ui", "example.hello-ui");
        assert_eq!(Host::parse(Some("main.example-hello--ui")), main);
        assert_eq!(Host::parse(Some("main.example-hello--ui.localhost")), main);
        let side = surface("side-2", "a---b", "a-.b");
        assert_eq!(Host::parse(Some("side-2.a---b")), side);
    }

    #[test]
    fn refuses_a_host_that_names_no_surface_of_a_plugin() {
        for host in [
            "",
            "evil",
            "example.com",
            "main",
            "main.",
            ".example-hello",
            "main.example",
            "main.example-",
            "main.-example",
            "main.example-1x",
            "Main.example-hello",
            "main.Example-hello",
            "2d.example-hello",
            "a.b.c",
            "main.example-hello.local",
            "main..localhost",
            "main.example_hello",
            "main.example-hello.localhost.localhost",
        ] {
            assert_eq!(Host::parse(Some(host)), None, "{host}");
        }
        assert_eq!(Host::parse(None), None);
    }

    #[test]
    fn a_surface_host_serves_only_its_own_plugin_and_the_shared_host_any() {
        let host = Host::parse(Some("main.example-hello")).unwrap();
        assert!(host.serves("example.hello"));
        assert!(!host.serves("example.other"));
        assert!(!host.serves("example.hello-ui"));
        assert!(Host::Shared.serves("example.other"));
    }

    #[test]
    fn a_surface_page_may_load_from_the_scheme_and_its_own_windows_origin() {
        assert_eq!(Host::Shared.sources(), SOURCES);
        let host = Host::parse(Some("main.example-hello.localhost")).unwrap();
        let own = "http://desk-plugin.main.example-hello.localhost";
        assert_eq!(host.sources(), format!("{SOURCES} {own}"));
    }
}
