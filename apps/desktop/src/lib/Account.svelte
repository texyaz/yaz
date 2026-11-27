<!--
  The account control in the title bar.

  # Two states

  A yaz served by a web server that asks who is there (ADR-0033) knows the
  person, and this shows them: a picture, or their initials where there is
  none, and under it their name and address with the way to sign out.

  Everywhere else — the desktop application, a web server started without
  sign-in — there is nobody to show, and this is the plain stub that holds
  the space. It is the same button, so the bar does not move whichever it is.

  # The picture is the browser's to fetch

  The address is the provider's `picture` claim and points at a host the
  *browser* can reach and the server may not. It is loaded directly, with no
  referrer so that the host learns nothing of where yaz is served, and if it
  does not load the initials are drawn instead.

  # Why a disclosure and not a menu

  What opens holds a name and an address to read as well as one action. A
  `role="menu"` may only hold items, so this is a button that shows and hides a
  region, with the one action a link in it — which is also what signing out is:
  a navigation to the server.
-->
<script lang="ts">
  import { signedInPerson } from "@yaz-host/account";
  import { t } from "./i18n";
  import { initials, type Person } from "./person";

  /** Where signing out goes: the server forgets the session and tells the provider. */
  const SIGN_OUT = "/auth/logout";

  let person = $state<Person | null>(null);
  let open = $state(false);
  /** The address of a picture that did not load, so it is not tried again. */
  let failed = $state<string | null>(null);
  let host = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();

  $effect(() => {
    let current = true;
    void signedInPerson().then((who) => {
      if (current) person = who;
    });
    return () => {
      current = false;
    };
  });

  const picture = $derived(
    person?.picture && person.picture !== failed ? person.picture : null,
  );

  function close(refocus: boolean) {
    open = false;
    if (refocus) button?.focus();
  }

  // Close on a click anywhere else, on the window rather than on a backdrop
  // so that the click that dismisses it still reaches what it was aimed at.
  $effect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!host?.contains(event.target as Node)) close(false);
    };
    window.addEventListener("click", outside);
    return () => window.removeEventListener("click", outside);
  });
</script>

{#if person}
  <div
    class="account"
    bind:this={host}
    role="presentation"
    onkeydown={(event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        close(true);
      }
    }}
    onfocusout={(event) => {
      // Tabbing past the last thing in it closes it.
      const to = event.relatedTarget as Node | null;
      if (open && to && !host?.contains(to)) close(false);
    }}
  >
    <button
      type="button"
      class="avatar signed-in"
      bind:this={button}
      aria-expanded={open}
      aria-controls="account-panel"
      title={t("account-menu", { name: person.name })}
      aria-label={t("account-menu", { name: person.name })}
      onclick={() => (open = !open)}
    >
      {#if picture}
        <img
          src={picture}
          alt=""
          referrerpolicy="no-referrer"
          decoding="async"
          onerror={() => (failed = picture)}
        />
      {:else}
        <span class="initials" aria-hidden="true">{initials(person.name)}</span>
      {/if}
    </button>

    {#if open}
      <div class="panel" id="account-panel" role="region" aria-label={t("titlebar-account")}>
        <p class="name">{person.name}</p>
        {#if person.email}<p class="email">{person.email}</p>{/if}
        <span class="separator"></span>
        <a class="item" href={SIGN_OUT}>{t("account-sign-out")}</a>
      </div>
    {/if}
  </div>
{:else}
  <!-- A stub, and drawn as one: there is no account behind it. -->
  <button
    type="button"
    class="avatar"
    title={t("titlebar-account")}
    aria-label={t("titlebar-account")}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="6" r="2.6" />
      <path d="M3 14a5 5 0 0110 0" />
    </svg>
  </button>
{/if}

<style>
  .account {
    position: relative;
    /* The bar is draggable; this is not, or the menu could not be opened. */
    -webkit-app-region: no-drag;
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 1.875rem;
    block-size: 1.875rem;
    padding: 0;
    overflow: hidden;
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: 999px;
    color: var(--yaz-text-muted);
    cursor: pointer;
  }

  .avatar svg {
    inline-size: 0.9375rem;
    block-size: 0.9375rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
  }

  .avatar:hover {
    color: var(--yaz-text-primary);
  }

  /* The person, rather than the place where a person would be. */
  .avatar.signed-in {
    background: var(--yaz-accent);
    border-color: var(--yaz-accent);
    color: var(--yaz-text-on-accent);
  }

  .avatar.signed-in:hover {
    color: var(--yaz-text-on-accent);
    border-color: var(--yaz-text-primary);
  }

  .avatar img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .initials {
    font: inherit;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1;
    letter-spacing: 0.02em;
  }

  .panel {
    position: absolute;
    inset-block-start: calc(100% + var(--yaz-space-1));
    inset-inline-end: 0;
    z-index: 20;
    min-inline-size: 14rem;
    max-inline-size: 20rem;
    padding: var(--yaz-space-1);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    box-shadow: 0 4px 12px rgb(0 0 0 / 30%);
    user-select: text;
  }

  .name,
  .email {
    margin: 0;
    padding: 0 var(--yaz-space-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    padding-block-start: var(--yaz-space-1);
    color: var(--yaz-text-primary);
    font-weight: 600;
  }

  .email {
    color: var(--yaz-text-muted);
    font-size: var(--yaz-font-size-sm);
  }

  .separator {
    display: block;
    block-size: 1px;
    margin: var(--yaz-space-1) 0;
    background: var(--yaz-border);
  }

  .item {
    display: block;
    padding: var(--yaz-space-1) var(--yaz-space-2);
    color: var(--yaz-text-primary);
    text-decoration: none;
    border-radius: var(--yaz-radius-sm);
  }

  .item:hover {
    background: var(--yaz-bg-hover);
  }
</style>
