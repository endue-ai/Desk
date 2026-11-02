//! plugin.json validation against specs/plugin v0 (the schemas embedded in desk-bridge).

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use desk_bridge::{PluginManifest, SCHEMAS, ThemePackage};
use serde_json::{Value, json};

const MANIFEST_ID: &str = "https://endue.ai/specs/plugin/v0/plugin.schema.json";

/// Every schema embedded in desk-bridge (bridge, plugin and init), for `$ref`s between them.
pub(crate) fn schema_registry() -> &'static jsonschema::Registry<'static> {
    static REGISTRY: OnceLock<jsonschema::Registry<'static>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let resources = SCHEMAS.iter().map(|(id, text)| {
            let value: Value = serde_json::from_str(text).expect("embedded schema is JSON");
            ((*id).to_owned(), value)
        });
        jsonschema::Registry::new()
            .extend(resources)
            .and_then(|builder| builder.prepare())
            .expect("embedded schemas form a registry")
    })
}

fn validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        jsonschema::options()
            .with_registry(schema_registry())
            .should_validate_formats(false)
            .build(&json!({ "$ref": MANIFEST_ID }))
            .expect("the manifest schema compiles")
    })
}

/// Validate the plugin folder `dir`: plugin.json must match the schema, its entry, when it has one
/// (policy plugins have none), must exist, and so must a theme's font and image files.
/// Returns every problem found, each prefixed with where it is.
pub fn validate_dir(dir: &Path) -> Result<PluginManifest, Vec<String>> {
    let text = fs::read_to_string(dir.join("plugin.json"))
        .map_err(|e| vec![format!("plugin.json: cannot be read: {e}")])?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| vec![format!("plugin.json: not valid JSON: {e}")])?;
    let problems: Vec<String> = validator()
        .iter_errors(&value)
        .map(|error| format!("plugin.json{}: {error}", error.instance_path()))
        .collect();
    if !problems.is_empty() {
        return Err(problems);
    }
    let manifest: PluginManifest = serde_json::from_value(value).map_err(|e| {
        vec![format!(
            "plugin.json: does not match the manifest type: {e}"
        )]
    })?;
    if let Some(theme) = &manifest.theme {
        let problems = theme_assets(dir, theme);
        if !problems.is_empty() {
            return Err(problems);
        }
    }
    let Some(entry) = manifest.entry.as_deref() else {
        return Ok(manifest);
    };
    match inside(dir, entry) {
        Some(file) if file.is_file() => Ok(manifest),
        _ => Err(vec![format!("plugin.json: entry {entry} does not exist")]),
    }
}

/// A theme asset's size limit, and all of one theme's together (docs/ko/theme-requirements.md TH-09).
pub const THEME_ASSET_MAX: u64 = 2 << 20;
pub const THEME_ASSETS_MAX: u64 = 8 << 20;

/// A theme's font and image files: each inside the folder, a file, and within the size limits. The
/// schema already holds their extensions to .woff2 and .png, .jpg, .jpeg or .webp.
fn theme_assets(dir: &Path, theme: &ThemePackage) -> Vec<String> {
    let fonts = theme
        .r#type
        .iter()
        .flat_map(|t| t.fonts.iter().flatten())
        .map(|font| ("theme.type.fonts", font.src.as_str()));
    let images = [("light", &theme.light), ("dark", &theme.dark)]
        .into_iter()
        .filter_map(|(scheme, variant)| {
            let image = variant.as_ref()?.backdrop.as_ref()?.image.as_deref()?;
            Some((
                if scheme == "light" {
                    "theme.light.backdrop"
                } else {
                    "theme.dark.backdrop"
                },
                image,
            ))
        });
    let mut problems = Vec::new();
    let mut total = 0;
    for (place, path) in fonts.chain(images) {
        let size = inside(dir, path).and_then(|file| fs::metadata(file).ok());
        match size {
            Some(meta) if meta.is_file() => {
                total += meta.len();
                if meta.len() > THEME_ASSET_MAX {
                    problems.push(format!(
                        "plugin.json: {place}: {path} is {} bytes, over the {THEME_ASSET_MAX} a theme asset may have",
                        meta.len()
                    ));
                }
            }
            _ => problems.push(format!("plugin.json: {place}: {path} does not exist")),
        }
    }
    if total > THEME_ASSETS_MAX {
        problems.push(format!(
            "plugin.json: theme: its assets are {total} bytes, over the {THEME_ASSETS_MAX} a theme may bring"
        ));
    }
    problems
}

/// `dir` joined with the relative `path`, or `None` when the path is absolute or climbs out.
pub fn inside(dir: &Path, path: &str) -> Option<PathBuf> {
    if path.contains('\\') {
        return None;
    }
    let mut out = dir.to_path_buf();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// An id for a folder whose manifest has none: `local.<folder>`, lowercased and dashed.
pub fn fallback_id(dir: &Path) -> String {
    let folder = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let cleaned: String = folder
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    let body = if trimmed.is_empty() {
        "plugin"
    } else {
        trimmed
    };
    let body = if body.starts_with(|c: char| c.is_ascii_digit()) {
        format!("p{body}")
    } else {
        body.to_owned()
    };
    format!("local.{body}")
}
