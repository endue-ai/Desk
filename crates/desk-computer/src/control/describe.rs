//! Actions in words, for the guard's card, the log and `Done::summary`.

use crate::apps::{App, AppOp};
use crate::ax::{Element, Setting};
use crate::input::Mouse;
use crate::{Action, Point};

/// How much typed or set text a description quotes.
const QUOTE_CHARS: usize = 60;

/// The action in the imperative: `click left at (120, 340)`.
pub(super) fn action(action: &Action) -> String {
    match action {
        Action::Mouse(mouse) => match *mouse {
            Mouse::Move { to } => format!("move the pointer to {to}"),
            Mouse::Click { at, button, count } => {
                let times = match count {
                    1 => "click",
                    2 => "double-click",
                    3 => "triple-click",
                    _ => "click",
                };
                format!("{times} {} at {at}", button.name())
            }
            Mouse::Drag { from, to } => format!("drag from {from} to {to}"),
            Mouse::Scroll { at, dx, dy } => format!("scroll {}{}", lines(dx, dy), place(at)),
        },
        Action::Key(chord) => format!("press {chord}"),
        Action::Text(text) => format!("type {}", quote(text)),
        Action::Perform { element, action } => {
            format!("{} on {}", action.name(), element.describe())
        }
        Action::Set { element, setting } => match setting {
            Setting::Value(value) => format!("set {} to {}", element.describe(), quote(value)),
            Setting::Focused(true) => format!("focus {}", element.describe()),
            Setting::Focused(false) => format!("unfocus {}", element.describe()),
        },
        Action::Launch(launch) => format!("launch {launch}"),
        Action::App { pid, op } => format!("{} the app of pid {pid}", op.verb()),
    }
}

/// What a finished action did, with what it reached.
pub(super) fn done(
    action: &Action,
    events: usize,
    element: Option<&Element>,
    app: Option<&App>,
) -> String {
    let base = self::action(action);
    let reached = match (element, app, action) {
        (Some(element), _, _) => {
            let label = element.label().map(|l| format!(" {}", quote(l)));
            format!(" ({}{})", element.role, label.unwrap_or_default())
        }
        (
            None,
            Some(app),
            Action::App {
                op: AppOp::Quit, ..
            },
        ) => {
            format!(" ({} was asked to quit)", app.name)
        }
        (None, Some(app), _) => format!(" ({}, pid {})", app.name, app.pid),
        _ => String::new(),
    };
    let plural = if events == 1 { "event" } else { "events" };
    format!("{base}{reached}: {events} {plural}")
}

fn lines(dx: i32, dy: i32) -> String {
    let part = |n: i32, ahead: &str, back: &str| match n {
        0 => None,
        n if n > 0 => Some(format!("{n} {} {ahead}", unit(n))),
        n => Some(format!("{} {} {back}", -n, unit(n))),
    };
    [part(dy, "down", "up"), part(dx, "right", "left")]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" and ")
}

fn unit(n: i32) -> &'static str {
    if n.abs() == 1 { "line" } else { "lines" }
}

fn place(at: Option<Point>) -> String {
    at.map(|at| format!(" at {at}")).unwrap_or_default()
}

/// `"text"`, cut to `QUOTE_CHARS` characters with `…`, and how long it is when it was cut.
fn quote(text: &str) -> String {
    let count = text.chars().count();
    if count <= QUOTE_CHARS {
        return format!("{text:?}");
    }
    let cut: String = text.chars().take(QUOTE_CHARS).collect();
    format!("{:?} ({count} characters)", format!("{cut}…"))
}
