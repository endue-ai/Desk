//! studio.agents.picture (ADR 0232): an agent's face as endue.ai shows it, handed over as a data:
//! URL because the desk's page loads no remote image. The core reads the agent, takes the address
//! of its face from that answer alone (never from the caller), and remembers the pictures it read
//! by address, so a face is fetched once until endue AI names another. A picture that could not be
//! read is remembered as none, so it is asked for once a session too (issue 352).

use std::collections::VecDeque;
use std::sync::Mutex;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use desk_bridge::{StudioAgentParams, StudioAgentsPictureResult, StudioPictureSource};
use desk_platform::Face;

use crate::core_studio::failed;
use crate::handler::{Answer, Core, json};

/// Faces remembered; the oldest goes first.
const KEPT: usize = 128;

/// The pictures read, as data: URLs by address; none for one that could not be read.
#[derive(Default)]
pub(crate) struct Faces(Mutex<VecDeque<(String, Option<String>)>>);

impl Faces {
    /// What was read at `url`: `Some(None)` when it was refused, `None` when it was never asked.
    fn get(&self, url: &str) -> Option<Option<String>> {
        let kept = self.0.lock().unwrap_or_else(|p| p.into_inner());
        kept.iter()
            .find(|(at, _)| at == url)
            .map(|(_, p)| p.clone())
    }

    fn keep(&self, url: &str, picture: Option<String>) {
        let mut kept = self.0.lock().unwrap_or_else(|p| p.into_inner());
        kept.retain(|(at, _)| at != url);
        if kept.len() >= KEPT {
            kept.pop_front();
        }
        kept.push_back((url.to_owned(), picture));
    }
}

impl Core {
    pub(crate) fn studio_agents_picture(&self, caller: &str, params: StudioAgentParams) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let agent = platform
            .get_agent(params.agent_id.as_str())
            .map_err(failed)?;
        let (url, face) = platform.face_of(&agent);
        let picture = self.studio.faces.get(&url).unwrap_or_else(|| {
            let data = platform
                .picture(&url)
                .map(|read| format!("data:{};base64,{}", read.kind, STANDARD.encode(&read.bytes)));
            self.studio.faces.keep(&url, data.clone());
            data
        });
        let source = picture.as_ref().map(|_| match face {
            Face::Character => StudioPictureSource::Character,
            Face::Photo => StudioPictureSource::Photo,
            Face::Drawn => StudioPictureSource::Drawn,
        });
        json(StudioAgentsPictureResult {
            agent_id: params.agent_id,
            picture,
            source,
        })
    }
}
