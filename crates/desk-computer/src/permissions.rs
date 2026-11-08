//! The OS permissions computer use needs. On macOS both are TCC grants the person gives in System
//! Settings > Privacy & Security: Accessibility (reading and acting on other apps' interfaces, and
//! posting input events) and Screen Recording (screenshots, and other apps' window titles).
//!
//! TCC grants them to the responsible process: the signed bundle `ai.endue.desk` for the app, and
//! the terminal that launched it under `just dev` (ADR 0120). `Permissions::bundle_id` says which.

/// One OS permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    /// Read and operate other apps' interfaces, and post synthesized input.
    Accessibility,
    /// Capture the screen, and read other apps' window titles.
    ScreenRecording,
}

impl Permission {
    pub const ALL: [Permission; 2] = [Permission::Accessibility, Permission::ScreenRecording];

    /// Its name in System Settings.
    pub fn label(self) -> &'static str {
        match self {
            Permission::Accessibility => "Accessibility",
            Permission::ScreenRecording => "Screen Recording",
        }
    }

    /// The System Settings pane that grants it. `shell.open` takes only http, https and mailto
    /// (ADR 0047), so a `Computer` opens this itself with `open_settings`.
    pub fn settings_url(self) -> &'static str {
        match self {
            Permission::Accessibility => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            Permission::ScreenRecording => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
        }
    }
}

/// What the OS allows now. Reading it never prompts.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Permissions {
    /// `AXIsProcessTrusted` on macOS.
    pub accessibility: bool,
    /// `CGPreflightScreenCaptureAccess` on macOS.
    pub screen_recording: bool,
    /// The bundle TCC asks about, when the process runs from an app bundle; `None` under `just dev`
    /// or a test binary, where the OS asks about the launching terminal instead.
    pub bundle_id: Option<String>,
}

impl Permissions {
    pub fn granted(&self, permission: Permission) -> bool {
        match permission {
            Permission::Accessibility => self.accessibility,
            Permission::ScreenRecording => self.screen_recording,
        }
    }
}

/// The `permission_denied` a call answers when the OS has not granted what it needs.
pub(crate) fn missing(permission: Permission, what: &str) -> crate::Error {
    crate::Error::new(
        crate::ErrorCode::PermissionDenied,
        format!(
            "{what} needs the {} permission, which the OS has not granted; open {}",
            permission.label(),
            permission.settings_url()
        ),
    )
}
