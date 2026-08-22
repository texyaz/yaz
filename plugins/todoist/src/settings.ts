/**
 * Signing in to Todoist, and signing out again.
 *
 * # Why a token and not a browser sign-in
 *
 * Todoist offers OAuth, which is the better experience and needs a redirect
 * back into a desktop application — a loopback listener, a registered client
 * secret, and a round trip through the system browser. That is a real feature
 * and it is not this one. A personal API token is a field in Todoist's own
 * settings, it takes a copy and a paste, and it is exactly as revocable.
 *
 * The token goes into the operating system's keychain and this plugin never
 * reads it back: what it can do is *spend* it, against the one host its
 * manifest declares
 * ([ADR-0026](https://generalpawz.github.io/yaz/adr/0026-task-providers-and-credentials)).
 *
 * # Why signing out does not say "revoked"
 *
 * Forgetting a token here removes it from this machine. It does not invalidate
 * it — only Todoist can do that — so the panel says what it did and links to
 * where the other thing is done. Telling somebody their secret is safe when it
 * is merely gone from one computer would be the wrong reassurance.
 */

import type { App } from "@yaz/api";

import { checkReach, forgetBase } from "./api";

/** Where a personal API token is found, for the link in the panel. */
const TOKEN_PAGE = "https://app.todoist.com/app/settings/integrations/developer";

/** Draw the panel into `container`. */
export function renderSettings(app: App, container: HTMLElement): void {
  const draw = (signedIn: boolean): void => {
    container.replaceChildren();

    const box = document.createElement("fieldset");
    box.className = "yaz-todoist-settings";

    const legend = document.createElement("legend");
    legend.textContent = app.i18n.t("todoist-settings-title");
    box.append(legend);

    const state = document.createElement("p");
    state.className = "yaz-todoist-state";
    state.textContent = app.i18n.t(
      signedIn ? "todoist-signed-in" : "todoist-signed-out",
    );
    box.append(state);

    if (signedIn) {
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "yaz-todoist-button";
      forget.textContent = app.i18n.t("todoist-forget");
      forget.addEventListener("click", () => {
        void app.credentials.forget().then(() => {
          draw(false);
          // The Tasks tab and the Connections entry were both drawn from a
          // sign-in that has just gone, so they are told. Without this they
          // keep offering a list nothing can reach until something else
          // happens to refresh them.
          app.tasks.refresh();
          // Said plainly: this machine has forgotten it, which is not the same
          // as Todoist having revoked it.
          app.notices.show("todoist-forgotten");
        });
      });
      box.append(forget);

      const revoke = document.createElement("p");
      revoke.className = "yaz-todoist-note";
      revoke.textContent = app.i18n.t("todoist-revoke-elsewhere");
      box.append(revoke);
    } else {
      const how = document.createElement("p");
      how.className = "yaz-todoist-note";
      how.textContent = app.i18n.t("todoist-token-where", {
        page: TOKEN_PAGE,
      });
      box.append(how);

      const row = document.createElement("div");
      row.className = "yaz-todoist-row";

      const field = document.createElement("input");
      // A password field, so it is not read over somebody's shoulder or left
      // legible in a screen recording.
      field.type = "password";
      field.className = "yaz-todoist-field";
      field.placeholder = app.i18n.t("todoist-token-placeholder");
      field.setAttribute("aria-label", app.i18n.t("todoist-token-placeholder"));

      const save = document.createElement("button");
      save.type = "button";
      save.className = "yaz-todoist-button";
      save.textContent = app.i18n.t("todoist-sign-in");

      const submit = (): void => {
        const token = field.value.trim();
        if (!token) return;
        // Cleared immediately: it is in the keychain a moment later and there
        // is no reason for it to stay in a DOM node.
        field.value = "";
        void app.credentials
          .set(token)
          .then(() => {
            // A different token may be a different account, which may be on a
            // different API version.
            forgetBase();
            // Stored is not signed in. A token can be mistyped, revoked, or
            // simply the wrong kind of string, and every one of those looked
            // exactly like "not signed in" — which is an unanswerable state.
            return checkReach(app);
          })
          .then(({ ok, reason }) => {
            draw(ok);
            // The whole point of signing in is that everything else can now
            // reach the service, so the Tasks tab and the Connections entry
            // are told rather than left stale until something else asks.
            app.tasks.refresh();
            if (ok) {
              app.notices.show("todoist-signed-in");
              return;
            }
            // What actually happened, not what we guessed. Saying "Todoist
            // refused it" when the real answer was a firewall or a retired
            // endpoint sends somebody to make a new token that will fail the
            // same way — which is exactly what it did.
            app.notices.show("todoist-token-refused", { reason });
          })
          .catch(() => app.notices.show("todoist-sign-in-failed"));
      };

      save.addEventListener("click", submit);
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") submit();
      });

      row.append(field, save);
      box.append(row);
    }

    container.append(box);
  };

  void app.credentials.has().then(draw);
}
