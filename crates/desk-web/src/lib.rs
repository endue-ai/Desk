//! What the desk's URL schemes answer, apart from any browser engine (ADR 0143).

pub mod assets;
pub mod mime;
pub mod plugin_host;
pub mod sender;
pub mod wire;

/// One answer to a scheme request: status, MIME type, extra headers and body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub mime: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    /// A reply with no body and no headers.
    pub fn status(status: u16) -> Self {
        Self {
            status,
            mime: "text/plain".to_owned(),
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    /// The reason phrase browsers show for `status`.
    pub fn status_text(&self) -> &'static str {
        match self.status {
            200 => "OK",
            204 => "No Content",
            206 => "Partial Content",
            304 => "Not Modified",
            400 => "Bad Request",
            403 => "Forbidden",
            404 => "Not Found",
            405 => "Method Not Allowed",
            416 => "Range Not Satisfiable",
            _ => "Error",
        }
    }
}
