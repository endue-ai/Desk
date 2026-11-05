//! The brains a desk chooses from (ADR 0094): endue AI, the local brain on Ollama and
//! examples/brain-echo. The runtime's own setting `brain.use` picks one for every turn (init.yaml:
//! `desk.brain.use`) and `brain.model` names the local model. A remote brain that cannot be reached
//! hands its turns to the local brain; a local choice never reaches out. Each brain keeps its
//! sessions in a file of its own, and they share turn numbers so turn ids never repeat.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};

use desk_brain::Brain;
use desk_bridge::BrainName;

use crate::conversation::{BrainMode, BrainOptions, Conversation, Fallback, Tools};
use crate::events::EventBus;
use crate::handler::Core;

/// The local model when the runtime's `brain.model` names none.
pub const DEFAULT_LOCAL_MODEL: &str = "llama3.2";
/// The runtime's settings that choose the brain: the owner and the keys.
const OWNER: &str = "desk";
const USE: &str = "brain.use";
const MODEL: &str = "brain.model";

/// Makes the local brain for a model (the app: `LocalBrain` on Ollama).
pub type LocalBrains = Arc<dyn Fn(&str) -> Result<Arc<dyn Brain>, String> + Send + Sync>;

/// The brains a desk can choose from. Any may be missing; a choice the desk does not have goes to
/// the first it has, in the order endue, echo, local.
#[derive(Clone, Default)]
pub struct Brains {
    endue: Option<Arc<dyn Brain>>,
    echo: Option<Arc<dyn Brain>>,
    local: Option<LocalBrains>,
    folder: Option<PathBuf>,
    options: BrainOptions,
}

impl Brains {
    /// endue AI: the brain behind the person's endue ID.
    pub fn with_endue(mut self, brain: Arc<dyn Brain>) -> Self {
        self.endue = Some(brain);
        self
    }

    /// examples/brain-echo, or any brain a developer points the desk at.
    pub fn with_echo(mut self, brain: Arc<dyn Brain>) -> Self {
        self.echo = Some(brain);
        self
    }

    /// The local brain, made once per model as the setting names it.
    pub fn with_local(
        mut self,
        make: impl Fn(&str) -> Result<Arc<dyn Brain>, String> + Send + Sync + 'static,
    ) -> Self {
        self.local = Some(Arc::new(make));
        self
    }

    /// Keep each brain's sessions in `folder`: `brain.json` (endue), `brain-echo.json` and
    /// `brain-local-<model>.json`. Without it they last until the core goes.
    pub fn with_folder(mut self, folder: impl Into<PathBuf>) -> Self {
        self.folder = Some(folder.into());
        self
    }

    /// Leases and retries for every brain; their state files and modes are set per brain.
    pub fn with_options(mut self, options: BrainOptions) -> Self {
        self.options = options;
        self
    }

    fn has(&self, name: BrainName) -> bool {
        match name {
            BrainName::Endue => self.endue.is_some(),
            BrainName::Echo => self.echo.is_some(),
            BrainName::Local => self.local.is_some(),
        }
    }
}

/// The conversation a turn goes to now, and where it goes when that brain is out of reach.
pub(crate) struct Picked {
    pub conversation: Arc<Conversation>,
    pub fallback: Option<Fallback>,
    /// The brain the desk chose; `None` on a desk with one brain (`with_brain`).
    pub chosen: Option<BrainName>,
}

pub(crate) struct BrainChoice {
    brains: Brains,
    events: EventBus,
    made: Mutex<BTreeMap<String, Arc<Conversation>>>,
    said: Arc<AtomicBool>,
    turns: Arc<AtomicU64>,
    asks: Arc<AtomicU64>,
    tools: OnceLock<Weak<dyn Tools>>,
}

impl BrainChoice {
    fn pick(&self, chosen: BrainName, model: &str) -> Option<Picked> {
        let name = [chosen, BrainName::Endue, BrainName::Echo, BrainName::Local]
            .into_iter()
            .find(|name| self.brains.has(*name))?;
        let conversation = self.conversation(name, model)?;
        let fallback = (name != BrainName::Local)
            .then(|| self.conversation(BrainName::Local, model))
            .flatten()
            .map(|to| Fallback {
                to,
                said: Arc::clone(&self.said),
            });
        Some(Picked {
            conversation,
            fallback,
            chosen: Some(name),
        })
    }

    /// The conversation with `name`, made the first time it is asked for.
    fn conversation(&self, name: BrainName, model: &str) -> Option<Arc<Conversation>> {
        let (key, file, mode) = match name {
            BrainName::Endue => (
                "endue".to_owned(),
                "brain.json".to_owned(),
                BrainMode::Cloud,
            ),
            BrainName::Echo => (
                "echo".to_owned(),
                "brain-echo.json".to_owned(),
                BrainMode::Cloud,
            ),
            BrainName::Local => (
                format!("local:{model}"),
                format!("brain-local-{}.json", file_safe(model)),
                BrainMode::Local {
                    model: model.to_owned(),
                },
            ),
        };
        if let Some(made) = self.lock().get(&key) {
            return Some(Arc::clone(made));
        }
        let brain = match name {
            BrainName::Endue => self.brains.endue.clone()?,
            BrainName::Echo => self.brains.echo.clone()?,
            BrainName::Local => (self.brains.local.as_ref()?)(model).ok()?,
        };
        let options = BrainOptions {
            state_file: self.brains.folder.as_ref().map(|folder| folder.join(file)),
            mode,
            ..self.brains.options.clone()
        };
        let events = self.events.clone();
        let (turns, asks) = (Arc::clone(&self.turns), Arc::clone(&self.asks));
        let made = Conversation::counted(brain, events, options, turns, asks);
        if let Some(tools) = self.tools.get() {
            made.route(tools.clone());
        }
        let mut all = self.lock();
        Some(Arc::clone(all.entry(key).or_insert(made)))
    }

    fn route(&self, tools: Weak<dyn Tools>) {
        if self.tools.set(tools.clone()).is_ok() {
            for made in self.lock().values() {
                made.route(tools.clone());
            }
        }
    }

    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, Arc<Conversation>>> {
        self.made
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// A model name as part of a file name: letters, digits, `.`, `-` and `_`; anything else is `_`.
fn file_safe(model: &str) -> String {
    model
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => c,
            _ => '_',
        })
        .collect()
}

impl Core {
    /// Let the runtime's setting choose Eris's brain among `brains` for every turn (ADR 0094).
    pub fn with_brains(mut self, brains: Brains) -> Self {
        for file in ["brain.json", "brain-echo.json"] {
            if let Some(folder) = &brains.folder {
                self.screen_state(&folder.join(file), crate::sessions::readable);
            }
        }
        self.choice = Some(Arc::new(BrainChoice {
            brains,
            events: self.events().clone(),
            made: Mutex::default(),
            said: Arc::default(),
            turns: Arc::default(),
            asks: Arc::default(),
            tools: OnceLock::new(),
        }));
        self
    }

    /// The conversation a turn goes to now: the desk's one brain, or the one the setting chooses.
    pub(crate) fn talking(&self) -> Option<Picked> {
        if let Some(conversation) = &self.conversation {
            return Some(Picked {
                conversation: Arc::clone(conversation),
                fallback: None,
                chosen: None,
            });
        }
        let chosen = self
            .setting_in_force(OWNER, USE)
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or(BrainName::Endue);
        let model = self
            .setting_in_force(OWNER, MODEL)
            .and_then(|value| value.as_str().map(str::trim).map(str::to_owned))
            .filter(|model| !model.is_empty())
            .unwrap_or_else(|| DEFAULT_LOCAL_MODEL.to_owned());
        self.choice.as_ref()?.pick(chosen, &model)
    }

    /// Route the brains' tool calls through this core (agent_tools.rs).
    pub(crate) fn route_choice(&self, tools: Weak<dyn Tools>) {
        if let Some(choice) = &self.choice {
            choice.route(tools);
        }
    }
}
