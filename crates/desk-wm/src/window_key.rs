//! A plugin window's key (ADR 0212). A plugin's first window is keyed by the plugin id; a file
//! opener that opens each file in a window of its own keys the later ones `<plugin>@<n>`, which the
//! desk page reports as the surface's plugin. desk-wm and the compositor seat and look up each
//! window by its key; the plugin is read from it where the plugin itself counts: a pane's plugin in
//! the snapshot, and in the shell its manifest and its native process.
//! `packages/runtime/src/instances.ts` makes the keys.

/// The plugin window `key` belongs to: the plugin id before `@<n>` when `key` is a later window's,
/// else `key` whole (an agent's view, such as `endue-agent:ana@home`, keeps its `@`).
pub fn plugin_of(key: &str) -> &str {
    let Some((plugin, n)) = key.rsplit_once('@') else {
        return key;
    };
    let number =
        n.starts_with(|c: char| ('1'..='9').contains(&c)) && n.bytes().all(|b| b.is_ascii_digit());
    let part = |part: &str| {
        part.starts_with(|c: char| c.is_ascii_lowercase())
            && (part.bytes()).all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    let id = plugin.contains('.') && plugin.split('.').all(part);
    if number && id { plugin } else { key }
}

#[cfg(test)]
mod tests {
    use super::plugin_of;

    #[test]
    fn a_later_window_belongs_to_the_plugin_before_its_number() {
        assert_eq!(plugin_of("endue.images@2"), "endue.images");
        assert_eq!(plugin_of("example.hello-ui@12"), "example.hello-ui");
        assert_eq!(plugin_of("endue.images"), "endue.images");
    }

    #[test]
    fn any_other_id_stays_whole() {
        for id in [
            "endue-agent:ana@home",
            "agent:x@2",
            "keys",
            "endue.images@x",
            "endue.images@0",
            "endue.images@",
            "a@2",
            "Endue.images@2",
        ] {
            assert_eq!(plugin_of(id), id, "{id}");
        }
    }
}
