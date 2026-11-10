//! Names on the wire and AccessKit's (`accessibility.md`): a role in kebab-case (`text-input`) is
//! AccessKit's [`Role`] (`TextInput`, `textInput` in its serde form), and an action's name
//! (`scroll-into-view`) its [`Action`].

use accesskit::{Action, Role};
use desk_surface::generated::SurfaceA11yActionName as Name;
use serde_json::Value;

/// The role `name` (kebab-case) names; [`Role::Unknown`] for one AccessKit does not have.
pub fn role_of(name: &str) -> Role {
    // The schema's pattern: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`.
    let kebab = name.starts_with(|c: char| c.is_ascii_lowercase())
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !kebab {
        return Role::Unknown;
    }
    let mut camel = String::with_capacity(name.len());
    let mut upper = false;
    for c in name.chars() {
        match c {
            '-' => upper = true,
            c if upper => {
                camel.extend(c.to_uppercase());
                upper = false;
            }
            c => camel.push(c),
        }
    }
    serde_json::from_value(Value::String(camel)).unwrap_or(Role::Unknown)
}

/// `role`'s name on the wire, in kebab-case.
pub fn role_name(role: Role) -> String {
    let camel = serde_json::to_value(role).ok();
    let camel = camel.as_ref().and_then(Value::as_str).unwrap_or("unknown");
    let mut kebab = String::with_capacity(camel.len() + 4);
    for c in camel.chars() {
        if c.is_ascii_uppercase() {
            kebab.push('-');
            kebab.push(c.to_ascii_lowercase());
        } else {
            kebab.push(c);
        }
    }
    kebab
}

/// The AccessKit action an action's name stands for.
pub fn action_of(name: Name) -> Action {
    match name {
        Name::Click => Action::Click,
        Name::Focus => Action::Focus,
        Name::Blur => Action::Blur,
        Name::Collapse => Action::Collapse,
        Name::Expand => Action::Expand,
        Name::Increment => Action::Increment,
        Name::Decrement => Action::Decrement,
        Name::ScrollIntoView => Action::ScrollIntoView,
        Name::SetValue => Action::SetValue,
        Name::ShowContextMenu => Action::ShowContextMenu,
    }
}

/// The name of `action` on the wire, when a surface can be asked for it.
pub fn name_of(action: Action) -> Option<Name> {
    Some(match action {
        Action::Click => Name::Click,
        Action::Focus => Name::Focus,
        Action::Blur => Name::Blur,
        Action::Collapse => Name::Collapse,
        Action::Expand => Name::Expand,
        Action::Increment => Name::Increment,
        Action::Decrement => Name::Decrement,
        Action::ScrollIntoView => Name::ScrollIntoView,
        Action::SetValue => Name::SetValue,
        Action::ShowContextMenu => Name::ShowContextMenu,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_kebab_case_role_is_accesskits_and_back() {
        for (name, role) in [
            ("button", Role::Button),
            ("text-input", Role::TextInput),
            ("root-web-area", Role::RootWebArea),
            ("check-box", Role::CheckBox),
            ("generic-container", Role::GenericContainer),
            ("list-box-option", Role::ListBoxOption),
            ("svg-root", Role::SvgRoot),
        ] {
            assert_eq!(role_of(name), role, "{name}");
            assert_eq!(role_name(role), name, "{role:?}");
        }
    }

    #[test]
    fn a_role_accesskit_does_not_have_is_unknown() {
        for name in ["", "textInput", "made-up", "button-", "-button"] {
            assert_eq!(role_of(name), Role::Unknown, "{name}");
        }
    }

    #[test]
    fn every_action_name_is_an_accesskit_action_and_back() {
        let all = [
            Name::Click,
            Name::Focus,
            Name::Blur,
            Name::Collapse,
            Name::Expand,
            Name::Increment,
            Name::Decrement,
            Name::ScrollIntoView,
            Name::SetValue,
            Name::ShowContextMenu,
        ];
        for name in all {
            assert_eq!(name_of(action_of(name)), Some(name));
        }
        assert_eq!(name_of(Action::ScrollDown), None);
    }
}
