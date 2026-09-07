# TASK-01 — Typesetting: vorhandenes LaTeX erkennen & nutzen

Quelle: texyaz/yaz Issue #39. Ziel: Wenn LaTeX auf dem Rechner ist, soll yaz es
erkennen und nutzbar machen. Der „Typesetting"-Bereich in den Einstellungen wird
erweitert um: (1) nach vorhandener Installation scannen, (2) eine Installation
dauerhaft (über Sessions) hinzufügen, (3) den Pfad der Installation sehen,
(4) die Engines dieser Installation nutzen, (5) ein pulsierender Kreis, der eine
aktive/tote Verbindung zeigt.

> Wichtig: Vieles existiert schon. Das ist **Bausteine verdrahten**, kein
> Neubau. Vor dem Coden die genannten Dateien lesen und Annahmen prüfen —
> der Code ist pre-alpha und ändert sich.

## Was es schon gibt (verifiziert am Code-Stand)

- **Statuslicht mit Puls:** `apps/desktop/src/lib/StatusLight.svelte`. Typ
  `Health = "live"|"degraded"|"off"|"unknown"`; grün pulsiert bereits, amber/rot
  stehen still, `prefers-reduced-motion` beachtet. Aktuell in `App.svelte`
  (~Z. 2496) NUR an Zotero-Status gekoppelt — **für Typesetting neu verdrahten**.
- **Settings als Daten:** `apps/desktop/src/lib/Settings.svelte`. Feldtypen
  existieren: `select`, `toggle`, `button`, `path` (Verzeichnis wählen/anzeigen/
  löschen!), `copy`, `note`, `shortcut`, `panel`. Ein neues Setting = ein
  Listeneintrag, KEIN neues Markup. Die Sektionen werden in `App.svelte` als
  `Section[]` zusammengebaut (Import Z. 31).
- **Engine-Modell:** `crates/yaz-core/src/project.rs` → `EngineChoice`
  (`Tectonic` default, `System { engine }`, `Typst`), `to_id`/`from_id`
  (`system:<binary>`). Engine liegt **pro Projekt** in `ProjectSettings.engine`
  (Z. 178), persistiert als `yaz.toml`.
- **Detektion:** `crates/yaz-compile/src/system_engine.rs` →
  `SystemEngine::detect_all()` (Z. 44) scannt PATH nach xelatex/lualatex/
  pdflatex. ACHTUNG: **prozessweiter Cache** `static CACHE` (Z. 109) — ein
  frischer „Scan"-Button muss den Cache umgehen, sonst wird eine erst jetzt
  installierte Distribution nicht gesehen.
- **IPC-Commands:** `crates/yaz-app/src/commands.rs` → `list_engines` (Z. 848,
  liefert `EngineInfo{id,label,available,unavailableReasonKey}`),
  `default_engine_choice` (Z. 768), `build_engine` (Z. 790, verweigert statt zu
  ersetzen — ADR-0007). Frontend-Bindung: `apps/desktop/src/lib/ipc.ts`
  (`listEngines` Z. 135, `setProjectEngine` Z. 148).
- **App-weite Persistenz als Vorlage:** `crates/yaz-app/src/appearance.rs` zeigt,
  wie yaz eine App-Einstellung auf Platte hält. Für „across sessions" diesem
  Muster folgen (VERIFIZIEREN, nicht blind kopieren).

## Leitplanken (ADRs / CLAUDE.md)

- **ADR-0007:** Tectonic und System-TeX sind **gleichrangige Peers**, kein
  Fallback. Der System-Pfad ist eine bewusste Wahl, nicht „Notlösung".
- **ADR-0014:** ARM64 ist Tier 1. Keine x86-only-Pfade.
- **ADR-0011 / CI:** KEINE hartkodierten UI-Strings — nur i18n-Keys in
  `locales/`. `node scripts/check-i18n.mjs` muss grün sein.
- **ADR-0005:** kein privilegierter Backdoor für First-Party-Code; wenn UI etwas
  braucht, geht es über eine saubere IPC/API.
- Keine literalen Farben (Theme-Tokens), logische CSS-Properties, Conventional
  Commits.

## Umsetzung in DREI Scheiben (einzeln bauen, testen, Markus zeigen)

### Scheibe 1 — „Scan"-Button + Typesetting-Statuslicht  ← ZUERST
Kleinster sichtbarer Nutzen, idealer Test des Zusammenspiels.
- **Rust:** einen cache-umgehenden Scan bereitstellen — entweder Parameter an
  der Detektion oder neues Command `rescan_engines` in `commands.rs` (den
  `CACHE` in `system_engine.rs` bewusst überspringen/leeren). `cargo test` +
  ein Test, dass ein frischer Scan nicht aus dem Cache antwortet.
- **Frontend:** in der Typesetting-Sektion (in `App.svelte` bei den `Section[]`)
  ein `button`-Feld „nach Installationen suchen", das das Command ruft und die
  gefundenen Engines listet (als `note`-Felder o. Ä.). Eine zweite
  `StatusLight`-Instanz für Typesetting: `live` = mind. eine Engine verfügbar,
  `off` = keine, `unknown` = noch nicht gescannt.
- **i18n:** neue Keys in `locales/`.
- **Markus zeigt:** Settings → Typesetting → Scan drücken → Liste + Licht.

### Scheibe 2 — Pfad manuell hinzufügen & anzeigen
- Den vorhandenen `path`-Feldtyp verdrahten: Nutzer wählt ein TeX-Verzeichnis.
- **Rust:** Command, das prüft, ob im gewählten Verzeichnis ein bekannter
  Typesetter liegt; Ergebnis + Pfad zurück.

### Scheibe 3 — Persistenz „across sessions" + tatsächliches Nutzen
- App-weiten Settings-Store nach dem `appearance.rs`-Muster: der gewählte
  Installationspfad überlebt Neustart.
- In `default_engine_choice`/`build_engine` einfließen lassen, sodass die Engines
  dieser Installation real zum Kompilieren genutzt werden (ADR-0007: verweigern
  statt still ersetzen, wenn weg).

## Definition of Done je Scheibe
`pnpm test` + `pnpm test:rust` grün · `pnpm lint:rust` + `check-i18n.mjs` grün ·
keine ADR verletzt · Markus hat das laufende Verhalten gesehen und OK gegeben ·
Commit(s) als Conventional Commits auf `feat/typesetting-detection` in `origin`.
