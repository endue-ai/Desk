//! The palette window frames the shipped palette UI, never an installed plugin impersonating
//! desk.palette: the binary embeds the very same files as the plugin folder holds and serves them at
//! `desk-plugin://localhost/_desk/palette/` (`plugin_scheme.rs`). Ported from the Tauri shell.

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
        "keys.js" => asset!("keys.js"),
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
    fn only_the_shipped_palette_files_are_served() {
        for name in [
            "index.html",
            "main.js",
            "keys.js",
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

    #[test]
    fn every_module_the_palette_imports_is_served() {
        for name in [
            "main.js",
            "providers.js",
            "search.js",
            "match.js",
            "keys.js",
        ] {
            let text =
                String::from_utf8_lossy(super::file(&format!("_desk/palette/{name}")).unwrap());
            for line in text.lines().filter(|l| l.starts_with("import ")) {
                let Some(local) = line.split('"').nth(1).and_then(|p| p.strip_prefix("./")) else {
                    continue;
                };
                let served = super::file(&format!("_desk/palette/{local}"));
                assert!(
                    served.is_some(),
                    "{name} imports {local}, which is not served"
                );
            }
        }
    }
}
