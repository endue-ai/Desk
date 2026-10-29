//! One thread per process hands its output and exit to the caller, in order, exit last.

use std::io::{self, Read};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

use super::{Event, Exit, Stream};

/// Once the process has exited, output still in flight gets this long of silence to arrive. A
/// grandchild can keep a pipe open forever, and a Windows PTY only ends when it is closed.
const DRAIN: Duration = Duration::from_millis(100);

/// The callback a process reports to.
pub(super) type OnEvent = Box<dyn FnMut(Event) + Send>;

pub(super) enum Message {
    Output(Stream, Vec<u8>),
    /// A reader reached the end of its stream.
    Closed,
    Exited(Exit),
}

/// Start the thread that calls `on_event` for a process with `readers` output streams.
pub(super) fn start(readers: usize, on_event: OnEvent) -> io::Result<Sender<Message>> {
    let (sender, receiver) = mpsc::channel();
    thread::Builder::new()
        .name("desk-proc-events".to_owned())
        .spawn(move || run(&receiver, readers, on_event))?;
    Ok(sender)
}

fn run(receiver: &Receiver<Message>, mut open: usize, mut on_event: OnEvent) {
    let mut exit = None;
    while exit.is_none() || open > 0 {
        let message = match exit {
            None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(_) => receiver.recv_timeout(DRAIN),
        };
        match message {
            Ok(Message::Output(stream, data)) => on_event(Event::Output { stream, data }),
            Ok(Message::Closed) => open = open.saturating_sub(1),
            Ok(Message::Exited(status)) => exit = Some(status),
            Err(_) => break,
        }
    }
    on_event(Event::Exit(exit.unwrap_or_default()));
}

/// Read `source` on a thread of its own until it ends, sending what arrives as `stream` output.
pub(super) fn read(
    mut source: impl Read + Send + 'static,
    stream: Stream,
    sender: Sender<Message>,
) -> io::Result<()> {
    thread::Builder::new()
        .name("desk-proc-read".to_owned())
        .spawn(move || {
            let mut buffer = vec![0; 8192];
            loop {
                match source.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        if sender
                            .send(Message::Output(stream, buffer[..n].to_vec()))
                            .is_err()
                        {
                            return;
                        }
                    }
                    Err(err) if err.kind() == io::ErrorKind::Interrupted => {}
                    // A PTY reports its end as an error (EIO on Linux) once the program is gone.
                    Err(_) => break,
                }
            }
            let _ = sender.send(Message::Closed);
        })?;
    Ok(())
}
