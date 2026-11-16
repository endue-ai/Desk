//! The audio side of `Core`: audio.capture.start and audio.capture.stop over the injected input
//! (`Core::with_audio`: desk-sys's cpal input in the app, its fake in tests), ADR 0245. A capture
//! needs `audio:capture`, asked once as perm.request asks, then the OS's own grant. Its 20 ms frames
//! reach only its caller as `audio.frame`; `audio.ended` comes once, last, with the reason; and the
//! runtime hears `audio.capturing`, every capture in force, on each change, so the chrome shows that
//! the microphone is on. A capture belongs to its caller, and ends when the caller stops it, the
//! runtime stops it for the person, the caller unloads, its grant goes, or its last surface closes.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use base64::Engine as _;
use desk_bridge::{
    AudioCaptureInForce, AudioCaptureStartParams, AudioCaptureStartResult, AudioCaptureStopParams,
    AudioCaptureStopResult, AudioCapturingData, AudioCapturingEvent, AudioEndReason,
    AudioEndedData, AudioEndedEvent, AudioFrameData, AudioFrameEvent, BridgeEvent, ErrorCode,
    Permission,
};
use desk_sys::audio::{
    AudioInput, Authorization, Capture, CaptureOptions, DEFAULT_SAMPLE_RATE, Event,
};

use crate::events::EventBus;
use crate::handler::{Answer, Core, error, json, sys_error};
use crate::perm::Target;

/// The caller the person's own chrome speaks as; it may stop any capture.
const RUNTIME: &str = "desk";
const REASON: &str = "listens to the microphone";
/// The captures one caller may hold at once; another start is `forbidden` until one ends.
pub(crate) const MAX_PER_CALLER: usize = 4;
/// How many ended ids are remembered, so that stopping one again is not an error.
const ENDED: usize = 256;

struct Entry {
    caller: String,
    scope: Permission,
    capture: Arc<Capture>,
    /// Why it ends, set before it is stopped; its callback reads it for `audio.ended`.
    reason: Arc<Mutex<AudioEndReason>>,
}

/// The captures callers started, by id, in the order they started, and the ids that ended (a stop of
/// one of those is not an error). Shared with each capture's callback, which removes its entry when
/// the capture ends.
#[derive(Default)]
pub(crate) struct Captures {
    next: u64,
    entries: BTreeMap<u64, (String, Entry)>,
    ended: VecDeque<(String, String)>,
}

impl Captures {
    fn find(&self, id: &str) -> Option<u64> {
        self.entries
            .iter()
            .find(|(_, (capture_id, _))| capture_id == id)
            .map(|(key, _)| *key)
    }

    fn has_ended(&self, caller: &str, id: &str) -> bool {
        self.ended
            .iter()
            .any(|(c, e)| (caller == RUNTIME || c == caller) && e == id)
    }

    fn remember_ended(&mut self, caller: &str, id: &str) {
        if self.ended.len() == ENDED {
            self.ended.pop_front();
        }
        self.ended.push_back((caller.to_owned(), id.to_owned()));
    }

    fn held_by(&self, caller: &str) -> usize {
        self.entries
            .values()
            .filter(|(_, e)| e.caller == caller)
            .count()
    }

    fn in_force(&self) -> Vec<AudioCaptureInForce> {
        self.entries
            .values()
            .map(|(capture_id, entry)| AudioCaptureInForce {
                capture_id: capture_id.clone(),
                caller: entry.caller.clone(),
            })
            .collect()
    }
}

/// The input and the captures: what `Core` keeps for audio.*.
#[derive(Default)]
pub(crate) struct Audio {
    input: Option<Arc<dyn AudioInput>>,
    captures: Arc<Mutex<Captures>>,
}

impl Core {
    /// The microphones audio.capture.* reads; without one both answer `unsupported`.
    pub fn with_audio(mut self, input: Arc<dyn AudioInput>) -> Self {
        self.audio.input = Some(input);
        self
    }

    pub(crate) fn audio_capture_start(
        &self,
        caller: &str,
        params: AudioCaptureStartParams,
    ) -> Answer {
        if params.wake_word == Some(true) {
            return Err(error(
                ErrorCode::Unsupported,
                "the desk has no wake-word engine yet; capture without wakeWord".to_owned(),
            ));
        }
        let input = self.audio.input.clone().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "this desk has no microphone input".to_owned(),
            )
        })?;
        let scope = Permission::AudioCapture(params.scope);
        self.check_or_ask(caller, &scope, &Target::None, REASON)?;
        if input.authorization() == Authorization::NotDetermined {
            input.request_access().map_err(sys_error)?;
        }
        let sample_rate = match params.sample_rate {
            Some(rate) => u32::try_from(rate).unwrap_or(u32::MAX),
            None => DEFAULT_SAMPLE_RATE,
        };
        let options = CaptureOptions {
            device: None,
            sample_rate,
        };
        // The table stays locked until the capture is stored, so an end that comes at once still
        // finds the entry it removes.
        let mut captures = lock(&self.audio.captures);
        if captures.held_by(caller) >= MAX_PER_CALLER {
            return Err(error(
                ErrorCode::Forbidden,
                format!("{caller} already holds {MAX_PER_CALLER} captures; stop one first"),
            ));
        }
        captures.next += 1;
        let key = captures.next;
        let capture_id = format!("a-{key}");
        let reason = Arc::new(Mutex::new(AudioEndReason::Stopped));
        let report = Reporter {
            key,
            capture_id: capture_id.clone(),
            caller: caller.to_owned(),
            sample_rate,
            reason: Arc::clone(&reason),
            events: self.events().clone(),
            captures: Arc::downgrade(&self.audio.captures),
        };
        let capture = input
            .capture(&options, Box::new(move |event| report.on(event)))
            .map_err(sys_error)?;
        let entry = Entry {
            caller: caller.to_owned(),
            scope,
            capture: Arc::new(capture),
            reason,
        };
        captures.entries.insert(key, (capture_id.clone(), entry));
        // Under the table's lock, so the runtime hears the lists in the order they changed.
        capturing(self.events(), captures.in_force());
        drop(captures);
        json(AudioCaptureStartResult { capture_id })
    }

    /// Owning the capture is all a stop needs, as net.close: a stop only takes access away, and a
    /// `once` grant the start spent must not leave the caller unable to stop its own capture.
    pub(crate) fn audio_capture_stop(
        &self,
        caller: &str,
        params: AudioCaptureStopParams,
    ) -> Answer {
        let id = params.capture_id;
        let taken = {
            let mut captures = lock(&self.audio.captures);
            let owned = captures
                .find(&id)
                .filter(|key| caller == RUNTIME || captures.entries[key].1.caller == caller);
            match owned {
                Some(key) => captures.entries.remove(&key).map(|(_, entry)| entry),
                None if captures.has_ended(caller, &id) => None,
                None => {
                    return Err(error(
                        ErrorCode::NotFound,
                        format!("{caller} has no capture {id}"),
                    ));
                }
            }
        };
        if let Some(entry) = taken {
            let reason = if entry.caller == caller {
                AudioEndReason::Stopped
            } else {
                AudioEndReason::StoppedByPerson
            };
            end(entry, reason);
        }
        json(AudioCaptureStopResult {})
    }

    /// The caller unloaded: its captures end.
    pub(crate) fn drop_captures(&self, caller: &str) {
        self.end_captures(AudioEndReason::PluginStopped, |entry| {
            entry.caller == caller
        });
    }

    /// The caller's last surface closed: its captures end.
    pub(crate) fn surfaces_gone(&self, caller: &str) {
        self.end_captures(AudioEndReason::SurfaceClosed, |entry| {
            entry.caller == caller
        });
    }

    /// End the caller's captures that its grants no longer cover.
    pub(crate) fn prune_captures(&self, caller: &str) {
        let permissions = self.permissions();
        let lost: Vec<u64> = lock(&self.audio.captures)
            .entries
            .iter()
            .filter(|(_, (_, entry))| {
                entry.caller == caller
                    && permissions
                        .authorize(caller, &entry.scope, &Target::None)
                        .is_err()
            })
            .map(|(key, _)| *key)
            .collect();
        drop(permissions);
        let taken: Vec<Entry> = {
            let mut captures = lock(&self.audio.captures);
            lost.iter()
                .filter_map(|key| captures.entries.remove(key).map(|(_, entry)| entry))
                .collect()
        };
        for entry in taken {
            end(entry, AudioEndReason::Revoked);
        }
    }

    /// A caller of the desk socket (`cli`, `agent:<id>`) has no connection left: nothing of its
    /// can stop its captures any more, so they end.
    pub fn caller_left(&self, caller: &str) {
        self.end_captures(AudioEndReason::PluginStopped, |entry| {
            entry.caller == caller
        });
    }

    /// How many captures are running, for tests and diagnostics.
    pub fn capture_count(&self) -> usize {
        lock(&self.audio.captures).entries.len()
    }

    fn end_captures(&self, reason: AudioEndReason, ends: impl Fn(&Entry) -> bool) {
        let taken: Vec<Entry> = {
            let mut captures = lock(&self.audio.captures);
            let keys: Vec<u64> = captures
                .entries
                .iter()
                .filter(|(_, (_, entry))| ends(entry))
                .map(|(key, _)| *key)
                .collect();
            keys.iter()
                .filter_map(|key| captures.entries.remove(key).map(|(_, entry)| entry))
                .collect()
        };
        for entry in taken {
            end(entry, reason);
        }
    }
}

/// Stop a capture taken out of the table, not under its lock: `Capture::stop` waits for the
/// callback, which reports the end and the list in force.
fn end(entry: Entry, reason: AudioEndReason) {
    *lock(&entry.reason) = reason;
    entry.capture.stop();
}

/// The callback of one capture: its frames as `audio.frame` for the caller, then `audio.ended` and
/// the runtime's `audio.capturing`, once the entry has left the table.
struct Reporter {
    key: u64,
    capture_id: String,
    caller: String,
    sample_rate: u32,
    reason: Arc<Mutex<AudioEndReason>>,
    events: EventBus,
    captures: Weak<Mutex<Captures>>,
}

impl Reporter {
    fn on(&self, event: Event) {
        match event {
            Event::Frame(frame) => {
                let pcm: Vec<u8> = frame.samples.iter().flat_map(|s| s.to_le_bytes()).collect();
                let data = AudioFrameData {
                    capture_id: self.capture_id.clone(),
                    at_ms: frame.at_ms,
                    sample_rate: u64::from(self.sample_rate),
                    pcm: base64::engine::general_purpose::STANDARD.encode(pcm),
                    rms_db: f64::from(frame.level.rms_db),
                    peak_db: f64::from(frame.level.peak_db),
                };
                self.events.publish_to(
                    vec![self.caller.clone()],
                    BridgeEvent::AudioFrame(AudioFrameEvent {
                        event: Default::default(),
                        data,
                    }),
                );
            }
            Event::End(failure) => self.ended(failure),
        }
    }

    fn ended(&self, failure: Option<desk_sys::Error>) {
        let (reason, message) = match failure {
            Some(err) => (AudioEndReason::Device, Some(err.message)),
            None => (*lock(&self.reason), None),
        };
        let ended = BridgeEvent::AudioEnded(AudioEndedEvent {
            event: Default::default(),
            data: AudioEndedData {
                capture_id: self.capture_id.clone(),
                reason,
                message,
            },
        });
        let Some(captures) = self.captures.upgrade() else {
            self.events.publish_to(vec![self.caller.clone()], ended);
            return;
        };
        // A device failure ends a capture still in the table: it leaves it here, and its `Capture`
        // is dropped on this thread once the table is unlocked, which `Capture::stop` allows. The
        // end and the new list go out under the table's lock, in the order the table changed.
        let gone = {
            let mut captures = lock(&captures);
            let gone = captures.entries.remove(&self.key);
            captures.remember_ended(&self.caller, &self.capture_id);
            self.events.publish_to(vec![self.caller.clone()], ended);
            capturing(&self.events, captures.in_force());
            gone
        };
        drop(gone);
    }
}

/// `audio.capturing` for the runtime: every capture in force.
fn capturing(events: &EventBus, captures: Vec<AudioCaptureInForce>) {
    events.publish_to(
        vec![RUNTIME.to_owned()],
        BridgeEvent::AudioCapturing(AudioCapturingEvent {
            event: Default::default(),
            data: AudioCapturingData { captures },
        }),
    );
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
