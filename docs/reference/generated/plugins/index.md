<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# Official plugins

Six plugins ship with yaz. Each is its own repository under the
[texyaz](https://github.com/texyaz) organisation and its own release
([ADR-0021](/adr/0021-plugin-distribution)), and each uses only the public
`@yaz/api` — there is no privileged tier for a plugin because it happens to be
ours ([ADR-0005](/adr/0005-extensibility-tiers)).

That last point is the one worth dwelling on. Zotero support is a plugin, and it
is written against the same contract anybody else would use. If something here
cannot be done from outside, that is a hole in the API rather than a reason for
a back door.

| | Plugin | What it does |
| --- | --- | --- |
| ≡ | [Text formats](/reference/generated/plugins/formats) | Highlighting for the files a LaTeX project is full of that are not LaTeX: Markdown, TOML, YAML and BibTeX. |
| ∑ | [LaTeX packages](/reference/generated/plugins/latex-packages) | Preview support for what the common LaTeX packages add: glossaries, biblatex, csquotes, amsmath, hyperref and the rest. |
| ▣ | [Learn](/reference/generated/plugins/learn) | Capture any part of the application as a clean image or a short clip, for documenting how it works. |
| ◇ | [Obsidian](/reference/generated/plugins/obsidian) | Bring a note from your Obsidian vault into the document, translated to LaTeX. |
| ✓ | [Todoist](/reference/generated/plugins/todoist) | Keep a paper's task list in Todoist, and see it beside the writing. |
| ◉ | [Zotero](/reference/generated/plugins/zotero) | Cite from your Zotero library, and quote the passages you highlighted. |

These pages are assembled from each plugin's own `manifest.json` and
`README.md`. To change one, change it in the plugin's repository.
