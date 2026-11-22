//! db.script (ADR 0344): several statements on a caller's session in one call, each answered with
//! its own first page, so a long script crosses the bridge once a batch instead of once a
//! statement. desk-pg's `Session::script` runs them; this side checks the call as db.run checks
//! one and says the pages, a cancel and a failure as the bridge does.

use desk_bridge::{DbScriptParams, DbScriptResult, ErrorCode};
use desk_pg::Statement;

use crate::core_db::{db_error, limits};
use crate::db_wire::page;
use crate::handler::{Answer, Core, error, json};

impl Core {
    pub(crate) fn db_script(&self, caller: &str, params: DbScriptParams) -> Answer {
        let limits = limits(params.page_rows, params.page_bytes)?;
        if params.statements.is_empty() {
            let why = "db.script takes one statement at least".to_owned();
            return Err(error(ErrorCode::InvalidParams, why));
        }
        let session = self.db_session(caller, &params.session_id)?;
        let statements = params.statements.into_iter().map(|statement| {
            let types = statement.param_types.unwrap_or_default().into_iter();
            Statement {
                sql: statement.sql,
                params: statement.params.unwrap_or_default(),
                types: types.map(|oid| u32::try_from(oid).unwrap_or(0)).collect(),
            }
        });
        let go_on = params.go_on == Some(true);
        let done = session
            .script(statements.collect(), limits, go_on)
            .map_err(db_error)?;
        json(DbScriptResult {
            pages: done.pages.into_iter().map(page).collect(),
            cancelled: done.cancelled.then_some(true),
            failure: done.failure.map(db_error),
        })
    }
}
