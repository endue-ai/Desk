//! Apps through NSWorkspace and NSRunningApplication. None of this needs a TCC permission.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::{Retained, autoreleasepool};
use objc2_app_kit::{
    NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication,
    NSWorkspace, NSWorkspaceOpenConfiguration,
};
use objc2_foundation::{NSError, NSString, NSURL};

use crate::apps::{App, AppOp, Launch};
use crate::{Error, ErrorCode, not_found};

/// How long an app may take to launch.
const LAUNCH_WAIT: Duration = Duration::from_secs(30);

pub(super) fn describe(app: &NSRunningApplication) -> App {
    App {
        pid: app.processIdentifier(),
        name: app
            .localizedName()
            .map(|n| n.to_string())
            .unwrap_or_default(),
        bundle_id: app.bundleIdentifier().map(|id| id.to_string()),
        path: app
            .bundleURL()
            .and_then(|url| url.path())
            .map(|p| p.to_string()),
        active: app.isActive(),
        hidden: app.isHidden(),
        regular: app.activationPolicy() == NSApplicationActivationPolicy::Regular,
    }
}

pub(super) fn running() -> Vec<App> {
    autoreleasepool(|_| {
        NSWorkspace::sharedWorkspace()
            .runningApplications()
            .iter()
            .filter(|app| !app.isTerminated() && app.processIdentifier() > 0)
            .map(|app| describe(&app))
            .collect()
    })
}

/// The app's bundle URL, or `not_found`.
fn url(launch: &Launch) -> Result<Retained<NSURL>, Error> {
    match launch {
        Launch::BundleId(id) => NSWorkspace::sharedWorkspace()
            .URLForApplicationWithBundleIdentifier(&NSString::from_str(id))
            .ok_or_else(|| not_found(format!("no app {id} is installed"))),
        Launch::Path(path) => {
            if !std::path::Path::new(path).is_dir() {
                return Err(not_found(format!("there is no app at {path}")));
            }
            Ok(NSURL::fileURLWithPath(&NSString::from_str(path)))
        }
    }
}

/// An NSRunningApplication handed from the completion handler's queue to the waiting thread.
struct Handed(Result<App, Error>);

pub(super) fn launch(launch: &Launch) -> Result<App, Error> {
    let url = url(launch)?;
    let (sender, receiver) = mpsc::channel::<Handed>();
    let target = launch.to_string();
    let done = RcBlock::new(move |app: *mut NSRunningApplication, error: *mut NSError| {
        // SAFETY: NSWorkspace passes a live running app or nil, and nil or a live error.
        let (app, error) = unsafe { (app.as_ref(), error.as_ref()) };
        let answer = match (app, error) {
            (Some(app), _) => Ok(describe(app)),
            (None, error) => Err(Error::new(
                ErrorCode::IoError,
                format!(
                    "macOS did not launch {target}: {}",
                    error.map_or_else(
                        || "no reason given".to_owned(),
                        |e| e.localizedDescription().to_string()
                    )
                ),
            )),
        };
        let _ = sender.send(Handed(answer));
    });
    let configuration = NSWorkspaceOpenConfiguration::configuration();
    configuration.setActivates(true);
    NSWorkspace::sharedWorkspace().openApplicationAtURL_configuration_completionHandler(
        &url,
        &configuration,
        Some(&*done),
    );
    match receiver.recv_timeout(LAUNCH_WAIT) {
        Ok(Handed(answer)) => answer,
        Err(_) => Err(Error::new(
            ErrorCode::Timeout,
            format!("{launch} did not finish launching in {LAUNCH_WAIT:?}"),
        )),
    }
}

pub(super) fn act(pid: i32, op: AppOp) -> Result<App, Error> {
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .filter(|app| !app.isTerminated())
        .ok_or_else(|| not_found(format!("no app runs with pid {pid}")))?;
    let sent = match op {
        AppOp::Activate => {
            app.unhide();
            #[allow(deprecated)]
            let options = NSApplicationActivationOptions::ActivateAllWindows
                | NSApplicationActivationOptions::ActivateIgnoringOtherApps;
            app.activateWithOptions(options)
        }
        AppOp::Hide => app.hide(),
        AppOp::Quit => app.terminate(),
    };
    if !sent {
        return Err(Error::new(
            ErrorCode::IoError,
            format!("macOS refused to {} the app of pid {pid}", op.verb()),
        ));
    }
    Ok(describe(&app))
}
