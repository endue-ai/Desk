// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#[cfg(feature = "semver")]
use crate::semver_compat::semver_compat_string;

use crate::{SingleInstanceCallback, linux_bus, manage_instance_lock};
use tauri::{
    Resource, Runtime,
    plugin::{self, TauriPlugin},
};

impl Resource for linux_bus::Guard {}

pub fn init<R: Runtime>(
    callback: Box<SingleInstanceCallback<R>>,
    dbus_id: Option<String>,
) -> TauriPlugin<R> {
    plugin::Builder::new("single-instance")
        .setup(move |app, _api| {
            let mut dbus_name = dbus_id.unwrap_or_else(|| app.config().identifier.clone());
            dbus_name.push_str(".SingleInstance");

            #[cfg(feature = "semver")]
            {
                dbus_name.push('_');
                dbus_name.push_str(semver_compat_string(&app.package_info().version).as_str());
            }

            let mut dbus_path = dbus_name.replace('.', "/").replace('-', "_");
            if !dbus_path.starts_with('/') {
                dbus_path = format!("/{dbus_path}");
            }

            let app_handle = app.clone();
            let mut callback = callback;
            match linux_bus::start(
                None,
                dbus_name,
                dbus_path,
                std::env::args_os()
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .collect(),
                std::env::current_dir()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                Box::new(move |args, cwd| callback(&app_handle, args, cwd)),
            )? {
                linux_bus::Outcome::Primary(lock) => manage_instance_lock(app, lock),
                linux_bus::Outcome::Forwarded => {
                    // Exit successfully only after the primary accepted the arguments.
                    app.cleanup_before_exit();
                    std::process::exit(0);
                }
                linux_bus::Outcome::Unavailable(error) => {
                    tracing::warn!(
                        "single-instance: D-Bus session bus unavailable, launching normally: {error}"
                    );
                }
            }

            Ok(())
        })
        .build()
}
