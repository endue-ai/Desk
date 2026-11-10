//! Whether a native plugin may start here and what starting it runs: the program its manifest names
//! for this OS and processor, inside its folder, with its args and its grace.

use std::path::{Path, PathBuf};
use std::time::Duration;

use desk_bridge::{BridgeError, ErrorCode, NativeBinaries, NativeBlock, PluginKind, PluginStatus};

use crate::handler::{Core, error};
use crate::manifest::inside;

/// How long the desk waits for a process to exit once asked, unless its manifest says otherwise.
pub const DEFAULT_GRACE: Duration = Duration::from_millis(2000);

/// What starting a native plugin runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeLaunch {
    pub plugin: String,
    /// The program for this platform, inside the plugin's folder.
    pub program: PathBuf,
    pub args: Vec<String>,
    /// The plugin's folder: the process's working directory.
    pub dir: PathBuf,
    /// How long it has to exit once asked to stop.
    pub grace: Duration,
}

/// This desk's platform as manifests name it: `<os>-<arch>` as Rust does (`macos-aarch64`).
pub fn platform() -> &'static str {
    static PLATFORM: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    PLATFORM.get_or_init(|| format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH))
}

/// The program `binaries` names for `platform`, if any.
pub fn program_for<'a>(binaries: &'a NativeBinaries, platform: &str) -> Option<&'a str> {
    let program = match platform {
        "macos-aarch64" => &binaries.macos_aarch64,
        "macos-x86_64" => &binaries.macos_x86_64,
        "linux-aarch64" => &binaries.linux_aarch64,
        "linux-x86_64" => &binaries.linux_x86_64,
        "windows-aarch64" => &binaries.windows_aarch64,
        "windows-x86_64" => &binaries.windows_x86_64,
        _ => &None,
    };
    program.as_deref()
}

/// What keeps a native plugin in `dir` from loading here: no program for this platform, or one
/// that is not a file inside the folder (or, on Unix, not executable).
pub(crate) fn problems(dir: &Path, native: &NativeBlock) -> Vec<String> {
    let here = platform();
    let Some(path) = program_for(&native.binaries, here) else {
        return vec![format!(
            "plugin.json: native.binaries: no program for {here}, the platform of this desk"
        )];
    };
    match inside(dir, path) {
        Some(file) if file.is_file() => {}
        _ => {
            return vec![format!(
                "plugin.json: native.binaries.{here}: {path} does not exist"
            )];
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = inside(dir, path)
            .and_then(|file| std::fs::metadata(file).ok())
            .map(|meta| meta.permissions().mode());
        if mode.is_some_and(|mode| mode & 0o111 == 0) {
            return vec![format!(
                "plugin.json: native.binaries.{here}: {path} is not executable"
            )];
        }
    }
    Vec::new()
}

impl Core {
    /// What starting native plugin `plugin` runs. Refused unless it is a ready, enabled native
    /// plugin with a program for this platform.
    pub fn native_launch(&self, plugin: &str) -> Result<NativeLaunch, BridgeError> {
        let info = self
            .registry()
            .get(plugin)
            .ok_or_else(|| error(ErrorCode::NotFound, format!("no plugin {plugin}")))?;
        let manifest = info.manifest.as_ref();
        let native = manifest
            .filter(|m| m.kind == PluginKind::Native)
            .and_then(|m| m.native.as_ref())
            .ok_or_else(|| {
                error(
                    ErrorCode::Unsupported,
                    format!("{plugin} is not a native plugin"),
                )
            })?;
        if info.status != PluginStatus::Ready || !info.enabled {
            let why = info.error.clone().unwrap_or_else(|| "it is off".to_owned());
            return Err(error(
                ErrorCode::Unsupported,
                format!("{plugin} cannot start: {why}"),
            ));
        }
        let folders = self.plugin_folders();
        let dir = folders
            .into_iter()
            .find(|(id, _)| id == plugin)
            .map(|(_, dir)| dir)
            .ok_or_else(|| error(ErrorCode::NotFound, format!("no folder for {plugin}")))?;
        let here = platform();
        let program = program_for(&native.binaries, here)
            .and_then(|path| inside(&dir, path))
            .filter(|file| file.is_file())
            .ok_or_else(|| {
                error(
                    ErrorCode::Unsupported,
                    format!("{plugin} has no program for {here}"),
                )
            })?;
        Ok(NativeLaunch {
            plugin: plugin.to_owned(),
            program,
            args: native.args.clone().unwrap_or_default(),
            dir,
            grace: native
                .grace_ms
                .map(Duration::from_millis)
                .unwrap_or(DEFAULT_GRACE),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{platform, program_for};
    use desk_bridge::NativeBinaries;

    #[test]
    fn the_platform_is_named_as_manifests_name_it_and_picks_its_program() {
        let here = platform();
        assert!(
            ["macos", "linux", "windows"]
                .iter()
                .any(|os| here.starts_with(&format!("{os}-")))
        );
        let binaries: NativeBinaries = serde_json::from_value(serde_json::json!({
            "macos-aarch64": "a", "linux-x86_64": "b", "windows-x86_64": "c.exe" }))
        .unwrap();
        assert_eq!(program_for(&binaries, "macos-aarch64"), Some("a"));
        assert_eq!(program_for(&binaries, "linux-x86_64"), Some("b"));
        assert_eq!(program_for(&binaries, "linux-aarch64"), None);
        assert_eq!(program_for(&binaries, "darwin-arm64"), None);
    }
}
