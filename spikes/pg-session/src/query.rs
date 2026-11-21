//! Running statements on a session: a script through the simple protocol; one statement through the
//! extended protocol with text results in pages (Execute with a row limit on an open portal,
//! PortalSuspended between pages, Sync at the end); COPY out and in.

use bytes::{Bytes, BytesMut};
use fallible_iterator::FallibleIterator;
use postgres_protocol::IsNull;
use postgres_protocol::message::backend::{DataRowBody, Message, RowDescriptionBody};
use postgres_protocol::message::frontend::{self, CopyData};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::session::{Error, Fields, Session, fields};

/// One column as RowDescription describes it.
#[derive(Clone, Debug)]
pub struct Column {
    pub name: String,
    /// The table it comes from and its attribute number there; 0 for an expression.
    pub table_oid: u32,
    pub column_id: i16,
    pub type_oid: u32,
    pub type_size: i16,
    pub type_modifier: i32,
    /// 0 text, 1 binary: the spike asks for text, the server's own output of each value.
    pub format: i16,
}

pub fn columns(body: &RowDescriptionBody) -> Result<Vec<Column>, Error> {
    let mut out = Vec::new();
    let mut iter = body.fields();
    while let Some(f) = iter.next()? {
        out.push(Column {
            name: f.name().to_owned(),
            table_oid: f.table_oid(),
            column_id: f.column_id(),
            type_oid: f.type_oid(),
            type_size: f.type_size(),
            type_modifier: f.type_modifier(),
            format: f.format(),
        });
    }
    Ok(out)
}

/// A row's values in the server's text form; `None` is NULL.
pub type Row = Vec<Option<String>>;

pub fn row(body: &DataRowBody) -> Result<Row, Error> {
    let buffer = body.buffer();
    let mut out = Vec::new();
    let mut ranges = body.ranges();
    while let Some(range) = ranges.next()? {
        out.push(range.map(|r| String::from_utf8_lossy(&buffer[r]).into_owned()));
    }
    Ok(out)
}

/// One statement's answer in a script.
#[derive(Debug, Default)]
pub struct Outcome {
    pub columns: Option<Vec<Column>>,
    pub rows: Vec<Row>,
    pub tag: Option<String>,
    pub error: Option<Fields>,
}

/// One page of an open statement.
#[derive(Debug, Default)]
pub struct Page {
    pub columns: Option<Vec<Column>>,
    pub rows: Vec<Row>,
    /// The bytes of the rows' values as they came.
    pub bytes: usize,
    /// The command tag once the statement finished; `None` while more pages wait.
    pub tag: Option<String>,
}

impl Session {
    /// A script through the simple protocol: every statement's columns, rows, tag or error.
    pub async fn simple(&mut self, sql: &str) -> Result<(Vec<Outcome>, u8), Error> {
        let mut out = BytesMut::new();
        frontend::query(sql, &mut out)?;
        self.send(&out).await?;
        let mut outcomes = Vec::new();
        let mut current = Outcome::default();
        loop {
            match self.answer().await? {
                Message::RowDescription(body) => current.columns = Some(columns(&body)?),
                Message::DataRow(body) => current.rows.push(row(&body)?),
                Message::CommandComplete(body) => {
                    current.tag = Some(body.tag()?.to_owned());
                    outcomes.push(std::mem::take(&mut current));
                }
                Message::EmptyQueryResponse => outcomes.push(std::mem::take(&mut current)),
                Message::ErrorResponse(body) => {
                    current.error = Some(fields(body.fields()));
                    outcomes.push(std::mem::take(&mut current));
                }
                Message::ReadyForQuery(body) => return Ok((outcomes, body.status())),
                Message::CopyInResponse(_) | Message::CopyOutResponse(_) => {
                    return Err(Error::Protocol(
                        "COPY goes through copy_in / copy_out".into(),
                    ));
                }
                _ => {}
            }
        }
    }

    /// Open one statement with text parameters and read its first page of `page` rows at most.
    pub async fn open(
        &mut self,
        sql: &str,
        params: &[Option<&str>],
        page: i32,
    ) -> Result<Page, Error> {
        let mut out = BytesMut::new();
        frontend::parse("", sql, std::iter::empty(), &mut out)?;
        let formats = params.iter().map(|_| 0i16);
        let bound = frontend::bind(
            "",
            "",
            formats,
            params.iter().copied(),
            |value, buf| match value {
                Some(text) => {
                    buf.extend_from_slice(text.as_bytes());
                    Ok(IsNull::No)
                }
                None => Ok(IsNull::Yes),
            },
            Some(0),
            &mut out,
        );
        bound.map_err(|_| Error::Protocol("bind".into()))?;
        frontend::describe(b'P', "", &mut out)?;
        frontend::execute("", page, &mut out)?;
        frontend::flush(&mut out);
        self.send(&out).await?;
        self.read_page().await
    }

    /// The next page of the open statement.
    pub async fn more(&mut self, page: i32) -> Result<Page, Error> {
        let mut out = BytesMut::new();
        frontend::execute("", page, &mut out)?;
        frontend::flush(&mut out);
        self.send(&out).await?;
        self.read_page().await
    }

    /// End the open statement (or what a finished one left): Sync, then ReadyForQuery.
    pub async fn sync(&mut self) -> Result<u8, Error> {
        let mut out = BytesMut::new();
        frontend::sync(&mut out);
        self.send(&out).await?;
        loop {
            if let Message::ReadyForQuery(body) = self.answer().await? {
                return Ok(body.status());
            }
        }
    }

    async fn read_page(&mut self) -> Result<Page, Error> {
        let mut page = Page::default();
        loop {
            match self.answer().await? {
                Message::ParseComplete | Message::BindComplete | Message::NoData => {}
                Message::RowDescription(body) => page.columns = Some(columns(&body)?),
                Message::DataRow(body) => {
                    page.bytes += body.buffer().len();
                    page.rows.push(row(&body)?);
                }
                Message::PortalSuspended => return Ok(page),
                Message::CommandComplete(body) => {
                    page.tag = Some(body.tag()?.to_owned());
                    self.sync().await?;
                    return Ok(page);
                }
                Message::EmptyQueryResponse => {
                    page.tag = Some(String::new());
                    self.sync().await?;
                    return Ok(page);
                }
                Message::ErrorResponse(body) => {
                    let error = Error::Server(fields(body.fields()));
                    self.sync().await?;
                    return Err(error);
                }
                _ => return Err(Error::Protocol("unexpected message in a page".into())),
            }
        }
    }

    /// `COPY ... TO STDOUT` into `sink`; answers the bytes and the tag.
    pub async fn copy_out<W: AsyncWrite + Unpin>(
        &mut self,
        sql: &str,
        sink: &mut W,
    ) -> Result<(u64, String), Error> {
        let mut out = BytesMut::new();
        frontend::query(sql, &mut out)?;
        self.send(&out).await?;
        let (mut bytes, mut tag, mut error) = (0u64, String::new(), None);
        loop {
            match self.answer().await? {
                Message::CopyOutResponse(_) | Message::CopyDone => {}
                Message::CopyData(body) => {
                    bytes += body.data().len() as u64;
                    sink.write_all(body.data()).await?;
                }
                Message::CommandComplete(body) => tag = body.tag()?.to_owned(),
                Message::ErrorResponse(body) => error = Some(fields(body.fields())),
                Message::ReadyForQuery(_) => break,
                _ => return Err(Error::Protocol("unexpected message in COPY out".into())),
            }
        }
        sink.flush().await?;
        error.map_or(Ok((bytes, tag)), |f| Err(Error::Server(f)))
    }

    /// `COPY ... FROM STDIN` from `source`, in CopyData messages of `chunk` bytes.
    pub async fn copy_in<R: AsyncRead + Unpin>(
        &mut self,
        sql: &str,
        source: &mut R,
        chunk: usize,
    ) -> Result<(u64, String), Error> {
        let mut out = BytesMut::new();
        frontend::query(sql, &mut out)?;
        self.send(&out).await?;
        match self.answer().await? {
            Message::CopyInResponse(_) => {}
            Message::ErrorResponse(body) => {
                let error = Error::Server(fields(body.fields()));
                while !matches!(self.answer().await?, Message::ReadyForQuery(_)) {}
                return Err(error);
            }
            _ => {
                return Err(Error::Protocol(
                    "COPY FROM STDIN without CopyInResponse".into(),
                ));
            }
        }
        let mut sent = 0u64;
        let mut block = vec![0u8; chunk];
        loop {
            let n = source.read(&mut block).await?;
            if n == 0 {
                break;
            }
            sent += n as u64;
            let mut msg = BytesMut::with_capacity(n + 5);
            CopyData::new(Bytes::copy_from_slice(&block[..n]))?.write(&mut msg);
            self.send(&msg).await?;
        }
        let mut done = BytesMut::new();
        frontend::copy_done(&mut done);
        self.send(&done).await?;
        let (mut tag, mut error) = (String::new(), None);
        loop {
            match self.answer().await? {
                Message::CommandComplete(body) => tag = body.tag()?.to_owned(),
                Message::ErrorResponse(body) => error = Some(fields(body.fields())),
                Message::ReadyForQuery(_) => break,
                _ => {}
            }
        }
        error.map_or(Ok((sent, tag)), |f| Err(Error::Server(f)))
    }
}
