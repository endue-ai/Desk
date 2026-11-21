//! tokio-postgres 0.7.18, the same project's driver over the same protocol crate, measured for what
//! the plugin needs: it binds every result as binary (its query.rs sends result format 1), so a
//! value reaches the client as bytes to decode per type, never as the server's text; its simple
//! query gives text, but its columns have a name and nothing else (SimpleColumn::name).

use std::error::Error as StdError;
use std::process::ExitCode;

use desk_pg_session_spike::{expect, line, plain, title, verdict};
use tokio_postgres::types::{FromSql, Type};
use tokio_postgres::{NoTls, SimpleQueryMessage};

/// Any value's bytes as the server sent them.
struct Raw(Vec<u8>);

impl<'a> FromSql<'a> for Raw {
    fn from_sql(_: &Type, raw: &'a [u8]) -> Result<Raw, Box<dyn StdError + Sync + Send>> {
        Ok(Raw(raw.to_vec()))
    }
    fn accepts(_: &Type) -> bool {
        true
    }
}

const SQL: &str = "SELECT 12.50::numeric AS amount, '2026-11-21 10:00:00+00'::timestamptz AS at, '1 day 02:03:04.5'::interval AS span";

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let info = plain();
    let mut config = tokio_postgres::Config::new();
    config
        .host(&info.host)
        .port(info.port)
        .user(&info.user)
        .password(&info.password)
        .dbname(&info.database);
    let (client, connection) = config.connect(NoTls).await.expect("tokio-postgres sign-in");
    let task = tokio::spawn(connection);

    title("driver: tokio-postgres's extended query answers binary");
    let rows = client.query(SQL, &[]).await.expect("query");
    let as_text = rows[0].try_get::<_, String>("amount");
    line(
        "numeric read as a String",
        format!("{:?}", as_text.err().map(|e| e.to_string())),
    );
    for (i, column) in rows[0].columns().iter().enumerate() {
        let raw: Raw = rows[0].get(i);
        let hex: String = raw.0.iter().map(|b| format!("{b:02x}")).collect();
        line(
            &format!("{} ({})", column.name(), column.type_()),
            format!("{} bytes 0x{hex}", raw.0.len()),
        );
    }
    let statement = client
        .prepare("SELECT oid, relname FROM pg_class LIMIT 1")
        .await
        .expect("prepare");
    let origin: Vec<String> = statement
        .columns()
        .iter()
        .map(|c| {
            format!(
                "{} table {:?} attnum {:?}",
                c.name(),
                c.table_oid(),
                c.column_id()
            )
        })
        .collect();
    line("a prepared statement's columns", origin.join("; "));

    title("driver: tokio-postgres's simple query answers text without types");
    let messages = client.simple_query(SQL).await.expect("simple query");
    for message in &messages {
        match message {
            SimpleQueryMessage::RowDescription(columns) => {
                let names: Vec<&str> = columns.iter().map(|c| c.name()).collect();
                line("columns (a name is all SimpleColumn has)", names.join(", "));
            }
            SimpleQueryMessage::Row(row) => {
                let values: Vec<Option<&str>> = (0..row.len()).map(|i| row.get(i)).collect();
                line("values", format!("{values:?}"));
                expect(
                    &mut failures,
                    values[0] == Some("12.50"),
                    "simple query lost the text",
                );
            }
            _ => {}
        }
    }
    drop(client);
    task.await.ok();
    verdict(&failures)
}
