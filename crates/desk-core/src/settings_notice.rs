//! Telling the person about setting values that fail (ADR 0080, ADR XXXX). The core logs every
//! problem and sends `settings.invalid`; the person learns of a value that fell back from one notice
//! on the desk (ui.notified from `core`, a warning), naming each value with its file and line. The
//! runtime's own init.get at its start is the first moment anything listens, so that call tells;
//! later ones tell only a value that is wrong in a new way, so the person is told once per problem.

use std::sync::atomic::Ordering;

use desk_bridge::{BridgeEvent, NotifyLevel, UiNotifiedData, UiNotifiedEvent};

use crate::handler::Core;
use crate::settings_report::{ProblemKind, SettingProblem};
use crate::sync::lock;

/// The caller the notice names: the core itself, as its other notices do.
const CORE: &str = "core";

impl Core {
    /// One notice for the values among `problems` that fell back and were not told yet.
    pub(crate) fn notice_settings(&self, problems: &[SettingProblem]) {
        let lines: Vec<String> = {
            let mut told = lock(&self.settings_noticed);
            problems
                .iter()
                .filter(|problem| matches!(problem.kind, ProblemKind::Invalid { .. }))
                .map(ToString::to_string)
                .filter(|line| told.insert(line.clone()))
                .collect()
        };
        if lines.is_empty() {
            return;
        }
        let title = match lines.len() {
            1 => "A setting value is not used".to_owned(),
            n => format!("{n} setting values are not used"),
        };
        let n = self.notifications.fetch_add(1, Ordering::Relaxed) + 1;
        self.events()
            .publish(BridgeEvent::UiNotified(UiNotifiedEvent {
                event: Default::default(),
                data: UiNotifiedData {
                    notification_id: format!("n-{n}"),
                    caller: CORE.to_owned(),
                    title,
                    body: Some(lines.join("\n")),
                    level: NotifyLevel::Warning,
                },
            }));
    }
}
