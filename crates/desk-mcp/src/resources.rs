//! Resources: `desk://plugins`, every plugin with the commands it provides now, and
//! `desk://plugins/<id>`, one plugin with its whole manifest. Both are JSON, read as `cli`.

use serde_json::{Value, json};

use crate::call::RpcError;
use crate::catalog::Catalog;
use crate::desk::Desk;
use crate::rpc::{INTERNAL_ERROR, RESOURCE_NOT_FOUND};
use crate::tools::Selection;

pub(crate) const INDEX: &str = "desk://plugins";
const ONE: &str = "desk://plugins/";
const JSON: &str = "application/json";

/// `resources/list`: the index, and one resource per installed plugin while the desk runs.
pub(crate) fn list(desk: &Desk) -> Value {
    let mut resources = vec![json!({
        "uri": INDEX,
        "name": "plugins",
        "title": "Desk plugins",
        "description": "The plugins installed in the running Desk with the commands each provides now",
        "mimeType": JSON
    })];
    if let Ok(catalog) = Catalog::read(desk) {
        for plugin in catalog.plugins() {
            let id = plugin["id"].as_str().unwrap_or_default();
            let manifest = &plugin["manifest"];
            let mut resource = json!({
                "uri": format!("{ONE}{id}"),
                "name": id,
                "title": manifest.get("name").unwrap_or(&plugin["id"]),
                "mimeType": JSON
            });
            if let Some(description) = manifest.get("description") {
                resource["description"] = description.clone();
            }
            resources.push(resource);
        }
    }
    json!({ "resources": resources })
}

/// `resources/read`.
pub(crate) fn read(desk: &Desk, selection: &Selection, uri: &str) -> Result<Value, RpcError> {
    let not_found = || (RESOURCE_NOT_FOUND, format!("no resource {uri}"));
    let one = uri.strip_prefix(ONE);
    if uri != INDEX && one.is_none_or(str::is_empty) {
        return Err(not_found());
    }
    let catalog = Catalog::read(desk).map_err(|failure| (INTERNAL_ERROR, failure.message))?;
    let content = match one {
        None => catalog.plugins_json(None, selection),
        Some(id) => catalog.plugin_json(id, selection),
    };
    let content = content.ok_or_else(not_found)?;
    Ok(json!({
        "contents": [{ "uri": uri, "mimeType": JSON, "text": content.to_string() }]
    }))
}
