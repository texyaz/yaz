# Deutsche Übersetzung. en-US.ftl ist die Quelle der Wahrheit für Nachrichten-
# schlüssel; fehlt hier einer, greift die Kette (de-AT → de-DE → en-US), statt
# den rohen Schlüssel anzuzeigen.
#
# Anrede: unpersönlich, wo es geht ("Ordner öffnen…"), sonst Sie-Form. Fachwörter
# aus dem LaTeX- und Zotero-Umfeld bleiben englisch, weil sie in der Praxis so
# heißen — "Preamble" wird zu "Präambel", "SyncTeX" bleibt SyncTeX.
#
# Siehe docs/adr/0011-localisation.md

## Anwendung

app-name = yaz
app-tagline = Aus Ideen und Quellen werden Aufsätze.

## Dateisystemfehler — Schlüssel aus yaz-core::Error::message_key()

error-fs-not-found = { $path } wurde nicht gefunden.
error-mcp-listen = Der Agenten-Server konnte nicht starten: { $detail }
error-plugin-manifest = In diesem Ordner liegt eine manifest.json, die nicht als Plugin gelesen werden konnte.
error-plugin-repository = Dieses Plugin nennt ein Repository, mit dem yaz nichts anfangen kann: { $detail }
error-plugin-update-check = Das Repository des Plugins war nicht erreichbar: { $detail }
error-fs-outside-root = { $path } liegt außerhalb von { $root }, worauf dieser Vorgang beschränkt ist.
error-fs-undecodable = { $path } ließ sich nicht als Text lesen. Möglicherweise ist es eine Binärdatei oder verwendet eine nicht unterstützte Kodierung.
error-fs-conflicting-write = { $path } wurde außerhalb von yaz geändert, seit Sie es geöffnet haben. Jetzt zu speichern würde diese Änderungen verwerfen.
error-fs-io = Beim Lesen oder Schreiben von { $path } ist etwas schiefgegangen.

## Übersetzung des Dokuments

compile-run = Übersetzen
compile-running = Wird übersetzt…
compile-succeeded = In { $seconds } s übersetzt.
compile-failed = Übersetzung fehlgeschlagen.
compile-diagnostics-count = { $count } Fehler
compile-diagnostics =
    { $count ->
        [one] 1 Problem
       *[other] { $count } Probleme
    }
compile-engine-unavailable = Dieses Projekt ist auf { $engine } eingestellt, was nicht installiert ist. Installieren Sie eine TeX-Distribution oder stellen Sie das Projekt auf die eingebaute Tectonic-Engine um.

## Engines

settings-engine = Engine
settings-engine-help = Wird in yaz.toml gespeichert, damit Mitautorinnen und Mitautoren genauso übersetzen wie Sie.
engine-tectonic-not-built = In dieser yaz-Fassung nicht enthalten. Sie muss einkompiliert werden — eine Einstellung kann sie nicht nachrüsten.
engine-system-not-installed = Auf diesem Rechner nicht installiert.
engine-unavailable-suffix = nicht verfügbar

## Zotero — Schlüssel aus yaz-zotero::ActiveSource::status_key()

zotero-source-better-bibtex = Zotero: über Better BibTeX verbunden
zotero-source-local-api = Zotero: verbunden
zotero-source-exported-bib = Zotero: offline — es wird eine exportierte .bib gelesen
zotero-source-sqlite = Zotero: offline — die Bibliotheksdatenbank wird gelesen
zotero-source-none = Zotero: nicht verfügbar
zotero-keys-generated = Die Zitationsschlüssel stammen von yaz, weil Better BibTeX nicht verfügbar ist. Sie können von denen Ihrer Mitautorinnen und Mitautoren abweichen.

## Plugin-Berechtigungen — Schlüssel aus
## yaz-plugin::Capability::description_key()

capability-fs-project-description = Dateien in diesem Projekt lesen und ändern.
capability-fs-read-description = Dateien an einem bestimmten Ort außerhalb dieses Projekts lesen.
capability-fs-write-description = Dateien an einem bestimmten Ort außerhalb dieses Projekts ändern.
capability-net-description = Ins Internet gehen, beschränkt auf { $hosts }.
capability-process-description = Programme auf Ihrem Rechner ausführen: { $binaries }.
capability-mcp-client-description = Mit den von Ihnen verbundenen Werkzeugen sprechen: { $servers }.
capability-zotero-description = Ihre Zotero-Bibliothek lesen.
capability-obsidian-description = Ihren Obsidian-Vault lesen.
capability-clipboard-description = Die Zwischenablage lesen und ändern.
capability-notifications-description = Systembenachrichtigungen anzeigen.
capability-shell-open-description = Links und Dateien mit Ihren anderen Anwendungen öffnen.
capability-credential-description = Eine Anmeldung für diesen Dienst im Schlüsselbund des Systems ablegen.

## Plugin-Verwaltung

plugin-install-title = { $name } installieren?
plugin-install-capabilities = Dieses Plugin verlangt:
plugin-install-unreviewed = Dieses Plugin wurde von niemandem geprüft. Installieren Sie nur Plugins von Anbietern, denen Sie vertrauen.
plugin-update-new-capabilities = { $name } verlangt Rechte, die es vorher nicht hatte. Prüfen Sie sie vor dem Aktualisieren.
plugin-error = { $name } funktioniert nicht mehr.
plugin-error-disable = { $name } deaktivieren

## Arbeitsbereich

workspace-open-project = Ordner öffnen…
workspace-no-project = Noch kein Ordner geöffnet.
workspace-no-files = Keine .tex-Dateien in diesem Ordner.
workspace-no-file-open = Wählen Sie eine Datei, um zu schreiben.
workspace-entry = Hauptdatei

## Editor

editor-mode-source = Quelltext
editor-mode-visual = Visuell
editor-vim-mode = Vim
editor-loading = Wird geöffnet…

## PDF

pdf-empty = Übersetzen Sie das Dokument, um es hier zu sehen.
pdf-showing = { $file } wird angezeigt – nicht das übersetzte Dokument

## Einstellungen

settings-appearance = Erscheinungsbild
settings-theme = Theme
settings-colour-mode = Farbmodus
settings-colour-mode-system = Wie das System
settings-colour-mode-light = Hell
settings-colour-mode-dark = Dunkel
settings-interface-locale = Sprache der Oberfläche
settings-document-locale = Sprache des Dokuments
settings-document-locale-help = Die Sprache, in der Sie schreiben. Unabhängig von der Oberfläche — sie steuert Rechtschreibprüfung, Silbentrennung und Anführungszeichen.
settings-check-for-updates = Nach Aktualisierungen suchen
settings-check-for-updates-help = Fragt bei GitHub nach, ob es eine neuere Fassung gibt.

## Auswahllisten

picker-placeholder = Tippen zum Filtern
picker-empty = Nichts anzuzeigen
picker-loading = Wird geladen…
picker-failed = Die Liste konnte nicht geladen werden

## Plugin-Laufzeit

plugin-error-not-loaded = Dieses Plugin ist nicht geladen.
capability-error-not-declared = Das Plugin hat dafür keine Erlaubnis verlangt.
capability-error-not-granted = Sie haben dem Plugin dafür keine Erlaubnis erteilt.
capability-error-out-of-scope = Das liegt außerhalb dessen, was das Plugin erreichen darf.

## Zotero — Befehle

zotero-command-cite = Aus Zotero zitieren
zotero-command-cite-description = Ihre Zotero-Bibliothek durchsuchen und eine Zitation einfügen.
zotero-command-quote = Markierte Stelle zitieren
zotero-command-quote-description = Eine in Zotero markierte Stelle samt Zitation einfügen.
zotero-command-reconnect = Erneut mit Zotero verbinden
zotero-command-reconnect-description = Erneut nach einem laufenden Zotero suchen und sonst auf die Bibliothek auf der Festplatte zurückfallen.

## Zotero — Auswahllisten

zotero-picker-source-title = Quelle wählen
zotero-picker-source-placeholder = Nach Titel oder Autorin suchen
zotero-picker-source-empty = Nichts in Ihrer Bibliothek passt dazu
zotero-picker-passage-title = Markierte Stelle wählen
zotero-picker-passage-placeholder = Stellen filtern
zotero-picker-passage-empty = Keine Stelle passt dazu
zotero-page-label = S. { $page }

## Zotero — Hinweise

zotero-notice-no-editor = Öffnen Sie zuerst ein Dokument.
zotero-notice-unavailable = Unter { $detail } wurde keine Zotero-Bibliothek gefunden.
zotero-notice-no-annotations = In dieser Quelle haben Sie nichts markiert.
zotero-notice-no-quotable-annotations = Diese Quelle enthält Markierungen, aber keine davon ist zitierbarer Text.
zotero-notice-generated-key = { $key } eingefügt. Dieser Schlüssel stammt von yaz und kann von dem Ihrer Mitautorinnen und Mitautoren abweichen.

## Zotero — Arten von Markierungen

zotero-annotation-highlight = Hervorhebung
zotero-annotation-note = Notiz
zotero-annotation-image = Bild
zotero-annotation-ink = Zeichnung
zotero-annotation-underline = Unterstreichung
zotero-annotation-other = Sonstiges

## Zotero — wo die Bibliothek gefunden wurde

zotero-datadir-configured = dem Ordner, den Sie gewählt haben
zotero-datadir-profile = dem Ordner, auf den Ihr Zotero-Profil zeigt
zotero-datadir-convention = dem üblichen Zotero-Ordner

## Zotero — Fehler

zotero-error-no-library = Es wurde keine Zotero-Bibliothek gefunden.
zotero-error-unsupported-schema = Diese Zotero-Bibliothek stammt von einem neueren Zotero, als yaz versteht, und wurde deshalb nicht gelesen.
zotero-error-unsupported-journal = Diese Zotero-Bibliothek legt die letzten Änderungen getrennt ab; yaz hätte nur einen veralteten Stand gelesen.
zotero-error-not-running = Zotero läuft nicht.
zotero-error-cannot-launch = Zotero konnte nicht gestartet werden. Möglicherweise ist es nicht dort installiert, wo yaz gesucht hat.
zotero-error-unexpected-response = Zotero hat auf eine Weise geantwortet, die yaz nicht versteht.
zotero-error-http = Zotero war nicht erreichbar.
zotero-error-database = Ihre Zotero-Bibliothek ließ sich nicht lesen.
zotero-error-io = Eine Datei ließ sich nicht lesen oder schreiben.
zotero-error-item-not-found = Dieser Eintrag ist nicht mehr in Ihrer Zotero-Bibliothek.

## Zotero — die laufende Verbindung

zotero-live-available = Mit Zotero verbunden
zotero-live-not-running = Zotero läuft nicht
zotero-live-api-disabled = Zotero läuft, aber seine lokale Schnittstelle ist ausgeschaltet
zotero-live-api-disabled-help = Schalten Sie in Zoteros erweiterten Einstellungen „Anderen Anwendungen auf diesem Computer erlauben, mit Zotero zu kommunizieren“ ein, um die Bibliothek live zu lesen.
zotero-live-unexpected = Zotero hat unerwartet geantwortet
zotero-demoted = Die Live-Verbindung ist ausgefallen; die Bibliothek wird aus einer Kopie auf der Festplatte gelesen.

## Menüleiste

menu-file = Datei
menu-edit = Bearbeiten
menu-view = Ansicht
menu-tools = Werkzeuge
menu-help = Hilfe

menu-file-open-folder = Ordner öffnen…
menu-file-save = Speichern
menu-file-compile = Übersetzen
menu-file-close-project = Projekt schließen
menu-edit-undo = Rückgängig
menu-edit-redo = Wiederherstellen
menu-edit-find = Suchen…
menu-view-vim = Vim-Tasten
menu-view-connections = Verbindungen
menu-tools-engine = Satz-Engine
menu-help-documentation = Dokumentation
menu-help-report-issue = Problem melden
menu-help-about = Über yaz
menu-not-implemented = Das ist noch nicht gebaut.

## Verbindungen

connections-title = Verbindungen
connections-none = Es ist noch nichts eingerichtet.
connections-reconnect = Neu verbinden
connections-zotero = Zotero
connections-obsidian = Obsidian
connections-not-configured = Nicht eingerichtet
connections-reading-offline = Es wird eine Kopie der Bibliothek von der Festplatte gelesen
connections-source = Quelle: { $source }

## Fensterschaltflächen

window-minimise = Minimieren
window-maximise = Maximieren
window-restore = Wiederherstellen
window-close = Schließen

## Einstellungen

settings-title = Einstellungen
settings-section-general = Allgemein
settings-section-engine = Satz
settings-section-connections = Verbindungen
settings-group-editor = Editor
settings-group-typesetting = Engine
settings-vim-help = Modales Bearbeiten, im Quelltext wie in der visuellen Ansicht.
settings-engine-no-project = Öffnen Sie ein Projekt, um seine Engine zu wählen. Die Wahl wird pro Projekt gespeichert.

## Verbindungen, Fortsetzung

connections-unknown = Noch nicht verbunden
connections-connect-zotero = Mit Zotero verbinden
connections-reconnect-zotero = Erneut mit Zotero verbinden
menu-tools-connections = Verbindungen
menu-edit-settings = Einstellungen…

## Arbeitsbereich

workspace-close-tab = Reiter schließen
workspace-tab-editor = Quelltext
workspace-tab-pdf = PDF
menu-view-tabs = Reiter
menu-view-reset-layout = Anordnung zurücksetzen

## Menü „Datei“, Fortsetzung

menu-file-open-recent = Zuletzt geöffnet
menu-file-no-recent = Keine zuletzt geöffneten Projekte
compile-start = Übersetzen

## Versionsverwaltung

vcs-title = Versionsverlauf
vcs-enable = Versionen aufzeichnen
vcs-disable = Versionen nicht mehr aufzeichnen
vcs-recording = Versionen werden aufgezeichnet
vcs-not-recording = Versionen werden nicht aufgezeichnet
vcs-unavailable = Auf diesem Rechner ist keine Versionsverwaltung verfügbar
vcs-backend-git = Git
vcs-backend-builtin = In yaz eingebaut (noch nicht fertig)
vcs-settings-backend = Aufzeichnung mit
vcs-settings-backend-help = Git nutzt Ihr eigenes Repository, sodass Branches, Remotes und Hooks weiter funktionieren. Die Versionsverwaltung auszuschalten löscht nie etwas.
vcs-commit-with-message = Version mit eigener Beschreibung speichern…
vcs-commit-placeholder = Was sich geändert hat, und warum
vcs-commit-title = Version speichern
vcs-commit-hint = Lassen Sie das Feld leer, dann beschreibt yaz die Änderungen für Sie.
vcs-committed = Version { $id } gespeichert
vcs-nothing-to-commit = Seit der letzten Version hat sich nichts geändert.
vcs-restore = Diese Version wiederherstellen
vcs-restored = { $id } wiederhergestellt. Speichern Sie eine Version, um sie zu behalten.
vcs-empty = Noch keine Versionen aufgezeichnet.
vcs-uncommitted = Sie haben ungespeicherte Änderungen.
vcs-off-explains = Schalten Sie die Versionsverwaltung ein, um einen Verlauf dieses Projekts zu behalten.
vcs-error-unavailable = Diese Versionsverwaltung ist nicht installiert.
vcs-error-not-initialised = Dieses Projekt steht nicht unter Versionsverwaltung.
vcs-error-would-lose-changes = Speichern Sie zuerst eine Version — das Wiederherstellen würde Änderungen überschreiben, die nirgends aufgezeichnet sind.
vcs-error-not-implemented = Diese Versionsverwaltung ist noch nicht gebaut.
vcs-error-tool = Die Versionsverwaltung hat ein Problem gemeldet.
vcs-error-io = Eine Datei ließ sich nicht lesen oder schreiben.
vcs-error-unknown-backend = Unbekannte Versionsverwaltung.
workspace-tab-history = Verlauf

## Formatierte Ansicht und Gliederung

menu-view-rich-text = Vorschau
workspace-tab-outline = Gliederung
workspace-tab-search = Suche
search-empty = Tippen Sie in das Suchfeld, um etwas zu finden.
search-none = Nichts passt zu „{ $query }".
search-found = { $count } in { $files } Datei(en)
search-working = wird noch gelesen …
search-capped = nur die ersten Treffer
search-match-case = Groß-/Kleinschreibung beachten
search-whole-word = Nur ganzes Wort
search-regex = Regulärer Ausdruck
search-replace = Ersetzen
search-replace-toggle = Ersetzen
search-replace-one = Diesen ersetzen
search-replace-all = Alle in dieser Datei ersetzen
search-replaced = { $count } ersetzt
outline-empty = Noch keine Überschriften. Fügen Sie ein \section ein, um die Gliederung zu sehen.
outline-untitled = Abschnitt ohne Titel

## Die Marken, die den Text einfassen

editor-text-start = Anfang des Textes
editor-text-end = Ende des Textes
editor-wrapper-show = Das LaTeX um den Text zeigen
editor-wrapper-hide = Das LaTeX um den Text verbergen

## Ansichten und Zeilennummern

view-mode-rich = Vorschau
view-mode-source = Quelltext
view-mode-show-rich = Das Dokument so zeigen, wie es gelesen wird
view-mode-show-source = Den Quelltext zeigen
menu-view-line-numbers = Zeilennummern
menu-view-line-numbers-off = Keine
menu-view-line-numbers-absolute = Absolut
menu-view-line-numbers-relative = Relativ

## Die Dateiliste

menu-view-files = Dateiliste
files-pin = Dateiliste offen halten
files-unpin = Dateiliste einklappen lassen

## Vom PDF zurück in den Quelltext

synctex-outside-project = Das stammt aus { $path } und liegt außerhalb dieses Projekts.

## Erscheinungsbild

settings-theme-help = Ein Theme bringt Hell und Dunkel mit.
settings-interface-locale-help = Die Sprache des Dokuments selbst ist eine Projekteinstellung und wird getrennt gesetzt.
settings-appearance-build = Theme bauen
settings-appearance-build-help = Vom aktuellen Theme ausgehen und ändern, was Ihnen gefällt.
settings-appearance-build-open = Theme bauen…
settings-appearance-install = Theme installieren…
theme-error-manifest = Dieser Ordner enthält kein Theme.
theme-error-modes = Ein Theme muss Hell und Dunkel mitbringen.
theme-installed = { $name } installiert.
theme-exported = Nach { $path } geschrieben.

## Der Theme-Baukasten

theme-builder-title = Theme-Baukasten
theme-builder-name = Name
theme-builder-author = Autorin oder Autor
theme-builder-mode-light = Hell
theme-builder-mode-dark = Dunkel
theme-builder-editing = Sie bearbeiten die { $mode }-Palette. Das Fenster zeigt sie mit.
theme-builder-apply = Dieses Theme verwenden
theme-builder-export = Exportieren…
theme-builder-reset = Von vorn anfangen
theme-builder-close = Schließen
theme-group-surfaces = Flächen
theme-group-text = Text
theme-group-accent = Akzent
theme-group-state = Zustände
theme-group-borders = Ränder
theme-group-editor = Editor
theme-group-syntax = Syntaxhervorhebung
theme-group-pdf = PDF-Ansicht
theme-token-bg-primary = Hintergrund
theme-token-bg-secondary = Bereiche
theme-token-bg-tertiary = Erhöhte Flächen
theme-token-bg-overlay = Dialoge
theme-token-text-primary = Text
theme-token-text-secondary = Nebentext
theme-token-text-muted = Gedämpfter Text
theme-token-accent = Akzent
theme-token-accent-hover = Akzent, überfahren
theme-token-text-on-accent = Text auf Akzent
theme-token-success = Erfolg
theme-token-warning = Warnung
theme-token-error = Fehler
theme-token-border = Ränder
theme-token-border-strong = Kräftige Ränder
theme-token-editor-bg = Editor-Hintergrund
theme-token-editor-gutter-bg = Randspalte
theme-token-editor-cursor = Schreibmarke
theme-token-syntax-command = Befehle
theme-token-syntax-environment = Umgebungen
theme-token-syntax-math = Mathematik
theme-token-syntax-comment = Kommentare
theme-token-syntax-string = Zeichenketten
theme-token-syntax-reference = Verweise
theme-token-pdf-bg = Fläche um die Seite

## Formatierung

format-bold = Fett
format-italic = Kursiv
format-underline = Unterstrichen
format-monospace = Feste Breite
format-small-caps = Kapitälchen
format-quote = Zitat
format-heading-1 = Überschrift 1
format-heading-2 = Überschrift 2
format-heading-3 = Überschrift 3
format-clear = Formatierung entfernen
format-bar = Formatierung
format-family = Schrift
format-family-default = Schrift des Dokuments
format-family-textrm = Serif
format-family-textsf = Serifenlos
format-family-texttt = Schreibmaschine
format-size = Größe
format-size-default = Größe des Dokuments
format-size-tiny = Winzig
format-size-scriptsize = Sehr klein
format-size-footnotesize = Fußnote
format-size-small = Klein
format-size-normalsize = Normal
format-size-large = Groß
format-size-Large = Größer
format-size-LARGE = Sehr groß
format-size-huge = Riesig
format-size-Huge = Am größten
format-colour = Textfarbe
format-colour-none = Keine Farbe
format-colour-black = Schwarz
format-colour-red = Rot
format-colour-blue = Blau
format-colour-green = Grün
format-colour-orange = Orange
format-colour-violet = Violett
format-colour-brown = Braun
format-colour-gray = Grau
format-package-added = \usepackage{{ $package }} in { $file } ergänzt
paste-image-saved = Bild als { $file } gespeichert
paste-image-no-project = Zuerst ein Projekt öffnen — ein eingefügtes Bild wird darin gespeichert.
ribbon-font = Schrift
ribbon-paragraph = Absatz
titlebar-project-menu = Projekt

## Tastatur

settings-section-keys = Tastatur
keys-suites = Gruppen
keys-suite-core = Grundlegendes
keys-suite-core-help = Speichern, Suchen, Vervollständigen. Lässt sich nicht abschalten.
keys-suite-yaz = yaz
keys-suite-yaz-help = Alles hinter Strg+Leertaste: Ansichten, Übersetzen, Versionen.
keys-suite-word = Word
keys-suite-word-help = Was man aus einer Textverarbeitung schon kennt.
keys-suite-lists = Listen
keys-suite-lists-help = Eingabe beginnt den nächsten Punkt, Tab macht einen Unterpunkt daraus.
keys-list-continue = Nächster Listenpunkt
keys-list-indent = Zum Unterpunkt machen
keys-list-outdent = Eine Ebene herausheben
keys-complete = Vervollständigung vorschlagen
keys-press = Tasten drücken…
keys-unbound = Nicht belegt
keys-reset = Zurücksetzen
keys-conflict = Ein anderes Tastenkürzel belegt diese Tasten.
menu-view-cycle = Nächste Ansicht
menu-view-plain = Einfach
menu-view-continuous = Fortlaufend
menu-view-page = Seite

## Weitere Überschriftenfarben

theme-group-headings = Überschriften
theme-token-heading-0 = Teil
theme-token-heading-1 = Kapitel
theme-token-heading-2 = Abschnitt
theme-token-heading-3 = Unterabschnitt
theme-token-heading-4 = Unter-Unterabschnitt

## Das Menüband

ribbon-title = Menüband
ribbon-layout = Layout
ribbon-document = Dokument
ribbon-work = Arbeit
ribbon-page-setup = Seite einrichten
ribbon-paper = Format
ribbon-orientation = Ausrichtung
orientation-portrait = Hochformat
orientation-landscape = Querformat
ribbon-view = Ansicht
ribbon-vertical = An der Seite
ribbon-title-block = Titelei
ribbon-doc-title = Titel
ribbon-doc-author = Autorin oder Autor
ribbon-doc-date = Datum
ribbon-doc-date-today = Heute

paper-a4paper = A4
paper-a5paper = A5
paper-letterpaper = Letter
paper-legalpaper = Legal
paper-b5paper = B5

language-english = Englisch
language-german = Deutsch
language-french = Französisch
language-spanish = Spanisch
language-italian = Italienisch

## Die Titelleiste

titlebar-autosave-on = Speichert von selbst
titlebar-autosave-off = Von selbst speichern
titlebar-search = Suchen
titlebar-account = Konto

## Die Statusleiste

status-page = Seite { $page } von { $pages }
status-words = { $words } Wörter (geschätzt)
status-zoom = Zoom
status-zoom-set = Zoomstufe festlegen
status-view = Textsatz
status-language-unset = Keine Sprache gesetzt

menu-view-wrap = Lange Zeilen umbrechen
menu-view-comments = Kommentare
menu-view-line-breaks = Explizite Zeilenumbrüche
menu-view-machinery = Dokument-Innereien
menu-view-lock-tables = Tabellen gezeichnet lassen
menu-view-paper = Weißes Papier

## Befehlsgruppen im Menüband

group-project = Projekt
group-document = Dokument
group-history = Verlauf
group-find = Suchen
group-preferences = Einstellungen
group-views = Ansichten
group-panes = Bereiche
group-editing = Bearbeiten
group-connections = Verbindungen
group-versions = Versionen
group-capture = Aufnehmen
group-learn = Lernen
group-about = Über

## Das neu geordnete Menüband

ribbon-start = Start
ribbon-connections = Verbindungen
connections-zotero-group = Zotero
connections-obsidian-group = Obsidian

date-today = Der Tag der Übersetzung
date-on = Ein bestimmter Tag
date-none = Kein Datum

compile-clean = Von Grund auf übersetzen
compile-choose-engine = Übersetzen mit…
compile-open-log = Protokoll öffnen

ribbon-compact = Schmales Menüband

## Die Dateiliste

files-show-hidden = Versteckte Ordner
files-show-other = Andere Dateitypen
files-show-build = Build-Dateien
files-dim-build = Build-Dateien dämpfen
files-expand = { $name } öffnen
files-collapse = { $name } schließen
group-files = Dateien

## Ein Dokument bearbeiten, das aus mehreren Dateien besteht

menu-view-joined = Verbundenes Dokument
joined-entered = { $count } Dateien werden als ein Dokument bearbeitet. Beim Speichern wird jede davon geschrieben.
joined-missing = { $count } Dateien werden als ein Dokument bearbeitet. Diese konnten nicht gelesen werden und stehen weiterhin als Befehl im Text: { $missing }
joined-refused = Diese Änderung reicht von einer Datei in die nächste – es gibt keine eine Datei, in die sie gehört. Bitte innerhalb einer Datei bearbeiten.
joined-left = { $file } gehört nicht zum Dokument, die verbundene Ansicht ist daher aus.
joined-save-failed = { $file } konnte nicht gespeichert werden: { $error }
joined-unexpanded = Nicht eingefügt, nicht lesbar: { $missing }
joined-drifted = Das verbundene Dokument passt nicht mehr zu seinen Dateien, Änderungen werden nicht geschrieben. Verbundene Ansicht ausschalten, um wieder einzelne Dateien zu bearbeiten.

## Erzeugte Verzeichnisse, aus dem Dokument selbst

listing-contents = Inhalt
listing-figures = Abbildungen
listing-tables = Tabellen
listing-glossary = Glossar
listing-bibliography = Literatur
listing-index = Index
listing-compiled = Wird beim Übersetzen erzeugt.
listing-open-contents = Inhalt in der Gliederung anzeigen
listing-open-figures = Abbildungen anzeigen
listing-open-tables = Tabellen anzeigen
listing-open-glossary = Glossar anzeigen
listing-open-bibliography = Literatur anzeigen
listing-open-index = Index anzeigen
pagebreak-clearpage = Seitenumbruch
pagebreak-cleardoublepage = Seitenumbruch, auf eine rechte Seite
pagebreak-newpage = Seitenumbruch
pagebreak-pagebreak = Seitenumbruch

## Verweise, Zitate und Glossareinträge, als das dargestellt, was sie bedeuten

reference-kind-heading = Abschnitt
reference-kind-figure = Abbildung
reference-kind-table = Tabelle
reference-kind-equation = Gleichung
reference-kind-unknown = Verweis
reference-undefined = In diesem Dokument ist nichts mit { $key } bezeichnet.
citation-unknown = { $key } steht nicht in der eingelesenen Literaturliste.
glossary-unknown = { $key } ist im Glossar nicht definiert.
heading-label = Bezeichnet mit { $label }
figure-caption-figure = Abbildung { $number }
figure-caption-table = Tabelle { $number }

## Textformate

settings-section-formats = Formate
settings-group-formats = Textformate
settings-formats-help = Jede Textdatei öffnet sich mit Zeilennummern, Umbruch, Vim und Suche. Ein Format ergänzt Hervorhebung und eigene Hilfen; wird eines abgeschaltet, bleibt der einfache Editor – nicht nichts.
format-latex = LaTeX
format-markdown = Markdown
format-toml = TOML
format-yaml = YAML
format-bibtex = BibTeX
format-text = Nur Text

## Das Obsidian-Plugin

obsidian-command-insert-note = Notiz aus dem Vault einfügen
obsidian-pick-note = Notiz auswählen
obsidian-pick-note-filter = Vault durchsuchen…
obsidian-no-notes = Keine Notizen gefunden. Den Vault-Ort unter Verbindungen prüfen.

## Das Learn-Plugin

learn-command-capture = Element als Bild aufnehmen
learn-command-clip = Element als Clip aufnehmen
learn-pick-name = Aufnahme benennen
learn-capturing = Wird aufgenommen…
learn-captured = Gespeichert unter { $path }
learn-failed = Aufnahme fehlgeschlagen: { $error }

# Reading a value out of settings, and choosing a directory.
copy-action = Kopieren
copy-done = Kopiert
copy-show = Anzeigen
copy-hide = Verbergen
path-choose = Auswählen…
path-clear = Löschen

# Der Plugin-Bereich: Installiertes, Entwicklung und MCP.
settings-section-plugins = Plugins
plugins-installed = Installiert
plugins-none = Es sind keine Plugins geladen.
plugins-update-label = Aktualisierungen
plugins-update-action = Nach Aktualisierungen suchen
plugins-update-checking = Wird gesucht…
plugins-update-help = Jedes Plugin nennt selbst, woher seine Veröffentlichungen kommen. Dort fragt yaz nach.
plugins-update-none = Dieses Plugin nimmt keine Aktualisierungen an.
plugins-update-current = Aktuell mit { $version }.
plugins-update-available = Version { $version } ist verfügbar.
plugins-update-unknown = Keine Veröffentlichung gefunden.
plugins-update-unreachable = Das Repository war nicht erreichbar.
plugins-development = Entwicklung
plugins-development-directory = Plugin-Verzeichnis
plugins-development-none = Nichts ausgewählt
plugins-development-help = Ein Plugin, an dem Sie arbeiten — von der Festplatte geladen statt aus einer Veröffentlichung.
mcp-title = Model Context Protocol
mcp-enabled = Einen Agenten yaz steuern lassen
mcp-enabled-help = Hört nur auf diesem Rechner, und nur auf Clients, die das Token senden.
mcp-address = Adresse
mcp-address-help = Tragen Sie dies in die MCP-Konfiguration Ihres Agenten ein.
mcp-token = Token
mcp-token-help = Die gesamte Authentifizierung. Behandeln Sie es wie ein Passwort.
mcp-not-running = Läuft nicht
mcp-tools = { $count } Werkzeuge sind erreichbar.

# Changing a table's shape from the preview.
table-column-add = Spalte dahinter einfügen
table-column-remove = Diese Spalte entfernen
table-column-width = Ziehen, um die Spaltenbreite zu setzen
table-row-add = Zeile darunter einfügen
table-row-remove = Diese Zeile entfernen
table-row-height = Ziehen, um den Abstand nach dieser Zeile zu setzen
table-cell-in-source = Diese Zelle enthält Markup; im Quelltext bearbeiten
table-menu = Tabellenaktionen
table-row-above = Zeile darüber einfügen
table-row-below = Zeile darunter einfügen
table-column-left = Spalte links einfügen
table-column-right = Spalte rechts einfügen
table-clear-cell = Diese Zelle leeren
table-remove = Tabelle löschen

## Das Glossar-Tab des LaTeX-Pakete-Plugins.

latex-packages-glossary-title = Glossar
latex-packages-glossary-empty = Dieses Dokument definiert keine Glossareinträge.
latex-packages-glossary-no-document = Ein Dokument öffnen, um sein Glossar zu sehen.
zotero-notice-drop-unresolved = Ohne Quelle zitiert: Der Drag hat nicht mitgeteilt, aus welchem Eintrag er stammt.

## Verbindung zu Zotero, wenn es nicht läuft.

zotero-connect-title = Zotero läuft nicht
zotero-connect-launch = Zotero starten
zotero-connect-launch-detail = Das Zotero auf diesem Rechner öffnen und dann verbinden.
zotero-connect-online = Bibliothek auf zotero.org verwenden
zotero-connect-online-detail = Noch nicht gebaut — siehe Roadmap des Plugins.
zotero-connect-offline = Weiter aus der lokalen Kopie lesen
zotero-connect-offline-detail = Antwortet derzeit aus { $source }.
zotero-notice-online-later = Die Bibliothek von zotero.org zu lesen ist geplant, aber noch nicht gebaut. Solange antwortet die lokale Kopie.
zotero-notice-launching = Zotero wird gestartet…
zotero-notice-launch-failed = Zotero konnte nicht gestartet werden.
zotero-notice-launch-slow = Zotero startet noch. Nach dem Start erneut verbinden.

## Zitat reparieren, dessen Schlüssel keine Literaturdatei kennt.

bib-fix-title = Dieses Zitat lässt sich nicht auflösen
bib-fix-key = \cite{ "{" }{ $key }{ "}" }
bib-fix-cancel = So lassen
bib-fix-undeclared = Dieses Dokument lädt überhaupt keine Literaturdatei, deshalb kann kein Zitat darin aufgelöst werden.
bib-fix-missing = Dieses Dokument lädt { $file }, was im Projekt nicht vorhanden ist.
bib-fix-absent = { $file } wird geladen und ist vorhanden; dieser Schlüssel steht nur nicht darin.
bib-fix-absent-detail = Die Quelle aus Zotero zitieren oder den Eintrag von Hand ergänzen.
bib-fix-use = Stattdessen { $file } laden
bib-fix-use-detail = Richtet \addbibresource des Dokuments auf diese Datei.
bib-fix-create = { $file } anlegen
bib-fix-create-declared-detail = Legt die leere Datei an, die das Dokument bereits verlangt.
bib-fix-create-detail = Legt die Datei an und ergänzt das passende \addbibresource.
bib-fix-created = { $file } angelegt und das Dokument darauf ausgerichtet.
bib-fix-declared-in = In { $file } eingetragen, wo die Präambel steht.

## Das Zitate-Tab.

workspace-tab-citations = Zitate
citations-empty = Diese Datei zitiert noch nichts.
citations-unresolved = { $count } davon lassen sich nicht auflösen. Zum Nachsehen anklicken.
citations-no-bibliography = Es ist keine Literaturdatei geladen, deshalb kann nichts aufgelöst werden.
citations-not-in-bibliography = Nicht in der Literaturdatei.
citations-uses = { $count }-mal zitiert.

## Einstellungen des Zotero-Plugins.

zotero-settings-title = Zotero
zotero-settings-key-scheme = Benennung neuer Einträge
zotero-settings-key-scheme-detail = Unabhängig von der Wahl hält der Eintrag fest, welcher Zotero-Eintrag er ist — eine Quelle wird also nie doppelt geschrieben, auch nicht nach dem Umbenennen des Schlüssels.
zotero-settings-saved = Gespeichert.
zotero-key-scheme-readable = Lesbarer Schlüssel
zotero-key-scheme-readable-detail = meister2021building — im Quelltext lesbar, stimmt aber nicht zwingend mit dem von Mitautoren überein.
zotero-key-scheme-item-key = Zotero-Eintragsschlüssel
zotero-key-scheme-item-key-detail = B8IM9SU5 — kollidiert nie und muss nie umbenannt werden, sagt Lesenden aber nichts.
zotero-key-scheme-better-bibtex = Better-BibTeX-Schlüssel
zotero-key-scheme-better-bibtex-detail = Stimmt exakt mit dem von Mitautoren überein. Benötigt Zotero mit Better BibTeX; sonst wird ein lesbarer Schlüssel verwendet.
zotero-command-refresh = Literaturdatei aus Zotero aktualisieren
zotero-command-refresh-description = Jeden von yaz angelegten Eintrag mit dem aktuellen Stand aus Zotero überschreiben.
zotero-notice-refreshed = { $count } Einträge aus Zotero aktualisiert.
zotero-notice-refresh-missing = { $count } Einträge aktualisiert. In Zotero nicht gefunden und unverändert gelassen: { $keys }
zotero-notice-refresh-failed = Die Literaturdatei konnte nicht aktualisiert werden.
zotero-settings-fields = Inhalt eines Eintrags
zotero-settings-fields-detail = biber ignoriert Felder, die der Stil nicht druckt — mehr zu schreiben ist also unbedenklich, weniger kann dazu führen, dass beim Stilwechsel der Verlag fehlt.
zotero-fields-publication = Verlag, Ort, Auflage
zotero-fields-publication-detail = Woran ein Buch oder ein Bericht zu erkennen ist.
zotero-fields-location = Band, Heft, Seiten
zotero-fields-location-detail = Wo ein Aufsatz innerhalb seines Mediums steht.
zotero-fields-identifiers = DOI, ISBN, URL
zotero-fields-identifiers-detail = Wie das Werk wiederzufinden ist.
zotero-fields-summary = Abstract
zotero-fields-summary-detail = Ein Absatz je Eintrag, den kaum ein Stil druckt.
zotero-settings-comments = Eigene Notiz zu einer Markierung
zotero-settings-comments-detail = Eine in Zotero geschriebene Notiz sind eigene Worte, nicht die der Quelle — sie gehört also nie ins Zitat. Hier steht, was stattdessen damit geschieht.
zotero-comments-ignore = Weglassen
zotero-comments-ignore-detail = Das Zitat bleibt das Zitat. Die Notiz bleibt in Zotero.
zotero-comments-text = Hinter das Zitat setzen
zotero-comments-text-detail = Ein Ausgangspunkt zum Schreiben. Bleibt sie stehen, wird sie gedruckt.
zotero-comments-comment = Als LaTeX-Kommentar stehen lassen
zotero-comments-comment-detail = Beim Schreiben sichtbar, nie gedruckt, beim Löschen weg.

## Kommunikation mit einem Dienst im Auftrag eines Plugins.

error-project-settings = Die Einstellungen dieses Projekts konnten nicht gelesen oder geschrieben werden.
error-keychain = Der Schlüsselbund des Systems war nicht erreichbar.
error-no-credential = Für diesen Dienst ist keine Anmeldung hinterlegt.
error-invalid-url = Diese Adresse war nicht lesbar.
error-http-client = Es konnte kein Netzwerk-Client erstellt werden.
error-http = Der Dienst war nicht erreichbar.
error-http-status = Der Dienst hat die Anfrage abgelehnt.

## Das Aufgaben-Tab.

workspace-tab-tasks = Aufgaben
tasks-no-provider = Es ist keine Aufgabenliste verbunden. Ein To-do-Plugin installieren und unter Einstellungen → Plugins anmelden.
tasks-not-linked = Diese Arbeit ist noch mit keiner Aufgabenliste verknüpft.
tasks-link = Liste wählen
tasks-refresh = Aktualisieren
tasks-empty = Nichts mehr zu tun.
tasks-add = Hinzufügen
tasks-add-placeholder = Was ist zu tun?
tasks-link-title = Welche Liste gehört zu dieser Arbeit?
tasks-link-placeholder = Filtern oder einen Namen für eine neue Liste eingeben
tasks-link-empty = Noch keine Listen.
tasks-link-new = „{ $name }" anlegen
workspace-no-project-open = Ein Projekt öffnen, um seine Aufgaben zu sehen.

## Das Todoist-Plugin.

todoist-name = Todoist
todoist-settings-title = Todoist
todoist-signed-in = Bei Todoist angemeldet.
todoist-signed-out = Nicht angemeldet.
todoist-sign-in = Anmelden
todoist-sign-in-failed = Dieses Token konnte nicht gespeichert werden.
todoist-token-refused = Das Token wurde gespeichert, aber die Anfrage schlug fehl: { $reason }
todoist-token-placeholder = Persönliches API-Token
todoist-token-where = Ein persönliches API-Token unter { $page } kopieren und hier einfügen. Es wird im Schlüsselbund des Systems abgelegt und von yaz nie wieder angezeigt.
todoist-forget = Token vergessen
todoist-forgotten = Auf diesem Rechner vergessen.
todoist-revoke-elsewhere = Vergessen ist kein Widerrufen. Dafür das Token in den Einstellungen von Todoist löschen.
todoist-command-add = Auswahl zu Todoist hinzufügen
todoist-command-add-description = Aus dem markierten Text eine Aufgabe auf der Liste dieser Arbeit machen.
todoist-notice-nothing-selected = Zuerst den Text markieren, aus dem eine Aufgabe werden soll.
todoist-notice-not-linked = Diese Arbeit zuerst im Aufgaben-Tab mit einer Todoist-Liste verknüpfen.
todoist-notice-added = Zu Todoist hinzugefügt.
todoist-notice-failed = Todoist hat diese Aufgabe nicht angenommen.

## Das Detail-Tab.

workspace-tab-details = Details
details-empty = Ein Zitat, eine Aufgabe oder einen Glossareintrag anklicken, um zu sehen, worum es sich handelt.
details-kind-citation = Zitat
details-kind-task = Aufgabe
details-citation-key = Schlüssel
details-citation-uses = Zitiert
details-citation-fix = Warum lässt sich das nicht auflösen?
details-task-due = Fällig
details-task-priority = Priorität
details-task-created = Erstellt
details-rename = Umbenennen
details-pick-date = Datum wählen
details-task-description = Beschreibung
details-task-description-empty = Noch nichts geschrieben
details-task-due-empty = Kein Datum
details-task-section = Abschnitt
details-task-section-none = Kein Abschnitt
details-task-priority-1 = Dringend
details-task-priority-2 = Hoch
details-task-priority-3 = Mittel
details-task-priority-4 = Normal
latex-packages-glossary-detail-kind = Glossareintrag
latex-packages-glossary-detail-key = Schlüssel
latex-packages-glossary-detail-meaning = Bedeutet
connections-tasks-sign-in-first = Zuerst unter Einstellungen → Plugins bei Todoist anmelden.
connections-tasks-link = Liste dieser Arbeit wählen
connections-tasks-relink = Liste dieser Arbeit wechseln
settings-installed-plugins = Installierte Plugins
plugins-installed-count = { $count } installiert. Jedes hat unten einen eigenen Abschnitt.
plugins-about = Über
plugins-version = Version
plugins-version-value = { $version }

## Die Befehlspalette.

palette-title = Befehl ausführen
palette-placeholder = Zum Filtern tippen
palette-empty = Nichts gefunden.
insert-table = Einfügen: Tabelle
insert-figure = Einfügen: Abbildung
insert-equation = Einfügen: Formel
insert-itemize = Einfügen: Aufzählung
insert-enumerate = Einfügen: nummerierte Liste
insert-section = Einfügen: Abschnitt
insert-subsection = Einfügen: Unterabschnitt
insert-quote = Einfügen: Blockzitat
insert-footnote = Einfügen: Fußnote
