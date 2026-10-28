//! The audio side of `Core`: audio.capture.start and audio.capture.stop, and audio.wake events from
//! the capture's wake-word detector. Audio itself never leaves the core.

use std::sync::Arc;
use std::time::Duration;

use desk_bridge::{
    AudioCaptureStartParams, AudioCaptureStartResult, AudioCaptureStopParams,
    AudioCaptureStopResult, AudioWakeData, AudioWakeEvent, BridgeEvent, ErrorCode, Permission,
};
use desk_sys::audio::{Capture, Microphone, WakeDetector};

use crate::core_proc::lock;
use crate::handler::{Answer, Core, denied, error, json};
use crate::perm::{Denied, Target};

/// After a wake word, the same capture stays quiet this long (one utterance, one event).
const REFRACTORY: Duration = Duration::from_millis(1500);

/// Makes one detector per capture.
pub type DetectorFactory = Arc<dyn Fn() -> Box<dyn WakeDetector> + Send + Sync>;

pub(crate) struct Audio {
    pub microphone: Arc<dyn Microphone>,
    pub detector: DetectorFactory,
}

impl Core {
    /// Capture from `microphone`, listening with a fresh `detector()` when the wake word is asked
    /// for. Without it, audio.capture.start answers `unsupported`.
    pub fn with_audio(
        mut self,
        microphone: Arc<dyn Microphone>,
        detector: DetectorFactory,
    ) -> Self {
        self.audio = Some(Audio {
            microphone,
            detector,
        });
        self
    }

    pub(crate) fn audio_capture_start(
        &self,
        caller: &str,
        params: AudioCaptureStartParams,
    ) -> Answer {
        let wake = params.wake_word == Some(true);
        let scope = Permission::AudioCapture(params.scope);
        if wake && !matches!(&scope, Permission::AudioCapture(s) if s.wake_word == Some(true)) {
            return Err(denied(Denied {
                permission: scope,
                reason: "the scope does not allow listening for the wake word".to_owned(),
            }));
        }
        let grant = self
            .permissions()
            .authorize(caller, &scope, &Target::None)
            .map_err(denied)?;
        let audio = self.audio.as_ref().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "this desk has no microphone".to_owned(),
            )
        })?;
        let capture_id = lock(&self.captures).next_id();
        let mut detector = wake.then(|| (audio.detector)());
        let (events, id) = (self.events().clone(), capture_id.clone());
        let (mut heard, mut quiet_until) = (0u64, 0u64);
        let on_frames = move |frames: &[f32], rate: u32| {
            heard += frames.len() as u64;
            let at_ms = heard * 1000 / u64::from(rate.max(1));
            let Some(detector) = detector.as_mut() else {
                return;
            };
            let Some(hit) = detector.feed(frames, rate) else {
                return;
            };
            if at_ms < quiet_until {
                return;
            }
            quiet_until = at_ms + REFRACTORY.as_millis() as u64;
            events.publish(BridgeEvent::AudioWake(AudioWakeEvent {
                event: Default::default(),
                data: AudioWakeData {
                    capture_id: id.clone(),
                    word: hit.word,
                    confidence: f64::from(hit.confidence.clamp(0.0, 1.0)),
                    at_ms,
                },
            }));
        };
        let rate = params.sample_rate.and_then(|r| u32::try_from(r).ok());
        let capture: Capture = audio
            .microphone
            .open(rate, Box::new(on_frames))
            .map_err(|e| {
                let code = match e.kind() {
                    std::io::ErrorKind::NotFound => ErrorCode::NotFound,
                    std::io::ErrorKind::Unsupported => ErrorCode::Unsupported,
                    _ => ErrorCode::IoError,
                };
                error(code, format!("the microphone did not open: {e}"))
            })?;
        lock(&self.captures).insert(capture_id.clone(), caller, &grant, capture);
        json(AudioCaptureStartResult { capture_id })
    }

    /// Close one of the caller's captures. One that already ended is not an error.
    pub(crate) fn audio_capture_stop(
        &self,
        caller: &str,
        params: AudioCaptureStopParams,
    ) -> Answer {
        self.permissions()
            .authorize(
                caller,
                &Permission::AudioCapture(params.scope),
                &Target::None,
            )
            .map_err(denied)?;
        drop(lock(&self.captures).remove(caller, &params.capture_id));
        json(AudioCaptureStopResult {})
    }
}
