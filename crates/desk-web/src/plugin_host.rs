//! Plugin surface hosts on the `desk-plugin` scheme (#36): `<surface>.<plugin label>`, the label
//! being the plugin id with every `-` doubled and then every `.` one `-` (`example.hello-ui` is
//! `example-hello--ui`). The runtime builds them (`packages/runtime/src/plugin-origins.ts`); the
//! schemes and the bridge read them back here.

/// The desk's own host on the scheme: theme fonts, the palette and banner pages.
pub const SHARED: &str = "localhost";

/// What a `desk-plugin` host names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PluginHost {
    Shared,
    /// One surface of the plugin `plugin`.
    Surface {
        surface: String,
        plugin: String,
    },
}

impl PluginHost {
    /// The host of a request, if it is the shared one or names a surface of a plugin. Windows'
    /// form (`<host>.localhost`) is read the same way.
    pub fn parse(host: &str) -> Option<Self> {
        if host == SHARED {
            return Some(Self::Shared);
        }
        let host = host.strip_suffix(".localhost").unwrap_or(host);
        let (surface, label) = host.split_once('.')?;
        let plugin = plugin_of(label)?;
        is_part(surface).then(|| Self::Surface {
            surface: surface.to_owned(),
            plugin,
        })
    }
}

/// A plugin id as one host label.
pub fn plugin_label(id: &str) -> String {
    id.replace('-', "--").replace('.', "-")
}

/// The plugin id a label names: in a run of hyphens each pair is one of the id's own and an odd last
/// one is a dot, since each part of an id starts with a letter.
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
    (parts.clone().count() > 1 && parts.all(is_part)).then_some(id)
}

/// A surface id, and each part of a plugin id: a lowercase letter, then letters, digits and `-`.
fn is_part(part: &str) -> bool {
    let mut chars = part.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::{PluginHost, plugin_label};

    fn surface(surface: &str, plugin: &str) -> Option<PluginHost> {
        Some(PluginHost::Surface {
            surface: surface.to_owned(),
            plugin: plugin.to_owned(),
        })
    }

    #[test]
    fn labels_round_trip_and_hosts_parse_in_both_forms() {
        assert_eq!(plugin_label("example.hello-ui"), "example-hello--ui");
        assert_eq!(PluginHost::parse("localhost"), Some(PluginHost::Shared));
        assert_eq!(
            PluginHost::parse("main.example-hello--ui"),
            surface("main", "example.hello-ui")
        );
        assert_eq!(
            PluginHost::parse("main.example-hello--ui.localhost"),
            surface("main", "example.hello-ui")
        );
        assert_eq!(PluginHost::parse("side-2.a---b"), surface("side-2", "a-.b"));
    }

    #[test]
    fn hosts_that_name_no_plugin_surface_are_refused() {
        for host in [
            "",
            "evil",
            "main.nodots",
            "Main.endue-notes",
            "main.endue--notes",
            "x.endue_notes",
            "main.-a-b",
        ] {
            assert_eq!(PluginHost::parse(host), None, "{host}");
        }
    }
}
