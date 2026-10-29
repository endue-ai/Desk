//! The data each plugin's Wasmtime store holds, and the generated host traits it implements by
//! handing every call to `Imports`.

use wasmtime::component::ResourceTable;
use wasmtime_wasi::{WasiCtx, WasiCtxView, WasiView};

use crate::bindings::desk::host::{fs, net, perm, store, types, ui};
use crate::bindings::{DirEntry, Error, Grant, NotifyLevel, Request, Response};
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
}

impl store::Host for State {
    fn get(&mut self, key: String) -> Result<Option<String>, Error> {
        self.imports.store_get(&key)
    }

    fn set(&mut self, key: String, value: String) -> Result<(), Error> {
        self.imports.store_set(&key, &value)
    }
}
