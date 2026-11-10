//! One node of Chromium's accessibility tree, as CEF hands it over in JSON (`AXNodeData`: `id`,
//! `role`, `state`, `location` with its offset container, `child_ids`, `attributes`), and the
//! surface protocol's node it becomes (`SurfaceA11yNode`): AccessKit's role in kebab-case, its
//! words, its state and the actions a person's input can do on it. Chromium's roles are mostly
//! AccessKit's own under the same names; the rest are mapped here, and what has no meaning for a
//! screen reader (ignored, presentational, layout-only nodes) becomes a generic container, which
//! AccessKit leaves out and whose children it keeps.

use std::collections::HashSet;

use desk_compositor::a11y::role_of;
use desk_surface::generated::{
    SurfaceA11yActionName as Name, SurfaceA11yNode, SurfaceA11yToggled, SurfaceRect,
};
use serde_json::{Map, Value};

/// A node as Chromium serialized it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AxNode {
    pub role: String,
    pub states: HashSet<String>,
    pub attributes: Map<String, Value>,
    pub children: Vec<i64>,
    pub offset_container: Option<i64>,
    /// Relative to its offset container (or the tree's root), before its transform.
    pub bounds: [f64; 4],
    /// Row-major 2D affine `[a, b, c, d, e, f]` (`x' = a x + c y + e`).
    pub transform: Option<[f64; 6]>,
}

fn int(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
}

/// `[x, y, width, height]` of a `{x, y, width, height}` dictionary.
pub fn rect_of(v: &Value) -> Option<[f64; 4]> {
    let n = |k: &str| v.get(k).and_then(Value::as_f64);
    Some([n("x")?, n("y")?, n("width")?, n("height")?])
}

/// The 2D part of a `gfx::Transform` written as text (16 numbers row by row, or 6).
pub fn transform_of(text: &str) -> Option<[f64; 6]> {
    let numbers: Vec<f64> = (text.split(|c: char| !(c.is_ascii_digit() || "+-.eE".contains(c))))
        .filter_map(|t| t.parse().ok())
        .collect();
    match numbers.as_slice() {
        // rows: [m00 m01 m02 m03] [m10 m11 m12 m13] ...
        [m00, m01, _, m03, m10, m11, _, m13, ..] if numbers.len() == 16 => {
            Some([*m00, *m10, *m01, *m11, *m03, *m13])
        }
        [a, b, c, d, e, f] => Some([*a, *b, *c, *d, *e, *f]),
        _ => None,
    }
}

impl AxNode {
    /// The node `v` (an `AXNodeData` dictionary), and its id.
    pub fn parse(v: &Value) -> Option<(i64, AxNode)> {
        let id = int(v.get("id")?)?;
        let states = match v.get("state") {
            Some(Value::Array(all)) => (all.iter().filter_map(Value::as_str))
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            Some(Value::Object(all)) => (all.iter())
                .filter(|(_, on)| on.as_bool() != Some(false))
                .map(|(k, _)| k.clone())
                .collect(),
            _ => HashSet::new(),
        };
        let location = v.get("location");
        let bounds =
            (location.and_then(|l| rect_of(l.get("bounds").unwrap_or(l)))).unwrap_or_default();
        let offset_container = (v.get("offset_container_id"))
            .or_else(|| location.and_then(|l| l.get("offset_container_id")))
            .and_then(int)
            .filter(|c| *c != -1);
        let transform = (v.get("transform"))
            .or_else(|| location.and_then(|l| l.get("transform")))
            .and_then(Value::as_str)
            .and_then(transform_of);
        let children = (v.get("child_ids").and_then(Value::as_array))
            .map(|all| all.iter().filter_map(int).collect())
            .unwrap_or_default();
        let attributes = (v.get("attributes").and_then(Value::as_object))
            .cloned()
            .unwrap_or_default();
        let role = v
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned();
        Some((
            id,
            AxNode {
                role,
                states,
                attributes,
                children,
                offset_container,
                bounds,
                transform,
            },
        ))
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.attributes
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    }

    pub fn int(&self, key: &str) -> Option<i64> {
        self.attributes.get(key).and_then(int)
    }

    fn num(&self, key: &str) -> Option<f64> {
        self.attributes
            .get(key)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
    }

    fn flag(&self, key: &str) -> bool {
        self.attributes.get(key).and_then(Value::as_bool) == Some(true)
    }

    pub fn has(&self, state: &str) -> bool {
        self.states.contains(state)
    }

    /// Text runs Chromium splits static text into: their words are their parent's already.
    pub fn is_text_run(&self) -> bool {
        self.role == "inlineTextBox"
    }

    /// The DOM node it is (DevTools' `backendNodeId`), for the actions done through DevTools.
    pub fn dom_node(&self) -> Option<i64> {
        self.int("domNodeId").filter(|id| *id > 0)
    }

    /// The child tree an iframe node holds (another frame's document).
    pub fn child_tree(&self) -> Option<&str> {
        self.str("childTreeId")
    }

    /// Nothing a screen reader reads: an ignored or presentational node.
    fn is_ignored(&self) -> bool {
        self.has("ignored")
            || self.has("invisible")
            || matches!(self.role.as_str(), "none" | "ignored" | "presentational")
    }

    /// AccessKit's role for it, in kebab-case.
    pub fn role(&self) -> String {
        if self.is_ignored() {
            return "generic-container".into();
        }
        let input = self.str("inputType").unwrap_or_default();
        let mapped = match self.role.as_str() {
            "staticText" | "labelText" => "label",
            "textField" if self.has("multiline") => "multiline-text-input",
            "textField" => match input {
                "email" => "email-input",
                "password" => "password-input",
                "number" => "number-input",
                "tel" => "phone-number-input",
                "url" => "url-input",
                "search" => "search-input",
                _ => "text-input",
            },
            "searchBox" => "search-input",
            "textFieldWithComboBox" => "editable-combo-box",
            "comboBoxSelect" | "comboBoxMenuButton" | "comboBoxGrouping" => "combo-box",
            "toggleButton" | "popUpButton" => "button",
            "figcaption" => "figure-caption",
            "date" => "date-input",
            "dateTime" => "date-time-input",
            "inputTime" => "time-input",
            "descriptionListDetail" | "descriptionListDetailDeprecated" => "definition",
            "descriptionListTerm" | "descriptionListTermDeprecated" => "term",
            "mathMLMath" => "math",
            "imageMap" => "image",
            "headerAsNonLandmark" => "header",
            "footerAsNonLandmark" => "footer",
            "sectionWithoutName" => "section",
            "disclosureTriangleGrouped" => "disclosure-triangle",
            other => return kebab_if_known(other),
        };
        mapped.into()
    }

    /// What a person's input can do to it.
    pub fn actions(&self, role: &str) -> Vec<Name> {
        if role == "generic-container" {
            return Vec::new();
        }
        let mut all = Vec::new();
        let verb = self.str("defaultActionVerb").is_some_and(|v| v != "none");
        let pressable = matches!(
            role,
            "button"
                | "link"
                | "check-box"
                | "radio-button"
                | "switch"
                | "menu-item"
                | "menu-item-check-box"
                | "menu-item-radio"
                | "tab"
                | "list-box-option"
                | "tree-item"
                | "combo-box"
                | "disclosure-triangle"
                | "menu-list-option"
        );
        if verb || pressable {
            all.push(Name::Click);
        }
        if self.has("focusable") {
            all.extend([Name::Focus, Name::Blur]);
        }
        let editable = role.ends_with("-input") || role == "editable-combo-box";
        if editable || (self.has("richlyEditable") && self.flag("editableRoot")) {
            all.push(Name::SetValue);
        }
        if matches!(role, "slider" | "spin-button") {
            all.extend([Name::Increment, Name::Decrement]);
        }
        if self.has("collapsed") {
            all.push(Name::Expand);
        }
        if self.has("expanded") {
            all.push(Name::Collapse);
        }
        if self.dom_node().is_some() {
            all.push(Name::ScrollIntoView);
        }
        all
    }

    /// The protocol's node: `id`, its children's ids and its box in the surface.
    pub fn protocol(
        &self,
        id: u64,
        children: Vec<u64>,
        bounds: Option<[f64; 4]>,
    ) -> SurfaceA11yNode {
        let role = self.role();
        let shown = role != "generic-container";
        let text =
            |key: &str, max: usize| shown.then(|| self.str(key).map(|s| cut(s, max))).flatten();
        let name = text("name", 4096);
        // A label's words are its value in AccessKit (its static text).
        let (name, value) = if role == "label" {
            (None, name.map(|n| cut(&n, 65536)))
        } else {
            (name, text("value", 65536))
        };
        let toggled = match self.str("checkedState") {
            Some("true") => Some(SurfaceA11yToggled::True),
            Some("mixed") => Some(SurfaceA11yToggled::Mixed),
            Some("false") => Some(SurfaceA11yToggled::False),
            _ if role == "check-box" || role == "switch" => Some(SurfaceA11yToggled::False),
            _ => None,
        };
        let expanded = if self.has("expanded") {
            Some(true)
        } else if self.has("collapsed") {
            Some(false)
        } else {
            None
        };
        let actions = self.actions(&role);
        let num = |k: &str| shown.then(|| self.num(k)).flatten();
        SurfaceA11yNode {
            id,
            name,
            description: text("description", 4096),
            value,
            placeholder: text("placeholder", 1024),
            url: (role == "link").then(|| text("url", 8192)).flatten(),
            bounds: bounds.map(|[x, y, width, height]| SurfaceRect {
                x,
                y,
                width,
                height,
            }),
            children: (!children.is_empty()).then_some(children),
            actions: (!actions.is_empty()).then_some(actions),
            toggled: shown.then_some(toggled).flatten(),
            expanded: shown.then_some(expanded).flatten(),
            selected: (shown && self.attributes.contains_key("selected"))
                .then(|| self.flag("selected")),
            disabled: (shown && self.str("restriction") == Some("disabled")).then_some(true),
            level: self
                .int("hierarchicalLevel")
                .filter(|l| shown && (1..=255).contains(l))
                .map(|l| l as u64),
            numeric_value: num("valueForRange"),
            min_numeric_value: num("minValueForRange"),
            max_numeric_value: num("maxValueForRange"),
            role,
        }
    }
}

/// Chromium's camelCase role as AccessKit's kebab-case one, when AccessKit has it.
fn kebab_if_known(camel: &str) -> String {
    let mut kebab = String::with_capacity(camel.len() + 4);
    for c in camel.chars() {
        if c.is_ascii_uppercase() {
            kebab.push('-');
            kebab.push(c.to_ascii_lowercase());
        } else {
            kebab.push(c);
        }
    }
    if role_of(&kebab) == accesskit::Role::Unknown {
        "generic-container".into()
    } else {
        kebab
    }
}

/// At most `max` characters of `s`.
fn cut(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

#[cfg(test)]
#[path = "a11y_nodes_tests.rs"]
mod tests;
