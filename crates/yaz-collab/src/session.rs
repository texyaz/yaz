//! One project's live session: an actor that owns the replica.
//!
//! One OS thread with a current-thread tokio runtime per session owns the
//! [`Awareness`] and its [`Doc`]; everything else talks to it over channels,
//! so there is no lock around the document and nothing about it has to be
//! `Send`. The actor passes Yjs messages between the pages attached to it,
//! writes the shared files into the folder after they change, and takes the
//! folder's own changes in ([`crate::reconcile`]).
//!
//! Every link is handled by the same code: send step 1 on attach, answer step
//! 1 with step 2, apply step 2 and updates, and forward an update to every link
//! but the one it came from. The collaboration server of a later step is one
//! more link.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::time::{Duration, Instant, SystemTime};

use camino::Utf8PathBuf;
use serde::Serialize;
use tokio::sync::{mpsc, oneshot};
use yrs::encoding::read::Cursor;
use yrs::sync::{Awareness, Message, SyncMessage};
use yrs::updates::decoder::{Decode, Decoder, DecoderV1};
use yrs::updates::encoder::Encode;
use yrs::{
    ClientID, Doc, GetString, Map, MapRef, OffsetKind, Options, Out, ReadTxn, StateVector,
    TextPrelim, Transact, TransactionMut, Update,
};

use yaz_core::project::FolderLocks;

use crate::base::{Base, BaseRecord};
use crate::disk::{self, Disk};
use crate::error::Error;
use crate::policy::{SharedPath, shared_path};
use crate::reconcile::{Action, decide};
use crate::text::{self, Digest, LineEnding};
use crate::wire::{self, FolderReport, HostMessage, Kept, State, Upstream};
use crate::{HostEvent, LINK_PROTOCOL, LocalLink, SCHEMA};

/// How long the host waits before it acts. Fields, not constants, so that a
/// test does not have to wait a minute for a session to end.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// Writing waits until typing has paused this long.
    pub idle: Duration,
    /// But never longer than this after the first change.
    pub busiest: Duration,
    /// A session ends this long after its last page has gone.
    pub linger: Duration,
    /// A flush gives up after this long.
    pub flush: Duration,
    /// How often the folder is looked at for changes made by others.
    pub rescan: Duration,
    /// How soon to try again when a compile holds the folder.
    pub retry: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(1),
            busiest: Duration::from_secs(5),
            linger: Duration::from_secs(60),
            flush: Duration::from_secs(5),
            rescan: Duration::from_secs(2),
            retry: Duration::from_millis(250),
        }
    }
}

/// What a flush brought about.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct FlushReport {
    /// The shared paths written into the folder.
    pub written: Vec<String>,
    /// What else happened to the folder.
    pub folder: FolderReport,
}

/// Everything a session needs to start.
pub(crate) struct Settings {
    pub root: Utf8PathBuf,
    pub locks: FolderLocks,
    pub timing: Timing,
}

type LinkId = u64;

enum Command {
    Attach {
        to_page: mpsc::Sender<Vec<u8>>,
        reply: oneshot::Sender<LinkId>,
    },
    Frame {
        link: LinkId,
        bytes: Vec<u8>,
    },
    Detach {
        link: LinkId,
    },
    Flush {
        seen: StateVector,
        reply: oneshot::Sender<Result<FlushReport, Error>>,
    },
    Rescan {
        reply: oneshot::Sender<Result<FlushReport, Error>>,
    },
    Announce(HostEvent),
}

/// The way to a running session.
pub(crate) struct SessionHandle {
    commands: mpsc::UnboundedSender<Command>,
}

impl SessionHandle {
    /// Start a session: read the folder into a new replica on a thread of its
    /// own, and return once it is ready or has failed.
    pub(crate) async fn start(settings: Settings) -> Result<Self, Error> {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = oneshot::channel();
        std::thread::Builder::new()
            .name("yaz-collab".to_owned())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_time()
                    .build()
                    .expect("a current-thread runtime builds");
                runtime.block_on(async move {
                    match Actor::new(settings) {
                        Ok(actor) => {
                            let _ = ready_tx.send(Ok(()));
                            actor.run(receiver).await;
                        }
                        Err(error) => {
                            let _ = ready_tx.send(Err(error));
                        }
                    }
                });
            })
            .map_err(|error| Error::Unavailable {
                reason: error.to_string(),
            })?;
        match ready_rx.await {
            Ok(Ok(())) => Ok(Self { commands }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(Error::Closed),
        }
    }

    /// Whether the session has ended.
    pub(crate) fn is_closed(&self) -> bool {
        self.commands.is_closed()
    }

    /// Attach a page.
    pub(crate) async fn attach(&self) -> Result<LocalLink, Error> {
        let (to_page, from_session) = mpsc::channel(1024);
        let (to_session, mut from_page) = mpsc::channel::<Vec<u8>>(1024);
        let (reply, answered) = oneshot::channel();
        self.commands
            .send(Command::Attach { to_page, reply })
            .map_err(|_| Error::Closed)?;
        let link = answered.await.map_err(|_| Error::Closed)?;
        let commands = self.commands.clone();
        tokio::spawn(async move {
            while let Some(bytes) = from_page.recv().await {
                if commands.send(Command::Frame { link, bytes }).is_err() {
                    return;
                }
            }
            let _ = commands.send(Command::Detach { link });
        });
        Ok(LocalLink {
            to_session,
            from_session,
        })
    }

    /// Wait until the replica holds what a page has seen, and bring the folder
    /// up to date.
    pub(crate) async fn flush(&self, seen: StateVector) -> Result<FlushReport, Error> {
        let (reply, answered) = oneshot::channel();
        self.commands
            .send(Command::Flush { seen, reply })
            .map_err(|_| Error::Closed)?;
        answered.await.map_err(|_| Error::Closed)?
    }

    /// Look at the folder now.
    pub(crate) async fn rescan(&self) -> Result<FlushReport, Error> {
        let (reply, answered) = oneshot::channel();
        self.commands
            .send(Command::Rescan { reply })
            .map_err(|_| Error::Closed)?;
        answered.await.map_err(|_| Error::Closed)?
    }

    /// Tell every page something happened.
    pub(crate) fn announce(&self, event: HostEvent) {
        let _ = self.commands.send(Command::Announce(event));
    }
}

/// Why a pass over the folder stopped.
enum Stop {
    /// A compile or a restore holds the folder; try again shortly.
    Busy,
    Failed(Error),
}

impl From<Error> for Stop {
    fn from(error: Error) -> Self {
        Stop::Failed(error)
    }
}

struct Link {
    to_page: mpsc::Sender<Vec<u8>>,
    /// The awareness clients this link has spoken for, so that they can be
    /// removed when it closes.
    clients: HashSet<ClientID>,
}

struct PendingFlush {
    seen: StateVector,
    reply: oneshot::Sender<Result<FlushReport, Error>>,
    deadline: Instant,
}

struct Actor {
    root: Utf8PathBuf,
    locks: FolderLocks,
    timing: Timing,
    awareness: Awareness,
    files: MapRef,
    epoch: String,
    links: HashMap<LinkId, Link>,
    next_link: LinkId,
    base: BaseRecord,
    /// Files in the folder that are not shared, so that each is reported once.
    refused: HashSet<SharedPath>,
    /// What the pass in progress has done, until it has finished.
    run: FlushReport,
    /// Whether the first reading of the folder is still going on, which is
    /// seeding and not news.
    starting: bool,
    first_change: Option<Instant>,
    last_change: Option<Instant>,
    retry_at: Option<Instant>,
    next_rescan: Instant,
    linger_at: Option<Instant>,
    flushes: Vec<PendingFlush>,
    done: bool,
}

/// A document in the units the page counts: UTF-16.
fn new_doc() -> Doc {
    Doc::with_options(Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::default()
    })
}

/// A random 128-bit identifier, as hex.
fn random_hex() -> String {
    let random = |_| {
        std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish()
    };
    format!("{:016x}{:016x}", random(0), random(1))
}

/// Fold a map entry's value back into text, if it is one.
fn text_of<T: ReadTxn>(txn: &T, value: Option<Out>) -> Option<String> {
    match value {
        Some(Out::YText(text)) => Some(text.get_string(txn)),
        _ => None,
    }
}

impl Actor {
    fn new(settings: Settings) -> Result<Self, Error> {
        let Settings {
            root,
            locks,
            timing,
        } = settings;
        let doc = new_doc();
        let files = doc.get_or_insert_map("files");
        let meta = doc.get_or_insert_map("meta");
        let epoch = random_hex();
        {
            let mut txn = doc.transact_mut();
            meta.insert(&mut txn, "schema", i64::from(SCHEMA));
            meta.insert(&mut txn, "epoch", epoch.as_str());
        }
        let now = Instant::now();
        let mut actor = Self {
            root,
            locks,
            timing,
            awareness: Awareness::new(doc),
            files,
            epoch,
            links: HashMap::new(),
            next_link: 0,
            base: BaseRecord::default(),
            refused: HashSet::new(),
            run: FlushReport::default(),
            starting: true,
            first_change: None,
            last_change: None,
            retry_at: None,
            next_rescan: now + timing.rescan,
            linger_at: Some(now + timing.linger),
            flushes: Vec::new(),
            done: false,
        };
        match actor.reconcile_all() {
            // What the first look found is for the first page to hear of.
            Ok(report) => actor.run.folder.refused = report.folder.refused,
            Err(Stop::Busy) => unreachable!("seeding writes nothing, so it never waits for a lock"),
            Err(Stop::Failed(error)) => {
                return Err(Error::Unavailable {
                    reason: error.to_string(),
                });
            }
        }
        actor.starting = false;
        Ok(actor)
    }

    async fn run(mut self, mut commands: mpsc::UnboundedReceiver<Command>) {
        loop {
            let received = match self.next_wake() {
                Some(at) => tokio::select! {
                    command = commands.recv() => Some(command),
                    () = tokio::time::sleep_until(at.into()) => None,
                },
                None => Some(commands.recv().await),
            };
            match received {
                Some(Some(command)) => self.handle(command),
                Some(None) => break,
                None => {}
            }
            self.tick(Instant::now());
            if self.done {
                break;
            }
        }
        // No new page from here on; one that was already queued is turned
        // away and attaches to a fresh session.
        commands.close();
        self.finish();
        while commands.try_recv().is_ok() {}
    }

    // --- time ------------------------------------------------------------

    fn writing_due(&self) -> Option<Instant> {
        let (first, last) = (self.first_change?, self.last_change?);
        Some((last + self.timing.idle).min(first + self.timing.busiest))
    }

    fn next_wake(&self) -> Option<Instant> {
        let rescan = (!self.links.is_empty()).then_some(self.next_rescan);
        [self.writing_due(), self.retry_at, rescan, self.linger_at]
            .into_iter()
            .flatten()
            .chain(self.flushes.iter().map(|flush| flush.deadline))
            .min()
    }

    fn tick(&mut self, now: Instant) {
        if self.retry_at.is_some_and(|at| at <= now) {
            self.retry_at = None;
        }
        if self.retry_at.is_none() && self.writing_due().is_some_and(|at| at <= now) {
            self.write_changed();
        }
        if self.retry_at.is_none() && !self.links.is_empty() && self.next_rescan <= now {
            self.next_rescan = now + self.timing.rescan;
            if self.reconcile_and_announce().is_err() {
                tracing::warn!("the folder could not be looked at");
            }
        }
        self.settle_flushes(now);
        if self.linger_at.is_some_and(|at| at <= now) && self.links.is_empty() {
            self.done = true;
        }
    }

    // --- commands --------------------------------------------------------

    fn handle(&mut self, command: Command) {
        match command {
            Command::Attach { to_page, reply } => self.attach(to_page, reply),
            Command::Frame { link, bytes } => self.frame(link, &bytes),
            Command::Detach { link } => self.detach(link),
            Command::Flush { seen, reply } => {
                self.flushes.push(PendingFlush {
                    seen,
                    reply,
                    deadline: Instant::now() + self.timing.flush,
                });
                self.settle_flushes(Instant::now());
            }
            Command::Rescan { reply } => {
                let result = match self.reconcile_and_announce() {
                    Ok(report) => Ok(report),
                    Err(Stop::Busy) => Err(Error::FlushTimedOut),
                    Err(Stop::Failed(error)) => Err(error),
                };
                let _ = reply.send(result);
            }
            Command::Announce(HostEvent::Compiled { succeeded, at }) => {
                self.broadcast_raw(
                    None,
                    &wire::encode(&HostMessage::Compiled { succeeded, at }),
                );
            }
        }
    }

    fn attach(&mut self, to_page: mpsc::Sender<Vec<u8>>, reply: oneshot::Sender<LinkId>) {
        let id = self.next_link;
        self.next_link += 1;
        self.linger_at = None;
        self.links.insert(
            id,
            Link {
                to_page,
                clients: HashSet::new(),
            },
        );
        self.send_raw(
            id,
            wire::encode(&HostMessage::Hello {
                protocol: LINK_PROTOCOL,
                epoch: self.epoch.clone(),
                state: State::Ready,
                reason: None,
            }),
        );
        self.send_raw(
            id,
            wire::encode(&HostMessage::Upstream {
                state: Upstream::None,
            }),
        );
        let state = self.awareness.doc().transact().state_vector();
        self.send(id, &Message::Sync(SyncMessage::SyncStep1(state)));
        if let Ok(update) = self.awareness.update() {
            if !update.clients.is_empty() {
                self.send(id, &Message::Awareness(update));
            }
        }
        let _ = reply.send(id);
    }

    fn frame(&mut self, link: LinkId, bytes: &[u8]) {
        if !self.links.contains_key(&link) {
            return;
        }
        // One message per frame, read strictly: the reader of the library
        // takes a truncated message for the end of the input.
        let mut decoder = DecoderV1::new(Cursor::new(bytes));
        let message = Message::decode(&mut decoder).and_then(|message| {
            match decoder.read_to_end()?.is_empty() {
                true => Ok(message),
                false => Err(yrs::encoding::read::Error::UnexpectedValue),
            }
        });
        let Ok(message) = message else {
            tracing::warn!("a page sent a frame that is not the protocol; closing its link");
            self.detach(link);
            return;
        };
        if let Err(error) = self.message(link, message) {
            tracing::warn!("a page's message was refused ({error}); closing its link");
            self.detach(link);
        }
    }

    fn message(&mut self, link: LinkId, message: Message) -> Result<(), Error> {
        match message {
            Message::Sync(SyncMessage::SyncStep1(state)) => {
                let update = self
                    .awareness
                    .doc()
                    .transact()
                    .encode_state_as_update_v1(&state);
                self.send(link, &Message::Sync(SyncMessage::SyncStep2(update)));
            }
            Message::Sync(SyncMessage::SyncStep2(bytes) | SyncMessage::Update(bytes)) => {
                let update = Update::decode_v1(&bytes)
                    .map_err(|error| Error::Protocol(error.to_string()))?;
                self.awareness
                    .doc()
                    .transact_mut()
                    .apply_update(update)
                    .map_err(|error| Error::Protocol(error.to_string()))?;
                let now = Instant::now();
                self.first_change.get_or_insert(now);
                self.last_change = Some(now);
                self.broadcast(Some(link), &Message::Sync(SyncMessage::Update(bytes)));
                self.settle_flushes(now);
            }
            Message::Awareness(update) => {
                let summary = self
                    .awareness
                    .apply_update_summary(update)
                    .map_err(|error| Error::Protocol(error.to_string()))?;
                let Some(summary) = summary else {
                    return Ok(());
                };
                if let Some(entry) = self.links.get_mut(&link) {
                    entry.clients.extend(&summary.added);
                    entry.clients.extend(&summary.updated);
                    for client in &summary.removed {
                        entry.clients.remove(client);
                    }
                }
                let changed = summary.all_changes();
                if !changed.is_empty() {
                    if let Ok(update) = self.awareness.update_with_clients(changed) {
                        self.broadcast(Some(link), &Message::Awareness(update));
                    }
                }
            }
            // Tag 100 is the host's alone, and the rest is nothing a page has
            // to say to a host that publishes no state of its own.
            Message::Custom(..) | Message::Auth(_) | Message::AwarenessQuery => {}
        }
        Ok(())
    }

    fn detach(&mut self, link: LinkId) {
        let Some(gone) = self.links.remove(&link) else {
            return;
        };
        let clients: Vec<ClientID> = gone.clients.into_iter().collect();
        for client in &clients {
            self.awareness.remove_state(*client);
        }
        if !clients.is_empty() {
            if let Ok(update) = self.awareness.update_with_clients(clients) {
                self.broadcast(None, &Message::Awareness(update));
            }
        }
        if self.links.is_empty() {
            self.linger_at = Some(Instant::now() + self.timing.linger);
        }
    }

    // --- sending ---------------------------------------------------------

    fn send(&mut self, link: LinkId, message: &Message) {
        self.send_raw(link, message.encode_v1());
    }

    /// A page that cannot keep up, or has gone, loses its link; it attaches
    /// again and syncs from the state vector it has.
    fn send_raw(&mut self, link: LinkId, frame: Vec<u8>) {
        let Some(entry) = self.links.get(&link) else {
            return;
        };
        if entry.to_page.try_send(frame).is_err() {
            self.detach(link);
        }
    }

    fn broadcast(&mut self, except: Option<LinkId>, message: &Message) {
        self.broadcast_raw(except, &message.encode_v1());
    }

    fn broadcast_raw(&mut self, except: Option<LinkId>, frame: &[u8]) {
        let ids: Vec<LinkId> = self
            .links
            .keys()
            .copied()
            .filter(|id| Some(*id) != except)
            .collect();
        for id in ids {
            self.send_raw(id, frame.to_vec());
        }
    }

    // --- the replica ------------------------------------------------------

    /// Change the replica as the host, and tell every page.
    fn edit<R>(&mut self, change: impl FnOnce(&mut TransactionMut<'_>) -> R) -> R {
        let doc = self.awareness.doc().clone();
        let before = doc.transact().state_vector();
        let result = change(&mut doc.transact_mut());
        let update = doc.transact().encode_diff_v1(&before);
        self.broadcast(None, &Message::Sync(SyncMessage::Update(update)));
        result
    }

    fn session_text(&self, path: &SharedPath) -> Option<String> {
        let txn = self.awareness.doc().transact();
        text_of(&txn, self.files.get(&txn, path.as_str()))
    }

    fn session_paths(&self) -> Vec<SharedPath> {
        let txn = self.awareness.doc().transact();
        self.files.keys(&txn).filter_map(shared_path).collect()
    }

    /// Whether the replica holds everything a page had seen.
    fn contains(&self, seen: &StateVector) -> bool {
        let ours = self.awareness.doc().transact().state_vector();
        seen.iter()
            .all(|(client, clock)| ours.get(client) >= *clock)
    }

    // --- the folder ------------------------------------------------------

    /// Write what changed in the session; the folder's own changes wait for
    /// the next look at it.
    fn write_changed(&mut self) {
        let mut busy = false;
        for path in self.session_paths() {
            let Some(text) = self.session_text(&path) else {
                continue;
            };
            let unchanged = self
                .base
                .get(&path)
                .is_some_and(|base| base.digest == Digest::of(&text));
            if unchanged {
                continue;
            }
            match self.reconcile_path(&path) {
                Ok(()) => {}
                Err(Stop::Busy) => busy = true,
                Err(Stop::Failed(error)) => tracing::warn!("{path} was not written: {error}"),
            }
        }
        if busy {
            self.retry_at = Some(Instant::now() + self.timing.retry);
        } else {
            self.first_change = None;
            self.last_change = None;
            self.announce_run();
        }
    }

    /// Look at every shared path of the folder and of the session.
    fn reconcile_all(&mut self) -> Result<FlushReport, Stop> {
        let mut paths: BTreeSet<SharedPath> = disk::scan(&self.root)?.into_iter().collect();
        paths.extend(self.session_paths());
        paths.extend(self.base.paths().cloned());
        let mut busy = false;
        for path in paths {
            match self.reconcile_path(&path) {
                Ok(()) => {}
                Err(Stop::Busy) => busy = true,
                Err(Stop::Failed(error)) => tracing::warn!("{path} was not reconciled: {error}"),
            }
        }
        if busy {
            return Err(Stop::Busy);
        }
        self.first_change = None;
        self.last_change = None;
        Ok(std::mem::take(&mut self.run))
    }

    /// [`Self::reconcile_all`], and the pages are told what it did.
    fn reconcile_and_announce(&mut self) -> Result<FlushReport, Stop> {
        match self.reconcile_all() {
            Ok(report) => {
                self.announce(&report.folder);
                Ok(report)
            }
            Err(Stop::Busy) => {
                self.retry_at = Some(Instant::now() + self.timing.retry);
                Err(Stop::Busy)
            }
            Err(error) => Err(error),
        }
    }

    fn announce_run(&mut self) {
        let report = std::mem::take(&mut self.run);
        self.announce(&report.folder);
    }

    fn announce(&mut self, folder: &FolderReport) {
        if !folder.is_empty() {
            self.broadcast_raw(None, &wire::encode(&HostMessage::Folder(folder.clone())));
        }
    }

    fn settle_flushes(&mut self, now: Instant) {
        if self.flushes.is_empty() {
            return;
        }
        for flush in std::mem::take(&mut self.flushes) {
            if self.contains(&flush.seen) {
                match self.reconcile_all() {
                    Ok(report) => {
                        self.announce(&report.folder);
                        let _ = flush.reply.send(Ok(report));
                        continue;
                    }
                    Err(Stop::Failed(error)) => {
                        let _ = flush.reply.send(Err(error));
                        continue;
                    }
                    Err(Stop::Busy) => self.retry_at = Some(now + self.timing.retry),
                }
            }
            if flush.deadline <= now {
                let _ = flush.reply.send(Err(Error::FlushTimedOut));
            } else {
                self.flushes.push(flush);
            }
        }
    }

    /// A last look before the session goes: nothing typed is left unwritten.
    fn finish(&mut self) {
        for flush in std::mem::take(&mut self.flushes) {
            let _ = flush.reply.send(Err(Error::Closed));
        }
        let give_up = Instant::now() + Duration::from_secs(600);
        loop {
            match self.reconcile_all() {
                Ok(_) => return,
                Err(Stop::Busy) if Instant::now() < give_up => {
                    std::thread::sleep(self.timing.retry);
                }
                Err(Stop::Busy) => {
                    tracing::error!("the folder stayed busy; the session's last changes are lost");
                    return;
                }
                Err(Stop::Failed(error)) => {
                    tracing::error!("the session's last changes were not written: {error}");
                    return;
                }
            }
        }
    }

    /// Take the folder's lock if it is free. A compile or a restore holds it
    /// for as long as it takes, and the host has pages to serve meanwhile.
    fn folder(&self) -> Result<yaz_core::project::FolderGuard, Stop> {
        match self.locks.try_lock(&self.root) {
            Ok(Some(guard)) => Ok(guard),
            Ok(None) => Err(Stop::Busy),
            Err(error) => Err(Stop::Failed(error.into())),
        }
    }

    /// Decide one path by the table and carry it out.
    fn reconcile_path(&mut self, path: &SharedPath) -> Result<(), Stop> {
        let on_disk = match disk::read(&self.root, path) {
            Ok(disk) => disk,
            Err(error) => {
                tracing::warn!("{path} could not be read: {error}");
                Disk::Refused
            }
        };
        let (disk_text, disk_ending, disk_digest) = match on_disk {
            Disk::Missing => {
                self.refused.remove(path);
                (None, LineEnding::Lf, None)
            }
            Disk::Refused => {
                if self.refused.insert(path.clone()) {
                    self.run.folder.refused.push(path.to_string());
                }
                return Ok(());
            }
            Disk::Text {
                text,
                ending,
                digest,
            } => {
                self.refused.remove(path);
                (Some(text), ending, Some(digest))
            }
        };
        let session_text = self.session_text(path);
        let session_digest = session_text.as_deref().map(Digest::of);
        let base = self.base.get(path).copied();
        let action = decide(
            base.as_ref().map(|base| &base.digest),
            disk_digest.as_ref(),
            session_digest.as_ref(),
        );
        let disk_base = |text: &Option<String>| {
            text.as_deref().map(|text| Base {
                digest: Digest::of(text),
                ending: disk_ending,
            })
        };
        match action {
            Action::Nothing => {}
            Action::WriteSession => {
                let _folder = self.folder()?;
                let text = session_text.expect("a session text is written");
                let ending = base.map_or(LineEnding::Lf, |base| base.ending);
                disk::write_atomic(&self.root, path, &text::to_disk(&text, ending))?;
                self.base.set(
                    path.clone(),
                    Base {
                        digest: Digest::of(&text),
                        ending,
                    },
                );
                self.run.written.push(path.to_string());
            }
            Action::ImportDisk => {
                let text = disk_text.expect("a file is imported");
                self.replace(path, &text);
                self.base
                    .set(path.clone(), disk_base(&Some(text)).expect("some"));
                self.run.folder.imported.push(path.to_string());
            }
            Action::Adopt => {
                self.base.set(
                    path.clone(),
                    disk_base(&disk_text).expect("a file is adopted"),
                );
            }
            Action::KeepThenImport => {
                let _folder = self.folder()?;
                let kept = self.keep(path, &session_text.expect("a text is kept"), disk_ending)?;
                let text = disk_text.expect("a file is imported");
                self.replace(path, &text);
                self.base
                    .set(path.clone(), disk_base(&Some(text)).expect("some"));
                self.run.folder.kept.push(kept);
                self.run.folder.imported.push(path.to_string());
            }
            Action::Seed => {
                let text = disk_text.expect("a file is seeded");
                let entry = path.as_str();
                // Whole, as a new entry: two hosts that seed one file end with
                // one copy of it and not two.
                let files = self.files.clone();
                self.edit(|txn| {
                    files.insert(txn, entry, TextPrelim::new(text.as_str()));
                });
                self.base
                    .set(path.clone(), disk_base(&Some(text)).expect("some"));
                if !self.starting {
                    self.run.folder.imported.push(path.to_string());
                }
            }
            Action::RemoveEntry => {
                self.remove_entry(path);
                self.run.folder.removed.push(path.to_string());
            }
            Action::KeepThenRemove => {
                let _folder = self.folder()?;
                let ending = base.map_or(LineEnding::Lf, |base| base.ending);
                let kept = self.keep(path, &session_text.expect("a text is kept"), ending)?;
                self.remove_entry(path);
                self.run.folder.kept.push(kept);
                self.run.folder.removed.push(path.to_string());
            }
        }
        Ok(())
    }

    fn remove_entry(&mut self, path: &SharedPath) {
        let files = self.files.clone();
        self.edit(|txn| {
            files.remove(txn, path.as_str());
        });
        self.base.remove(path);
    }

    /// Replace a shared text by the smallest edit that makes it `new`.
    fn replace(&mut self, path: &SharedPath, new: &str) {
        let (text, old) = {
            let txn = self.awareness.doc().transact();
            match self.files.get(&txn, path.as_str()) {
                Some(Out::YText(text)) => (text.clone(), text.get_string(&txn)),
                _ => return,
            }
        };
        if let Some(edit) = text::diff(&old, new) {
            self.edit(|txn| text::apply(&text, txn, &edit));
        }
    }

    /// Write the session's text beside the file, and say where.
    fn keep(&self, path: &SharedPath, text: &str, ending: LineEnding) -> Result<Kept, Error> {
        let copy = disk::kept_copy(&self.root, path, SystemTime::now())?;
        disk::write_atomic(&self.root, &copy, &text::to_disk(text, ending))?;
        Ok(Kept {
            path: path.to_string(),
            copy: copy.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_epochs_are_never_the_same() {
        assert_ne!(random_hex(), random_hex());
        assert_eq!(random_hex().len(), 32);
    }
}
