//! A page, as far as the host can tell: a `Y.Doc` and an awareness, joined to
//! a session by the link, with the frames pumped by hand.

#![allow(dead_code)]

use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use serde_json::Value;
use tokio::time::timeout;
use yaz_collab::{Host, HostConfig, LocalLink, Timing};
use yaz_core::project::{FolderLocks, canonical_root};
use yrs::sync::{Awareness, DefaultProtocol, Message, Protocol, SyncMessage};
use yrs::updates::encoder::Encode;
use yrs::{
    ClientID, Doc, GetString, Map, MapRef, OffsetKind, Options, Out, ReadTxn, Text, TextPrelim,
    Transact,
};

/// Fast enough for a test, in the proportions of the real thing.
pub fn quick() -> Timing {
    Timing {
        idle: Duration::from_millis(30),
        busiest: Duration::from_millis(200),
        linger: Duration::from_millis(500),
        flush: Duration::from_millis(600),
        rescan: Duration::from_millis(100),
        retry: Duration::from_millis(20),
    }
}

/// A folder with these files in it, and a host that shares it.
pub fn project(files: &[(&str, &str)]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = canonical_root(Utf8Path::from_path(dir.path()).unwrap()).unwrap();
    for (name, body) in files {
        let target = root.join(name);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, body).unwrap();
    }
    (dir, root)
}

pub fn host(timing: Timing) -> Host {
    let mut config = HostConfig::sharing(Utf8PathBuf::from("unused"));
    config.timing = timing;
    Host::new(config, FolderLocks::default())
}

pub struct Page {
    pub awareness: Awareness,
    pub files: MapRef,
    pub meta: MapRef,
    pub link: Option<LocalLink>,
    /// Every host message (tag 100) received, in order.
    pub messages: Vec<Value>,
    /// Every frame received, by its first byte.
    pub tags: Vec<u8>,
}

pub fn doc() -> Doc {
    Doc::with_options(Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::default()
    })
}

impl Page {
    /// Attach, read `hello`, and begin to sync as a page does.
    pub async fn attach(host: &Host, root: &Utf8Path) -> Page {
        let link = host.attach(root).await.unwrap();
        let doc = doc();
        let files = doc.get_or_insert_map("files");
        let meta = doc.get_or_insert_map("meta");
        let mut page = Page {
            awareness: Awareness::new(doc),
            files,
            meta,
            link: Some(link),
            messages: Vec::new(),
            tags: Vec::new(),
        };
        page.pump_until(|page| page.messages.iter().any(|m| m["t"] == "hello"))
            .await;
        let state = page.awareness.doc().transact().state_vector();
        page.send(&Message::Sync(SyncMessage::SyncStep1(state)));
        page
    }

    pub fn send(&mut self, message: &Message) {
        let link = self.link.as_ref().expect("the link is open");
        link.to_session.try_send(message.encode_v1()).unwrap();
    }

    pub fn send_raw(&mut self, frame: Vec<u8>) {
        self.link
            .as_ref()
            .unwrap()
            .to_session
            .try_send(frame)
            .unwrap();
    }

    /// Leave, as a closed tab does.
    pub fn leave(&mut self) {
        self.link = None;
    }

    pub fn client_id(&self) -> ClientID {
        self.awareness.client_id()
    }

    /// Handle one frame from the host.
    fn receive(&mut self, frame: &[u8]) {
        self.tags.push(frame[0]);
        if frame[0] == 100 {
            let mut at = 1;
            while frame[at] & 0x80 != 0 {
                at += 1;
            }
            self.messages
                .push(serde_json::from_slice(&frame[at + 1..]).unwrap());
            return;
        }
        for response in DefaultProtocol.handle(&mut self.awareness, frame).unwrap() {
            self.send(&response);
        }
    }

    /// Receive frames until `done` holds, or fail after five seconds.
    pub async fn pump_until(&mut self, done: impl Fn(&Page) -> bool) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while !done(self) {
            let link = self.link.as_mut().expect("the link is open");
            match timeout(
                deadline.saturating_duration_since(tokio::time::Instant::now()),
                link.from_session.recv(),
            )
            .await
            {
                Ok(Some(frame)) => self.receive(&frame),
                Ok(None) => panic!("the host closed the link"),
                Err(_) => panic!("the page never reached the state it waited for"),
            }
        }
    }

    /// Receive whatever arrives within a moment.
    pub async fn pump_for(&mut self, wait: Duration) {
        while let Ok(Some(frame)) =
            timeout(wait, self.link.as_mut().unwrap().from_session.recv()).await
        {
            self.receive(&frame);
        }
    }

    pub fn text(&self, path: &str) -> Option<String> {
        let txn = self.awareness.doc().transact();
        match self.files.get(&txn, path) {
            Some(Out::YText(text)) => Some(text.get_string(&txn)),
            _ => None,
        }
    }

    pub fn meta_schema(&self) -> Option<f64> {
        let txn = self.awareness.doc().transact();
        match self.meta.get(&txn, "schema") {
            Some(Out::Any(yrs::Any::Number(yrs::any::Number::Int(number)))) => Some(number as f64),
            Some(Out::Any(yrs::Any::Number(yrs::any::Number::Float(number)))) => Some(number),
            _ => None,
        }
    }

    pub fn paths(&self) -> Vec<String> {
        let txn = self.awareness.doc().transact();
        let mut paths: Vec<String> = self.files.keys(&txn).map(str::to_owned).collect();
        paths.sort();
        paths
    }

    pub fn state_vector(&self) -> Vec<u8> {
        self.awareness.doc().transact().state_vector().encode_v1()
    }

    /// Edit a file as typing does, and send the change.
    pub fn insert(&mut self, path: &str, index: u32, chunk: &str) -> Vec<u8> {
        let update = self.edit_locally(path, index, chunk);
        self.send(&Message::Sync(SyncMessage::Update(update.clone())));
        update
    }

    /// Edit a file and keep the change to oneself.
    pub fn edit_locally(&mut self, path: &str, index: u32, chunk: &str) -> Vec<u8> {
        let doc = self.awareness.doc().clone();
        let before = doc.transact().state_vector();
        {
            let mut txn = doc.transact_mut();
            match self.files.get(&txn, path) {
                Some(Out::YText(text)) => text.insert(&mut txn, index, chunk),
                _ => {
                    self.files.insert(&mut txn, path, TextPrelim::new(chunk));
                }
            }
        }
        doc.transact().encode_diff_v1(&before)
    }

    /// Say who this page is, as `y-protocols` does.
    pub fn announce(&mut self, state: &Value) {
        self.awareness.set_local_state_raw(state.to_string());
        let update = self.awareness.update().unwrap();
        self.send(&Message::Awareness(update));
    }

    pub fn state_of(&self, client: ClientID) -> Option<Value> {
        self.awareness.state::<Value>(client)
    }
}

/// Wait for a condition on the disk, for up to five seconds.
pub async fn eventually(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            std::time::Instant::now() < deadline,
            "never happened: {what}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
