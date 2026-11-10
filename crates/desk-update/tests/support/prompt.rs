//! Stand-ins for the OS's administrator prompt (#99). None of them shows a prompt or runs anything
//! as root: the real one (`SystemPrompt`) is never made in a test, since a person may be using the
//! machine. `Approves` runs the macOS administrator's step as this user, with the folders root
//! could write opened for it, so the step itself is tested whole.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use desk_update::install::{Elevate, Refusal, Step};

/// A prompt that must never show: the install was refused, or needed nobody, before it.
pub struct Never;

impl Elevate for Never {
    fn run(&self, step: &Step) -> Result<(), Refusal> {
        panic!("nobody should have been asked: {step:?}");
    }
}

/// A prompt the person cancels; it keeps what it was asked.
#[derive(Default)]
pub struct Declines {
    pub asked: Mutex<Vec<Step>>,
}

impl Elevate for Declines {
    fn run(&self, step: &Step) -> Result<(), Refusal> {
        self.asked.lock().unwrap().push(step.clone());
        Err(Refusal::Declined)
    }
}

/// A prompt an administrator approves, for a step that is never run (`dpkg`): it keeps what it was
/// asked and answers `Ok`.
#[derive(Default)]
pub struct Records {
    pub asked: Mutex<Vec<Step>>,
}

impl Elevate for Records {
    fn run(&self, step: &Step) -> Result<(), Refusal> {
        self.asked.lock().unwrap().push(step.clone());
        Ok(())
    }
}

type Before = Box<dyn Fn(&Step) + Send + Sync>;

/// A prompt an administrator approves: the macOS step runs as this user, `locked` folders made
/// writable (0755) for it and read-only (0555) again afterwards, as root would write them.
pub struct Approves {
    pub asked: Mutex<Vec<Step>>,
    locked: Vec<PathBuf>,
    before: Option<Before>,
}

impl Approves {
    pub fn opening(locked: Vec<PathBuf>) -> Self {
        Self {
            asked: Mutex::default(),
            locked,
            before: None,
        }
    }

    /// Do `before` once the person approved and before the step runs.
    pub fn then(mut self, before: impl Fn(&Step) + Send + Sync + 'static) -> Self {
        self.before = Some(Box::new(before));
        self
    }

    #[cfg(unix)]
    fn modes(&self, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        for path in &self.locked {
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
        }
    }

    #[cfg(not(unix))]
    fn modes(&self, _mode: u32) {}
}

impl Elevate for Approves {
    fn run(&self, step: &Step) -> Result<(), Refusal> {
        self.asked.lock().unwrap().push(step.clone());
        assert_eq!(step.program, "/bin/sh", "only the macOS step runs here");
        if let Some(before) = &self.before {
            before(step);
        }
        self.modes(0o755);
        let output = Command::new(&step.program).args(&step.args).output();
        self.modes(0o555);
        let output = output.map_err(|e| Refusal::Failed(e.to_string()))?;
        if output.status.success() {
            Ok(())
        } else {
            let said = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            Err(Refusal::Failed(said))
        }
    }
}

/// Whether this user writes into read-only folders anyway (root), which the tests cannot fake.
pub fn writes_anyway(dir: &std::path::Path) -> bool {
    let probe = dir.join(".probe");
    let wrote = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(probe);
    wrote
}
