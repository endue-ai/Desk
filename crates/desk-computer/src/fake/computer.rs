//! `FakeComputer`'s answers.

use std::marker::PhantomData;

use super::{Call, FakeComputer, State};
use crate::apps::{App, AppOp, Launch};
use crate::ax::{self, AxAction, Budget, Element, ElementRef, Node, Query, Setting, Source, Tree};
use crate::input::Event;
use crate::permissions::{Permission, Permissions, missing};
use crate::screen::{Capture, Display, Screenshot, Window, WindowScope};
use crate::{Computer, Error, Focus, Permit, invalid, not_found};

/// A scripted tree as a walk source.
struct Scripted<'a>(PhantomData<&'a Node>);

impl<'a> Source for Scripted<'a> {
    type Handle = &'a Node;

    fn children(&mut self, of: &&'a Node) -> Vec<&'a Node> {
        of.children.iter().collect()
    }

    fn element(&mut self, of: &&'a Node) -> Element {
        of.element.clone()
    }
}

fn need(state: &State, permission: Permission, what: &str) -> Result<(), Error> {
    let granted = match permission {
        Permission::Accessibility => state.accessibility,
        Permission::ScreenRecording => state.screen_recording,
    };
    if granted {
        Ok(())
    } else {
        Err(missing(permission, what))
    }
}

fn node_at<'a>(root: &'a Node, path: &[u32]) -> Option<&'a Node> {
    path.iter()
        .try_fold(root, |node, &i| node.children.get(i as usize))
}

fn node_at_mut<'a>(root: &'a mut Node, path: &[u32]) -> Option<&'a mut Node> {
    path.iter()
        .try_fold(root, |node, &i| node.children.get_mut(i as usize))
}

fn gone(target: &ElementRef) -> Error {
    not_found(format!("there is no {}", target.describe()))
}

/// The node `target` names, checked against the role it expects.
fn resolve<'a>(state: &'a State, target: &ElementRef) -> Result<&'a Node, Error> {
    let root = state.trees.get(&target.pid).ok_or_else(|| gone(target))?;
    let node = node_at(root, &target.path).ok_or_else(|| gone(target))?;
    target.check_role(&node.element.role)?;
    Ok(node)
}

/// The element at `path` of `pid`'s tree, with its path.
fn element_at(state: &State, pid: i32, path: &[u32]) -> Option<Element> {
    let node = node_at(state.trees.get(&pid)?, path)?;
    let mut element = node.element.clone();
    element.path = path.to_vec();
    Some(element)
}

fn frontmost(state: &State) -> Option<&App> {
    state
        .apps
        .iter()
        .find(|app| app.active)
        .or(state.apps.first())
}

fn bring_forward(apps: &mut [App], pid: i32) -> Option<App> {
    for app in apps.iter_mut() {
        app.active = app.pid == pid;
        if app.active {
            app.hidden = false;
        }
    }
    apps.iter().find(|app| app.pid == pid).cloned()
}

impl Computer for FakeComputer {
    fn permissions(&self) -> Result<Permissions, Error> {
        let state = self.record(Call::Permissions);
        Ok(Permissions {
            accessibility: state.accessibility,
            screen_recording: state.screen_recording,
            bundle_id: None,
        })
    }

    fn request(&self, permission: Permission) -> Result<bool, Error> {
        let mut state = self.record(Call::Request(permission));
        let answer = state.answer;
        let granted = match permission {
            Permission::Accessibility => &mut state.accessibility,
            Permission::ScreenRecording => &mut state.screen_recording,
        };
        *granted |= answer;
        Ok(*granted)
    }

    fn open_settings(&self, permission: Permission) -> Result<(), Error> {
        drop(self.record(Call::OpenSettings(permission)));
        Ok(())
    }

    fn displays(&self) -> Result<Vec<Display>, Error> {
        Ok(self.record(Call::Displays).displays.clone())
    }

    fn windows(&self, scope: WindowScope) -> Result<Vec<Window>, Error> {
        let state = self.record(Call::Windows(scope));
        let titles = state.screen_recording;
        Ok(state
            .windows
            .iter()
            .filter(|w| scope == WindowScope::All || w.on_screen)
            .cloned()
            .map(|mut window| {
                if !titles {
                    window.title = None;
                }
                window
            })
            .collect())
    }

    fn screenshot(&self, capture: &Capture) -> Result<Screenshot, Error> {
        let state = self.record(Call::Screenshot(*capture));
        need(&state, Permission::ScreenRecording, "a screenshot")?;
        state
            .shots
            .iter()
            .find(|(target, _)| *target == capture.target)
            .map(|(_, shot)| shot.clone())
            .ok_or_else(|| not_found(format!("nothing to capture for {:?}", capture.target)))
    }

    fn focused(&self) -> Result<Focus, Error> {
        let state = self.record(Call::Focused);
        need(&state, Permission::Accessibility, "reading the focus")?;
        let app = frontmost(&state)
            .cloned()
            .ok_or_else(|| not_found("no app is frontmost"))?;
        let at = |path: &Option<Vec<u32>>| {
            path.as_deref()
                .and_then(|path| element_at(&state, app.pid, path))
        };
        Ok(Focus {
            window: at(&state.focus.0),
            element: at(&state.focus.1),
            app,
        })
    }

    fn tree(&self, root: &ElementRef, budget: Budget) -> Result<Tree, Error> {
        let state = self.record(Call::Tree(root.clone(), budget));
        need(
            &state,
            Permission::Accessibility,
            "reading the accessibility tree",
        )?;
        let node = resolve(&state, root)?;
        Ok(ax::tree(
            &mut Scripted(PhantomData),
            root.pid,
            node,
            root.path.clone(),
            budget,
        ))
    }

    fn find(
        &self,
        root: &ElementRef,
        query: &Query,
        budget: Budget,
    ) -> Result<Vec<Element>, Error> {
        let state = self.record(Call::Find(root.clone(), query.clone(), budget));
        need(&state, Permission::Accessibility, "finding elements")?;
        let node = resolve(&state, root)?;
        Ok(ax::find(
            &mut Scripted(PhantomData),
            node,
            root.path.clone(),
            query,
            budget,
        ))
    }

    fn apps(&self) -> Result<Vec<App>, Error> {
        Ok(self.record(Call::Apps).apps.clone())
    }

    fn post(&self, event: &Event, _: &Permit) -> Result<(), Error> {
        let mut state = self.record(Call::Post(event.clone()));
        need(&state, Permission::Accessibility, "synthesized input")?;
        match event {
            Event::Move { to } | Event::Drag { to, .. } => state.pointer = *to,
            Event::Down { at, .. } | Event::Up { at, .. } => state.pointer = *at,
            _ => {}
        }
        Ok(())
    }

    fn perform(&self, target: &ElementRef, action: AxAction, _: &Permit) -> Result<Element, Error> {
        let state = self.record(Call::Perform(target.clone(), action));
        need(&state, Permission::Accessibility, "an accessibility action")?;
        let node = resolve(&state, target)?;
        let actions = &node.element.actions;
        if !actions.is_empty() && !actions.iter().any(|a| a == action.name()) {
            return Err(invalid(format!(
                "{} ({}) does not offer {}",
                target.describe(),
                node.element.role,
                action.name()
            )));
        }
        let mut element = node.element.clone();
        element.path = target.path.clone();
        Ok(element)
    }

    fn set(&self, target: &ElementRef, setting: &Setting, _: &Permit) -> Result<Element, Error> {
        let mut state = self.record(Call::Set(target.clone(), setting.clone()));
        need(&state, Permission::Accessibility, "setting an attribute")?;
        resolve(&state, target)?;
        let root = state
            .trees
            .get_mut(&target.pid)
            .ok_or_else(|| gone(target))?;
        let node = node_at_mut(root, &target.path).ok_or_else(|| gone(target))?;
        match setting {
            Setting::Value(value) => node.element.value = Some(value.clone()),
            Setting::Focused(focused) => node.element.focused = *focused,
        }
        let mut element = node.element.clone();
        element.path = target.path.clone();
        Ok(element)
    }

    fn launch(&self, launch: &Launch, _: &Permit) -> Result<App, Error> {
        let mut state = self.record(Call::Launch(launch.clone()));
        let names = |app: &App| match launch {
            Launch::BundleId(id) => app.bundle_id.as_deref() == Some(id),
            Launch::Path(path) => app.path.as_deref() == Some(path),
        };
        if let Some(pid) = state.apps.iter().find(|app| names(app)).map(|app| app.pid) {
            return bring_forward(&mut state.apps, pid).ok_or_else(|| not_found("gone"));
        }
        let mut app = state
            .installed
            .iter()
            .find(|app| names(app))
            .cloned()
            .ok_or_else(|| not_found(format!("no app {launch} is installed")))?;
        app.pid = state.next_pid;
        state.next_pid += 1;
        state.apps.push(app.clone());
        bring_forward(&mut state.apps, app.pid).ok_or_else(|| not_found("gone"))
    }

    fn app(&self, pid: i32, op: AppOp, _: &Permit) -> Result<App, Error> {
        let mut state = self.record(Call::App(pid, op));
        let missing = || not_found(format!("no app runs with pid {pid}"));
        let index = state
            .apps
            .iter()
            .position(|app| app.pid == pid)
            .ok_or_else(missing)?;
        match op {
            AppOp::Activate => bring_forward(&mut state.apps, pid).ok_or_else(missing),
            AppOp::Hide => {
                let app = &mut state.apps[index];
                app.hidden = true;
                app.active = false;
                Ok(app.clone())
            }
            AppOp::Quit => Ok(state.apps.remove(index)),
        }
    }
}
