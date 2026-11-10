//! The CEF desk's own updates (ADR 0054, ADR 0147): the same `desk_update::Updater` the Tauri desk
//! runs, over HTTPS, installing through `desk_update::install` instead of `tauri-plugin-updater`. The
//! core serves `update.*` from it, so the runtime's update row and `desk.update.*` commands work as
//! on the Tauri desk, and the tray offers "Restart to update (<version>)" while a build is staged.
//!
//! Applying swaps the installed app (or AppImage, or runs the package or installer), then quits the
//! desk the way the menu's Quit does; once CEF has shut down, `relaunch_if_asked` lets go of what one
//! desk holds (the single-instance lock, the desk socket) and starts the updated desk, its output in
//! `<data>/updates/restart.log`. Made only when this build carries an updater key and was installed
//! from a package; a development build answers `update.*` with `unsupported`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use desk_update::https::Https;
use desk_update::install::{self, Layout, PackageInstaller, Relaunch, Running};
use desk_update::{Config, Prefs, State, Status, Updater};

use crate::menu::Choice;
use crate::pump::Pump;
use crate::release;

/// The restart an applied update asked for, until the desk has quit.
static RESTART: Mutex<Option<Relaunch>> = Mutex::new(None);

/// The updater for this build, its folder `<data>/updates`; none without a key or a package.
pub fn updater(data: &Path, pump: &Pump) -> Option<Updater> {
    let (pubkey, base) = release::origin()?;
    let Some(layout) = layout() else {
        eprintln!("endue Desk: not installed from a package, so it does not update itself");
        return None;
    };
    let targets = layout.targets(&install::base_target()?);
    let updates = data.join("updates");
    let config = Config {
        base: base.clone(),
        pubkey,
        version: release::version().to_owned(),
        commit: release::commit(),
        targets,
        dir: updates.clone(),
    };
    let pump = pump.clone();
    let installer = PackageInstaller::new(
        layout,
        updates,
        Box::new(move |relaunch| restart(&pump, relaunch)),
    );
    let transport = Arc::new(Https::new(release::allows_http(&base)));
    match Updater::new(config, transport, Arc::new(installer), Prefs::default()) {
        Ok(updater) => Some(updater),
        Err(why) => {
            eprintln!("endue Desk: this desk will not update itself ({why})");
            None
        }
    }
}

/// How the running desk is installed, from its executable and the environment.
fn layout() -> Option<Layout> {
    let exe = std::env::current_exe().ok()?;
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    let program_files = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let running = Running {
        appimage: appimage.as_deref(),
        program_files: program_files.as_deref(),
        ..Running::at(&exe)
    };
    Layout::of(std::env::consts::OS, &running)
}

/// Keep `relaunch` and quit the desk; the restart is under way once the quit is asked.
fn restart(pump: &Pump, relaunch: Relaunch) -> Result<(), String> {
    *lock(&RESTART) = Some(relaunch);
    pump.run(|shell, event_loop| shell.menu(event_loop, Choice::Quit));
    Ok(())
}

/// After the desk has quit and CEF has shut down: start the updated desk when an update asked for
/// it, once `let_go` has released what the new desk needs first.
pub fn relaunch_if_asked(data: &Path, let_go: impl FnOnce()) {
    let Some(relaunch) = lock(&RESTART).take() else {
        return;
    };
    let_go();
    let log = data.join("updates").join("restart.log");
    match relaunch.spawn(Some(&log)) {
        Ok(_) => eprintln!(
            "endue Desk: starting the updated desk ({}; its output in {})",
            relaunch.program.display(),
            log.display()
        ),
        Err(why) => eprintln!("endue Desk: the updated desk did not start ({why}): start it again"),
    }
}

/// The version the tray offers to restart into: the staged build's, unless it is being applied.
pub fn offered(status: &Status) -> Option<&str> {
    let ready = status.staged && matches!(status.state, State::Staged | State::Failed);
    ready
        .then(|| status.release.as_ref().map(|r| r.version.as_str()))
        .flatten()
}

/// Keep the tray's update item in step with `updater`.
pub fn follow(updater: &Updater, pump: &Pump) {
    let shown = Mutex::new(None::<String>);
    let pump = pump.clone();
    let show = move |status: &Status| {
        let offer = offered(status).map(str::to_owned);
        let mut last = lock(&shown);
        if *last != offer {
            last.clone_from(&offer);
            pump.run(move |shell, _| shell.offer_update(offer));
        }
    };
    show(&updater.status());
    updater.listen(show);
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::offered;
    use desk_update::{Channel, Chosen, State, Status};

    fn status(state: State, staged: bool) -> Status {
        let release = Some(Chosen {
            version: "0.6.0".to_owned(),
            commit: None,
            date: None,
            notes: None,
            target: "darwin-aarch64-app".to_owned(),
            url: String::new(),
            file: String::new(),
            size: 0,
            sha256: String::new(),
            signature: String::new(),
            release: String::new(),
        });
        Status {
            state,
            version: "0.5.0".to_owned(),
            commit: None,
            channel: Channel::Beta,
            checked_at: None,
            release,
            staged,
            received: None,
            total: None,
            reason: None,
        }
    }

    #[test]
    fn the_tray_offers_a_staged_build_unless_it_is_going_in() {
        assert_eq!(offered(&status(State::Staged, true)), Some("0.6.0"));
        assert_eq!(offered(&status(State::Failed, true)), Some("0.6.0"));
        assert_eq!(offered(&status(State::Applying, true)), None);
        assert_eq!(offered(&status(State::Downloading, false)), None);
    }
}
