//! db.describe (ADR 0353): what one statement on a caller's session takes and answers, without
//! running it. desk-pg's `Session::describe` sends Parse and Describe; this side checks the call as
//! db.run checks one and says the parameter types, the columns and the server's error as the
//! bridge does.

use desk_bridge::{DbDescribeParams, DbDescribeResult};
use desk_pg::Statement;

use crate::core_db::db_error;
use crate::db_wire::page;
use crate::handler::{Answer, Core, json};

impl Core {
    pub(crate) fn db_describe(&self, caller: &str, params: DbDescribeParams) -> Answer {
        let session = self.db_session(caller, &params.session_id)?;
        let types = params.param_types.unwrap_or_default().into_iter();
        let statement = Statement {
            sql: params.sql,
            params: Vec::new(),
            types: types.map(|oid| u32::try_from(oid).unwrap_or(0)).collect(),
        };
        let described = session.describe(statement).map_err(db_error)?;
        let answered = page(described.page);
        json(DbDescribeResult {
            param_types: described.params.into_iter().map(u64::from).collect(),
            columns: answered.columns,
            transaction: answered.transaction,
            error: answered.error,
            notices: answered.notices,
        })
    }
}
