//! The updater: reads the channel index, chooses the next build, downloads and stages it, and
//! applies it when asked, over the app's `Transport` and `Installer`. One step runs at a time, and
//! every change reaches the listeners as a whole `Status`.
//!
//! A failed check or download while a build is staged leaves the state `staged`: the ready build is
//! what the person needs to see, and the schedule tries again. A failed install is the answer to the
//! person's own request, so it shows as `failed` with the build still staged.

mod steps;

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;

use semver::Version;

use crate::ports::{Config, Installer, Prefs, Transport};
use crate::schedule::{Schedule, jitter};
use crate::stage::Stage;
use crate::status::{Chosen, State, Status};

type Listener = Box<dyn Fn(&Status) + Send + Sync>;

#[derive(Clone)]
pub struct Updater {
    inner: Arc<Inner>,
}

struct Inner {
    config: Config,
    current: Version,
    transport: Arc<dyn Transport>,
    installer: Arc<dyn Installer>,
    stage: Stage,
    salt: Vec<u8>,
    status: Mutex<Status>,
    listeners: Mutex<Vec<Listener>>,
    work: Work,
    prepared: Mutex<Option<String>>,
}

impl Updater {
    /// An updater for the running build. A build staged by an earlier run comes back as `staged`;
    /// one that is not newer than the running build (the update went in) is removed.
    pub fn new(
        config: Config,
        transport: Arc<dyn Transport>,
        installer: Arc<dyn Installer>,
        prefs: Prefs,
    ) -> Result<Self, String> {
        let current = Version::parse(&config.version)
            .map_err(|e| format!("{} is not a version: {e}", config.version))?;
        let stage = Stage::open(&config.dir)
            .map_err(|e| format!("no updates folder at {}: {e}", config.dir.display()))?;
        let salt = stage.salt();
        let mut status = Status::new(&config.version, config.commit.clone(), prefs.channel);
        match stage.staged() {
            Some(chosen) if newer(&chosen, &current) => {
                status = status.at(State::Staged, Some(chosen), true);
            }
            Some(_) => stage.discard(),
            None => {}
        }
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                current,
                transport,
                installer,
                stage,
                salt,
                status: Mutex::new(status),
                listeners: Mutex::default(),
                work: Work::default(),
                prepared: Mutex::default(),
            }),
        })
    }

    /// Hear every status change. Listeners run on the updater's threads; they must not call `listen`.
    pub fn listen(&self, listener: impl Fn(&Status) + Send + Sync + 'static) {
        lock(&self.inner.listeners).push(Box::new(listener));
    }

    pub fn status(&self) -> Status {
        lock(&self.inner.status).clone()
    }

    /// Follow `prefs.channel` from now on; the status names it at once.
    pub fn follow(&self, prefs: Prefs) {
        if self.status().channel != prefs.channel {
            self.update(|s| s.channel = prefs.channel);
        }
    }

    /// Read the channel index in the background, unless a step is running. Answers at once.
    pub fn check(&self, prefs: Prefs) -> Status {
        if self.inner.work.try_begin() {
            self.checking(prefs);
            let me = self.clone();
            thread::spawn(move || {
                me.check_step(prefs);
                me.inner.work.end();
            });
        }
        self.status()
    }

    /// `check` on this thread.
    pub fn check_now(&self, prefs: Prefs) -> Status {
        if self.inner.work.try_begin() {
            self.checking(prefs);
            self.check_step(prefs);
            self.inner.work.end();
        }
        self.status()
    }

    /// Download the chosen build when it waits (`available`, or a download that failed). Answers at
    /// once; refused when there is nothing to download.
    pub fn download(&self) -> Result<Status, String> {
        let chosen = self.waiting()?;
        if self.inner.work.try_begin() {
            let me = self.clone();
            thread::spawn(move || {
                me.download_step(chosen);
                me.inner.work.end();
            });
        }
        Ok(self.status())
    }

    /// `download` on this thread.
    pub fn download_now(&self) -> Result<Status, String> {
        let chosen = self.waiting()?;
        if self.inner.work.try_begin() {
            self.download_step(chosen);
            self.inner.work.end();
        }
        Ok(self.status())
    }

    /// Install the staged build and restart into it, after the running step ends. Answers at once
    /// with `applying`; refused when nothing is staged.
    pub fn apply(&self) -> Result<Status, String> {
        let staged = self.applicable()?;
        self.update(|s| *s = s.at(State::Applying, Some(staged), true));
        let me = self.clone();
        thread::spawn(move || {
            me.inner.work.begin();
            me.apply_step();
            me.inner.work.end();
        });
        Ok(self.status())
    }

    /// `apply` on this thread.
    pub fn apply_now(&self) -> Result<Status, String> {
        let staged = self.applicable()?;
        self.update(|s| *s = s.at(State::Applying, Some(staged), true));
        self.inner.work.begin();
        self.apply_step();
        self.inner.work.end();
        Ok(self.status())
    }

    /// Check by the schedule from now on, reading the preferences before each check.
    pub fn start(&self, prefs: impl Fn() -> Prefs + Send + 'static) {
        let me = self.clone();
        let _ = thread::Builder::new()
            .name("desk-update".to_owned())
            .spawn(move || {
                let mut schedule = Schedule::default();
                thread::sleep(schedule.first());
                loop {
                    let prefs = prefs();
                    me.follow(prefs);
                    let succeeded = !prefs.check || me.check_now(prefs).state != State::Failed;
                    thread::sleep(schedule.next(succeeded, jitter()));
                }
            });
    }

    fn waiting(&self) -> Result<Chosen, String> {
        let status = self.status();
        match (status.state, status.release) {
            (State::Available | State::Failed, Some(chosen)) if !status.staged => Ok(chosen),
            (State::Downloading, Some(chosen)) => Ok(chosen),
            _ => Err("no update is available to download".to_owned()),
        }
    }

    fn applicable(&self) -> Result<Chosen, String> {
        self.inner
            .stage
            .staged()
            .filter(|c| newer(c, &self.inner.current))
            .ok_or_else(|| "no update is staged".to_owned())
    }

    fn update(&self, change: impl FnOnce(&mut Status)) {
        let status = {
            let mut status = lock(&self.inner.status);
            change(&mut status);
            status.clone()
        };
        for listener in lock(&self.inner.listeners).iter() {
            listener(&status);
        }
    }
}

fn newer(chosen: &Chosen, current: &Version) -> bool {
    Version::parse(&chosen.version).is_ok_and(|v| v > *current)
}

/// One step at a time: a check is skipped while another step runs; an apply waits its turn.
#[derive(Default)]
struct Work {
    busy: Mutex<bool>,
    idle: Condvar,
}

impl Work {
    fn try_begin(&self) -> bool {
        let mut busy = lock(&self.busy);
        !std::mem::replace(&mut *busy, true)
    }

    fn begin(&self) {
        let mut busy = lock(&self.busy);
        while *busy {
            busy = self.idle.wait(busy).unwrap_or_else(|p| p.into_inner());
        }
        *busy = true;
    }

    fn end(&self) {
        *lock(&self.busy) = false;
        self.idle.notify_all();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
