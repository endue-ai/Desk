//! desk-computer's types in the bridge's shapes (specs/bridge/v0/computer.schema.json), and back.

use desk_bridge::{
    BridgeError, ComputerApp, ComputerAxAction, ComputerButton, ComputerDisplay, ComputerElement,
    ComputerElementRef, ComputerOsPermission, ComputerPoint, ComputerRect, ComputerTarget,
    ComputerWindow, ErrorCode,
};
use desk_computer::apps::App;
use desk_computer::ax::{AxAction, Element, ElementRef};
use desk_computer::input::Button;
use desk_computer::permissions::Permission;
use desk_computer::screen::{Display, Target, Window};
use desk_computer::{Point, Rect};

use crate::handler::error;

pub(crate) fn rect(rect: Rect) -> ComputerRect {
    ComputerRect {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}

pub(crate) fn from_rect(rect: &ComputerRect) -> Rect {
    Rect::new(rect.x, rect.y, rect.width, rect.height)
}

pub(crate) fn point(point: &ComputerPoint) -> Point {
    Point::new(point.x, point.y)
}

pub(crate) fn app(app: App) -> ComputerApp {
    ComputerApp {
        pid: i64::from(app.pid),
        name: app.name,
        bundle_id: app.bundle_id,
        path: app.path,
        active: app.active,
        hidden: app.hidden,
        regular: app.regular,
    }
}

pub(crate) fn window(window: Window) -> ComputerWindow {
    ComputerWindow {
        id: u64::from(window.id),
        pid: i64::from(window.pid),
        app: window.app,
        bundle_id: window.bundle_id,
        title: window.title,
        bounds: rect(window.bounds),
        layer: i64::from(window.layer),
        on_screen: window.on_screen,
    }
}

pub(crate) fn display(display: Display) -> ComputerDisplay {
    ComputerDisplay {
        id: u64::from(display.id),
        bounds: rect(display.bounds),
        scale: display.scale,
        main: display.main,
        builtin: display.builtin,
    }
}

/// An element with its path, and how many children it has when the walk asked.
pub(crate) fn element(element: Element, child_count: Option<u32>) -> ComputerElement {
    ComputerElement {
        path: element.path.into_iter().map(u64::from).collect(),
        role: element.role,
        subrole: element.subrole,
        title: element.title,
        value: element.value,
        description: element.description,
        frame: element.frame.map(rect),
        enabled: element.enabled,
        focused: element.focused,
        actions: element.actions,
        child_count: child_count.map(u64::from),
    }
}

/// A pid as the OS has them; `invalid_params` beyond what one can be.
pub(crate) fn pid(pid: i64) -> Result<i32, BridgeError> {
    i32::try_from(pid)
        .ok()
        .filter(|pid| *pid > 0)
        .ok_or_else(|| invalid(format!("{pid} is not a process id")))
}

pub(crate) fn element_ref(reference: &ComputerElementRef) -> Result<ElementRef, BridgeError> {
    let path = reference
        .path
        .iter()
        .map(|i| u32::try_from(*i).map_err(|_| invalid(format!("{i} is not a child index"))))
        .collect::<Result<Vec<u32>, _>>()?;
    let found = ElementRef::new(pid(reference.pid)?, path);
    Ok(match &reference.role {
        Some(role) => found.expecting(role),
        None => found,
    })
}

pub(crate) fn os_permission(permission: ComputerOsPermission) -> Permission {
    match permission {
        ComputerOsPermission::Accessibility => Permission::Accessibility,
        ComputerOsPermission::ScreenRecording => Permission::ScreenRecording,
    }
}

pub(crate) fn ax_action(action: ComputerAxAction) -> AxAction {
    match action {
        ComputerAxAction::Press => AxAction::Press,
        ComputerAxAction::Raise => AxAction::Raise,
        ComputerAxAction::ShowMenu => AxAction::ShowMenu,
        ComputerAxAction::Confirm => AxAction::Confirm,
        ComputerAxAction::Cancel => AxAction::Cancel,
        ComputerAxAction::Increment => AxAction::Increment,
        ComputerAxAction::Decrement => AxAction::Decrement,
        ComputerAxAction::Pick => AxAction::Pick,
    }
}

pub(crate) fn button(button: Option<ComputerButton>) -> Button {
    match button {
        None | Some(ComputerButton::Left) => Button::Left,
        Some(ComputerButton::Right) => Button::Right,
        Some(ComputerButton::Middle) => Button::Middle,
    }
}

/// What a screenshot shows: the main display without a target.
pub(crate) fn target(target: Option<&ComputerTarget>) -> Result<Target, BridgeError> {
    let id = |n: u64| u32::try_from(n).map_err(|_| invalid(format!("{n} is not an id")));
    Ok(match target {
        None => Target::MainDisplay,
        Some(ComputerTarget::ComputerDisplay(d)) => Target::Display(id(d.display)?),
        Some(ComputerTarget::ComputerWindow(w)) => Target::Window(id(w.window)?),
        Some(ComputerTarget::ComputerRegion(r)) => Target::Region(from_rect(&r.region)),
    })
}

pub(crate) fn invalid(message: String) -> BridgeError {
    error(ErrorCode::InvalidParams, message)
}
