//! Citation keys and `.bib` entries.
//!
//! # Why this exists even though Zotero can export
//!
//! [ADR-0008] makes the project `.bib` the compile-time source of truth: a
//! document must build on a co-author's machine that has never had Zotero
//! installed. So inserting a citation copies the entry into the project rather
//! than pointing at the library.
//!
//! # Keys we generate are not keys Better BibTeX generates
//!
//! When Better BibTeX is running it owns the citation key, and we use its answer
//! because that key is what already appears in `.bib` files and in
//! collaborators' documents. Without it we generate one, and the two can differ.
//! That is surfaced to the user rather than hidden — a citation key that
//! silently disagrees with a co-author's is a genuinely annoying problem to
//! debug, and the tool knows perfectly well which case it is in.
//!
//! [ADR-0008]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0008-zotero-integration.md

use std::collections::HashSet;

use crate::model::Item;

/// Generate a deterministic citation key: `surnameYEARword`.
///
/// Deterministic on purpose. The same item must produce the same key on every
/// machine and every run, or a project's `.bib` churns every time somebody cites
/// something.
///
/// The shape follows Better BibTeX's default so that a library which later gains
/// BBT mostly agrees with what we already wrote. "Mostly" is doing real work in
/// that sentence, which is why [`crate::Item::citation_key`] records whether a
/// key was authoritative.
pub fn generate_key(item: &Item) -> String {
    let surname = item
        .first_creator()
        .map(surname_of)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "anon".to_owned());

    let year = item
        .year
        .map(|y| y.to_string())
        .unwrap_or_else(|| "nd".to_owned());

    let word = first_significant_word(&item.title);

    format!("{surname}{year}{word}")
}

/// Make a key unique against keys already present in a bibliography.
///
/// Two papers by the same author in the same year with the same leading title
/// word is not a hypothetical — conference series produce them routinely.
/// Suffixes follow the usual `a`, `b`, `c` convention.
pub fn disambiguate(base: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(base) {
        return base.to_owned();
    }
    for suffix in b'a'..=b'z' {
        let candidate = format!("{base}{}", suffix as char);
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    // Twenty-six collisions on one key is pathological; fall back to a counter
    // rather than returning a duplicate, which would silently merge citations.
    let mut n = 2usize;
    loop {
        let candidate = format!("{base}-{n}");
        if !taken.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The surname from a creator string formatted as `Last, First`.
fn surname_of(creator: &str) -> String {
    let surname = creator.split(',').next().unwrap_or(creator);
    ascii_fold(surname)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// The first title word that carries meaning.
///
/// Leading articles and prepositions make for keys that all look alike —
/// `smith2024the` tells a reader nothing.
fn first_significant_word(title: &str) -> String {
    const SKIP: [&str; 12] = [
        "a", "an", "the", "on", "of", "in", "for", "to", "and", "or", "with", "into",
    ];
    title
        .split_whitespace()
        .map(|word| {
            ascii_fold(word)
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
                .to_lowercase()
        })
        .find(|word| !word.is_empty() && !SKIP.contains(&word.as_str()))
        .unwrap_or_default()
}

/// Fold the Latin-1 range down to ASCII.
///
/// Citation keys are used in `\cite{...}` and must survive every LaTeX engine
/// and every editor's idea of encoding. `Müller` becomes `mueller`, following
/// German transliteration rather than dropping the diaeresis, because
/// `muller` is a different name.
fn ascii_fold(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            'ä' => out.push_str("ae"),
            'ö' => out.push_str("oe"),
            'ü' => out.push_str("ue"),
            'Ä' => out.push_str("Ae"),
            'Ö' => out.push_str("Oe"),
            'Ü' => out.push_str("Ue"),
            'ß' => out.push_str("ss"),
            'å' => out.push('a'),
            'æ' => out.push_str("ae"),
            'ø' => out.push('o'),
            'á' | 'à' | 'â' | 'ã' => out.push('a'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'í' | 'ì' | 'î' | 'ï' => out.push('i'),
            'ó' | 'ò' | 'ô' | 'õ' => out.push('o'),
            'ú' | 'ù' | 'û' => out.push('u'),
            'ç' => out.push('c'),
            'ñ' => out.push('n'),
            'ý' | 'ÿ' => out.push('y'),
            'ł' => out.push('l'),
            'š' => out.push('s'),
            'ž' => out.push('z'),
            'č' => out.push('c'),
            'ř' => out.push('r'),
            other => out.push(other),
        }
    }
    out
}

/// Map a Zotero item type onto a BibTeX entry type.
///
/// Unknown types become `@misc`, which every style can render. Inventing an
/// entry type no `.bst` recognises produces a silently missing bibliography
/// entry, which is worse than an imprecise one.
fn entry_type(item_type: &str) -> &'static str {
    match item_type {
        "journalArticle" | "magazineArticle" | "newspaperArticle" => "article",
        "book" => "book",
        "bookSection" => "incollection",
        "conferencePaper" => "inproceedings",
        "thesis" => "phdthesis",
        "report" | "standard" => "techreport",
        "manuscript" | "preprint" => "unpublished",
        "webpage" | "blogPost" => "online",
        _ => "misc",
    }
}

/// Escape the characters that are syntax in BibTeX and LaTeX.
///
/// A `&` or `%` copied out of a title will otherwise break the build — `%`
/// comments out the rest of the line, which is a particularly confusing failure
/// because the entry looks fine in the file.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' | '%' | '$' | '#' | '_' => {
                out.push('\\');
                out.push(c);
            }
            '{' | '}' => {
                out.push('\\');
                out.push(c);
            }
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            '\\' => out.push_str("\\textbackslash{}"),
            other => out.push(other),
        }
    }
    out
}

/// Render an item as a BibTeX entry.
///
/// The title is wrapped in an extra pair of braces so that styles which
/// lowercase titles leave acronyms alone. `BIM and IFC` becoming `Bim and ifc`
/// is the classic complaint, and this is the classic fix.
pub fn to_bibtex(item: &Item, key: &str, fields: Fields) -> String {
    let mut out = format!("@{}{{{},\n", entry_type(&item.item_type), key);

    // Which Zotero item this is, so re-citing it finds this entry by identity
    // rather than by what it happens to be called. See [`entry_for_item`].
    out.push_str(&format!("  {ITEM_FIELD} = {{{}}},\n", item_uri(&item.key)));

    if !item.title.is_empty() {
        out.push_str(&format!("  title = {{{{{}}}}},\n", escape(&item.title)));
    }
    if !item.creators.is_empty() {
        // BibTeX joins authors with " and ", and the `Last, First` form each
        // creator already carries is exactly what it expects.
        let authors = item
            .creators
            .iter()
            .map(|c| escape(c))
            .collect::<Vec<_>>()
            .join(" and ");
        out.push_str(&format!("  author = {{{authors}}},\n"));
    }
    if let Some(year) = item.year {
        out.push_str(&format!("  year = {{{year}}},\n"));
    }
    if let Some(container) = &item.container {
        let field = match entry_type(&item.item_type) {
            "inproceedings" | "incollection" => "booktitle",
            _ => "journal",
        };
        out.push_str(&format!("  {field} = {{{}}},\n", escape(container)));
    }
    write_fields(&mut out, item, fields);

    out.push_str("}\n");
    out
}

/// The optional half of an entry, as the settings ask for it.
///
/// Everything is written by default, because biber ignores a field the style
/// does not print — the cost of writing too much is a longer `.bib`, and the
/// cost of writing too little is a reference that comes out missing its
/// publisher after the author changes style.
fn write_fields(out: &mut String, item: &Item, fields: Fields) {
    let mut put = |name: &str, value: &Option<String>| {
        if let Some(text) = value {
            out.push_str(&format!("  {name} = {{{}}},\n", escape(text)));
        }
    };

    if fields.publication {
        put("publisher", &item.publisher);
        // biblatex calls it `location`; BibTeX calls it `address`. `location`
        // is what biber wants and what an older style quietly ignores, which
        // is the right way round — ignored beats misplaced.
        put("location", &item.place);
        put("edition", &item.edition);
    }
    if fields.location {
        put("volume", &item.volume);
        put("number", &item.issue);
        put("pages", &item.pages);
    }
    if fields.identifiers {
        put("doi", &item.doi);
        put("isbn", &item.isbn);
        put("url", &item.url);
    }
    if fields.summary {
        put("abstract", &item.abstract_text);
    }
}

/// How a new entry is named.
///
/// Three, because the trade is real and different people want different ends of
/// it. A generated key is legible in the source and is *ours*, so it may not
/// match a co-author's; an item key never collides and never needs renaming but
/// says nothing to a reader; Better BibTeX's is authoritative and needs Better
/// BibTeX to be running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum KeyScheme {
    /// `meister2021building`, with the Zotero item key recorded in the entry.
    #[default]
    Readable,
    /// `B8IM9SU5` — Zotero's own identifier, used directly.
    ItemKey,
    /// Whatever Better BibTeX calls it, falling back to [`KeyScheme::Readable`].
    BetterBibtex,
}

/// Which of Zotero's metadata is written into an entry.
///
/// Zotero holds far more than a citation needs, and which of it a style prints
/// depends on the style — a book's entry wants a publisher and a place, an
/// article's wants a volume and pages, and neither wants the other's. Writing
/// everything is the default, because biber ignores a field the style does not
/// print: the cost of too much is a longer `.bib`, and the cost of too little
/// is a reference that loses its publisher when the author changes style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct Fields {
    /// Publisher, place and edition — what a book or a report is identified by.
    pub publication: bool,
    /// Volume, issue and pages — where an article sits inside its container.
    pub location: bool,
    /// DOI, ISBN and URL — how the work is found again.
    pub identifiers: bool,
    /// The abstract.
    pub summary: bool,
}

impl Default for Fields {
    fn default() -> Self {
        Self {
            publication: true,
            location: true,
            identifiers: true,
            // The one exception: an abstract is a paragraph per entry, and a
            // `.bib` nobody can read is a `.bib` nobody will correct.
            summary: false,
        }
    }
}

/// The field an entry records its Zotero item under.
///
/// A `note` rather than an invented field name: biber warns about a field it
/// does not know, and a warning per entry in a build log is how a real error
/// gets missed. `note` is a standard field, and a Zotero URI in it is
/// meaningful to a person reading the `.bib` as well as to this.
const ITEM_FIELD: &str = "note";

/// The Zotero URI recorded for an item, as it appears in an entry.
fn item_uri(item_key: &str) -> String {
    format!("zotero://select/items/{item_key}")
}

/// The citation key of the entry recording this Zotero item, if one does.
///
/// This is what makes re-citing idempotent *whatever the key is called*.
/// Matching on the generated name instead meant that an author who renamed a
/// key by hand — which is the first thing anyone does to `meister2021b` — got a
/// second copy of the same work the next time they cited it.
pub fn entry_for_item(bib: &str, item_key: &str) -> Option<String> {
    let needle = item_uri(item_key);
    for chunk in bib.split('@').skip(1) {
        if !chunk.contains(&needle) {
            continue;
        }
        let (_, after_brace) = chunk.split_once('{')?;
        let key = after_brace.split(',').next().unwrap_or("").trim();
        if !key.is_empty() && !key.contains(char::is_whitespace) {
            return Some(key.to_owned());
        }
    }
    None
}

/// Every Zotero item a `.bib` records, with the key its entry carries.
///
/// What a refresh walks. An entry with no item recorded is one this did not
/// write — a reference the author typed themselves — and it is not in this
/// list, so a refresh cannot touch it.
pub fn recorded_items(bib: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for chunk in bib.split('@').skip(1) {
        let Some(at) = chunk.find("zotero://select/items/") else {
            continue;
        };
        let item: String = chunk[at + "zotero://select/items/".len()..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect();
        let Some((_, after_brace)) = chunk.split_once('{') else {
            continue;
        };
        let key = after_brace.split(',').next().unwrap_or("").trim();
        if !item.is_empty() && !key.is_empty() && !key.contains(char::is_whitespace) {
            found.push((item, key.to_owned()));
        }
    }
    found
}

/// Replace the entry with this citation key, keeping everything else.
///
/// By key rather than by position, and the whole entry at once: a refresh that
/// merged field by field would have to decide whether an author's correction or
/// Zotero's value wins for each of them, and it cannot know. Replacing wholesale
/// at least means the result is exactly what Zotero says, which is what the
/// person asking for a refresh asked for.
pub fn replace_entry(bib: &str, key: &str, entry: &str) -> Option<String> {
    let mut cursor = 0usize;
    while let Some(at) = bib[cursor..].find('@') {
        let start = cursor + at;
        let rest = &bib[start..];
        let Some((_, after_brace)) = rest.split_once('{') else {
            break;
        };
        let found = after_brace.split(',').next().unwrap_or("").trim();
        if found == key {
            // To the end of this entry: the next `@` at the start of a line, or
            // the end of the file.
            let end = bib[start + 1..]
                .find("\n@")
                .map(|offset| start + 1 + offset + 1)
                .unwrap_or(bib.len());
            let mut out = String::with_capacity(bib.len());
            out.push_str(&bib[..start]);
            out.push_str(entry.trim_end());
            out.push('\n');
            out.push_str(&bib[end..]);
            return Some(out);
        }
        cursor = start + 1;
    }
    None
}

/// Citation keys already present in a `.bib` file.
///
/// Deliberately tolerant. This parses only far enough to find keys, because its
/// job is to avoid colliding with them — a `.bib` this cannot fully parse is
/// still a `.bib` whose keys must be respected.
pub fn existing_keys(bib: &str) -> HashSet<String> {
    let mut keys = HashSet::new();
    for line in bib.lines() {
        let line = line.trim_start();
        let Some(rest) = line.strip_prefix('@') else {
            continue;
        };
        let Some((_, after_brace)) = rest.split_once('{') else {
            continue;
        };
        let key = after_brace.split(',').next().unwrap_or("").trim();
        if !key.is_empty() && !key.contains(char::is_whitespace) {
            keys.insert(key.to_owned());
        }
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(creators: &[&str], year: Option<i32>, title: &str) -> Item {
        Item {
            key: "K".into(),
            citation_key: None,
            item_type: "journalArticle".into(),
            title: title.into(),
            creators: creators.iter().map(|c| (*c).to_owned()).collect(),
            year,
            // The rest defaulted: these tests are about how a key is made, and
            // spelling out ten empty fields in each of them would bury that.
            ..Default::default()
        }
    }

    #[test]
    fn key_follows_the_surname_year_word_shape() {
        let it = item(
            &["Hagedorn, Jakob"],
            Some(2024),
            "Semantic validation of information containers",
        );
        assert_eq!(generate_key(&it), "hagedorn2024semantic");
    }

    #[test]
    fn leading_articles_do_not_become_the_key_word() {
        // `smith2024the` would be useless.
        let it = item(&["Smith, Jo"], Some(2024), "The bridge design guideline");
        assert_eq!(generate_key(&it), "smith2024bridge");
        let it = item(&["Smith, Jo"], Some(2024), "On the origin of species");
        assert_eq!(generate_key(&it), "smith2024origin");
    }

    #[test]
    fn german_umlauts_transliterate_rather_than_drop() {
        // `muller` is a different name from `mueller`.
        let it = item(&["Müller, Anna"], Some(2020), "Über Brücken");
        assert_eq!(generate_key(&it), "mueller2020ueber");
        let it = item(&["Weiß, Karl"], Some(2020), "Straßenbau");
        assert_eq!(generate_key(&it), "weiss2020strassenbau");
    }

    #[test]
    fn missing_author_and_year_still_produce_a_usable_key() {
        let it = item(&[], None, "Anonymous report");
        assert_eq!(generate_key(&it), "anonndanonymous");
        // And it must never be empty, or `\cite{}` results.
        assert!(!generate_key(&item(&[], None, "")).is_empty());
    }

    #[test]
    fn institutional_authors_keep_their_whole_name() {
        let it = item(&["European Commission"], Some(2019), "Level(s) framework");
        // No comma, so the whole name is the surname part.
        assert_eq!(generate_key(&it), "europeancommission2019levels");
    }

    #[test]
    fn colliding_keys_get_letter_suffixes() {
        let mut taken = HashSet::new();
        assert_eq!(disambiguate("smith2024bridge", &taken), "smith2024bridge");
        taken.insert("smith2024bridge".to_owned());
        assert_eq!(disambiguate("smith2024bridge", &taken), "smith2024bridgea");
        taken.insert("smith2024bridgea".to_owned());
        assert_eq!(disambiguate("smith2024bridge", &taken), "smith2024bridgeb");
    }

    #[test]
    fn disambiguation_never_returns_a_duplicate() {
        let mut taken: HashSet<String> = HashSet::new();
        taken.insert("k".to_owned());
        for suffix in b'a'..=b'z' {
            taken.insert(format!("k{}", suffix as char));
        }
        let result = disambiguate("k", &taken);
        assert!(!taken.contains(&result), "returned an already-used key");
    }

    #[test]
    fn latex_syntax_in_a_title_is_escaped() {
        // A `%` would comment out the rest of the line and the entry would look
        // perfectly fine in the file while breaking the build.
        let it = item(&["A, B"], Some(2024), "Cost & risk: 50% of the _total_");
        let bib = to_bibtex(&it, "ab2024cost", Fields::default());
        assert!(bib.contains("\\&"), "{bib}");
        assert!(bib.contains("\\%"), "{bib}");
        assert!(bib.contains("\\_"), "{bib}");
    }

    #[test]
    fn titles_are_brace_protected_so_acronyms_survive() {
        let it = item(&["Du, X"], Some(2024), "BIM and IFC data readiness");
        let bib = to_bibtex(&it, "du2024bim", Fields::default());
        assert!(
            bib.contains("title = {{BIM and IFC data readiness}}"),
            "acronyms must not be lowercased by the style: {bib}"
        );
    }

    #[test]
    fn authors_are_joined_the_way_bibtex_expects() {
        let it = item(&["Du, X", "Hou, Y", "Zhang, Z"], Some(2024), "T");
        let bib = to_bibtex(&it, "k", Fields::default());
        assert!(
            bib.contains("author = {Du, X and Hou, Y and Zhang, Z}"),
            "{bib}"
        );
    }

    #[test]
    fn container_maps_to_booktitle_for_proceedings() {
        let mut it = item(&["A, B"], Some(2024), "T");
        it.container = Some("Proceedings of Something".into());
        it.item_type = "conferencePaper".into();
        let bib = to_bibtex(&it, "k", Fields::default());
        assert!(bib.starts_with("@inproceedings{k,"), "{bib}");
        assert!(
            bib.contains("booktitle = {Proceedings of Something}"),
            "{bib}"
        );

        it.item_type = "journalArticle".into();
        assert!(to_bibtex(&it, "k", Fields::default()).contains("journal = {"));
    }

    #[test]
    fn unknown_item_types_fall_back_to_misc() {
        let mut it = item(&["A, B"], Some(2024), "T");
        it.item_type = "somethingZoteroAddedLater".into();
        assert!(to_bibtex(&it, "k", Fields::default()).starts_with("@misc{k,"));
    }

    #[test]
    fn existing_keys_are_read_out_of_a_bib_file() {
        let bib = "\
@article{hagedorn2024semantic,
  title = {{A}},
}

% a comment
@inproceedings{du2024bim,
  title = {{B}},
}
";
        let keys = existing_keys(bib);
        assert!(keys.contains("hagedorn2024semantic"));
        assert!(keys.contains("du2024bim"));
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn a_generated_entry_round_trips_through_the_key_reader() {
        // The entry we write must be one we can later recognise, or every
        // insertion would collide with itself.
        let it = item(&["Hagedorn, Jakob"], Some(2024), "Semantic validation");
        let key = generate_key(&it);
        let keys = existing_keys(&to_bibtex(&it, &key, Fields::default()));
        assert!(
            keys.contains(&key),
            "wrote {key} but could not read it back"
        );
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    fn sample() -> Item {
        Item {
            key: "B8IM9SU5".into(),
            citation_key: None,
            item_type: "journalArticle".into(),
            title: "Building Information Modeling".into(),
            creators: vec!["Meister, Ulrich".into()],
            year: Some(2021),
            ..Default::default()
        }
    }

    #[test]
    fn an_entry_records_which_zotero_item_it_is() {
        let written = to_bibtex(&sample(), "meister2021building", Fields::default());
        assert!(
            written.contains("zotero://select/items/B8IM9SU5"),
            "{written}"
        );
    }

    #[test]
    fn the_recorded_item_is_found_whatever_the_entry_is_called() {
        // The point of recording it. An author who renames `meister2021b` to
        // something they can remember must not get a second copy of the same
        // work the next time they cite it.
        let written = to_bibtex(&sample(), "whatever-i-renamed-it-to", Fields::default());
        assert_eq!(
            entry_for_item(&written, "B8IM9SU5").as_deref(),
            Some("whatever-i-renamed-it-to")
        );
    }

    #[test]
    fn a_different_item_is_not_matched() {
        let written = to_bibtex(&sample(), "meister2021building", Fields::default());
        assert_eq!(entry_for_item(&written, "OTHERKEY"), None);
    }

    #[test]
    fn the_right_entry_is_found_among_several() {
        let mut other = sample();
        other.key = "OTHERKEY".into();
        other.title = "Something else".into();
        let bib = format!(
            "{}
{}",
            to_bibtex(&other, "other2021something", Fields::default()),
            to_bibtex(&sample(), "meister2021building", Fields::default())
        );
        assert_eq!(
            entry_for_item(&bib, "B8IM9SU5").as_deref(),
            Some("meister2021building")
        );
    }

    #[test]
    fn a_bibliography_written_by_hand_matches_nothing() {
        // Which is right: an entry with no Zotero item recorded is one this
        // did not write, and claiming it as a match would attach an author's
        // own reference to whatever they happened to cite next.
        let bib = "@book{knuth1984, title = {The TeXbook}, year = {1984}}";
        assert_eq!(entry_for_item(bib, "B8IM9SU5"), None);
    }

    #[test]
    fn the_item_key_scheme_uses_zoteros_own_identifier() {
        // Not a function under test so much as the property the scheme exists
        // for: it is the item's key, so it cannot collide and never needs a
        // suffix.
        assert_eq!(sample().key, "B8IM9SU5");
        assert_ne!(generate_key(&sample()), sample().key);
    }

    #[test]
    fn the_default_scheme_is_the_readable_one() {
        // A setting nobody has touched must leave the source legible.
        assert_eq!(KeyScheme::default(), KeyScheme::Readable);
    }
}

#[cfg(test)]
mod field_tests {
    use super::*;

    fn rich() -> Item {
        Item {
            key: "B8IM9SU5".into(),
            item_type: "book".into(),
            title: "BKI Baukosten 2020".into(),
            creators: vec!["Spielbauer, Holger".into()],
            year: Some(2020),
            publisher: Some("BKI".into()),
            place: Some("Stuttgart".into()),
            edition: Some("3".into()),
            isbn: Some("978-3-481-04000-0".into()),
            url: Some("https://example.org/bki".into()),
            abstract_text: Some("A long paragraph nobody prints.".into()),
            pages: Some("120".into()),
            volume: Some("2".into()),
            issue: Some("4".into()),
            ..Default::default()
        }
    }

    #[test]
    fn everything_a_style_might_print_is_written_by_default() {
        // biber ignores a field the style does not print, so writing too much
        // costs a longer file. Writing too little costs a reference that comes
        // out missing its publisher after the author changes style.
        let written = to_bibtex(&rich(), "bki2020", Fields::default());
        for expected in ["publisher", "location", "edition", "isbn", "url"] {
            assert!(written.contains(expected), "missing {expected}: {written}");
        }
    }

    #[test]
    fn the_abstract_is_left_out_unless_asked_for() {
        // A paragraph per entry, and a `.bib` nobody can read is a `.bib`
        // nobody will correct.
        let written = to_bibtex(&rich(), "bki2020", Fields::default());
        assert!(!written.contains("abstract"), "{written}");
    }

    #[test]
    fn the_abstract_is_written_when_it_is() {
        let fields = Fields {
            summary: true,
            ..Default::default()
        };
        assert!(to_bibtex(&rich(), "bki2020", fields).contains("abstract"));
    }

    #[test]
    fn a_switched_off_group_writes_none_of_its_fields() {
        let fields = Fields {
            publication: false,
            ..Default::default()
        };
        let written = to_bibtex(&rich(), "bki2020", fields);
        assert!(!written.contains("publisher"), "{written}");
        assert!(!written.contains("location"), "{written}");
        // But the other groups are untouched.
        assert!(written.contains("isbn"), "{written}");
    }

    #[test]
    fn a_field_the_item_does_not_have_is_omitted_rather_than_empty() {
        // `publisher = {}` is worse than no publisher: a style prints the
        // empty braces.
        let bare = Item {
            key: "K".into(),
            item_type: "book".into(),
            title: "A title".into(),
            ..Default::default()
        };
        let written = to_bibtex(&bare, "k", Fields::default());
        assert!(!written.contains("publisher"), "{written}");
        assert!(!written.contains("{}"), "{written}");
    }

    #[test]
    fn the_place_is_written_as_location_for_biber() {
        // biblatex calls it `location` and BibTeX calls it `address`. An older
        // style ignoring `location` is better than biber mis-reading `address`.
        let written = to_bibtex(&rich(), "bki2020", Fields::default());
        assert!(written.contains("location = {Stuttgart}"), "{written}");
    }
}
