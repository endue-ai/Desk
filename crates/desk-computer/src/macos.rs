//! The macOS computer: Accessibility (AXUIElement) for the interface tree and its actions, CGEvent
//! for input, CoreGraphics for displays and the window list, ScreenCaptureKit for screenshots
//! (CGWindowListCreateImage before macOS 14), and NSWorkspace for apps and System Settings.
//!
//! This is the one module in desk-computer allowed `unsafe` (the workspace denies it everywhere
//! else). The C APIs take out-pointers, and the generated Objective-C bindings mark ScreenCaptureKit
//! methods `unsafe` because their contracts cannot be proven; each block calls one function with
//! the arguments its documentation asks for. Nothing unsafe leaves the module: `MacOs` is a safe
//! `Computer`, and each call checks the TCC permission it needs before it reaches the OS, because
//! without Accessibility the OS drops posted events silently and answers AX calls with errors.
#![allow(unsafe_code)]

use crate::apps::{App, AppOp, Launch};
use crate::ax::{AxAction, Budget, Element, ElementRef, Query, Setting, Tree};
use crate::input::Event;
use crate::permissions::{Permission, Permissions, missing};
use crate::screen::{Capture, Display, Screenshot, Window, WindowScope};
use crate::{Computer, Error, Focus, Permit};

mod apps;
mod ax;
mod capture;
mod cf;
mod events;
mod image;
mod screen;
mod tcc;

pub(crate) struct MacOs;

impl MacOs {
    pub(crate) fn new() -> Self {
        ax::set_timeout();
        Self
    }
}

fn require(permission: Permission, what: &str) -> Result<(), Error> {
    let granted = match permission {
        Permission::Accessibility => tcc::accessibility(false),
        Permission::ScreenRecording => tcc::screen_recording(),
    };
    if granted {
        Ok(())
    } else {
        Err(missing(permission, what))
    }
}

impl Computer for MacOs {
    fn permissions(&self) -> Result<Permissions, Error> {
        Ok(Permissions {
            accessibility: tcc::accessibility(false),
            screen_recording: tcc::screen_recording(),
            bundle_id: tcc::bundle_id(),
        })
    }

    fn request(&self, permission: Permission) -> Result<bool, Error> {
        Ok(match permission {
            Permission::Accessibility => tcc::accessibility(true),
            Permission::ScreenRecording => tcc::request_screen_recording(),
        })
    }

    fn open_settings(&self, permission: Permission) -> Result<(), Error> {
        tcc::open(permission.settings_url())
    }

    fn displays(&self) -> Result<Vec<Display>, Error> {
        screen::displays()
    }

    fn windows(&self, scope: WindowScope) -> Result<Vec<Window>, Error> {
        screen::windows(scope, tcc::screen_recording())
    }

    fn screenshot(&self, capture: &Capture) -> Result<Screenshot, Error> {
        require(Permission::ScreenRecording, "a screenshot")?;
        capture::screenshot(capture)
    }

    fn focused(&self) -> Result<Focus, Error> {
        require(Permission::Accessibility, "reading the focus")?;
        ax::focused()
    }

    fn tree(&self, root: &ElementRef, budget: Budget) -> Result<Tree, Error> {
        require(Permission::Accessibility, "reading the accessibility tree")?;
        ax::tree(root, budget)
    }

    fn find(
        &self,
        root: &ElementRef,
        query: &Query,
        budget: Budget,
    ) -> Result<Vec<Element>, Error> {
        require(Permission::Accessibility, "finding elements")?;
        ax::find(root, query, budget)
    }

    fn apps(&self) -> Result<Vec<App>, Error> {
        Ok(apps::running())
    }

    fn post(&self, event: &Event, _: &Permit) -> Result<(), Error> {
        require(Permission::Accessibility, "synthesized input")?;
        events::post(event)
    }

    fn perform(
        &self,
        element: &ElementRef,
        action: AxAction,
        _: &Permit,
    ) -> Result<Element, Error> {
        require(Permission::Accessibility, "an accessibility action")?;
        ax::perform(element, action)
    }

    fn set(&self, element: &ElementRef, setting: &Setting, _: &Permit) -> Result<Element, Error> {
        require(Permission::Accessibility, "setting an attribute")?;
        ax::set(element, setting)
    }

    fn launch(&self, launch: &Launch, _: &Permit) -> Result<App, Error> {
        launch.check()?;
        apps::launch(launch)
    }

    fn app(&self, pid: i32, op: AppOp, _: &Permit) -> Result<App, Error> {
        apps::act(pid, op)
    }
}
