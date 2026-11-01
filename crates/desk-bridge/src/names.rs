//! The rules of views and plugin manifests that a JSON Schema cannot say: the names a document uses
//! must resolve inside it. `SCHEMAS` checks shapes; these check names (`specs/view/v0`,
//! `specs/connector/v0`). Every problem starts with the JSON pointer of the value it is about.

use serde_json::Value;

use crate::{PluginManifest, View, ViewNode};

/// Every `$name` source of a binding that is not one of the view's `requires`, and every
/// `{params.<name>}` a template reads that is not one of its `params`, sorted.
pub fn view_problems(view: &View) -> Vec<String> {
    let mut sources = Vec::new();
    let mut templates = vec![("/title".to_owned(), view.title.clone())];
    walk(&view.layout, "/layout", &mut sources, &mut templates);
    let required = |name: &str| view.requires.as_ref().is_some_and(|r| r.contains_key(name));
    let declared = |name: &str| view.params.as_ref().is_some_and(|p| p.contains_key(name));
    let mut problems = Vec::new();
    for (at, source) in sources {
        if let Some(name) = source.strip_prefix('$')
            && !required(name)
        {
            problems.push(format!("{at}: {source} is not one of the view's requires"));
        }
    }
    for (at, text) in templates {
        for name in params_read(&text) {
            if !declared(&name) {
                problems.push(format!(
                    "{at}: {{params.{name}}} reads a param the view does not declare"
                ));
            }
        }
    }
    problems.sort();
    problems
}

/// The problems of an inline view (under `/view`), and every action of a connector resource that is
/// not a command the plugin declares in `contributes.commands`, sorted.
pub fn manifest_problems(manifest: &PluginManifest) -> Vec<String> {
    let mut problems: Vec<String> = manifest
        .view
        .iter()
        .flat_map(view_problems)
        .map(|problem| format!("/view{problem}"))
        .collect();
    if let Some(connector) = &manifest.connector {
        let commands = manifest
            .contributes
            .as_ref()
            .and_then(|c| c.commands.as_ref());
        let declared = |id: &str| commands.is_some_and(|cs| cs.iter().any(|c| c.id == id));
        for (r, resource) in connector.resources.iter().enumerate() {
            for (a, id) in resource.actions.iter().flatten().enumerate() {
                if !declared(id) {
                    problems.push(format!(
                        "/connector/resources/{r}/actions/{a}: {id} is not in contributes.commands"
                    ));
                }
            }
        }
    }
    problems.sort();
    problems
}

/// Collect the binding sources and the templates of `node` and its children, with their pointers.
fn walk(
    node: &ViewNode,
    at: &str,
    sources: &mut Vec<(String, String)>,
    templates: &mut Vec<(String, String)>,
) {
    match node {
        ViewNode::ViewContainer(container) => {
            if let Some(title) = &container.title {
                templates.push((format!("{at}/title"), title.clone()));
            }
            for (i, child) in container.children.iter().enumerate() {
                walk(child, &format!("{at}/children/{i}"), sources, templates);
            }
        }
        ViewNode::ViewComponent(component) => {
            if let Some(title) = &component.title {
                templates.push((format!("{at}/title"), title.clone()));
            }
            if let Some(binding) = &component.binding {
                for (i, source) in binding.sources.iter().flatten().enumerate() {
                    sources.push((format!("{at}/binding/sources/{i}"), source.clone()));
                }
                for (i, condition) in binding.r#where.iter().flatten().enumerate() {
                    let value = condition.value.as_ref().unwrap_or(&Value::Null);
                    strings(value, &format!("{at}/binding/where/{i}/value"), templates);
                }
            }
            for (i, field) in component.fields.iter().flatten().enumerate() {
                templates.push((format!("{at}/fields/{i}/value"), field.value.clone()));
            }
            for (i, action) in component.actions.iter().flatten().enumerate() {
                let args = action.args.as_ref().unwrap_or(&Value::Null);
                strings(args, &format!("{at}/actions/{i}/args"), templates);
            }
            if let Some(text) = &component.text {
                templates.push((format!("{at}/text"), text.clone()));
            }
        }
    }
}

/// Every string inside `value`, with its pointer.
fn strings(value: &Value, at: &str, out: &mut Vec<(String, String)>) {
    match value {
        Value::String(text) => out.push((at.to_owned(), text.clone())),
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                strings(item, &format!("{at}/{i}"), out);
            }
        }
        Value::Object(map) => {
            for (key, item) in map {
                strings(item, &format!("{at}/{key}"), out);
            }
        }
        _ => {}
    }
}

/// The params a template reads (`{params.days}` reads `days`); `{{` and `}}` are literal braces.
fn params_read(text: &str) -> Vec<String> {
    let text = text.replace("{{", "").replace("}}", "");
    text.split('{')
        .skip(1)
        .filter_map(|rest| {
            let mut parts = rest.split(['}', '|']).next()?.split('.');
            (parts.next() == Some("params"))
                .then(|| parts.next())
                .flatten()
        })
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}
