//! The data each plugin's Wasmtime store holds, and the generated host traits it implements by
//! handing every call to `Imports`, counted with its time for `Usage`.

use wasmtime::component::ResourceTable;
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use crate::bindings::desk::host::{cmd, events, fs, log, net, perm, settings, store, types, ui};
use crate::bindings::{Command, CommandInfo, Decision, DirEntry, Duration, Error, Failure, Grant};
use crate::bindings::{LogEntry, LogLevel, NotifyLevel, Request, Response, Setting};
use crate::imports::Imports;
use crate::limits::{Limiter, Limits};
use crate::usage::Imported;

pub(crate) struct State {
    pub(crate) imports: Imports,
    pub(crate) limiter: Limiter,
    /// The `desk:host` imports the guest called since the host last took them, and their time.
    pub(crate) imported: Imported,
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
            imported: Imported::default(),
            wasi: WasiCtx::builder().build(),
            table: ResourceTable::new(),
        }
    }

    /// Run one `desk:host` import, counted with its time. WASI's imports, with nothing behind
    /// them, are not counted.
    fn import<R>(&mut self, import: impl FnOnce(&Imports) -> R) -> R {
        let imports = &self.imports;
        self.imported.tally(|| import(imports))
    }
}

/// An engine for Wasm components with epoch interruption, which the time limit needs.
pub(crate) fn engine() -> wasmtime::Result<Engine> {
    let mut config = Config::new();
    config.wasm_component_model(true).epoch_interruption(true);
    Engine::new(&config)
}

/// A store for one plugin: its imports, its memory limiter, and the time limit armed for the
/// instantiation that follows.
pub(crate) fn store(engine: &Engine, imports: Imports, limits: &Limits) -> Box<Store<State>> {
    let mut store = Box::new(Store::new(engine, State::new(imports, limits)));
    store.limiter(|state| &mut state.limiter);
    store.epoch_deadline_trap();
    store.set_epoch_deadline(limits.ticks());
    store
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
        self.import(|i| i.fs_read(&path))
    }

    fn list(&mut self, path: String) -> Result<Vec<DirEntry>, Error> {
        self.import(|i| i.fs_list(&path))
    }

    fn write(&mut self, path: String, contents: Vec<u8>, create_dirs: bool) -> Result<u64, Error> {
        self.import(|i| i.fs_write(&path, &contents, create_dirs))
    }

    fn history(&mut self, path: String, limit: Option<u32>) -> Result<Vec<fs::Version>, Error> {
        self.import(|i| i.fs_history(&path, limit))
    }

    fn restore(&mut self, path: String, version_id: String) -> Result<u64, Error> {
        self.import(|i| i.fs_restore(&path, &version_id))
    }
}

impl net::Host for State {
    fn fetch(&mut self, request: Request) -> Result<Response, Error> {
        self.import(|i| i.net_fetch(request))
    }
}

impl ui::Host for State {
    fn notify(
        &mut self,
        title: String,
        body: Option<String>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        self.import(|i| i.ui_notify(&title, body.as_deref(), level))
    }
}

impl perm::Host for State {
    fn query(&mut self) -> Vec<Grant> {
        self.import(|i| i.perm_query())
    }

    fn request(
        &mut self,
        permission: String,
        reason: String,
        duration: Option<Duration>,
    ) -> Result<Decision, Error> {
        self.import(|i| i.perm_request(&permission, &reason, duration))
    }
}

impl store::Host for State {
    fn get(&mut self, key: String) -> Result<Option<String>, Error> {
        self.import(|i| i.store_get(&key))
    }

    fn set(&mut self, key: String, value: String) -> Result<(), Error> {
        self.import(|i| i.store_set(&key, &value))
    }
}

impl cmd::Host for State {
    fn register(&mut self, command: Command) -> Result<(), Error> {
        self.import(|i| i.cmd_register(command))
    }

    fn unregister(&mut self, id: String) -> Result<(), Error> {
        self.import(|i| i.cmd_unregister(&id))
    }

    fn list(&mut self) -> Result<Vec<CommandInfo>, Error> {
        self.import(|i| i.cmd_list())
    }

    fn invoke(&mut self, id: String, args_json: Option<String>) -> Result<String, Error> {
        self.import(|i| i.cmd_invoke(&id, args_json.as_deref()))
    }

    fn answer(
        &mut self,
        invocation_id: String,
        outcome: Result<String, Failure>,
    ) -> Result<(), Error> {
        let outcome = outcome.as_deref().map_err(Failure::clone);
        self.import(|i| i.cmd_answer(&invocation_id, outcome))
    }
}

impl events::Host for State {
    fn subscribe(&mut self, names: Vec<String>) -> Result<String, Error> {
        self.import(|i| i.events_subscribe(&names))
    }

    fn unsubscribe(&mut self, subscription_id: String) -> Result<(), Error> {
        self.import(|i| i.events_unsubscribe(&subscription_id))
    }
}

impl settings::Host for State {
    fn get(&mut self, key: String, owner: Option<String>) -> Result<Option<String>, Error> {
        self.import(|i| i.settings_get(&key, owner.as_deref()))
    }

    fn set(&mut self, key: String, value: String) -> Result<(), Error> {
        self.import(|i| i.settings_set(&key, &value))
    }

    fn list(&mut self, others: bool) -> Result<Vec<Setting>, Error> {
        self.import(|i| i.settings_list(others))
    }
}

impl log::Host for State {
    fn write(
        &mut self,
        level: LogLevel,
        message: String,
        fields: Option<String>,
    ) -> Result<(), Error> {
        self.import(|i| i.log_write(level, &message, fields.as_deref()))
    }

    fn tail(
        &mut self,
        channel: Option<String>,
        count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error> {
        self.import(|i| i.log_tail(channel.as_deref(), count))
    }
}
