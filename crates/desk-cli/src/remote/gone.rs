//! After the desk closed the connection while a command ran. A command that starts the desk again
//! (`desk.start.normally`, which leaves safe mode) ends this way: the old desk exits before it can
//! answer. So `cmd run` looks for a desk at the socket again before it says the desk was lost (#163).

use std::io::ErrorKind;
use std::path::Path;
use std::time::{Duration, Instant};

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_ipc::Client;
use serde_json::json;

/// How long a desk that starts again may take to answer at its socket.
const RESTART: Duration = Duration::from_secs(15);
/// How long the socket may stay gone before the desk counts as quit: a desk that quits removes it,
/// and one that starts again binds it again at once (an exit leaves the old file until then).
const REMOVED: Duration = Duration::from_secs(1);
const STEP: Duration = Duration::from_millis(100);

/// Whether a desk answers `init.get` at `path` again within [`RESTART`].
pub(super) fn came_back(path: &Path) -> bool {
    let deadline = Instant::now() + RESTART;
    let mut removed: Option<Instant> = None;
    while Instant::now() < deadline {
        match Client::connect(path).map(answers) {
            Ok(true) => return true,
            Err(why) if why.kind() == ErrorKind::NotFound => {
                if removed.get_or_insert_with(Instant::now).elapsed() >= REMOVED {
                    return false;
                }
            }
            _ => removed = None,
        }
        std::thread::sleep(STEP);
    }
    false
}

/// Whether the desk on `client` answers a round trip: a socket the old desk still held for a
/// moment as it exited takes the connection but never answers.
fn answers(mut client: Client) -> bool {
    let ping = json!({ "id": 1, "method": "init.get", "params": {} });
    let Ok(request) = serde_json::from_value::<BridgeRequest>(ping) else {
        return false;
    };
    matches!(client.call(request), Ok(BridgeResponse::BridgeSuccess(_)))
}
