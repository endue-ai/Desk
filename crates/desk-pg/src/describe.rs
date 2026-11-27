//! What a statement takes and answers, without running it (ADR 0353): Parse and Describe of the
//! unnamed statement, then Sync. The server answers ParameterDescription (the type it infers for
//! each `$n`) and RowDescription or NoData, or its error with the position; no Bind and no
//! Execute go out, so nothing runs, and a read-only session describes a write as well as a read.

use std::sync::atomic::Ordering;

use bytes::BytesMut;
use fallible_iterator::FallibleIterator;
use postgres_protocol::message::backend::Message;
use postgres_protocol::message::frontend;

use crate::error::{Error, ServerError};
use crate::page::{Page, columns};
use crate::session::Statement;
use crate::task::{End, Fail, Open, Reply, Task, unexpected};

/// What a statement takes and answers: `params` the type OID of each `$n` (empty with an error);
/// `page` holds the columns (none for NoData), the server's error, the transaction state after it
/// and the notices heard, and no rows.
#[derive(Debug, Default)]
pub struct Described {
    pub params: Vec<u32>,
    pub page: Page,
}

impl Task {
    pub(crate) async fn serve_describe(
        &mut self,
        statement: Statement,
        reply: Reply<Described>,
    ) -> Result<(), End> {
        let outcome = self.describe(statement).await;
        self.shared.open.store(false, Ordering::SeqCst);
        self.interrupted = matches!(outcome, Err(Fail::End(End::Stopped)));
        let (end, answer) = match outcome {
            Ok(described) => (None, Ok(described)),
            Err(Fail::Call(error)) => (None, Err(error)),
            Err(Fail::End(end)) => {
                // A describe the server ended the session over answers with the server's error.
                let answer = match (&end, &self.fatal) {
                    (End::Server, Some(fatal)) => Ok(Described {
                        params: Vec::new(),
                        page: Page {
                            error: Some(fatal.clone()),
                            ..Page::default()
                        },
                    }),
                    (End::Io(why), _) => Err(Error::Io(why.clone())),
                    _ => Err(Error::Closed),
                };
                (Some(end), answer)
            }
        };
        let answer = match answer {
            Ok(Described { params, page }) => self
                .with_notices(Ok(page))
                .map(|page| Described { params, page }),
            Err(error) => self.with_notices(Err(error)).map(|_| Described::default()),
        };
        let _ = reply.send(answer);
        end.map_or(Ok(()), Err)
    }

    async fn describe(&mut self, statement: Statement) -> Result<Described, Fail> {
        if let Open::CopyIn = self.open {
            let why =
                "a COPY FROM STDIN waits for its data: end it with db.copy done or fail first";
            return Err(Fail::Call(Error::Invalid(why.to_owned())));
        }
        self.close_result().await?;
        self.conn
            .out
            .extend_from_slice(&messages(&statement).map_err(Fail::Call)?);
        self.send().await?;
        let mut described = Described::default();
        loop {
            match self.next().await? {
                Message::ParseComplete => {}
                Message::ParameterDescription(body) => {
                    described.params = body.parameters().collect().map_err(Error::from)?;
                }
                Message::RowDescription(body) => {
                    described.page.columns = Some(columns(&body)?);
                    break;
                }
                Message::NoData => break,
                Message::ErrorResponse(body) => {
                    described.params.clear();
                    described.page.error = Some(ServerError::read(body.fields()));
                    break;
                }
                other => return Err(unexpected(&other, "Parse and Describe")),
            }
        }
        described.page.transaction = Some(self.sync().await?);
        Ok(described)
    }
}

/// Parse and Describe of the unnamed statement, and Flush: the Sync goes out after the answer.
fn messages(statement: &Statement) -> Result<BytesMut, Error> {
    let invalid = |e: std::io::Error| Error::Invalid(e.to_string());
    let mut out = BytesMut::new();
    let types = statement.types.iter().copied();
    frontend::parse("", &statement.sql, types, &mut out).map_err(invalid)?;
    frontend::describe(b'S', "", &mut out).map_err(invalid)?;
    frontend::flush(&mut out);
    Ok(out)
}
