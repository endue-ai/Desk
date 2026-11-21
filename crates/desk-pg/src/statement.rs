//! One statement by the extended protocol, its answer in pages: Parse, Bind with text results,
//! Describe and Execute of one row past the page, so `more` is exact; PortalSuspended between
//! Executes, Sync at the end. A result left open is closed before the next statement.

use bytes::BytesMut;
use fallible_iterator::FallibleIterator;
use postgres_protocol::IsNull;
use postgres_protocol::message::backend::Message;
use postgres_protocol::message::frontend;

use crate::error::{Error, ServerError};
use crate::page::{Copy, Direction, Limits, Page, Row, columns, counted_tag, row, tag_count};
use crate::session::Statement;
use crate::task::{Fail, Open, Task, unexpected};

/// What the next message of a result is.
pub(crate) enum Step {
    Row(Row, usize),
    Done(String),
    Error(ServerError),
    Copy(Copy),
}

impl Task {
    pub(crate) async fn run_statement(
        &mut self,
        statement: Statement,
        limits: Limits,
    ) -> Result<Page, Fail> {
        if let Open::CopyIn = self.open {
            return Err(copy_waits());
        }
        self.close_result().await?;
        let messages = messages(&statement, limits).map_err(Fail::Call)?;
        self.conn.out.extend_from_slice(&messages);
        self.send().await?;
        let described = loop {
            match self.next().await? {
                Message::ParseComplete | Message::BindComplete => {}
                Message::RowDescription(body) => break Some(columns(&body)?),
                Message::NoData => break None,
                Message::ErrorResponse(body) => {
                    return self
                        .failed(Page::default(), ServerError::read(body.fields()))
                        .await;
                }
                other => return Err(unexpected(&other, "Parse and Bind")),
            }
        };
        self.open = Open::Rows {
            suspended: false,
            held: None,
            total: 0,
            described: described.is_some(),
        };
        let mut page = self.rows(limits).await?;
        if page.copy.is_none() {
            page.columns = described;
        }
        Ok(page)
    }

    pub(crate) async fn fetch(&mut self, limits: Limits, close: bool) -> Result<Page, Fail> {
        match self.open {
            Open::None => Err(Fail::Call(Error::Invalid(
                "no result has pages left".to_owned(),
            ))),
            Open::CopyIn => Err(copy_waits()),
            _ if close => {
                self.close_result().await?;
                Ok(Page {
                    transaction: Some(self.shared.transaction()),
                    ..Page::default()
                })
            }
            Open::Rows { .. } => self.rows(limits).await,
            Open::CopyOut { .. } => self.copy_out(limits).await,
        }
    }

    /// The next page of rows: the one held from the last page, then rows until the page is full
    /// and one more, which is held for the next page.
    async fn rows(&mut self, limits: Limits) -> Result<Page, Fail> {
        let mut page = Page::default();
        let mut bytes = 0;
        if let Open::Rows { held, total, .. } = &mut self.open
            && let Some((row, size)) = held.take()
        {
            page.rows.push(row);
            bytes += size;
            *total += 1;
        }
        loop {
            let step = self.step(limits).await?;
            if std::mem::take(&mut self.too_large) {
                return self.abandon(&step).await;
            }
            match step {
                Step::Row(row, size) => {
                    let Open::Rows { held, total, .. } = &mut self.open else {
                        return Err(Fail::from(crate::error::protocol("rows without a result")));
                    };
                    if limits.full(page.rows.len(), bytes) {
                        *held = Some((row, size));
                        page.more = true;
                        return Ok(page);
                    }
                    page.rows.push(row);
                    bytes += size;
                    *total += 1;
                }
                Step::Done(tag) => return self.done(page, tag).await,
                Step::Error(error) => return self.failed(page, error).await,
                Step::Copy(copy) => {
                    page.copy = Some(copy);
                    if copy.direction == Direction::In {
                        self.open = Open::CopyIn;
                        page.more = true;
                        return Ok(page);
                    }
                    self.open = Open::CopyOut { held: None };
                    let rest = self.copy_out(limits).await?;
                    return Ok(Page {
                        copy: Some(copy),
                        ..rest
                    });
                }
            }
        }
    }

    /// The next message of the open rows, asking for the next batch after PortalSuspended.
    async fn step(&mut self, limits: Limits) -> Result<Step, Fail> {
        loop {
            if let Open::Rows { suspended, .. } = &mut self.open
                && *suspended
            {
                *suspended = false;
                frontend::execute("", batch(limits), &mut self.conn.out).map_err(Error::from)?;
                frontend::flush(&mut self.conn.out);
                self.send().await?;
            }
            match self.next().await? {
                Message::DataRow(body) => {
                    let (row, size) = row(&body)?;
                    return Ok(Step::Row(row, size));
                }
                Message::PortalSuspended => {
                    if let Open::Rows { suspended, .. } = &mut self.open {
                        *suspended = true;
                    }
                }
                Message::CommandComplete(body) => {
                    let tag = body.tag().map_err(Error::from)?.to_owned();
                    return Ok(Step::Done(tag));
                }
                Message::EmptyQueryResponse => return Ok(Step::Done(String::new())),
                Message::ErrorResponse(body) => {
                    return Ok(Step::Error(ServerError::read(body.fields())));
                }
                Message::CopyInResponse(body) => {
                    let columns = body.column_formats().count().map_err(Error::from)?;
                    return Ok(Step::Copy(copy(Direction::In, body.format(), columns)));
                }
                Message::CopyOutResponse(body) => {
                    let columns = body.column_formats().count().map_err(Error::from)?;
                    return Ok(Step::Copy(copy(Direction::Out, body.format(), columns)));
                }
                other => return Err(unexpected(&other, "a result")),
            }
        }
    }

    /// The statement finished: its last page with the tag, the row count and the transaction.
    pub(crate) async fn done(&mut self, mut page: Page, tag: String) -> Result<Page, Fail> {
        let counted = match std::mem::replace(&mut self.open, Open::None) {
            Open::Rows {
                total, described, ..
            } => described.then_some(total),
            _ => None,
        };
        page.transaction = Some(self.sync().await?);
        // The server's tag counts the last Execute only; a result read in pages counts them all.
        page.row_count = counted.or(tag_count(&tag));
        page.tag = Some(match counted {
            Some(total) => counted_tag(&tag, total),
            None => tag,
        });
        page.more = false;
        Ok(page)
    }

    /// The statement ended with the server's error: its last page carries it.
    pub(crate) async fn failed(
        &mut self,
        mut page: Page,
        error: ServerError,
    ) -> Result<Page, Fail> {
        self.open = Open::None;
        page.transaction = Some(self.sync().await?);
        page.error = Some(error);
        page.more = false;
        Ok(page)
    }

    /// A row or COPY message was over the limit: end the result and say so.
    async fn abandon(&mut self, step: &Step) -> Result<Page, Fail> {
        match step {
            Step::Row(..) => self.close_result().await?,
            _ => {
                self.open = Open::None;
                self.sync().await?;
            }
        }
        self.too_large = false;
        let limit = crate::MAX_ROW / (1024 * 1024);
        let why = format!("a row is over {limit} MiB: the result ended");
        Err(Fail::Call(Error::TooLarge(why)))
    }

    /// End what is open without reading on: the portal closed, a COPY out cancelled and drained,
    /// a COPY in failed.
    pub(crate) async fn close_result(&mut self) -> Result<(), Fail> {
        match std::mem::replace(&mut self.open, Open::None) {
            Open::None => return Ok(()),
            Open::Rows { suspended, .. } => {
                if !suspended {
                    self.drain().await?;
                }
                frontend::close(b'P', "", &mut self.conn.out).map_err(Error::from)?;
            }
            Open::CopyOut { .. } => {
                self.cancel_self().await;
                self.drain().await?;
            }
            Open::CopyIn => {
                frontend::copy_fail("the desk closed the COPY", &mut self.conn.out)
                    .map_err(Error::from)?;
            }
        }
        self.sync().await?;
        self.too_large = false;
        Ok(())
    }

    /// Read past the rest of the last Execute's answer, or of a COPY out.
    async fn drain(&mut self) -> Result<(), Fail> {
        loop {
            match self.next().await? {
                Message::DataRow(_) | Message::CopyData(_) | Message::CopyDone => {}
                Message::CopyOutResponse(_) => {}
                _ => return Ok(()),
            }
        }
    }
}

/// Parse, Bind (text parameters, text results), Describe, Execute and Flush for `statement`.
fn messages(statement: &Statement, limits: Limits) -> Result<BytesMut, Error> {
    let invalid = |e: std::io::Error| Error::Invalid(e.to_string());
    let mut out = BytesMut::new();
    let types = statement.types.iter().copied();
    frontend::parse("", &statement.sql, types, &mut out).map_err(invalid)?;
    let formats = statement.params.iter().map(|_| 0i16);
    let values = statement.params.iter().map(Option::as_deref);
    type Failed = Box<dyn std::error::Error + Sync + Send>;
    let serialize = |value: Option<&str>, buf: &mut BytesMut| -> Result<IsNull, Failed> {
        match value {
            Some(text) => {
                buf.extend_from_slice(text.as_bytes());
                Ok(IsNull::No)
            }
            None => Ok(IsNull::Yes),
        }
    };
    frontend::bind("", "", formats, values, serialize, Some(0), &mut out)
        .map_err(|_| Error::Invalid("the parameters cannot be sent".to_owned()))?;
    frontend::describe(b'P', "", &mut out).map_err(invalid)?;
    frontend::execute("", batch(limits), &mut out).map_err(invalid)?;
    frontend::flush(&mut out);
    Ok(out)
}

/// Rows one Execute asks for: a page and the one past it.
fn batch(limits: Limits) -> i32 {
    i32::try_from(limits.rows + 1).unwrap_or(i32::MAX)
}

fn copy(direction: Direction, format: u8, columns: usize) -> Copy {
    Copy {
        direction,
        binary: format == 1,
        columns,
    }
}

fn copy_waits() -> Fail {
    let why = "a COPY FROM STDIN waits for its data: end it with db.copy done or fail first";
    Fail::Call(Error::Invalid(why.to_owned()))
}
