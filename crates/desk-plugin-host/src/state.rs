//! The data each plugin's Wasmtime store holds, and the generated host traits it implements by
//! handing every call to `Imports`.

use wasmtime::component::ResourceTable;
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use crate::bindings::desk::host::{cmd, events, fs, log, net, perm, settings, store, types, ui};
use crate::bindings::{Command, CommandInfo, Decision, DirEntry, Duration, Error, Failure, Grant};
use crate::bindings::{LogEntry, LogLevel, NotifyLevel, Request, Response, Setting};
use crate::imports::Imports;
use crate::limits::{Limiter, Limits};

pub(crate) struct State {
    pub(crate) imports: Imports,
    pub(crate) limiter: Limiter,
    /// WASI 0.2 with nothing behind it: no folders, environment, arguments or network, and stdio
    /// discarded (ADR 0017). Ordinary `std` guests import it; every capability is `desk:host`.
    wasi: WasiCtx,
    table: ResourceTable,
}

impl State {
    pub(crate) fn new(imports: Imports, limits: &Limits) -> Self {
        Self {
            imports,
            limiter: Limiter::new(limits),
            wasi: WasiCtx::builder().build(),
            table: ResourceTable::new(),
        }
    }
}

impl WasiView for State {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl types::Host for State {}

impl fs::Host for State {
    fn read(&mut self, path: String) -> Result<Vec<u8>, Error> {
        self.imports.fs_read(&path)
    }

    fn list(&mut self, path: String) -> Result<Vec<DirEntry>, Error> {
        self.imports.fs_list(&path)
    }

    fn write(&mut self, path: String, contents: Vec<u8>, create_dirs: bool) -> Result<u64, Error> {
        self.imports.fs_write(&path, &contents, create_dirs)
    }
}

impl net::Host for State {
    fn fetch(&mut self, request: Request) -> Result<Response, Error> {
        self.imports.net_fetch(request)
    }
}

impl ui::Host for State {
    fn notify(
        &mut self,
        title: String,
        body: Option<String>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        self.imports.ui_notify(&title, body.as_deref(), level)
    }
}

impl perm::Host for State {
    fn query(&mut self) -> Vec<Grant> {
        self.imports.perm_query()
    }

    fn request(
        &mut self,
        permission: String,
        reason: String,
        duration: Option<Duration>,
    ) -> Result<Decision, Error> {
        self.imports.perm_request(&permission, &reason, duration)
    }
}

impl store::Host for State {
    fn get(&mut self, key: String) -> Result<Option<String>, Error> {
        self.imports.store_get(&key)
    }

    fn set(&mut self, key: String, value: String) -> Result<(), Error> {
        self.imports.store_set(&key, &value)
    }
}

impl cmd::Host for State {
    fn register(&mut self, command: Command) -> Result<(), Error> {
        self.imports.cmd_register(command)
    }

    fn unregister(&mut self, id: String) -> Result<(), Error> {
        self.imports.cmd_unregister(&id)
    }

    fn list(&mut self) -> Result<Vec<CommandInfo>, Error> {
        self.imports.cmd_list()
    }

    fn invoke(&mut self, id: String, args_json: Option<String>) -> Result<String, Error> {
        self.imports.cmd_invoke(&id, args_json.as_deref())
    }

    fn answer(
        &mut self,
        invocation_id: String,
        outcome: Result<String, Failure>,
    ) -> Result<(), Error> {
        let outcome = outcome.as_deref().map_err(Failure::clone);
        self.imports.cmd_answer(&invocation_id, outcome)
    }
}

impl events::Host for State {
    fn subscribe(&mut self, names: Vec<String>) -> Result<String, Error> {
        self.imports.events_subscribe(&names)
    }

    fn unsubscribe(&mut self, subscription_id: String) -> Result<(), Error> {
        self.imports.events_unsubscribe(&subscription_id)
    }
}

impl settings::Host for State {
    fn get(&mut self, key: String, owner: Option<String>) -> Result<Option<String>, Error> {
        self.imports.settings_get(&key, owner.as_deref())
    }

    fn set(&mut self, key: String, value: String) -> Result<(), Error> {
        self.imports.settings_set(&key, &value)
    }

    fn list(&mut self, others: bool) -> Result<Vec<Setting>, Error> {
        self.imports.settings_list(others)
    }
}

impl log::Host for State {
    fn write(
        &mut self,
        level: LogLevel,
        message: String,
        fields: Option<String>,
    ) -> Result<(), Error> {
        self.imports.log_write(level, &message, fields.as_deref())
    }

    fn tail(
        &mut self,
        channel: Option<String>,
        count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error> {
        self.imports.log_tail(channel.as_deref(), count)
    }
}
