//! The host and its pages, end to end through the link, on a real folder.

mod common;

use std::time::Duration;

use common::{Page, eventually, host, project, quick};
use serde_json::json;
use yaz_collab::{Error, Timing};
use yrs::sync::{Message, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, Transact, Update};

fn slow_writer() -> Timing {
    Timing {
        idle: Duration::from_secs(30),
        busiest: Duration::from_secs(30),
        ..quick()
    }
}

#[tokio::test]
async fn the_first_frame_is_hello_and_the_host_says_nothing_about_itself() {
    let (_dir, root) = project(&[("a.tex", "hello\n")]);
    let host = host(quick());
    let mut page = Page::attach(&host, &root).await;
    page.pump_for(Duration::from_millis(150)).await;
    // hello, upstream, step 1 of the sync, and the step 2 that answers the
    // page's own step 1; no awareness, because the host publishes no state and
    // so is nobody in the room.
    assert_eq!(page.tags, [100, 100, 0, 0]);
    assert_eq!(page.messages[0]["t"], "hello");
    assert_eq!(page.messages[0]["protocol"], 1);
    assert_eq!(page.messages[0]["state"], "ready");
    assert_eq!(page.messages[1], json!({"t": "upstream", "state": "none"}));
    assert!(page.messages[0]["epoch"].as_str().unwrap().len() >= 16);
    assert_eq!(page.text("a.tex").as_deref(), Some("hello\n"));
    assert_eq!(page.meta_schema(), Some(1.0));
}

#[tokio::test]
async fn two_pages_typing_at_once_converge_and_the_file_follows() {
    let (_dir, root) = project(&[("a.tex", "middle\n")]);
    let host = host(quick());
    let mut one = Page::attach(&host, &root).await;
    let mut two = Page::attach(&host, &root).await;
    one.pump_until(|p| p.text("a.tex").is_some()).await;
    two.pump_until(|p| p.text("a.tex").is_some()).await;

    // Both type before either has heard of the other.
    one.insert("a.tex", 0, "one: ");
    two.insert("a.tex", 7, "two: ");
    let both = |page: &Page| {
        page.text("a.tex")
            .is_some_and(|text| text.contains("one: ") && text.contains("two: "))
    };
    one.pump_until(both).await;
    two.pump_until(both).await;
    assert_eq!(one.text("a.tex"), two.text("a.tex"));
    let converged = one.text("a.tex").unwrap();

    eventually("the file equals the session", || {
        std::fs::read_to_string(root.join("a.tex")).is_ok_and(|disk| disk == converged)
    })
    .await;
}

#[tokio::test]
async fn a_page_that_leaves_takes_its_caret_with_it() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    let host = host(quick());
    let mut one = Page::attach(&host, &root).await;
    let mut two = Page::attach(&host, &root).await;
    let state = json!({"user": {"id": "abc", "name": "Äsa 😀"}, "file": "a.tex",
                       "cursor": {"anchor": 1, "head": 1}});
    one.announce(&state);
    let id = one.client_id();
    two.pump_until(|p| p.state_of(id).is_some()).await;
    assert_eq!(two.state_of(id), Some(state));

    one.leave();
    two.pump_until(|p| p.state_of(id).is_none()).await;
}

#[tokio::test]
async fn a_page_attaching_later_is_told_who_is_already_there() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    let host = host(quick());
    let mut one = Page::attach(&host, &root).await;
    one.announce(&json!({"user": {"id": "abc"}}));
    let id = one.client_id();
    // Let the host have it before the second page comes.
    one.pump_for(Duration::from_millis(100)).await;
    let mut two = Page::attach(&host, &root).await;
    two.pump_until(|p| p.state_of(id).is_some()).await;
}

#[tokio::test]
async fn two_hosts_that_seed_one_file_end_with_one_copy_of_it() {
    // Two folders with the same file, as two machines have; the entry is added
    // whole, so the merge picks one and does not append one to the other.
    let (_a, root_a) = project(&[("a.tex", "same text\n")]);
    let (_b, root_b) = project(&[("a.tex", "same text\n")]);
    let (host_a, host_b) = (host(quick()), host(quick()));
    let mut one = Page::attach(&host_a, &root_a).await;
    let mut two = Page::attach(&host_b, &root_b).await;
    one.pump_until(|p| p.text("a.tex").is_some()).await;
    two.pump_until(|p| p.text("a.tex").is_some()).await;

    let from_two = two
        .awareness
        .doc()
        .transact()
        .encode_state_as_update_v1(&Default::default());
    one.awareness
        .doc()
        .transact_mut()
        .apply_update(Update::decode_v1(&from_two).unwrap())
        .unwrap();
    assert_eq!(one.text("a.tex").as_deref(), Some("same text\n"));
}

#[tokio::test]
async fn a_flush_waits_for_what_the_page_has_seen_and_gives_up_in_time() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    let host = host(slow_writer());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.text("a.tex").is_some()).await;

    // An edit the host has not been sent: the state vector claims it.
    let held_back = page.edit_locally("a.tex", 1, " typed");
    let seen = page.state_vector();
    let started = std::time::Instant::now();
    let error = host.flush(&root, &seen).await.unwrap_err();
    assert!(matches!(error, Error::FlushTimedOut), "{error:?}");
    assert!(started.elapsed() >= Duration::from_millis(500));

    // Sent in time, it is written now, though the writer is set to wait 30 s.
    let (flush, ()) = tokio::join!(host.flush(&root, &seen), async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        page.send(&Message::Sync(SyncMessage::Update(held_back)));
    });
    let report = flush.unwrap();
    assert_eq!(report.written, ["a.tex"]);
    assert_eq!(
        std::fs::read_to_string(root.join("a.tex")).unwrap(),
        "x typed\n"
    );
}

#[tokio::test]
async fn an_outside_change_over_a_changed_file_keeps_the_sessions_text_beside_it() {
    let (_dir, root) = project(&[("a.tex", "original\n")]);
    let host = host(slow_writer());
    let mut one = Page::attach(&host, &root).await;
    let mut two = Page::attach(&host, &root).await;
    one.pump_until(|p| p.text("a.tex").is_some()).await;
    two.pump_until(|p| p.text("a.tex").is_some()).await;

    one.insert("a.tex", 0, "typed ");
    two.pump_until(|p| p.text("a.tex").as_deref() == Some("typed original\n"))
        .await;
    // Somebody else writes the file before the session has.
    std::fs::write(root.join("a.tex"), "outside\n").unwrap();

    let report = host.flush(&root, &one.state_vector()).await.unwrap();
    assert!(report.written.is_empty());
    assert_eq!(report.folder.kept.len(), 1);
    let kept = &report.folder.kept[0];
    assert_eq!(kept.path, "a.tex");
    assert!(
        kept.copy.starts_with("a.kept-") && kept.copy.ends_with(".tex"),
        "{}",
        kept.copy
    );
    assert_eq!(
        std::fs::read_to_string(root.join(&kept.copy)).unwrap(),
        "typed original\n"
    );
    // The folder won, and the file is as the outside writer left it.
    assert_eq!(
        std::fs::read_to_string(root.join("a.tex")).unwrap(),
        "outside\n"
    );

    // Every page took the folder's text, and was told.
    one.pump_until(|p| p.text("a.tex").as_deref() == Some("outside\n"))
        .await;
    two.pump_until(|p| p.text("a.tex").as_deref() == Some("outside\n"))
        .await;
    two.pump_until(|p| p.messages.iter().any(|m| m["t"] == "folder"))
        .await;
    let told = two.messages.iter().find(|m| m["t"] == "folder").unwrap();
    assert_eq!(told["kept"][0]["path"], "a.tex");
    assert_eq!(told["kept"][0]["copy"], kept.copy.as_str());
    // The kept copy is not itself shared.
    assert_eq!(two.paths(), ["a.tex"]);
}

#[tokio::test]
async fn an_outside_write_while_nobody_types_shows_up_in_the_pages() {
    let (_dir, root) = project(&[("a.tex", "before\n")]);
    let host = host(quick());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.text("a.tex").is_some()).await;

    std::fs::write(root.join("a.tex"), "after\n").unwrap();
    std::fs::write(root.join("new.tex"), "brand new\n").unwrap();
    page.pump_until(|p| {
        p.text("a.tex").as_deref() == Some("after\n")
            && p.text("new.tex").as_deref() == Some("brand new\n")
    })
    .await;
    page.pump_until(|p| p.messages.iter().any(|m| m["t"] == "folder"))
        .await;
    let news = page.messages.iter().find(|m| m["t"] == "folder").unwrap();
    assert_eq!(news["imported"], json!(["a.tex", "new.tex"]));
    // What was imported is not written back.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        std::fs::read_to_string(root.join("a.tex")).unwrap(),
        "after\n"
    );
}

#[tokio::test]
async fn a_crlf_file_stays_crlf_on_disk_and_is_lf_in_the_session() {
    let (_dir, root) = project(&[("a.tex", "one\r\ntwo\r\n")]);
    let host = host(quick());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.text("a.tex").is_some()).await;
    assert_eq!(page.text("a.tex").as_deref(), Some("one\ntwo\n"));

    page.insert("a.tex", 4, "and ");
    eventually("the edit is on disk with its endings", || {
        std::fs::read_to_string(root.join("a.tex")).is_ok_and(|disk| disk == "one\r\nand two\r\n")
    })
    .await;
}

#[tokio::test]
async fn umlauts_and_an_emoji_are_counted_the_way_the_page_counts_them() {
    let (_dir, root) = project(&[("a.tex", "Grüße 😀 aus Weimar\n")]);
    let host = host(quick());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.text("a.tex").is_some()).await;

    // After "Grüße 😀 ", which is 9 UTF-16 units: the emoji takes two.
    page.insert("a.tex", 9, "Ünï ");
    eventually("the edit is on disk", || {
        std::fs::read_to_string(root.join("a.tex")).is_ok_and(|d| d == "Grüße 😀 Ünï aus Weimar\n")
    })
    .await;

    // And a change from outside, around the emoji, comes in as an edit.
    std::fs::write(root.join("a.tex"), "Grüße 😁 Ünï aus Weimar\n").unwrap();
    page.pump_until(|p| p.text("a.tex").as_deref() == Some("Grüße 😁 Ünï aus Weimar\n"))
        .await;
}

#[tokio::test]
async fn a_session_that_ends_writes_what_it_holds_and_the_next_one_starts_afresh() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    let host = host(slow_writer());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.text("a.tex").is_some()).await;
    let epoch = page.messages[0]["epoch"].clone();
    page.insert("a.tex", 1, "yz");
    page.pump_for(Duration::from_millis(50)).await;
    page.leave();

    // The writer waits 30 s, but a session that ends does not.
    eventually("the final write", || {
        std::fs::read_to_string(root.join("a.tex")).is_ok_and(|d| d == "xyz\n")
    })
    .await;

    let mut again = Page::attach(&host, &root).await;
    assert_ne!(again.messages[0]["epoch"], epoch);
    again.pump_until(|p| p.text("a.tex").is_some()).await;
    assert_eq!(again.text("a.tex").as_deref(), Some("xyz\n"));
}

#[tokio::test]
async fn nothing_a_page_says_can_write_outside_the_policy() {
    let (dir, root) = project(&[("a.tex", "x\n")]);
    let host = host(quick());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.text("a.tex").is_some()).await;

    for path in [
        "../evil.tex",
        "build/x.tex",
        ".git/x.tex",
        "yaz.toml",
        "/abs.tex",
        "pic.png",
    ] {
        page.insert(path, 0, "owned");
    }
    // A shared one after them, to know the others have been looked at.
    page.insert("ok.tex", 0, "fine");
    eventually("the allowed file is written", || {
        root.join("ok.tex").exists()
    })
    .await;
    host.flush(&root, &page.state_vector()).await.unwrap();

    assert!(!dir.path().join("../evil.tex").exists());
    for path in ["build", ".git", "yaz.toml", "pic.png"] {
        assert!(!root.join(path).exists(), "{path} was written");
    }
    assert_eq!(
        std::fs::read_to_string(root.join("ok.tex")).unwrap(),
        "fine"
    );
}

#[tokio::test]
async fn a_frame_a_page_has_no_business_sending_is_dropped_without_harm() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    let host = host(quick());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.text("a.tex").is_some()).await;

    // Tag 100, from a page.
    page.send_raw(vec![100, 2, b'{', b'}']);
    page.insert("a.tex", 1, "!");
    eventually("the link still works", || {
        std::fs::read_to_string(root.join("a.tex")).is_ok_and(|d| d == "x!\n")
    })
    .await;
}

#[tokio::test]
async fn a_frame_that_is_not_the_protocol_closes_that_link_only() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    let host = host(quick());
    let mut bad = Page::attach(&host, &root).await;
    let mut good = Page::attach(&host, &root).await;
    good.pump_until(|p| p.text("a.tex").is_some()).await;

    bad.send_raw(vec![0, 2, 255, 255, 255]);
    // The host drops the link: its channel closes.
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        while bad
            .link
            .as_mut()
            .unwrap()
            .from_session
            .recv()
            .await
            .is_some()
        {}
    })
    .await;
    assert!(closed.is_ok(), "the link was not closed");
    good.insert("a.tex", 1, "?");
    eventually("the other page goes on", || {
        std::fs::read_to_string(root.join("a.tex")).is_ok_and(|d| d == "x?\n")
    })
    .await;
}

#[tokio::test]
async fn a_host_that_shares_nothing_refuses_and_says_why() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    let off = yaz_collab::Host::disabled();
    let status = off.status(&root);
    assert!(!status.shared);
    assert_eq!(status.reason.as_deref(), Some("error-collab-not-shared"));
    assert!(matches!(off.attach(&root).await, Err(Error::NotShared)));
}

#[tokio::test]
async fn a_file_that_cannot_be_shared_is_reported_and_left_alone() {
    let (_dir, root) = project(&[("a.tex", "x\n")]);
    std::fs::write(root.join("latin1.tex"), [0x4d, 0xfc, 0x6c]).unwrap();
    let host = host(quick());
    let mut page = Page::attach(&host, &root).await;
    page.pump_until(|p| p.messages.iter().any(|m| m["t"] == "folder"))
        .await;
    let told = page.messages.iter().find(|m| m["t"] == "folder").unwrap();
    assert_eq!(told["refused"], json!(["latin1.tex"]));
    assert_eq!(page.paths(), ["a.tex"]);
    assert_eq!(
        std::fs::read(root.join("latin1.tex")).unwrap(),
        [0x4d, 0xfc, 0x6c]
    );
}

// Keep the encoding helpers honest: a frame is what the page's library makes.
#[test]
fn the_messages_the_host_sends_are_plain_y_protocols_frames() {
    let step1 = Message::Sync(SyncMessage::SyncStep1(Default::default())).encode_v1();
    // Tag 0, step 1, then the state vector as a byte array of one byte.
    assert_eq!(step1, [0, 0, 1, 0]);
}
