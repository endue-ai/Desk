//! A statement built in pieces, with its parameters in order.

use rusqlite::types::Value;

#[derive(Debug, Clone, Default)]
pub(crate) struct Sql {
    pub text: String,
    pub params: Vec<Value>,
}

impl Sql {
    pub fn new(text: &str) -> Self {
        Self {
            text: text.to_string(),
            params: Vec::new(),
        }
    }

    pub fn push(&mut self, text: &str) -> &mut Self {
        self.text.push_str(text);
        self
    }

    /// A `?` bound to `value`.
    pub fn bind(&mut self, value: impl Into<Value>) -> &mut Self {
        self.text.push('?');
        self.params.push(value.into());
        self
    }

    /// Another statement's text and parameters, after this one's.
    pub fn append(&mut self, other: &Sql) -> &mut Self {
        self.text.push_str(&other.text);
        self.params.extend(other.params.iter().cloned());
        self
    }

    /// `(a OR b ...)` over `items`, or `0` (false) when there are none.
    pub fn any<T>(&mut self, items: &[T], mut each: impl FnMut(&mut Self, &T)) -> &mut Self {
        if items.is_empty() {
            return self.push("0");
        }
        self.push("(");
        for (n, item) in items.iter().enumerate() {
            if n > 0 {
                self.push(" OR ");
            }
            each(self, item);
        }
        self.push(")")
    }
}
