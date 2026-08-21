/**
 * Reading what Zotero puts on a drag.
 *
 * The payloads below are the shapes Zotero actually produces, and the two
 * examples in the prose are real drags: a source out of the library and a
 * highlight out of the PDF reader.
 *
 * Tested from the application's suite rather than the plugin's, because the
 * plugin repos are not in this workspace and have no runner of their own yet.
 */

import { describe, expect, it } from "vitest";

import {
  itemKeyFromUri,
  readZoteroDrop,
  unquote,
  withoutLinks,
  zoteroLinks,
} from "../../../../../plugins/zotero/src/drop";
import { searchable } from "../../../../../plugins/zotero/src/main";

/** Zotero's attributes are URI-encoded JSON. */
function attribute(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

const ITEM = "http://zotero.org/users/12345/items/ABCD1234";

describe("finding the item a Zotero URI names", () => {
  it("reads a personal library URI", () => {
    expect(itemKeyFromUri(ITEM)).toBe("ABCD1234");
  });

  it("reads a group library URI", () => {
    // The middle differs by which library the item is in, which is exactly the
    // part that does not matter: the library is already open.
    expect(
      itemKeyFromUri("http://zotero.org/groups/98765/items/WXYZ5678"),
    ).toBe("WXYZ5678");
  });

  it("says nothing for something that is not one", () => {
    expect(itemKeyFromUri("https://example.org/a/paper.pdf")).toBeNull();
    expect(itemKeyFromUri("")).toBeNull();
  });
});

describe("taking off the marks Zotero adds", () => {
  it("removes curly quotes", () => {
    expect(unquote("“Grundflächen, die erforderlich sind”")).toBe(
      "Grundflächen, die erforderlich sind",
    );
  });

  it("removes German low-high quotes", () => {
    expect(unquote("„Ein Satz“")).toBe("Ein Satz");
  });

  it("collapses the line breaks PDF extraction leaves mid-sentence", () => {
    expect(unquote("Ver- und\n  Entsorgung des\nBauwerks")).toBe(
      "Ver- und Entsorgung des Bauwerks",
    );
  });

  it("leaves a quotation mark that is part of the text", () => {
    expect(unquote('the so-called "smart" building')).toBe(
      'the so-called "smart" building',
    );
  });
});

describe("a source dragged out of the library", () => {
  it("finds the item behind the formatted reference", () => {
    // The plain flavour is prose — turning *that* back into a citation would
    // mean guessing. The HTML carries the item.
    const text =
      "DIN EN ISO 29481-1 IDM Bauwerksinformationsmodelle Handbuch der " +
      "Informationslieferungen, Jan. 2025.";
    const html = `<span class="citation" data-citation="${attribute({
      citationItems: [{ uris: [ITEM] }],
      properties: {},
    })}">(DIN, 2025)</span>`;

    const drop = readZoteroDrop(html, text);
    expect(drop).toEqual({
      kind: "citation",
      items: [{ itemKey: "ABCD1234", locator: null }],
    });
  });

  it("finds every item when several were dragged at once", () => {
    const html = `<span data-citation="${attribute({
      citationItems: [
        { uris: [ITEM] },
        { uris: ["http://zotero.org/users/12345/items/EFGH5678"] },
      ],
    })}">(DIN, 2025; ISO, 2016)</span>`;
    const drop = readZoteroDrop(html, "");
    expect(drop.kind).toBe("citation");
    expect(
      drop.kind === "citation" && drop.items.map((i) => i.itemKey),
    ).toEqual(["ABCD1234", "EFGH5678"]);
  });

  it("takes the first URI when an item is listed under several", () => {
    // Zotero names the same work by its URI in the user's own library and in
    // any group that also holds it. Either identifies it.
    const html = `<span data-citation="${attribute({
      citationItems: [
        { uris: [ITEM, "http://zotero.org/groups/1/items/OTHERKEY"] },
      ],
    })}">(DIN)</span>`;
    const drop = readZoteroDrop(html, "");
    expect(drop.kind === "citation" && drop.items).toHaveLength(1);
  });

  it("keeps the page a citation was dragged with", () => {
    const html = `<span data-citation="${attribute({
      citationItems: [{ uris: [ITEM], locator: "8", label: "page" }],
    })}">(DIN, S. 8)</span>`;
    const drop = readZoteroDrop(html, "");
    expect(drop.kind === "citation" && drop.items[0]?.locator).toBe("8");
  });
});

describe("a highlight dragged out of the reader", () => {
  /** The drag the user reported, as Zotero builds it. */
  const PASSAGE =
    "Grundflächen, die als Ergänzungsflächen zum Betrieb technischer " +
    "Anlagen zur Ver- und Entsorgung des Bauwerks unmittelbar erforderlich " +
    "sind (z. B. Lagerflächen";
  const html =
    `<p><span class="highlight" data-annotation="${attribute({
      attachmentURI: "http://zotero.org/users/12345/items/ATTACH01",
      annotationKey: "ANNOT001",
      color: "#ffd400",
      pageLabel: "8",
      citationItem: { uris: [ITEM], locator: "8" },
    })}">“${PASSAGE}”</span> ` +
    `<span class="citation" data-citation="${attribute({
      citationItems: [{ uris: [ITEM], locator: "8", label: "page" }],
    })}">(“DIN 277, Grundflächen und Rauminhalte im Hochbau”, p. 8)</span></p>`;

  it("reads the passage, the work and the page", () => {
    const drop = readZoteroDrop(html, "");
    expect(drop).toEqual({
      kind: "annotation",
      itemKey: "ABCD1234",
      annotationKey: "ANNOT001",
      text: PASSAGE,
      pageLabel: "8",
    });
  });

  it("cites the work rather than the PDF attached to it", () => {
    // `attachmentURI` names the file the mark is in; the citable thing is the
    // work, and citing the attachment would produce a key for a PDF.
    const drop = readZoteroDrop(html, "");
    expect(drop.kind === "annotation" && drop.itemKey).not.toBe("ATTACH01");
  });

  it("is a passage rather than a bare citation", () => {
    // A dragged highlight carries both attributes. Reading it as a citation
    // would throw away the words the reader marked, which are the point.
    expect(readZoteroDrop(html, "").kind).toBe("annotation");
  });

  it("falls back to the citation item inside the annotation", () => {
    // Some drags carry the annotation blob without a separate citation span.
    const alone = `<span data-annotation="${attribute({
      annotationKey: "ANNOT002",
      pageLabel: "12",
      citationItem: { uris: [ITEM] },
    })}">“Ein kurzer Satz.”</span>`;
    const drop = readZoteroDrop(alone, "");
    expect(drop.kind === "annotation" && drop.itemKey).toBe("ABCD1234");
    expect(drop.kind === "annotation" && drop.pageLabel).toBe("12");
  });

  it("still gives back the words when it cannot name the work", () => {
    // The passage is real even when the source is not identified, and losing
    // the author's quotation would be worse than leaving them to attribute it.
    const orphan = `<span data-annotation="${attribute({
      annotationKey: "ANNOT003",
    })}">“Ohne Quelle.”</span>`;
    const drop = readZoteroDrop(orphan, "");
    expect(drop).toEqual({
      kind: "annotation",
      itemKey: null,
      annotationKey: "ANNOT003",
      text: "Ohne Quelle.",
      pageLabel: null,
    });
  });
});

describe("a drag that carries no machine data", () => {
  it("gives back the plain text", () => {
    expect(readZoteroDrop("", "Some words from elsewhere.")).toEqual({
      kind: "text",
      text: "Some words from elsewhere.",
    });
  });

  it("gives back the rendered words when there is only HTML", () => {
    expect(readZoteroDrop("<p>Some <b>words</b>.</p>", "")).toEqual({
      kind: "text",
      text: "Some words.",
    });
  });

  it("does not mistake unreadable attributes for machine data", () => {
    // A payload that will not decode is a payload we decline. The drop still
    // has its text, and the caller falls back to that.
    const broken = '<span data-citation="%%%not-json%%%">(x)</span>';
    expect(readZoteroDrop(broken, "Fallback.")).toEqual({
      kind: "text",
      text: "Fallback.",
    });
  });

  it("does not mistake a citation with no usable URI for one", () => {
    const html = `<span data-citation="${attribute({
      citationItems: [{ uris: ["https://example.org/nope"] }],
    })}">(x)</span>`;
    expect(readZoteroDrop(html, "Fallback.").kind).toBe("text");
  });
});

/**
 * The drags that actually landed, reported verbatim.
 *
 * These are not constructed payloads — they are what a real Zotero put on the
 * clipboard on a real machine, and both of them fell through the attribute
 * reader and inserted their own prose. The reason is the Quick Copy setting:
 * with a Markdown format the machine data arrives as `zotero://` links rather
 * than as `data-citation` attributes.
 */
describe("a Markdown Quick Copy drag", () => {
  const SELECT = "zotero://select/groups/6292579/items/B8IM9SU5";
  const OPEN =
    "zotero://open-pdf/groups/6292579/items/4JUK7QZT?page=8&annotation=FARPUJ53";

  const PASSAGE =
    "Grundflächen, die als Ergänzungsflächen zum Betrieb technischer " +
    "Anlagen zur Ver- und Entsorgung des Bauwerks unmittelbar erforderlich " +
    "sind (z. B. Lagerflächen";

  /** Exactly what landed in the buffer. */
  const REPORTED =
    `“${PASSAGE}” ` +
    `([“DIN 277, Grundflächen und Rauminhalte im Hochbau”, p. 8](${SELECT})) ` +
    `([pdf](${OPEN}))`;

  it("finds every link in the markdown", () => {
    expect(zoteroLinks(REPORTED)).toEqual([SELECT, OPEN]);
  });

  it("takes the attribution links off the passage", () => {
    expect(withoutLinks(REPORTED)).toBe(`“${PASSAGE}”`);
  });

  it("reads the work, the mark and the page out of the links", () => {
    // The whole point: the prose is unusable and the links are not.
    expect(readZoteroDrop("", REPORTED)).toEqual({
      kind: "annotation",
      itemKey: "B8IM9SU5",
      annotationKey: "FARPUJ53",
      text: PASSAGE,
      pageLabel: "8",
    });
  });

  it("cites the work, not the PDF the mark is in", () => {
    // `select` names the work and `open-pdf` names the attachment. Reading
    // them the wrong way round would cite a copy of a document rather than the
    // document, and the citation would be for a PDF.
    const drop = readZoteroDrop("", REPORTED);
    expect(drop.kind === "annotation" && drop.itemKey).toBe("B8IM9SU5");
    expect(drop.kind === "annotation" && drop.itemKey).not.toBe("4JUK7QZT");
  });

  it("reads the same links out of the HTML flavour", () => {
    // The same Quick Copy also produces HTML, where the links are `href`s and
    // the passage is the rendered text rather than markdown.
    const html =
      `<p>“${PASSAGE}” ` +
      `(<a href="${SELECT}">“DIN 277…”, p. 8</a>) ` +
      `(<a href="${OPEN}">pdf</a>)</p>`;
    const drop = readZoteroDrop(html, "");
    expect(drop.kind).toBe("annotation");
    expect(drop.kind === "annotation" && drop.itemKey).toBe("B8IM9SU5");
    expect(drop.kind === "annotation" && drop.pageLabel).toBe("8");
    // And the quotation is words, not markup.
    expect(drop.kind === "annotation" && drop.text).toBe(PASSAGE);
  });

  it("reads a source dragged as a bare link", () => {
    expect(readZoteroDrop("", `[DIN 277](${SELECT})`)).toEqual({
      kind: "citation",
      items: [{ itemKey: "B8IM9SU5", locator: null }],
    });
  });

  it("prefers the attributes when a drag carries both shapes", () => {
    // A citation style gives a locator the style chose and the annotation's own
    // key; the links give neither. Where both are present the richer one wins.
    const html = `<span data-annotation="${attribute({
      annotationKey: "FROMBLOB",
      pageLabel: "99",
      citationItem: { uris: [ITEM] },
    })}">“Ein Satz.”</span> <a href="${SELECT}">x</a>`;
    const drop = readZoteroDrop(html, "");
    expect(drop.kind === "annotation" && drop.annotationKey).toBe("FROMBLOB");
    expect(drop.kind === "annotation" && drop.pageLabel).toBe("99");
  });

  it("declines a formatted reference that carries no link at all", () => {
    // The other drag that was reported. A numeric citation style produces a
    // bibliography entry and nothing machine-readable, so there is nothing to
    // resolve here — the plugin falls back to searching for it by title, and
    // only takes the answer if exactly one item matches.
    const reference =
      "[1] DIN EN ISO 29481-1 IDM Bauwerksinformationsmodelle Handbuch der " +
      "Informationslieferungen, Jan. 2025.";
    expect(readZoteroDrop("", reference)).toEqual({
      kind: "text",
      text: reference,
    });
  });
});

describe("reading a page out of a zotero:// link", () => {
  it("finds an item key before a query string", () => {
    expect(
      itemKeyFromUri(
        "zotero://open-pdf/groups/6292579/items/4JUK7QZT?page=8&annotation=FARPUJ53",
      ),
    ).toBe("4JUK7QZT");
  });

  it("finds an item key in a select link", () => {
    expect(
      itemKeyFromUri("zotero://select/groups/6292579/items/B8IM9SU5"),
    ).toBe("B8IM9SU5");
  });

  it("leaves text with no links alone", () => {
    expect(withoutLinks("Just some words.")).toBe("Just some words.");
    expect(zoteroLinks("Just some words.")).toEqual([]);
  });
});

/**
 * Turning a formatted reference back into something the library will match.
 *
 * The last resort, for a drag that carried no machine data at all — which is
 * what a numeric citation style produces, because its bibliography entry has
 * no link in it. The plugin only acts on the result when exactly one item
 * matches, so what matters here is that the query is the part that identifies
 * the work rather than the parts the style added.
 */
describe("searching for a source by its formatted reference", () => {
  it("drops the number a numeric style puts in front", () => {
    expect(
      searchable(
        "[1] DIN EN ISO 29481-1 IDM Bauwerksinformationsmodelle Handbuch der " +
          "Informationslieferungen, Jan. 2025.",
      ),
    ).toBe(
      "DIN EN ISO 29481-1 IDM Bauwerksinformationsmodelle Handbuch der " +
        "Informationslieferungen",
    );
  });

  it("drops a parenthesised marker too", () => {
    expect(searchable("(12) Ein Titel, 2020.")).toBe("Ein Titel");
  });

  it("drops the date a style appends", () => {
    expect(searchable("Grundflächen im Hochbau, Jan. 2025.")).toBe(
      "Grundflächen im Hochbau",
    );
    expect(searchable("Ein Titel, 2016")).toBe("Ein Titel");
  });

  it("leaves a title that has none of that alone", () => {
    expect(searchable("Building Information Modeling")).toBe(
      "Building Information Modeling",
    );
  });

  it("does not eat a title that ends in a number", () => {
    // `DIN 277` is the name of the standard, not a year, and cutting it would
    // turn a query that matches one item into one that matches a shelf.
    expect(searchable("DIN 277")).toBe("DIN 277");
  });
});
