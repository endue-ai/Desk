//! The computer of a platform without computer use yet: every call answers `unsupported`.

use crate::apps::{App, AppOp, Launch};
use crate::ax::{AxAction, Budget, Element, ElementRef, Query, Setting, Tree};
use crate::input::Event;
use crate::permissions::{Permission, Permissions};
use crate::screen::{Capture, Display, Screenshot, Window, WindowScope};
use crate::{Computer, Error, ErrorCode, Focus, Permit};

pub(crate) struct Unsupported;

fn unsupported<T>() -> Result<T, Error> {
    Err(Error::new(
        ErrorCode::Unsupported,
        "computer use is available on macOS only for now",
    ))
}

impl Computer for Unsupported {
    fn permissions(&self) -> Result<Permissions, Error> {
        unsupported()
    }

    fn request(&self, _: Permission) -> Result<bool, Error> {
        unsupported()
    }

    fn open_settings(&self, _: Permission) -> Result<(), Error> {
        unsupported()
    }

    fn displays(&self) -> Result<Vec<Display>, Error> {
        unsupported()
    }

    fn windows(&self, _: WindowScope) -> Result<Vec<Window>, Error> {
        unsupported()
    }

    fn screenshot(&self, _: &Capture) -> Result<Screenshot, Error> {
        unsupported()
    }

    fn focused(&self) -> Result<Focus, Error> {
        unsupported()
    }

    fn tree(&self, _: &ElementRef, _: Budget) -> Result<Tree, Error> {
        unsupported()
    }

    fn find(&self, _: &ElementRef, _: &Query, _: Budget) -> Result<Vec<Element>, Error> {
        unsupported()
    }

    fn apps(&self) -> Result<Vec<App>, Error> {
        unsupported()
    }

    fn post(&self, _: &Event, _: &Permit) -> Result<(), Error> {
        unsupported()
    }

    fn perform(&self, _: &ElementRef, _: AxAction, _: &Permit) -> Result<Element, Error> {
        unsupported()
    }

    fn set(&self, _: &ElementRef, _: &Setting, _: &Permit) -> Result<Element, Error> {
        unsupported()
    }

    fn launch(&self, _: &Launch, _: &Permit) -> Result<App, Error> {
        unsupported()
    }

    fn app(&self, _: i32, _: AppOp, _: &Permit) -> Result<App, Error> {
        unsupported()
    }
}
