//! The native palette uses the shipped UI, never an installed plugin impersonating desk.palette.
//! Source files stay in the ordinary plugin folder; the binary embeds the very same UI.
const ROOT: &str = "_desk/palette/";

pub fn file(path: &str) -> Option<&'static [u8]> {
    macro_rules! asset {
        ($name:literal) => {
            include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../../plugins/palette/ui/",
                $name
            )) as &'static [u8]
        };
    }
    Some(match path.strip_prefix(ROOT)? {
        "index.html" => asset!("index.html"),
        "main.js" => asset!("main.js"),
        "match.js" => asset!("match.js"),
        "search.js" => asset!("search.js"),
        "providers.js" => asset!("providers.js"),
        "style.css" => asset!("style.css"),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_palette_has_its_own_enabled_capability() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/palette.json")).unwrap();
        assert!(
            config["app"]["security"]["capabilities"]
                .as_array()
                .unwrap()
                .contains(&capability["identifier"])
        );
        assert_eq!(capability["windows"], serde_json::json!(["palette"]));
        assert!(
            capability["permissions"]
                .as_array()
                .unwrap()
                .contains(&serde_json::json!("allow-bridge-call"))
        );
    }

    #[test]
    fn only_the_shipped_palette_files_are_served() {
        for name in [
            "index.html",
            "main.js",
            "providers.js",
            "search.js",
            "match.js",
            "style.css",
        ] {
            assert!(super::file(&format!("_desk/palette/{name}")).is_some());
        }
        assert!(super::file("_desk/palette/../../plugin.json").is_none());
        assert!(super::file("desk.palette/ui/main.js").is_none());
    }
}
