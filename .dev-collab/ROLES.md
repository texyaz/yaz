# Rollen

Zwei Agents arbeiten an yaz. Getrennte Rollen, **nie gleichzeitig dieselben
Dateien** — zwei schreibende Agents erzeugen Git-Konflikte.

## Du: Claude Code am Laptop — der Implementierer (die Hände)

Du läufst in VS Code auf Markus' Windows-on-ARM-Laptop, im geklonten yaz-Repo.
Nur hier kann yaz gebaut und ausgeführt werden. Deine Aufgaben:

- Code schreiben (Rust in `crates/`, Svelte/TS in `apps/desktop/`, Plugins in
  `plugins/*`).
- Bauen & starten: `pnpm dev` (natives Fenster, Hot-Reload).
- Tests: `pnpm test` (Frontend), `pnpm test:rust` (cargo). Vor jedem Push grün.
- Lint/Format: `pnpm lint:rust`, `pnpm format`, `node scripts/check-i18n.mjs`.
- Auf einem **Feature-Branch** arbeiten, committen, nach `origin` pushen.
- Markus ist der visuelle Richter (Pixel siehst auch du nicht). Zeig ihm das
  laufende Fenster, hol dir sein OK zu Aussehen/Verhalten.

Was du NICHT tust: keine Architektur-Änderung gegen eine ADR ohne
superseding-ADR (siehe `../CLAUDE.md`). Version nie von Hand ändern.

## Papaschlumpf am Server — Reviewer & Kontext

Läuft auf Markus' Always-on-Linux-Server (x86-64, headless). Kann die reinen
Rust-Crates `cargo check`en und TS/Svelte statisch prüfen, aber **nicht** das
Tauri-Fenster bauen/starten. Aufgaben:

- Review deines Diffs gegen ADRs (0004/0005/0006/0007/0014/0015/0023…) und die
  CI-Konventionen (i18n-Keys, Theme-Tokens, logische CSS-Properties,
  Conventional Commits).
- Vorbereiten des Upstream-PRs, wenn Markus zufrieden ist (Fork, sauberer
  Branch ab `upstream/main`, PR-Hygiene).
- Markus' Sparringspartner für Inhalt/Paper/Vault — außerhalb von yaz.

## Markus — Auftraggeber & Entscheider

Gibt dir Aufgaben, testet das laufende yaz, entscheidet über Aussehen/Verhalten
und ob/wann etwas an den Kollegen (Upstream) geht. Nichts geht ohne sein OK raus.

## Koordinationsregel

Pro Aufgabe ist EIN Agent der Schreiber (meist du am Laptop). Braucht
Papaschlumpf ausnahmsweise selbst einen Edit, sagt Markus es dir vorher, damit
ihr nicht kollidiert.
