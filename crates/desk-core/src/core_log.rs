//! The log side of `Core`: log.write to the caller's own channel, log.tail under `log:read`, and
//! `Core::log` for desk-core's own channel, `core`. The core stamps each entry with its clock and
//! masks secret-looking fields before the entry reaches the ring, the file (`log.rs`) or the bus,
//! where `log.entry` goes to the subscribers that hold `log:read`.

use std::path::PathBuf;
use std::sync::MutexGuard;

use desk_bridge::{
    BridgeEvent, ErrorCode, EventName, LogEntry, LogEntryEvent, LogLevel, LogReadPermission,
    LogTailParams, LogTailResult, LogWriteParams, LogWriteResult, Permission,
};
use serde_json::{Map, Value};

use crate::handler::{Answer, Core, error, json};
use crate::log::{Log, mask};
use crate::perm::Target;
use crate::time::rfc3339_millis;

/// The longest message log.write takes, in characters.
const MAX_MESSAGE_CHARS: usize = 8_000;

/// How many entries log.tail answers without a `count`, and at most.
const TAIL_DEFAULT: u64 = 100;
const TAIL_MAX: u64 = 1_000;

/// desk-core's own channel.
const CORE_CHANNEL: &str = "core";

impl Core {
    /// Keep the log in `dir` (the app's logs folder) as `desk.log` and `desk.log.1`, and start with
    /// the entries they hold. Without it the log lasts until the core goes.
    pub fn with_log_dir(self, dir: PathBuf) -> Self {
        *self.log_book() = Log::open(dir);
        self
    }

    /// Write to desk-core's own channel, `core`, as log.write does for a caller.
    pub fn log(
        &self,
        level: LogLevel,
        message: impl Into<String>,
        fields: Option<Map<String, Value>>,
    ) {
        self.append(CORE_CHANNEL, level, message.into(), fields);
    }

    pub(crate) fn log_write(&self, caller: &str, params: LogWriteParams) -> Answer {
        let length = params.message.chars().count();
        if !(1..=MAX_MESSAGE_CHARS).contains(&length) {
            return Err(error(
                ErrorCode::InvalidParams,
                format!("a message is 1 to {MAX_MESSAGE_CHARS} characters; this one is {length}"),
            ));
        }
        self.append(caller, params.level, params.message, params.fields);
        json(LogWriteResult {})
    }

    pub(crate) fn log_tail(&self, caller: &str, params: LogTailParams) -> Answer {
        let count = params.count.unwrap_or(TAIL_DEFAULT);
        if !(1..=TAIL_MAX).contains(&count) {
            return Err(error(
                ErrorCode::InvalidParams,
                format!("count is 1 to {TAIL_MAX}; asked {count}"),
            ));
        }
        self.check(caller, &Permission::LogRead(params.scope), &Target::None)?;
        let entries = self
            .log_book()
            .tail(params.channel.as_deref(), count as usize);
        json(LogTailResult { entries })
    }

    /// Stamp, mask and keep one entry, then publish it as `log.entry`. The stamp and the ring are
    /// taken under one lock, so write order is time order across channels.
    fn append(
        &self,
        channel: &str,
        level: LogLevel,
        message: String,
        fields: Option<Map<String, Value>>,
    ) {
        let to = self.log_readers();
        let fields = fields.map(mask);
        let mut log = self.log_book();
        let entry = LogEntry {
            at: rfc3339_millis(self.clock.now()),
            channel: channel.to_owned(),
            level,
            message,
            fields,
        };
        log.push(entry.clone());
        self.events().publish_to(
            to,
            BridgeEvent::LogEntry(LogEntryEvent {
                event: Default::default(),
                data: entry,
            }),
        );
    }

    /// The callers subscribed to `log.entry` that hold `log:read`.
    fn log_readers(&self) -> Vec<String> {
        let subscribed = self.recipients(EventName::LogEntry, Vec::new());
        let scope = Permission::LogRead(LogReadPermission {
            permission: Default::default(),
        });
        let permissions = self.permissions();
        subscribed
            .into_iter()
            .filter(|caller| {
                let allowed = permissions.authorize(caller, &scope, &Target::None);
                allowed.is_ok()
            })
            .collect()
    }

    fn log_book(&self) -> MutexGuard<'_, Log> {
        self.log
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
