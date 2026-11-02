//! The desk's own updates (ADR 0054): a `desk_update::Updater` over HTTPS that installs through
//! `tauri-plugin-updater`, made only when this build carries an updater key. The release workflows
//! set `DESK_UPDATER_PUBKEY`, `DESK_UPDATE_URL` and `DESK_BUILD_COMMIT` at compile time; a debug build
//! may set the first two at run time to try a local origin. A build without a key never updates
//! itself, and the core answers `update.*` with `unsupported`.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use desk_update::https::Https;
use desk_update::{Chosen, Config, Installer, Prefs, Updater};
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Runtime, Url};
use tauri_plugin_updater::UpdaterExt;

/// Where builds come from unless the build says otherwise.
pub const DEFAULT_ORIGIN: &str = "https://releases.endue.ai/desk";

/// The updater, for the tray and anything else on the native side.
pub struct Updates(pub Updater);

/// The updater key and the origin this build updates from; none when it carries no key.
pub fn origin() -> Option<(String, String)> {
    let run = |name| {
        cfg!(debug_assertions)
            .then(|| std::env::var(name).ok())
            .flatten()
    };
    let key = pick(
        run("DESK_UPDATER_PUBKEY"),
        option_env!("DESK_UPDATER_PUBKEY"),
    )?;
    let base = pick(run("DESK_UPDATE_URL"), option_env!("DESK_UPDATE_URL"))
        .unwrap_or_else(|| DEFAULT_ORIGIN.to_owned());
    Some((key, base))
}

/// The run-time value over the built-in one; empty counts as none.
fn pick(run: Option<String>, built: Option<&str>) -> Option<String> {
    run.or_else(|| built.map(str::to_owned))
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Register the Tauri updater plugin when this build updates itself. Its JavaScript commands stay
/// out of every capability: only the native side installs.
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    match origin() {
        Some((key, _)) => builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key).build()),
        None => builder,
    }
}

/// The updater for this build, its folder under `data`; none without a key.
pub fn updater<R: Runtime>(app: &AppHandle<R>, data: &Path) -> Option<Updater> {
    let (pubkey, base) = origin()?;
    let config = Config {
        base,
        pubkey: pubkey.clone(),
        version: app.package_info().version.to_string(),
        commit: commit(option_env!("DESK_BUILD_COMMIT")),
        targets: targets(tauri_plugin_updater::target(), bundle_type()),
        dir: data.join("updates"),
    };
    let installer = PluginInstaller {
        app: app.clone(),
        pubkey,
        ready: Mutex::default(),
    };
    let transport = Arc::new(Https::new(cfg!(debug_assertions)));
    match Updater::new(config, transport, Arc::new(installer), Prefs::default()) {
        Ok(updater) => Some(updater),
        Err(why) => {
            eprintln!("endue Desk: this desk will not update itself ({why})");
            None
        }
    }
}

/// What the Tauri updater looks up for this build, most specific first: `linux-x86_64-deb`, then
/// `linux-x86_64`. `base` is its `{os}-{arch}`.
pub fn targets(base: Option<String>, bundle: Option<BundleType>) -> Vec<String> {
    let Some(base) = base else {
        return Vec::new();
    };
    let installer = match bundle {
        Some(BundleType::Deb) => Some("deb"),
        Some(BundleType::Rpm) => Some("rpm"),
        Some(BundleType::AppImage) => Some("appimage"),
        Some(BundleType::Msi) => Some("msi"),
        Some(BundleType::Nsis) => Some("nsis"),
        Some(BundleType::App) | Some(BundleType::Dmg) => Some("app"),
        _ => None,
    };
    installer
        .map(|installer| format!("{base}-{installer}"))
        .into_iter()
        .chain([base])
        .collect()
}

/// The build's commit as the bridge takes it: 7 to 40 hex digits, lowercase.
pub fn commit(built: Option<&str>) -> Option<String> {
    let commit = built?.trim().to_ascii_lowercase();
    let hex = commit.chars().all(|c| c.is_ascii_hexdigit());
    (hex && (7..=40).contains(&commit.len())).then_some(commit)
}

/// Installs through `tauri-plugin-updater`, whose update handle comes from the staged build's
/// signed `release.json`. The handle made while staging is kept, so applying in the same session
/// needs no network; after a restart it is made again.
struct PluginInstaller<R: Runtime> {
    app: AppHandle<R>,
    pubkey: String,
    ready: Mutex<BTreeMap<String, tauri_plugin_updater::Update>>,
}

impl<R: Runtime> Installer for PluginInstaller<R> {
    fn prepare(&self, chosen: &Chosen) -> Result<(), String> {
        let update = tauri::async_runtime::block_on(handle(&self.app, &self.pubkey, chosen))?;
        lock(&self.ready).insert(chosen.version.clone(), update);
        Ok(())
    }

    fn install(&self, chosen: &Chosen, bytes: &[u8]) -> Result<(), String> {
        let kept = lock(&self.ready).get(&chosen.version).cloned();
        let update = match kept {
            Some(update) => update,
            None => tauri::async_runtime::block_on(handle(&self.app, &self.pubkey, chosen))?,
        };
        update
            .install(bytes)
            .map_err(|e| format!("Desk could not install {}: {e}", chosen.version))?;
        // On Windows the installer has taken over and the app is exiting; elsewhere, restart.
        self.app.restart()
    }
}

/// The plugin's update handle for `chosen`, from its release manifest.
async fn handle<R: Runtime>(
    app: &AppHandle<R>,
    pubkey: &str,
    chosen: &Chosen,
) -> Result<tauri_plugin_updater::Update, String> {
    let manifest = Url::parse(&chosen.release).map_err(|e| format!("{}: {e}", chosen.release))?;
    let fail = |e: tauri_plugin_updater::Error| format!("the manifest of {}: {e}", chosen.version);
    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .target(chosen.target.clone())
        .timeout(Duration::from_secs(30))
        .endpoints(vec![manifest])
        .map_err(fail)?
        .build()
        .map_err(fail)?;
    let update = updater
        .check()
        .await
        .map_err(fail)?
        .ok_or_else(|| format!("{} is not newer than this build", chosen.version))?;
    // The plugin read the manifest the desk checked; it must name the very artifact on disk.
    let same = update.version == chosen.version
        && update.download_url.as_str() == chosen.url
        && update.signature == chosen.signature;
    if !same {
        return Err(format!(
            "the manifest of {} changed after it was staged",
            chosen.version
        ));
    }
    Ok(update)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_name_the_installer_first() {
        let base = Some("linux-x86_64".to_owned());
        assert_eq!(
            targets(base.clone(), Some(BundleType::Deb)),
            ["linux-x86_64-deb", "linux-x86_64"]
        );
        assert_eq!(targets(base, None), ["linux-x86_64"]);
        let mac = Some("darwin-aarch64".to_owned());
        assert_eq!(
            targets(mac, Some(BundleType::App)),
            ["darwin-aarch64-app", "darwin-aarch64"]
        );
        assert!(targets(None, Some(BundleType::Nsis)).is_empty());
    }

    #[test]
    fn the_run_time_value_wins_and_empty_is_none() {
        assert_eq!(
            pick(Some("run".into()), Some("built")).as_deref(),
            Some("run")
        );
        assert_eq!(pick(None, Some(" built ")).as_deref(), Some("built"));
        assert_eq!(pick(Some("  ".into()), None), None);
        assert_eq!(pick(None, None), None);
    }

    #[test]
    fn a_commit_is_hex_of_seven_to_forty() {
        assert_eq!(commit(Some("C46D12B")).as_deref(), Some("c46d12b"));
        assert_eq!(commit(Some("c46d12")), None);
        assert_eq!(commit(Some("main")), None);
        assert_eq!(commit(None), None);
    }
}
