# .dev-collab — Zusammenarbeit Laptop-Claude-Code ↔ Papaschlumpf (Server)

Diese Mappe ist das **Betriebshandbuch** für die geteilte Arbeit an yaz.
Sie ist NICHT Teil des yaz-Projekts des Kollegen — sie gehört Markus &
seinen Agents und muss vor einem Upstream-PR draußen bleiben (siehe
`GIT-WORKFLOW.md` → „PR-Hygiene").

## Reihenfolge zum Einlesen (für Claude Code am Laptop)

1. **`ROLES.md`** — wer macht was. Du (Laptop) bist der Implementierer.
2. **`GIT-WORKFLOW.md`** — wie push/pull/Submodule/Branches laufen. PFLICHT.
3. **`TASK-01-typesetting-detection.md`** — die aktuelle Aufgabe, in Scheiben.

Die Architektur-Autorität bleibt `../CLAUDE.md` und `../docs/adr/`. Diese
Mappe widerspricht ihnen nie, sie ergänzt nur die Zusammenarbeit.

## Sehr kurze Zusammenfassung

- Du entwickelst am Laptop (nativ ARM, `pnpm dev`, `pnpm test`), weil nur hier
  gebaut/ausgeführt werden kann.
- Papaschlumpf (Server) editiert nicht gleichzeitig; er reviewt deinen Diff
  gegen die ADRs und CI-Konventionen und ist Markus' Kontext-/Sparringspartner.
- Transport ist Git über ein lokales Bare-Repo auf dem Server (`origin`).
  GitHub (`upstream`) ist nur Lesequelle + späteres PR-Ziel.
