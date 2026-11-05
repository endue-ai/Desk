//! Reading and checking one view, in either language (ADR 0102): an item view (specs/view/v0, ADR
//! 0032) passes `view.schema.json` and `desk_bridge::view_problems`; a universal view (ADR 0087)
//! passes `universal.schema.json` and, in the person's folder, has its id. A value with a `layout`
//! is an item view, one with a `type` or a `source` and no layout a universal view, so a broken
//! file is named by the schema of the language it was written in.

use std::io;
use std::path::Path;
use std::sync::OnceLock;

use desk_bridge::{AnyView, View, ViewSource, ViewSummary, view_problems};
use serde_json::{Value, json};

use crate::manifest::schema_registry;

const VIEW_SCHEMA: &str = "https://endue.ai/specs/view/v0/view.schema.json#/$defs/View";
const UNIVERSAL_SCHEMA: &str =
    "https://endue.ai/specs/view/v0/universal.schema.json#/$defs/UniversalView";

/// A view file as read from disk.
pub(crate) enum ViewFile {
    Valid(Box<AnyView>, String),
    /// What is wrong, naming the file.
    Invalid(String),
}

/// The id of a view in either language; a universal view may have none.
pub(crate) fn id_of(view: &AnyView) -> Option<&str> {
    match view {
        AnyView::View(view) => Some(&view.id),
        AnyView::Universal(view) => view.id.as_deref(),
    }
}

/// Read and check one of the person's view files, which must be named after its id. A file that
/// cannot be read at all is the io error.
pub(crate) fn read_view(path: &Path) -> io::Result<ViewFile> {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let bytes = std::fs::read(path)?;
    let stem = name.strip_suffix(".yaml").unwrap_or(&name);
    let checked = text_of(&name, bytes)
        .and_then(|text| Ok((check_any_view(&name, value_of(&name, &text, false)?)?, text)));
    Ok(match checked {
        Ok((view, text)) => match id_of(&view) {
            Some(id) if id == stem => ViewFile::Valid(Box::new(view), text),
            Some(id) => {
                ViewFile::Invalid(format!("{name}: its id is {id}; name the file {id}.yaml"))
            }
            None => ViewFile::Invalid(format!("{name}: a universal view needs its id ({stem})")),
        },
        Err(problem) => ViewFile::Invalid(problem),
    })
}

/// Parse one item view, JSON when `json` and YAML otherwise, and check it; returns it with its
/// text. Every problem starts with `name`.
pub(crate) fn parse_view(name: &str, bytes: Vec<u8>, json: bool) -> Result<(View, String), String> {
    let text = text_of(name, bytes)?;
    Ok((check_view(name, value_of(name, &text, json)?)?, text))
}

fn text_of(name: &str, bytes: Vec<u8>) -> Result<String, String> {
    String::from_utf8(bytes).map_err(|_| format!("{name}: not UTF-8"))
}

fn value_of(name: &str, text: &str, json: bool) -> Result<Value, String> {
    if json {
        return serde_json::from_str::<Value>(text).map_err(|e| format!("{name}: not JSON: {e}"));
    }
    let value = yaml_serde::from_str::<Option<Value>>(text);
    Ok(value
        .map_err(|e| format!("{name}: not YAML: {e}"))?
        .unwrap_or(Value::Null))
}

fn named(name: &str, problems: &[String]) -> String {
    let problems: Vec<String> = problems.iter().map(|p| format!("{name}{p}")).collect();
    problems.join("; ")
}

/// Check one item view: the schema, then `desk_bridge::view_problems`. Every problem starts with
/// `name`, followed by where it is.
pub(crate) fn check_view(name: &str, value: Value) -> Result<View, String> {
    let problems = schema_problems(&value, false);
    if !problems.is_empty() {
        return Err(named(name, &problems));
    }
    let view: View =
        serde_json::from_value(value).map_err(|e| format!("{name}: not a view: {e}"))?;
    let problems = view_problems(&view);
    if !problems.is_empty() {
        return Err(named(name, &problems));
    }
    Ok(view)
}

/// Whether a value is written as a universal view: a type or a source, and no layout.
pub(crate) fn is_universal(value: &Value) -> bool {
    value.get("layout").is_none() && (value.get("type").is_some() || value.get("source").is_some())
}

/// Check a view in either language, by how it is written.
pub(crate) fn check_any_view(name: &str, value: Value) -> Result<AnyView, String> {
    if !is_universal(&value) {
        return check_view(name, value).map(AnyView::View);
    }
    let problems = schema_problems(&value, true);
    if !problems.is_empty() {
        return Err(named(name, &problems));
    }
    serde_json::from_value(value)
        .map(AnyView::Universal)
        .map_err(|e| format!("{name}: not a universal view: {e}"))
}

/// view.list's line for a view: an item view's version, a universal view's type (and its id for a
/// title when it has none).
pub(crate) fn summary(view: AnyView, source: ViewSource, plugin: Option<String>) -> ViewSummary {
    match view {
        AnyView::View(view) => ViewSummary {
            id: view.id,
            version: Some(view.version),
            r#type: None,
            title: view.title,
            description: view.description,
            source,
            plugin,
        },
        AnyView::Universal(view) => {
            let id = view.id.unwrap_or_default();
            ViewSummary {
                title: view.title.unwrap_or_else(|| id.clone()),
                id,
                version: None,
                r#type: Some(view.r#type),
                description: view.description,
                source,
                plugin,
            }
        }
    }
}

/// Where `value` breaks its language's schema, each as `<pointer>: <problem>`.
fn schema_problems(value: &Value, universal: bool) -> Vec<String> {
    static VIEW: OnceLock<jsonschema::Validator> = OnceLock::new();
    static UNIVERSAL: OnceLock<jsonschema::Validator> = OnceLock::new();
    let (cell, schema) = if universal {
        (&UNIVERSAL, UNIVERSAL_SCHEMA)
    } else {
        (&VIEW, VIEW_SCHEMA)
    };
    let validator = cell.get_or_init(|| {
        jsonschema::options()
            .with_registry(schema_registry())
            .should_validate_formats(false)
            .build(&json!({ "$ref": schema }))
            .expect("the view schemas compile")
    });
    validator
        .iter_errors(value)
        .map(|e| format!("{}: {e}", e.instance_path()))
        .collect()
}
