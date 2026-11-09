//! The spaces the person can open (`/api/v1/spaces`), read only: the list with each space's summary,
//! one space, its overview and its rooms.

use desk_sys::net::Method;

use crate::Platform;
use crate::error::Result;
use crate::http::{encode, with_query};
use crate::wire_spaces::{Room, Space, SpaceOverview};

/// The path of one space.
pub(crate) fn space_path(id: &str) -> String {
    format!("/api/v1/spaces/{}", encode(id))
}

impl Platform {
    /// Every space the person can open, with its summary: the active ones, or the archived ones.
    pub fn spaces(&self, archived: bool) -> Result<Vec<Space>> {
        let status = archived.then(|| "archived".to_owned());
        let path = with_query(
            "/api/v1/spaces",
            &[("include", Some("summary".to_owned())), ("status", status)],
        );
        self.read(Method::Get, &path, None, "space list")
    }

    pub fn space(&self, id: &str) -> Result<Space> {
        self.read(Method::Get, &space_path(id), None, "space")
    }

    /// The space's counts, the agents taking part, the work going on and the newest results.
    pub fn space_overview(&self, id: &str) -> Result<SpaceOverview> {
        let path = format!("{}/overview", space_path(id));
        self.read(Method::Get, &path, None, "space overview")
    }

    /// The space's rooms that are not archived.
    pub fn space_rooms(&self, id: &str) -> Result<Vec<Room>> {
        let path = format!("{}/rooms", space_path(id));
        self.read(Method::Get, &path, None, "room list")
    }
}
