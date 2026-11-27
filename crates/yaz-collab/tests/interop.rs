//! `yrs` and `yjs` have to agree on the wire.
//!
//! The host is `yrs` and the page is `yjs`, and a document, an awareness
//! update and a frame that one writes must read the same in the other.
//! `tests/fixtures/from-yjs/` is written by `scripts/collab-fixtures.mjs` and
//! decoded here. `tests/fixtures/from-yrs/` is written here, and decoded by
//! `apps/desktop/src/lib/collab/interop.test.ts`.
//!
//! Run with `YAZ_COLLAB_FIXTURES=write` to rewrite the second set; without it
//! the test fails if what `yrs` writes now is not what is committed.

use std::path::PathBuf;

use serde_json::{Value, json};
use yaz_collab::wire::{self, FolderReport, HostMessage, Kept, State};
use yrs::sync::{Awareness, AwarenessUpdate, Message, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{
    ClientID, Doc, GetString, Map, OffsetKind, Options, Out, ReadTxn, StateVector, Text,
    TextPrelim, Transact, Update,
};

const BASE: &str = "Grüße 😀 aus Weimar\nZweite Zeile\n";

fn fixtures(set: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(set)
}

fn read(set: &str, name: &str) -> Vec<u8> {
    std::fs::read(fixtures(set).join(name))
        .unwrap_or_else(|error| panic!("{set}/{name}: {error}; run scripts/collab-fixtures.mjs"))
}

fn doc_for(client: u64) -> Doc {
    Doc::with_options(Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::with_client_id(ClientID::new(client))
    })
}

fn text_in(doc: &Doc, path: &str) -> Option<String> {
    let files = doc.get_or_insert_map("files");
    let txn = doc.transact();
    match files.get(&txn, path) {
        Some(Out::YText(text)) => Some(text.get_string(&txn)),
        _ => None,
    }
}

fn number(value: Option<Out>) -> Option<f64> {
    match value {
        Some(Out::Any(yrs::Any::Number(yrs::any::Number::Int(n)))) => Some(n as f64),
        Some(Out::Any(yrs::Any::Number(yrs::any::Number::Float(n)))) => Some(n),
        _ => None,
    }
}

fn expected(set: &str) -> Value {
    serde_json::from_slice(&read(set, "expected.json")).unwrap()
}

// --- Yjs to yrs --------------------------------------------------------------

#[test]
fn a_document_written_by_yjs_reads_the_same_in_yrs() {
    let expected = expected("from-yjs");
    let doc = doc_for(1);
    doc.transact_mut()
        .apply_update(Update::decode_v1(&read("from-yjs", "document.bin")).unwrap())
        .unwrap();

    for (path, text) in expected["document"]["files"].as_object().unwrap() {
        assert_eq!(text_in(&doc, path).as_deref(), text.as_str(), "{path}");
    }
    let meta = doc.get_or_insert_map("meta");
    let txn = doc.transact();
    assert_eq!(number(meta.get(&txn, "schema")), Some(1.0));
    assert!(matches!(
        meta.get(&txn, "epoch"),
        Some(Out::Any(yrs::Any::String(epoch))) if &*epoch == "0123456789abcdef0123456789abcdef"
    ));
}

#[test]
fn an_edit_written_by_yjs_lands_on_the_same_text_counting_utf16_units() {
    let expected = expected("from-yjs");
    let doc = doc_for(1);
    for name in ["document.bin", "edit.bin"] {
        doc.transact_mut()
            .apply_update(Update::decode_v1(&read("from-yjs", name)).unwrap())
            .unwrap();
    }
    // The edit sits behind an emoji of two units, so a byte or a char count
    // would put it elsewhere.
    assert_eq!(
        text_in(&doc, "main.tex").as_deref(),
        expected["edit"]["files"]["main.tex"].as_str()
    );
    assert_eq!(
        text_in(&doc, "main.tex").as_deref(),
        Some("Grüße 😀 Ünï Weimar\nZweite Zeile\n")
    );
}

#[test]
fn an_awareness_update_written_by_y_protocols_reads_the_same_and_its_removal_removes_it() {
    let expected = expected("from-yjs");
    let mut awareness = Awareness::new(doc_for(1));
    let client = ClientID::new(expected["awareness"]["client"].as_u64().unwrap());

    let update = AwarenessUpdate::decode_v1(&read("from-yjs", "awareness.bin")).unwrap();
    let summary = awareness.apply_update_summary(update).unwrap().unwrap();
    assert_eq!(summary.added, [client]);
    assert_eq!(
        awareness.state::<Value>(client),
        Some(expected["awareness"]["state"].clone())
    );
    assert_eq!(
        awareness.meta(client).map(|(clock, _)| u64::from(clock)),
        expected["awareness"]["clock"].as_u64()
    );

    let gone = AwarenessUpdate::decode_v1(&read("from-yjs", "awareness-removed.bin")).unwrap();
    let summary = awareness.apply_update_summary(gone).unwrap().unwrap();
    assert_eq!(summary.removed, [client]);
    assert_eq!(awareness.state::<Value>(client), None);
}

// --- yrs to Yjs --------------------------------------------------------------

/// What `yrs` writes, with the client ids fixed so that it is the same bytes
/// every time.
fn from_yrs() -> Vec<(&'static str, Vec<u8>)> {
    let mut files = Vec::new();
    let doc = doc_for(2002);
    let (file_map, meta) = (
        doc.get_or_insert_map("files"),
        doc.get_or_insert_map("meta"),
    );
    {
        let mut txn = doc.transact_mut();
        file_map.insert(&mut txn, "main.tex", TextPrelim::new(BASE));
        file_map.insert(
            &mut txn,
            "chapters/one.tex",
            TextPrelim::new("\\chapter{Eins}\n"),
        );
        meta.insert(&mut txn, "schema", 1i64);
        meta.insert(&mut txn, "epoch", "0123456789abcdef0123456789abcdef");
    }
    files.push((
        "document.bin",
        doc.transact()
            .encode_state_as_update_v1(&StateVector::default()),
    ));

    let before = doc.transact().state_vector();
    let Some(Out::YText(text)) = file_map.get(&doc.transact(), "main.tex") else {
        unreachable!("it was just inserted")
    };
    {
        let mut txn = doc.transact_mut();
        text.insert(&mut txn, 9, "Ünï ");
        text.remove_range(&mut txn, 13, 4);
    }
    let edit = doc.transact().encode_diff_v1(&before);
    files.push(("edit.bin", edit.clone()));

    // The frames a page reads: step 1 of the sync as the host sends it, and an
    // update message.
    files.push((
        "frame-step1.bin",
        Message::Sync(SyncMessage::SyncStep1(before)).encode_v1(),
    ));
    files.push((
        "frame-update.bin",
        Message::Sync(SyncMessage::Update(edit)).encode_v1(),
    ));

    let mut awareness = Awareness::new(doc_for(2002));
    awareness.set_local_state_raw(AWARENESS_STATE);
    files.push((
        "awareness.bin",
        awareness
            .update_with_clients([ClientID::new(2002)])
            .unwrap()
            .encode_v1(),
    ));
    awareness.remove_state(ClientID::new(2002));
    files.push((
        "awareness-removed.bin",
        awareness
            .update_with_clients([ClientID::new(2002)])
            .unwrap()
            .encode_v1(),
    ));

    // What the host says besides Yjs: tag 100.
    files.push((
        "host-hello.bin",
        wire::encode(&HostMessage::Hello {
            protocol: 1,
            epoch: "0123456789abcdef0123456789abcdef".to_owned(),
            state: State::Ready,
            reason: None,
        }),
    ));
    files.push((
        "host-folder.bin",
        wire::encode(&HostMessage::Folder(FolderReport {
            imported: vec!["Ünï.tex".to_owned()],
            kept: vec![Kept {
                path: "main.tex".to_owned(),
                copy: "main.kept-20261127-101500.tex".to_owned(),
            }],
            ..FolderReport::default()
        })),
    ));

    let manifest = json!({
        "document": {
            "files": {"main.tex": BASE, "chapters/one.tex": "\\chapter{Eins}\n"},
            "meta": {"schema": 1, "epoch": "0123456789abcdef0123456789abcdef"},
        },
        "edit": {"files": {"main.tex": "Grüße 😀 Ünï Weimar\nZweite Zeile\n"}},
        "awareness": {
            "client": 2002,
            "clock": awareness_clock(&files),
            "state": serde_json::from_str::<Value>(AWARENESS_STATE).unwrap(),
        },
        "host-hello": {"t": "hello", "protocol": 1, "epoch": "0123456789abcdef0123456789abcdef", "state": "ready"},
        "host-folder": {
            "t": "folder",
            "imported": ["Ünï.tex"],
            "kept": [{"path": "main.tex", "copy": "main.kept-20261127-101500.tex"}],
            "removed": [],
            "refused": [],
        },
    });
    files.push((
        "expected.json",
        (serde_json::to_string_pretty(&manifest).unwrap() + "\n").into_bytes(),
    ));
    files
}

const AWARENESS_STATE: &str = r#"{"user":{"id":"0f1e2d3c4b5a6978","name":"Äsa 😀"},"file":"main.tex","cursor":{"anchor":{"type":null,"tname":null,"item":{"client":2002,"clock":4},"assoc":0},"head":null}}"#;

/// The clock `yrs` put on the awareness update it wrote.
fn awareness_clock(files: &[(&str, Vec<u8>)]) -> u32 {
    let bytes = &files
        .iter()
        .find(|(name, _)| *name == "awareness.bin")
        .unwrap()
        .1;
    let update = AwarenessUpdate::decode_v1(bytes).unwrap();
    update.clients[&ClientID::new(2002)].clock
}

#[test]
fn what_yrs_writes_is_what_is_committed_for_yjs_to_read() {
    let write = std::env::var_os("YAZ_COLLAB_FIXTURES").is_some_and(|value| value == "write");
    let directory = fixtures("from-yrs");
    if write {
        std::fs::create_dir_all(&directory).unwrap();
    }
    for (name, bytes) in from_yrs() {
        let path = directory.join(name);
        if write {
            std::fs::write(&path, &bytes).unwrap();
        } else {
            let committed = std::fs::read(&path).unwrap_or_else(|error| {
                panic!("{name}: {error}; run with YAZ_COLLAB_FIXTURES=write")
            });
            assert_eq!(
                committed, bytes,
                "{name} differs from what yrs writes now; run with YAZ_COLLAB_FIXTURES=write \
                 and look at the difference before it reaches a page"
            );
        }
    }
}
