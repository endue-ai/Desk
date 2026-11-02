//! The updater's steps: check the channel index and choose, download and stage, apply. Each runs
//! while it holds the updater's one work slot.

use std::time::SystemTime;

use crate::manifest::{self, Index, Listed};
use crate::policy;
use crate::status::{Channel, Chosen, State, Status};
use crate::time::rfc3339;
use crate::verify::verify;

use super::{Prefs, Updater, lock, newer};

impl Updater {
    pub(super) fn checking(&self, prefs: Prefs) {
        self.update(|s| {
            s.channel = prefs.channel;
            s.state = State::Checking;
            s.reason = None;
        });
    }

    pub(super) fn check_step(&self, prefs: Prefs) {
        match self.read_index(prefs.channel) {
            Ok(index) => self.decide(&index, prefs),
            Err(reason) => self.failed(None, reason),
        }
    }

    fn read_index(&self, channel: Channel) -> Result<Index, String> {
        let url = format!(
            "{}/channels/{}/index.json",
            self.inner.config.base.trim_end_matches('/'),
            channel.name()
        );
        let bytes = self
            .signed(&url)
            .map_err(|e| format!("the channel index: {e}"))?;
        let index = manifest::index(&bytes)?;
        if index.channel != channel.name() {
            let named = &index.channel;
            return Err(format!("the {} index says it is {named}'s", channel.name()));
        }
        if let Some(seen) = self.inner.stage.seen(channel.name())
            && index.serial < seen
        {
            let serial = index.serial;
            return Err(format!(
                "the {} index is older than one already seen ({serial} < {seen})",
                channel.name()
            ));
        }
        self.inner.stage.see(channel.name(), index.serial);
        Ok(index)
    }

    /// Choose from a checked index and act on the choice.
    fn decide(&self, index: &Index, prefs: Prefs) {
        let checked_at = Some(rfc3339(SystemTime::now()));
        // A staged build the channel no longer lists was taken down: it is never applied.
        let staged = self
            .inner
            .stage
            .staged()
            .filter(|chosen| policy::listed(index, &chosen.version));
        let salt = &self.inner.salt;
        let next = policy::choose(
            index,
            &self.inner.current,
            &self.inner.config.targets,
            |version| policy::bucket(salt, version),
        );
        let Some(listed) = next else {
            self.inner.stage.discard();
            self.update(|s| {
                *s = s.at(State::UpToDate, None, false);
                s.checked_at = checked_at;
            });
            return;
        };
        if let Some(chosen) = staged.filter(|chosen| chosen.version == listed.version) {
            self.prepare(&chosen);
            self.update(|s| {
                *s = s.at(State::Staged, Some(chosen), true);
                s.checked_at = checked_at;
            });
            return;
        }
        if self
            .inner
            .stage
            .staged()
            .is_some_and(|c| !policy::listed(index, &c.version))
        {
            self.inner.stage.discard();
        }
        match self.read_release(listed) {
            Ok(chosen) => {
                self.update(|s| {
                    *s = s.at(State::Available, Some(chosen.clone()), false);
                    s.checked_at = checked_at;
                });
                if prefs.auto {
                    self.download_step(chosen);
                }
            }
            Err(reason) => self.failed(None, reason),
        }
    }

    fn read_release(&self, listed: &Listed) -> Result<Chosen, String> {
        let base = &self.inner.config.base;
        let url = manifest::resolve(base, &listed.release);
        let bytes = self
            .signed(&url)
            .map_err(|e| format!("the manifest of {}: {e}", listed.version))?;
        let release = manifest::release(&bytes)?;
        if release.version != listed.version {
            let (has, wants) = (&release.version, &listed.version);
            return Err(format!(
                "the manifest is for {has}, the index lists {wants}"
            ));
        }
        let target = policy::target(&release, &self.inner.config.targets)
            .ok_or_else(|| format!("{} has no artifact for this desk", release.version))?;
        let platform = &release.platforms[target];
        let artifact = &release.desk.artifacts[target];
        let artifact_url = manifest::resolve(base, &platform.url);
        Ok(Chosen {
            version: release.version.clone(),
            commit: release
                .desk
                .commit
                .clone()
                .or_else(|| listed.commit.clone()),
            date: listed.date.clone().or_else(|| release.pub_date.clone()),
            notes: release.notes.clone(),
            target: target.to_owned(),
            file: manifest::file_name(&artifact_url),
            url: artifact_url,
            size: artifact.size,
            sha256: artifact.sha256.to_ascii_lowercase(),
            signature: platform.signature.clone(),
            release: url,
        })
    }

    /// The document at `url`, checked against its `.sig`.
    fn signed(&self, url: &str) -> Result<Vec<u8>, String> {
        let bytes = self.inner.transport.get(url)?;
        let signature = self.inner.transport.get(&format!("{url}.sig"))?;
        let signature = String::from_utf8(signature).map_err(|_| "the signature is not text")?;
        verify(&bytes, &signature, &self.inner.config.pubkey, None)?;
        Ok(bytes)
    }

    pub(super) fn download_step(&self, chosen: Chosen) {
        let total = Some(chosen.size);
        self.update(|s| {
            *s = s.at(State::Downloading, Some(chosen.clone()), false);
            s.received = Some(0);
            s.total = total;
        });
        let mut shown = 0;
        let mut progress = |received: u64, _: Option<u64>| {
            let percent = received.saturating_mul(100) / chosen.size.max(1);
            if percent > shown {
                shown = percent;
                self.update(|s| s.received = Some(received));
            }
        };
        let fetched = self.inner.transport.download(&chosen.url, &mut progress);
        let kept = fetched.and_then(|bytes| {
            let pubkey = &self.inner.config.pubkey;
            verify(&bytes, &chosen.signature, pubkey, Some(&chosen.version))
                .map_err(|e| format!("the update: {e}"))?;
            self.inner.stage.put(&chosen, &bytes)
        });
        match kept {
            Ok(()) => {
                self.prepare(&chosen);
                self.update(|s| *s = s.at(State::Staged, Some(chosen), true));
            }
            Err(reason) => self.failed(Some(chosen), reason),
        }
    }

    pub(super) fn apply_step(&self) {
        let Some(staged) = self.inner.stage.staged() else {
            return self.failed(None, "no update is staged".to_owned());
        };
        let pubkey = &self.inner.config.pubkey;
        let checked = self.inner.stage.read(&staged).and_then(|bytes| {
            verify(&bytes, &staged.signature, pubkey, Some(&staged.version))
                .map(|()| bytes)
                .map_err(|e| format!("the staged update: {e}"))
        });
        let bytes = match checked {
            Ok(bytes) => bytes,
            Err(reason) => {
                self.inner.stage.discard();
                let failed = |s: &mut Status| {
                    *s = s.at(State::Failed, Some(staged.clone()), false);
                    s.reason = Some(reason.clone());
                };
                return self.update(failed);
            }
        };
        if let Err(reason) = self.inner.installer.install(&staged, &bytes) {
            self.update(|s| {
                *s = s.at(State::Failed, Some(staged), true);
                s.reason = Some(reason);
            });
        }
    }

    /// A step failed: back to a staged build when there is one, else `failed`.
    fn failed(&self, release: Option<Chosen>, reason: String) {
        let current = &self.inner.current;
        match self.inner.stage.staged().filter(|c| newer(c, current)) {
            Some(staged) => self.update(|s| *s = s.at(State::Staged, Some(staged), true)),
            None => self.update(|s| {
                *s = s.at(State::Failed, release, false);
                s.reason = Some(reason);
            }),
        }
    }

    fn prepare(&self, chosen: &Chosen) {
        let mut prepared = lock(&self.inner.prepared);
        if prepared.as_deref() != Some(chosen.version.as_str())
            && self.inner.installer.prepare(chosen).is_ok()
        {
            *prepared = Some(chosen.version.clone());
        }
    }
}
