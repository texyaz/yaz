# Git-Workflow (Laptop ↔ Server ↔ Kollege)

## Die drei Remotes / Orte

```
Kollege (GitHub)        github.com/texyaz/yaz          = upstream  (nur lesen; späteres PR-Ziel)
Server-Bare (Sync)      ~/git/yaz/yaz.git              = origin    (Treffpunkt Laptop↔Server)
Server-Arbeitsklon      ~/Projects/Coding/Work/yaz/yaz (Papaschlumpf reviewt hier)
Laptop-Klon             <dein VS-Code-Ordner>          (DU arbeitest hier)
```

`origin` zeigt auf ein lokales Bare-Repo auf dem Server (über Tailscale-SSH),
**nicht** auf GitHub. Deine Drafts verlassen die zwei Geräte nicht.

## Auto-Sync auf dem Server (musst du kennen)

Auf `origin` liegt ein `post-receive`-Hook: pusht du, zieht Papaschlumpfs
Arbeitsklon automatisch nach — **aber nur** als Fast-Forward und **nur** wenn
sein Klon sauber ist und **denselben** Branch ausgecheckt hat. Konsequenz:

- **Arbeite auf einem Feature-Branch**, nie direkt auf `main`. Dann kann der
  Server-Klon auf `main` bleiben und Papaschlumpf reviewt per `git fetch` +
  Diff, ohne dass sich etwas beißt.

## Dein Zyklus (Standardfall: Änderung im Superrepo)

```
git switch -c feat/<kurzname>            # Feature-Branch
# ... code, dann:
pnpm test && pnpm test:rust              # grün vor Push
pnpm lint:rust && node scripts/check-i18n.mjs
git add -A
git commit -m "feat(scope): ..."         # Conventional Commits (CI erzwingt das)
git push -u origin feat/<kurzname>
```
Dann Bescheid an Markus/Papaschlumpf: „feat/<kurzname> steht auf origin."
Papaschlumpf reviewt und meldet zurück. Fixes: weiter committen + pushen.

Meine (Papaschlumpf-)Vorschläge holst du mit:
```
git fetch origin && git log --oneline origin/feat/<kurzname>
git merge --ff-only origin/feat/<kurzname>   # oder cherry-pick, je nach Fall
```

## Sonderfall: Änderung in einem Plugin (Submodul)

Die 5 Plugins unter `plugins/*` sind **Git-Submodule** mit eigenem Remote.
Bei einer Plugin-Änderung:
```
cd plugins/<name>
git switch -c feat/<kurzname>
# ... code ...
git commit -am "feat: ..."
git push -u origin feat/<kurzname>           # origin = Bare des Plugins auf dem Server
cd ../..
git add plugins/<name>                        # Superrepo: neuen Submodul-Zeiger festschreiben
git commit -m "chore: bump <name> submodule"
git push origin feat/<kurzname>
```
Merke: Nach einem Plugin-Commit zeigt das Superrepo den Submodul-Zeiger als
„geändert" — das ist normal, kein Fehler.

## Updates vom Kollegen nachziehen

```
git fetch upstream
git merge upstream/main            # bzw. rebase, nach Absprache
```
Je Submodul analog mit dessen `upstream`.

## PR-Hygiene (erst wenn Markus zufrieden ist — GATED)

Der PR an den Kollegen entsteht NICHT aus diesen Collab-Branches. Papaschlumpf
schneidet dann einen sauberen Branch ab `upstream/main` und cherry-pickt nur die
Feature-Commits. **Diese `.dev-collab/`-Mappe und alles Collab-Interne dürfen
NICHT im Upstream-PR landen.** Nichts geht ohne Markus' ausdrückliches OK raus.

## Diese Doku aufs Laptop holen

Papaschlumpf hat `.dev-collab/` nach `origin/main` gepusht. Einmalig am Laptop:
```
git pull origin main
```
(Falls du auf einem Feature-Branch bist: `git switch main && git pull` und die
Mappe dann in deinen Branch mergen, oder sie liegt eh schon in main.)
