//! Zotero 7's local HTTP API.
//!
//! Zotero serves a read-only mirror of its web API on `127.0.0.1:23119` while it
//! is running. That gives a live view of the library without touching the
//! database file, and without Better BibTeX being installed.
//!
//! # Loopback unless the operator says otherwise
//!
//! By default every request here goes to `127.0.0.1`. No plugin can change
//! that: a Zotero host a plugin could name would be a configurable
//! exfiltration target, and would turn the bridge into a general-purpose HTTP
//! client — see [ADR-0006].
//!
//! The one exception is an [`Endpoint`] given by whoever *starts* the program.
//! A yaz served to a browser ([ADR-0030]) runs on a different machine from the
//! writer's Zotero, so its operator may name where that Zotero is forwarded
//! to. That is a start-up option and not a setting, so nothing that runs
//! inside yaz can reach it.
//!
//! Zotero refuses any request whose `Host` is not loopback, to stop DNS
//! rebinding. A forwarded Zotero is still the same Zotero, so every request
//! names the loopback authority whatever address it is sent to.
//!
//! # Verification status
//!
//! The queries here are written against Zotero's documented local API and are
//! covered by tests that parse **recorded response shapes**, not by tests
//! against a running Zotero. Until this has been exercised against a live
//! instance, treat the sqlite source as the one with evidence behind it.
//!
//! [ADR-0006]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md
//! [ADR-0030]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0030-a-web-server-hosts-the-same-commands.md

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::model::{Annotation, AnnotationKind, Item};

/// The loopback address Zotero listens on.
pub const ZOTERO_HOST: &str = "127.0.0.1";

/// The port Zotero's connector and local API share.
pub const ZOTERO_PORT: u16 = 23119;

/// The `Host` Zotero insists on, wherever the request is actually sent.
const LOOPBACK_AUTHORITY: &str = "127.0.0.1:23119";

/// Where a Zotero on another machine is forwarded to.
///
/// Only ever built from a start-up option of the program — see the module
/// docs for why this must not become something a plugin or a setting can say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    /// Host name or address, as given.
    host: String,
    /// The forwarded port.
    port: u16,
}

impl Endpoint {
    /// Parse `host`, `host:port` or `[v6]:port`; the port defaults to Zotero's.
    ///
    /// `None` for anything that is not a plain host and port, so a value
    /// carrying a path, a scheme or credentials is refused rather than guessed
    /// at.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let (host, port) = match text.rsplit_once(':') {
            // A bare IPv6 address has colons but no port.
            Some((host, port)) if !host.contains(':') || host.ends_with(']') => {
                (host, port.parse().ok()?)
            }
            Some(_) => return None,
            None => (text, ZOTERO_PORT),
        };
        let bare = host
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
            .unwrap_or(host);
        let plain = !bare.is_empty()
            && bare
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
        plain.then(|| Self {
            host: host.to_owned(),
            port,
        })
    }

    /// Root of the local API at this endpoint.
    fn api_root(&self) -> String {
        format!("http://{}:{}/api", self.host, self.port)
    }
}

impl Default for Endpoint {
    fn default() -> Self {
        Self {
            host: ZOTERO_HOST.to_owned(),
            port: ZOTERO_PORT,
        }
    }
}

impl std::fmt::Display for Endpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.host, self.port)
    }
}

/// One library the API can serve.
///
/// Zotero has no cross-library endpoint: a query names exactly one library, so
/// reaching a whole collection means asking each in turn. On the machine this
/// was developed against that is twelve — 802 items in the personal library and
/// 788 spread across eleven groups. Querying only `users/0`, which is what this
/// did at first, silently hid half of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibraryRef {
    /// The personal library.
    User,
    /// A group library, by its Zotero group id.
    Group(u64),
}

impl LibraryRef {
    /// The path segment naming this library.
    fn path(&self) -> String {
        match self {
            LibraryRef::User => "users/0".to_owned(),
            LibraryRef::Group(id) => format!("groups/{id}"),
        }
    }
}

/// A client for a locally running Zotero.
#[derive(Debug, Clone)]
pub struct LocalApi {
    http: reqwest::Client,
    /// Where Zotero answers: loopback, unless the operator forwarded one.
    endpoint: Endpoint,
    /// Every library to query. Always includes the personal one.
    libraries: Vec<LibraryRef>,
}

/// What a probe of the local API found.
///
/// More than a boolean because the cases need different words. "Zotero is
/// closed" is the normal state for most writers most of the time and deserves
/// no fuss; "Zotero is open but its local API is switched off" is a thing the
/// user can fix in thirty seconds, and telling them so is the difference between
/// a working live connection and permanently reading a copy of the database.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    /// The local API answered.
    Available,
    /// Nothing is listening; Zotero is not running.
    NotRunning,
    /// Zotero is running, but the local API is disabled in its settings.
    LocalApiDisabled,
    /// Something answered, but not in a way this understands.
    Unexpected,
}

impl Availability {
    /// Message key explaining this state.
    pub fn message_key(&self) -> &'static str {
        match self {
            Availability::Available => "zotero-live-available",
            Availability::NotRunning => "zotero-live-not-running",
            Availability::LocalApiDisabled => "zotero-live-api-disabled",
            Availability::Unexpected => "zotero-live-unexpected",
        }
    }
}

/// The envelope every local-API item comes in.
#[derive(Debug, Deserialize)]
struct Envelope<T> {
    key: String,
    data: T,
    #[serde(default)]
    meta: Meta,
}

#[derive(Debug, Default, Deserialize)]
struct Meta {
    #[serde(default)]
    #[serde(rename = "parsedDate")]
    parsed_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemData {
    #[serde(default)]
    item_type: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    creators: Vec<Creator>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    publication_title: Option<String>,
    #[serde(default, rename = "DOI")]
    doi: Option<String>,
    /// Better BibTeX writes its key here when it is installed, so an
    /// authoritative key can arrive even on this tier.
    #[serde(default)]
    citation_key: Option<String>,

    // The rest of what a citation style might print. Zotero names the same
    // idea differently per item type — a book publishes, a report is issued by
    // an institution, a thesis by a university — so all of them are read and
    // the first that answers wins.
    #[serde(default)]
    publisher: Option<String>,
    #[serde(default)]
    institution: Option<String>,
    #[serde(default)]
    university: Option<String>,
    #[serde(default)]
    place: Option<String>,
    #[serde(default)]
    edition: Option<String>,
    #[serde(default, rename = "ISBN")]
    isbn: Option<String>,
    #[serde(default, rename = "ISSN")]
    issn: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    abstract_note: Option<String>,
    #[serde(default)]
    pages: Option<String>,
    #[serde(default)]
    num_pages: Option<String>,
    #[serde(default)]
    volume: Option<String>,
    #[serde(default)]
    issue: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Creator {
    #[serde(default)]
    first_name: Option<String>,
    #[serde(default)]
    last_name: Option<String>,
    /// Institutional creators carry a single `name` instead of a split pair.
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationData {
    #[serde(default)]
    item_type: String,
    #[serde(default)]
    annotation_type: Option<String>,
    #[serde(default)]
    annotation_text: Option<String>,
    #[serde(default)]
    annotation_comment: Option<String>,
    #[serde(default)]
    annotation_color: Option<String>,
    #[serde(default)]
    annotation_page_label: Option<String>,
}

impl LocalApi {
    /// Wrap an HTTP client.
    ///
    /// The client comes from [`yaz_core::net::http_client`] so that the trust
    /// policy in ADR-0019 has exactly one implementation.
    pub fn new(http: reqwest::Client) -> Self {
        Self::at(http, Endpoint::default())
    }

    /// A client for a Zotero forwarded from another machine.
    pub fn at(http: reqwest::Client, endpoint: Endpoint) -> Self {
        Self {
            http,
            endpoint,
            libraries: vec![LibraryRef::User],
        }
    }

    /// Root of the local API.
    fn api_root(&self) -> String {
        self.endpoint.api_root()
    }

    /// Start a request, named for loopback whatever address it goes to.
    fn get(&self, url: &str) -> reqwest::RequestBuilder {
        self.http
            .get(url)
            .header(reqwest::header::HOST, LOOPBACK_AUTHORITY)
    }

    /// The libraries this will query.
    pub fn libraries(&self) -> &[LibraryRef] {
        &self.libraries
    }

    /// Ask Zotero which group libraries exist, and query those too.
    ///
    /// Without this only the personal library is visible, and that is not a
    /// degradation anyone can see: the picker simply never offers half the
    /// sources, with no error and no explanation.
    pub async fn discover_libraries(&mut self) {
        let url = format!("{}/users/0/groups", self.api_root());
        let Ok(response) = self
            .get(&url)
            .query(&[("format", "json")])
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        else {
            return;
        };
        let Ok(body) = response.text().await else {
            return;
        };

        #[derive(Deserialize)]
        struct Group {
            id: u64,
        }
        if let Ok(groups) = serde_json::from_str::<Vec<Group>>(&body) {
            self.libraries = std::iter::once(LibraryRef::User)
                .chain(groups.into_iter().map(|group| LibraryRef::Group(group.id)))
                .collect();
        }
    }

    /// Whether this source can actually answer queries.
    ///
    /// # Why not `/connector/ping`
    ///
    /// Because it lies about the thing we care about. `ping` answers `200` from
    /// the connector server, which is on by default, and says only that Zotero
    /// is *running*. The local API is a **separate, disabled-by-default**
    /// feature, and asking it for items while it is off returns
    /// `403 Local API is not enabled`.
    ///
    /// Probing `ping` therefore reported the live source as available on a
    /// perfectly ordinary Zotero install, and every subsequent query failed —
    /// which is exactly how this was found. The probe now asks the endpoint it
    /// is actually going to use.
    pub async fn availability(&self) -> Availability {
        let response = self
            .get(&format!("{}/users/0/items", self.api_root()))
            .query(&[("limit", "1"), ("format", "json")])
            .timeout(std::time::Duration::from_millis(1500))
            .send()
            .await;

        match response {
            Ok(response) if response.status().is_success() => Availability::Available,
            Ok(response) if response.status() == reqwest::StatusCode::FORBIDDEN => {
                Availability::LocalApiDisabled
            }
            Ok(_) => Availability::Unexpected,
            Err(error) if error.is_connect() || error.is_timeout() => Availability::NotRunning,
            Err(_) => Availability::Unexpected,
        }
    }

    /// Search every library.
    ///
    /// # Why this is not the query path
    ///
    /// One request per library, and Zotero serves them one at a time — issuing
    /// them concurrently measured no faster. Across twelve libraries a single
    /// search took **3.4 seconds**, against **16 ms** for the same search over
    /// the copied database, which covers every library in one query. A picker
    /// cannot spend that per keystroke.
    ///
    /// Kept correct and available because that reasoning is a measurement, not
    /// a law: a Zotero with a cross-library endpoint would change the answer.
    pub async fn search(&self, query: &str, limit: usize) -> Result<Vec<Item>> {
        let mut all = Vec::new();
        for library in &self.libraries {
            let url = format!("{}/{}/items", self.api_root(), library.path());
            let response = self
                .get(&url)
                .query(&[
                    ("q", query),
                    ("limit", &limit.to_string()),
                    ("format", "json"),
                    // Ask Zotero to leave out what is not citable rather than
                    // filtering it out after transfer.
                    ("itemType", "-attachment || note || annotation"),
                ])
                .send()
                .await
                .map_err(http)?;

            let body = response.text().await.map_err(http)?;
            all.extend(parse_items(&body)?);
            if all.len() >= limit {
                break;
            }
        }
        all.truncate(limit);
        Ok(all)
    }

    /// Look one item up by its Zotero key.
    ///
    /// A separate endpoint from search, because a key matches no searchable
    /// field — passing one to `/items?q=` finds nothing.
    pub async fn find(&self, item_key: &str) -> Result<Option<Item>> {
        // A key does not say which library holds it, so this asks each.
        for library in &self.libraries {
            let url = format!("{}/{}/items/{item_key}", self.api_root(), library.path());
            let response = self
                .get(&url)
                .query(&[("format", "json")])
                .send()
                .await
                .map_err(http)?;

            if !response.status().is_success() {
                continue;
            }
            let body = response.text().await.map_err(http)?;
            // The single-item endpoint returns one envelope, not an array.
            if let Some(item) = parse_items(&format!("[{body}]"))?.pop() {
                return Ok(Some(item));
            }
        }
        Ok(None)
    }

    /// Every marked passage on an item.
    ///
    /// Two hops, because Zotero models annotations as children of the
    /// *attachment*: item → attachments → annotations.
    pub async fn annotations(&self, item_key: &str) -> Result<Vec<Annotation>> {
        let children = self.children(item_key).await?;
        let attachment_keys: Vec<String> = parse_attachment_keys(&children);

        let mut all = Vec::new();
        for attachment in attachment_keys {
            let body = self.children(&attachment).await?;
            all.extend(parse_annotations(&body, item_key)?);
        }
        Ok(all)
    }

    async fn children(&self, key: &str) -> Result<String> {
        for library in &self.libraries {
            let url = format!(
                "{}/{}/items/{key}/children",
                self.api_root(),
                library.path()
            );
            let response = self
                .get(&url)
                .query(&[("format", "json")])
                .send()
                .await
                .map_err(http)?;
            if response.status().is_success() {
                return response.text().await.map_err(http);
            }
        }
        // An item no library admits to holding has no children; that is not an
        // error, and reporting one would surface as a failed citation.
        Ok("[]".to_owned())
    }
}

fn http(source: reqwest::Error) -> Error {
    // A refused connection means Zotero is closed, which is not a failure worth
    // showing anyone — it is the signal to fall through to the next source.
    if source.is_connect() {
        return Error::NotRunning;
    }
    Error::Http {
        source: Box::new(source),
    }
}

/// An empty string is an absent field, not a value.
fn some(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

/// Parse a local-API item listing.
fn parse_items(body: &str) -> Result<Vec<Item>> {
    let envelopes: Vec<Envelope<ItemData>> =
        serde_json::from_str(body).map_err(|_| Error::UnexpectedResponse {
            source_name: "local-api",
        })?;

    Ok(envelopes
        .into_iter()
        .filter(|e| {
            !matches!(
                e.data.item_type.as_str(),
                "attachment" | "note" | "annotation"
            )
        })
        .map(|e| Item {
            key: e.key,
            citation_key: e.data.citation_key.filter(|k| !k.is_empty()),
            item_type: e.data.item_type,
            title: e.data.title,
            creators: e
                .data
                .creators
                .into_iter()
                .filter_map(format_creator)
                .collect(),
            // `meta.parsedDate` is Zotero's own normalisation and is more
            // reliable than re-parsing the free-text `date` field.
            year: e
                .meta
                .parsed_date
                .as_deref()
                .or(e.data.date.as_deref())
                .and_then(parse_year),
            container: e.data.publication_title.filter(|s| !s.is_empty()),
            doi: e.data.doi.filter(|s| !s.is_empty()),
            // An empty string from the API is an absent field, not a value:
            // writing `publisher = {}` into a `.bib` is worse than omitting it.
            publisher: some(
                e.data
                    .publisher
                    .or(e.data.institution)
                    .or(e.data.university),
            ),
            place: some(e.data.place),
            edition: some(e.data.edition),
            isbn: some(e.data.isbn.or(e.data.issn)),
            url: some(e.data.url),
            date: some(e.data.date.clone()),
            abstract_text: some(e.data.abstract_note),
            pages: some(e.data.pages.or(e.data.num_pages)),
            volume: some(e.data.volume),
            issue: some(e.data.issue),
        })
        .collect())
}

fn format_creator(creator: Creator) -> Option<String> {
    if let Some(name) = creator
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(name.to_owned());
    }
    let first = creator
        .first_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let last = creator
        .last_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match (first, last) {
        (Some(first), Some(last)) => Some(format!("{last}, {first}")),
        (None, Some(last)) => Some(last.to_owned()),
        (Some(first), None) => Some(first.to_owned()),
        (None, None) => None,
    }
}

/// Keys of the attachments among an item's children.
fn parse_attachment_keys(body: &str) -> Vec<String> {
    #[derive(Deserialize)]
    struct Child {
        key: String,
        data: ChildData,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ChildData {
        #[serde(default)]
        item_type: String,
    }

    serde_json::from_str::<Vec<Child>>(body)
        .map(|children| {
            children
                .into_iter()
                .filter(|c| c.data.item_type == "attachment")
                .map(|c| c.key)
                .collect()
        })
        .unwrap_or_default()
}

/// Parse annotations out of an attachment's children.
fn parse_annotations(body: &str, item_key: &str) -> Result<Vec<Annotation>> {
    let envelopes: Vec<Envelope<AnnotationData>> =
        serde_json::from_str(body).map_err(|_| Error::UnexpectedResponse {
            source_name: "local-api",
        })?;

    Ok(envelopes
        .into_iter()
        .filter(|e| e.data.item_type == "annotation")
        .map(|e| Annotation {
            key: e.key,
            item_key: item_key.to_owned(),
            kind: annotation_kind(e.data.annotation_type.as_deref()),
            text: e.data.annotation_text.unwrap_or_default(),
            comment: e.data.annotation_comment.filter(|c| !c.trim().is_empty()),
            color: e.data.annotation_color.filter(|c| !c.is_empty()),
            page_label: e.data.annotation_page_label,
        })
        .collect())
}

/// The local API names annotation types where sqlite numbers them.
fn annotation_kind(name: Option<&str>) -> AnnotationKind {
    match name {
        Some("highlight") => AnnotationKind::Highlight,
        Some("note") => AnnotationKind::Note,
        Some("image") => AnnotationKind::Image,
        Some("ink") => AnnotationKind::Ink,
        Some("underline") => AnnotationKind::Underline,
        _ => AnnotationKind::Other,
    }
}

/// Leading four-digit year, matching the sqlite source's rule.
fn parse_year(date: &str) -> Option<i32> {
    let head: String = date
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if head.len() != 4 {
        return None;
    }
    head.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Recorded from Zotero's documented local API response shape.
    const ITEMS: &str = r#"[
      {
        "key": "ITEMAAAA",
        "version": 12,
        "meta": { "creatorSummary": "Hagedorn", "parsedDate": "2024-01-01" },
        "data": {
          "key": "ITEMAAAA",
          "itemType": "journalArticle",
          "title": "Semantic validation of information containers",
          "creators": [
            { "creatorType": "author", "firstName": "Jakob", "lastName": "Hagedorn" },
            { "creatorType": "author", "name": "European Commission" }
          ],
          "date": "2024",
          "publicationTitle": "Automation in Construction",
          "DOI": "10.1016/j.autcon.2024.001"
        }
      },
      {
        "key": "ATTACHAA",
        "version": 13,
        "meta": {},
        "data": { "key": "ATTACHAA", "itemType": "attachment", "title": "paper.pdf" }
      }
    ]"#;

    const ANNOTATIONS: &str = r##"[
      {
        "key": "ANNOAAAA",
        "version": 20,
        "meta": {},
        "data": {
          "key": "ANNOAAAA",
          "itemType": "annotation",
          "annotationType": "highlight",
          "annotationText": "information containers must be validated",
          "annotationComment": "key claim",
          "annotationColor": "#ffd400",
          "annotationPageLabel": "21"
        }
      },
      {
        "key": "ANNOBBBB",
        "version": 21,
        "meta": {},
        "data": {
          "key": "ANNOBBBB",
          "itemType": "annotation",
          "annotationType": "ink",
          "annotationColor": "#e56eee",
          "annotationPageLabel": "24"
        }
      }
    ]"##;

    #[test]
    fn items_parse_and_attachments_are_dropped() {
        let items = parse_items(ITEMS).unwrap();
        assert_eq!(items.len(), 1, "the attachment must not be citable");
        let item = &items[0];
        assert_eq!(item.key, "ITEMAAAA");
        assert_eq!(item.year, Some(2024));
        assert_eq!(item.doi.as_deref(), Some("10.1016/j.autcon.2024.001"));
    }

    #[test]
    fn institutional_and_personal_creators_both_format() {
        let items = parse_items(ITEMS).unwrap();
        assert_eq!(
            items[0].creators,
            vec![
                "Hagedorn, Jakob".to_owned(),
                "European Commission".to_owned()
            ]
        );
    }

    #[test]
    fn annotations_parse_with_their_kinds() {
        let annotations = parse_annotations(ANNOTATIONS, "ITEMAAAA").unwrap();
        assert_eq!(annotations.len(), 2);
        assert_eq!(annotations[0].kind, AnnotationKind::Highlight);
        assert!(annotations[0].has_quotable_text());
        assert_eq!(annotations[0].comment.as_deref(), Some("key claim"));

        // Ink carries no text, and must not be offered as a quotation.
        assert_eq!(annotations[1].kind, AnnotationKind::Ink);
        assert!(!annotations[1].has_quotable_text());
    }

    #[test]
    fn annotations_are_attributed_to_the_item_not_the_attachment() {
        // The whole reason for the two-hop walk.
        let annotations = parse_annotations(ANNOTATIONS, "ITEMAAAA").unwrap();
        assert!(annotations.iter().all(|a| a.item_key == "ITEMAAAA"));
    }

    #[test]
    fn attachment_keys_are_picked_out_of_children() {
        assert_eq!(parse_attachment_keys(ITEMS), vec!["ATTACHAA".to_owned()]);
    }

    #[test]
    fn a_garbled_response_is_reported_rather_than_silently_empty() {
        // Returning an empty list here would read as "this item has no
        // annotations", which is a lie the user cannot detect.
        let error = parse_items("<html>not json</html>").unwrap_err();
        assert!(matches!(
            error,
            Error::UnexpectedResponse {
                source_name: "local-api"
            }
        ));
        assert!(parse_annotations("nonsense", "K").is_err());
    }

    #[test]
    fn the_host_is_loopback_unless_an_endpoint_is_given() {
        // Nothing but a start-up option builds another endpoint: a Zotero host
        // a plugin could name would be a configurable exfiltration target.
        assert_eq!(ZOTERO_HOST, "127.0.0.1");
        assert!(
            Endpoint::default()
                .api_root()
                .starts_with("http://127.0.0.1:23119/")
        );
    }

    #[test]
    fn an_endpoint_is_a_plain_host_and_port() {
        let named = Endpoint::parse("laptop.tailnet.ts.net:4000").unwrap();
        assert_eq!(named.api_root(), "http://laptop.tailnet.ts.net:4000/api");
        assert_eq!(
            Endpoint::parse("100.64.0.7").unwrap().to_string(),
            "100.64.0.7:23119"
        );
        assert_eq!(
            Endpoint::parse("[fd7a::1]:23119").unwrap().api_root(),
            "http://[fd7a::1]:23119/api"
        );

        for refused in [
            "",
            "http://laptop:23119",
            "laptop:23119/api",
            "user@laptop:23119",
            "laptop:port",
            "fd7a::1",
        ] {
            assert_eq!(Endpoint::parse(refused), None, "{refused}");
        }
    }

    #[tokio::test]
    async fn a_forwarded_request_still_names_loopback() {
        // Zotero answers `400 Invalid Host header` to anything else, so a
        // forwarded Zotero would look permanently broken.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0; 4096];
            let read = socket.read(&mut buffer).await.unwrap();
            socket
                .write_all(b"HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\n[]")
                .await
                .unwrap();
            String::from_utf8_lossy(&buffer[..read]).to_lowercase()
        });

        // `localhost` rather than the address, so the default `Host` would
        // differ from the one Zotero wants.
        let endpoint = Endpoint::parse(&format!("localhost:{port}")).unwrap();
        let api = LocalApi::at(reqwest::Client::new(), endpoint);
        assert_eq!(api.availability().await, Availability::Available);

        let request = seen.await.unwrap();
        assert!(request.contains("host: 127.0.0.1:23119"), "{request}");
        assert!(!request.contains("host: localhost"), "{request}");
    }
}
