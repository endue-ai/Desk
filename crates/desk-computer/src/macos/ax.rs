//! The accessibility tree over AXUIElement: reading elements, walking them with the shared walker,
//! naming an element again by its path, performing actions and setting attributes.

use std::ptr::NonNull;

use objc2_app_kit::NSWorkspace;
use objc2_application_services::{
    AXCopyMultipleAttributeOptions, AXError, AXUIElement, AXValue, AXValueType,
};
use objc2_core_foundation::{
    CFArray, CFBoolean, CFIndex, CFRetained, CFString, CFType, CGPoint, CGSize, Type,
};

use super::{apps, cf};
use crate::ax::{
    self as tree, AxAction, Budget, Element, ElementRef, MAX_DEPTH, Query, Setting, Source, Tree,
    clip,
};
use crate::permissions::{Permission, missing};
use crate::{Error, ErrorCode, Focus, Rect, invalid, not_found};

/// How long one AX message to an app may take before it answers `kAXErrorCannotComplete`; the
/// default is 6 s, long enough for a hung app to stall a walk.
const TIMEOUT_SECONDS: f32 = 1.5;

/// What `read` asks every element for, in one message.
const ATTRIBUTES: [&str; 9] = [
    "AXRole",
    "AXSubrole",
    "AXTitle",
    "AXValue",
    "AXDescription",
    "AXPosition",
    "AXSize",
    "AXEnabled",
    "AXFocused",
];

type Handle = CFRetained<AXUIElement>;

/// Set the messaging timeout for every element this process talks to.
pub(super) fn set_timeout() {
    // SAFETY: the system-wide element; setting its timeout sets the process-wide one.
    unsafe {
        let system = AXUIElement::new_system_wide();
        system.set_messaging_timeout(TIMEOUT_SECONDS);
    }
}

fn ax_error(error: AXError, what: &str) -> Error {
    let code = match error {
        AXError::ActionUnsupported
        | AXError::AttributeUnsupported
        | AXError::IllegalArgument
        | AXError::ParameterizedAttributeUnsupported => ErrorCode::InvalidParams,
        AXError::InvalidUIElement | AXError::NoValue => ErrorCode::NotFound,
        AXError::CannotComplete => ErrorCode::Timeout,
        AXError::APIDisabled => return missing(Permission::Accessibility, what),
        AXError::NotImplemented => ErrorCode::Unsupported,
        _ => ErrorCode::IoError,
    };
    Error::new(
        code,
        format!("{what}: the app answered AXError {}", error.0),
    )
}

fn attribute(element: &AXUIElement, name: &str) -> Result<CFRetained<CFType>, AXError> {
    let name = CFString::from_str(name);
    let mut value: *const CFType = std::ptr::null();
    // SAFETY: `value` is a valid out-pointer; on success it holds a +1 reference we take over.
    let error = unsafe { element.copy_attribute_value(&name, NonNull::from(&mut value)) };
    if error != AXError::Success {
        return Err(error);
    }
    NonNull::new(value.cast_mut())
        .map(|value| unsafe { CFRetained::from_raw(value) })
        .ok_or(AXError::NoValue)
}

fn children(element: &AXUIElement) -> Vec<Handle> {
    attribute(element, "AXChildren")
        .ok()
        .and_then(|value| value.downcast::<CFArray>().ok())
        .map(|array| cf::items::<AXUIElement>(&array))
        .unwrap_or_default()
}

fn child_count(element: &AXUIElement) -> u32 {
    let mut count: CFIndex = 0;
    let name = CFString::from_str("AXChildren");
    // SAFETY: `count` is a valid out-pointer.
    let error = unsafe { element.attribute_value_count(&name, NonNull::from(&mut count)) };
    if error == AXError::Success {
        count.max(0) as u32
    } else {
        0
    }
}

fn role(element: &AXUIElement) -> Result<String, AXError> {
    attribute(element, "AXRole").map(|role| cf::string(&role).unwrap_or_default())
}

/// An AXValue holding a CGPoint or CGSize.
fn ax_value<T: Default>(value: &CFType, kind: AXValueType) -> Option<T> {
    let value = value.downcast_ref::<AXValue>()?;
    let mut out = T::default();
    // SAFETY: `out` is a `T` of the layout `kind` names (CGPoint or CGSize).
    let ok = unsafe { value.value(kind, NonNull::from(&mut out).cast()) };
    ok.then_some(out)
}

/// One element's attributes, in one message, and its actions.
fn read(element: &AXUIElement) -> Element {
    let names: Vec<CFRetained<CFString>> =
        ATTRIBUTES.iter().map(|n| CFString::from_str(n)).collect();
    let names = CFArray::from_retained_objects(&names);
    let mut values: *const CFArray = std::ptr::null();
    // SAFETY: an array of attribute names and a valid out-pointer; on success it holds a +1
    // array with one entry per name, an AXValue of the AXError type where an attribute is missing.
    let error = unsafe {
        element.copy_multiple_attribute_values(
            names.as_opaque(),
            AXCopyMultipleAttributeOptions::empty(),
            NonNull::from(&mut values),
        )
    };
    let values: Vec<Option<CFRetained<CFType>>> = NonNull::new(values.cast_mut())
        .filter(|_| error == AXError::Success)
        .map(|values| unsafe { CFRetained::<CFArray>::from_raw(values) })
        .map(|array| {
            cf::all(&array)
                .into_iter()
                .map(|value| {
                    let missing = value.downcast_ref::<AXValue>().is_some_and(|v| {
                        // SAFETY: reads the type tag of a live AXValue.
                        let kind = unsafe { v.r#type() };
                        kind == AXValueType::AXError
                    });
                    (!missing).then_some(value)
                })
                .collect()
        })
        .unwrap_or_default();
    let get = |index: usize| values.get(index).and_then(Option::as_ref);
    let text = |index: usize| {
        get(index)
            .and_then(|v| cf::text(v))
            .filter(|t| !t.is_empty())
            .map(clip)
    };
    let position = get(5).and_then(|v| ax_value::<CGPoint>(v, AXValueType::CGPoint));
    let size = get(6).and_then(|v| ax_value::<CGSize>(v, AXValueType::CGSize));
    Element {
        path: Vec::new(),
        role: text(0).unwrap_or_else(|| "AXUnknown".to_owned()),
        subrole: text(1),
        title: text(2),
        value: text(3),
        description: text(4),
        frame: position
            .zip(size)
            .map(|(p, s)| Rect::new(p.x, p.y, s.width, s.height)),
        enabled: get(7).and_then(|v| cf::boolean(v)).unwrap_or(true),
        focused: get(8).and_then(|v| cf::boolean(v)).unwrap_or(false),
        actions: actions(element),
    }
}

fn actions(element: &AXUIElement) -> Vec<String> {
    let mut names: *const CFArray = std::ptr::null();
    // SAFETY: a valid out-pointer; on success it holds a +1 array of CFStrings.
    let error = unsafe { element.copy_action_names(NonNull::from(&mut names)) };
    if error != AXError::Success {
        return Vec::new();
    }
    NonNull::new(names.cast_mut())
        .map(|names| unsafe { CFRetained::<CFArray>::from_raw(names) })
        .map(|array| {
            cf::items::<CFString>(&array)
                .iter()
                .map(|name| name.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// The live AX tree as a walk source.
struct Live;

impl Source for Live {
    type Handle = Handle;

    fn children(&mut self, of: &Handle) -> Vec<Handle> {
        children(of)
    }

    fn child_count(&mut self, of: &Handle) -> u32 {
        child_count(of)
    }

    fn element(&mut self, of: &Handle) -> Element {
        read(of)
    }
}

fn application(pid: i32) -> Handle {
    // SAFETY: makes an element for a pid; nothing is sent to the app yet.
    unsafe { AXUIElement::new_application(pid) }
}

/// The element `target` names, checked against the role it expects.
fn resolve(target: &ElementRef) -> Result<Handle, Error> {
    let gone = || {
        not_found(format!(
            "there is no {}; read the tree again",
            target.describe()
        ))
    };
    let mut element = application(target.pid);
    role(&element).map_err(|e| match e {
        AXError::APIDisabled => missing(Permission::Accessibility, "the accessibility tree"),
        _ => not_found(format!(
            "no app with an interface runs with pid {}",
            target.pid
        )),
    })?;
    for &index in &target.path {
        element = children(&element)
            .into_iter()
            .nth(index as usize)
            .ok_or_else(gone)?;
    }
    if target.role.is_some() {
        target.check_role(&role(&element).map_err(|_| gone())?)?;
    }
    Ok(element)
}

pub(super) fn tree(root: &ElementRef, budget: Budget) -> Result<Tree, Error> {
    let element = resolve(root)?;
    Ok(tree::tree(
        &mut Live,
        root.pid,
        element,
        root.path.clone(),
        budget,
    ))
}

pub(super) fn find(
    root: &ElementRef,
    query: &Query,
    budget: Budget,
) -> Result<Vec<Element>, Error> {
    let element = resolve(root)?;
    Ok(tree::find(
        &mut Live,
        element,
        root.path.clone(),
        query,
        budget,
    ))
}

pub(super) fn perform(target: &ElementRef, action: AxAction) -> Result<Element, Error> {
    let element = resolve(target)?;
    let mut before = read(&element);
    before.path = target.path.clone();
    let name = CFString::from_str(action.name());
    // SAFETY: a live element and an action name.
    let error = unsafe { element.perform_action(&name) };
    if error != AXError::Success {
        return Err(ax_error(
            error,
            &format!("{} on {}", action.name(), target.describe()),
        ));
    }
    Ok(before)
}

pub(super) fn set(target: &ElementRef, setting: &Setting) -> Result<Element, Error> {
    let element = resolve(target)?;
    let attribute = CFString::from_str(setting.attribute());
    let what = format!("setting {} of {}", setting.attribute(), target.describe());
    let mut settable: u8 = 0;
    // SAFETY: a live element, an attribute name and a valid out-pointer.
    let error = unsafe { element.is_attribute_settable(&attribute, NonNull::from(&mut settable)) };
    if error != AXError::Success {
        return Err(ax_error(error, &what));
    }
    if settable == 0 {
        return Err(invalid(format!("{what}: the app does not let it be set")));
    }
    let text;
    let value: &CFType = match setting {
        Setting::Value(value) => {
            text = CFString::from_str(value);
            &text
        }
        Setting::Focused(focused) => CFBoolean::new(*focused),
    };
    // SAFETY: a live element, a settable attribute and a CFString or CFBoolean value.
    let error = unsafe { element.set_attribute_value(&attribute, value) };
    if error != AXError::Success {
        return Err(ax_error(error, &what));
    }
    let mut after = read(&element);
    after.path = target.path.clone();
    Ok(after)
}

/// The path of `element` below `app`: climb `AXParent` and find each step among its parent's
/// children. `None` when the chain does not reach the application within `MAX_DEPTH` steps.
fn path_of(element: &AXUIElement, app: &AXUIElement) -> Option<Vec<u32>> {
    let mut path = Vec::new();
    let mut current: Handle = element.retain();
    for _ in 0..MAX_DEPTH {
        if *current == *app || role(&current).ok()? == "AXApplication" {
            path.reverse();
            return Some(path);
        }
        let parent = attribute(&current, "AXParent")
            .ok()?
            .downcast::<AXUIElement>()
            .ok()?;
        let index = children(&parent).iter().position(|c| **c == *current)?;
        path.push(index as u32);
        current = parent;
    }
    None
}

fn focused_element(app: &AXUIElement, name: &str) -> Option<Element> {
    let element = attribute(app, name).ok()?.downcast::<AXUIElement>().ok()?;
    let path = path_of(&element, app)?;
    let mut element = read(&element);
    element.path = path;
    Some(element)
}

pub(super) fn focused() -> Result<Focus, Error> {
    let front = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .ok_or_else(|| not_found("no app is frontmost"))?;
    let app = apps::describe(&front);
    let element = application(app.pid);
    Ok(Focus {
        window: focused_element(&element, "AXFocusedWindow"),
        element: focused_element(&element, "AXFocusedUIElement"),
        app,
    })
}
