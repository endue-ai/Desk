//! shell.open: hand a link to the system, or show a file in the file manager (ADR 0047). Only http,
//! https and mailto URLs are ever opened (`desk_sys::shell::link`), and a path is only revealed. The
//! scope must cover the scheme or the path; without a grant that covers the scope the person is asked
//! first. The opener is the system's unless `with_opener` gives another, so tests launch nothing.

use std::fs;

use desk_bridge::{ErrorCode, Permission, ShellOpenParams, ShellOpenResult, True};
use desk_sys::shell::{self, Opener};

use crate::handler::{Answer, Core, error, io_error, json, sys_error};
use crate::perm::Target;

/// The longest target the core takes, URL or path (the schema's `maxLength`).
const MAX_TARGET: usize = 8192;

impl Core {
    /// Hand links and reveals to `opener` instead of the system: a test's fake.
    pub fn with_opener(mut self, opener: impl Opener + 'static) -> Self {
        self.opener = Box::new(opener);
        self
    }

    pub(crate) fn shell_open(&self, caller: &str, params: ShellOpenParams) -> Answer {
        let ShellOpenParams {
            target,
            reveal,
            scope,
        } = params;
        if target.len() > MAX_TARGET {
            let message = format!("the target is over {MAX_TARGET} bytes");
            return Err(error(ErrorCode::InvalidParams, message));
        }
        let scope = Permission::ShellOpen(scope);
        if reveal == Some(true) {
            let path = self.resolve(&target)?;
            let reason = format!("To show {target} in the file manager");
            self.check_or_ask(caller, &scope, &Target::Path(&target), &reason)?;
            fs::symlink_metadata(&path).map_err(io_error)?;
            self.opener.reveal(&path).map_err(sys_error)?;
        } else {
            let link = shell::link(&target).map_err(sys_error)?;
            let reason = format!("To open {}", link.url);
            self.check_or_ask(caller, &scope, &Target::Scheme(link.scheme), &reason)?;
            self.opener.open_url(&link.url).map_err(sys_error)?;
        }
        json(ShellOpenResult { opened: True })
    }
}
