//! Per-frame event delivery. Each frame (an OS window with its own runtime) receives the events of
//! the calls it made: turns, watches, processes and captures. Events nobody owns, like
//! `plugin.changed` and `perm.changed`, go to every frame.

use std::collections::{BTreeMap, HashMap};

use desk_bridge::{BrainTurnKind, BridgeEvent, BridgeRequest, BridgeResponse, RequestId};

/// How many unclaimed keys keep their early events.
const EARLY_KEYS: usize = 64;

/// Where an event goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    /// Every frame.
    All,
    /// One frame, by label.
    To(String),
    /// Nobody yet (the call that owns it has not answered) or nobody any more (its frame closed).
    Held,
}

#[derive(Debug, Default)]
pub struct FrameRouter {
    owners: HashMap<String, String>,
    early: BTreeMap<u64, (String, Vec<BridgeEvent>)>,
    arrivals: u64,
}

impl FrameRouter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Where `event` goes. An owned event whose call has not answered yet is held until it does.
    pub fn route(&mut self, event: &BridgeEvent) -> Delivery {
        let Some((key, last)) = event_key(event) else {
            return Delivery::All;
        };
        if let Some(frame) = self.owners.get(&key).cloned() {
            if last {
                self.owners.remove(&key);
            }
            return Delivery::To(frame);
        }
        self.hold(key, event.clone());
        Delivery::Held
    }

    /// `frame`'s call to `method` answered `response`: the work it started belongs to the frame.
    /// Returns the events that arrived before the answer, in order, for that frame.
    pub fn claim(
        &mut self,
        frame: &str,
        method: &str,
        response: &BridgeResponse,
    ) -> Vec<BridgeEvent> {
        let BridgeResponse::BridgeSuccess(success) = response else {
            return Vec::new();
        };
        let (prefix, field) = match method {
            "brain.say" => ("turn", "turnId"),
            "fs.watch" => ("watch", "watchId"),
            "proc.spawn" => ("proc", "procId"),
            "audio.capture.start" => ("capture", "captureId"),
            _ => return Vec::new(),
        };
        let Some(id) = success.result[field].as_str() else {
            return Vec::new();
        };
        let key = format!("{prefix}:{id}");
        let early = match self
            .early
            .iter()
            .find(|(_, (k, _))| *k == key)
            .map(|(n, _)| *n)
        {
            Some(arrival) => self
                .early
                .remove(&arrival)
                .map(|(_, e)| e)
                .unwrap_or_default(),
            None => Vec::new(),
        };
        let ended = early
            .iter()
            .any(|event| event_key(event).is_some_and(|(_, last)| last));
        if !ended {
            self.owners.insert(key, frame.to_owned());
        }
        early
    }

    /// A frame closed: its work keeps running in the core, but its events have nowhere to go.
    pub fn frame_closed(&mut self, frame: &str) {
        self.owners.retain(|_, owner| owner != frame);
    }

    fn hold(&mut self, key: String, event: BridgeEvent) {
        if let Some((_, events)) = self.early.values_mut().find(|(k, _)| *k == key) {
            events.push(event);
            return;
        }
        self.arrivals += 1;
        self.early.insert(self.arrivals, (key, vec![event]));
        while self.early.len() > EARLY_KEYS {
            self.early.pop_first();
        }
    }
}

/// A request's id and method, read without copying its params.
pub fn request_head(request: &BridgeRequest) -> (RequestId, &'static str) {
    use BridgeRequest as R;
    match request {
        R::FsRead(r) => (r.id, "fs.read"),
        R::FsWrite(r) => (r.id, "fs.write"),
        R::FsList(r) => (r.id, "fs.list"),
        R::FsWatch(r) => (r.id, "fs.watch"),
        R::ProcSpawn(r) => (r.id, "proc.spawn"),
        R::ProcWrite(r) => (r.id, "proc.write"),
        R::ProcResize(r) => (r.id, "proc.resize"),
        R::ProcKill(r) => (r.id, "proc.kill"),
        R::NetFetch(r) => (r.id, "net.fetch"),
        R::AudioCaptureStart(r) => (r.id, "audio.capture.start"),
        R::AudioCaptureStop(r) => (r.id, "audio.capture.stop"),
        R::UiSurfaceOpen(r) => (r.id, "ui.surface.open"),
        R::UiSurfaceClose(r) => (r.id, "ui.surface.close"),
        R::UiNotify(r) => (r.id, "ui.notify"),
        R::PermRequest(r) => (r.id, "perm.request"),
        R::PermQuery(r) => (r.id, "perm.query"),
        R::PermRevoke(r) => (r.id, "perm.revoke"),
        R::PluginList(r) => (r.id, "plugin.list"),
        R::PluginSetEnabled(r) => (r.id, "plugin.setEnabled"),
        R::StoreGet(r) => (r.id, "store.get"),
        R::StoreSet(r) => (r.id, "store.set"),
        R::BrainSay(r) => (r.id, "brain.say"),
    }
}

/// The key of an owned event and whether it is the last one for that key.
fn event_key(event: &BridgeEvent) -> Option<(String, bool)> {
    match event {
        BridgeEvent::BrainTurn(e) => Some((
            format!("turn:{}", e.data.turn_id),
            matches!(e.data.kind, BrainTurnKind::Completed | BrainTurnKind::Error),
        )),
        BridgeEvent::FsChanged(e) => Some((format!("watch:{}", e.data.watch_id), false)),
        BridgeEvent::ProcOutput(e) => Some((format!("proc:{}", e.data.proc_id), false)),
        BridgeEvent::ProcExit(e) => Some((format!("proc:{}", e.data.proc_id), true)),
        BridgeEvent::AudioWake(e) => Some((format!("capture:{}", e.data.capture_id), false)),
        BridgeEvent::PermChanged(_) | BridgeEvent::PluginChanged(_) => None,
    }
}
