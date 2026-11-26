# 0033 — The web server can ask who is there

- **Status:** Proposed
- **Date:** 2026-11-26
- **Supersedes:** —
- **Amends:** [0030 — A web server hosts the same commands](0030-a-web-server-hosts-the-same-commands)

## Context

[ADR-0030](0030-a-web-server-hosts-the-same-commands) gave yaz a web server
that authenticates nobody, and was plain about what follows: it belongs on an
address only its one user can reach. That holds for a thesis on a workstation.

It does not hold for a document several people write. A shared project on a
server is reached by everybody who writes it, and "an address only they can
reach" then means that a network rule is the whole of the access control: the
server cannot tell a colleague from anybody else on that network, cannot say
who it served, and cannot be opened to three people without being opened to a
group somebody else maintains.

Two things constrain what can be done about it:

- **The server is one user's process.** The open project and the plugin host
  are process state, and its commands read and write files and run a TeX
  engine. Letting a person in is letting them act as the user the server runs
  as. No amount of signing in changes that.
- **yaz should not keep passwords.** An organisation that shares a server
  already has a place where its people sign in.

## Decision

**`yaz-web` can be started with an OpenID Connect provider to ask, and then
serves only the people it was started for.**

- `--oidc-issuer`, `--oidc-client-id`, `--public-url` and one or more `--allow`
  turn it on; all four are needed, and the client secret is read from the
  environment (`YAZ_WEB_OIDC_SECRET`), never from the command line.
- A request without a session is sent to the provider (authorisation code with
  PKCE) and comes back to `/auth/callback`. The server asks the provider whom
  the token is for and lets the person in if their e-mail address, their user
  name or one of their groups is named with `--allow`. An API request without
  a session is refused with 401, and the page starts the sign-in.
- **Starting it without `--allow` is an error.** A provider knows everybody in
  an organisation; a server that amounts to a shell must name its people.
- A session is a random name in a cookie (`HttpOnly`, `Secure`,
  `SameSite=Lax`) and a row in the server's memory for twelve hours. A restart
  signs everybody out, and the provider's own session signs them back in.
- The checks of ADR-0030 stay and run first: the `Host` must be one the server
  was started for, and an API request must carry the `x-yaz-web` header.
- **Sign-in decides who reaches the server, not what they may do there.**
  Everybody who is let in shares the one open project and has what amounts to
  a shell as the server's user. A project some people must not see is served
  by **another server**, started as a user, or in a sandbox, that cannot read
  it.
- Without the options nothing changes: the server authenticates nobody and
  says so.

## Consequences

- A shared project can be opened to named colleagues with the accounts they
  already have, and the log says who signed in.
- The server now holds a secret and talks to a third party at start-up of the
  first sign-in. If the provider is down, nobody new gets in; people with a
  session keep working.
- The token is taken straight from the provider over TLS and handed straight
  back to it to learn whom it is for, so the server verifies no signature and
  carries no JWT library. The cost is one more request per sign-in.
- Two dependencies are added behind the `web` feature, both pure Rust
  ([ADR-0014](0014-target-platforms-and-arm64)): `sha2`, already in the
  workspace, for the PKCE challenge, and `getrandom` for the names of
  sessions.
- **This invites a mistake**: reading "sign-in" as "accounts". yaz has no
  notion of whose project a project is, and this record does not add one. The
  usage text, the module's documentation and the guide each say so.
- Sessions live in memory, so two servers behind one address would not share
  them. One project, one server is the deployment this is for.

## Alternatives considered

- **A reverse proxy that signs people in (oauth2-proxy and the like).** It
  works today and needs nothing from yaz. It lost because the two checks that
  make the server safe to expose at all — the `Host` and the marker header —
  are yaz's, and a deployment that needs a second program configured exactly
  right to be safe is one that will sometimes be run without it. The option
  costs about three hundred lines and removes that program.
- **Accounts and permissions per project inside one server.** This is what
  "sign-in" suggests, and it would need the open project, the plugin host and
  every command's access to the file system to become per-session, in a
  process whose commands can run a TeX engine with shell escape. It is a
  different product; the honest version of it is one server per audience.
- **A shared password or a token in the address.** No provider needed, but a
  secret that is passed around is known to everybody who ever had it, and
  nothing says who used it.
- **Verifying the ID token locally.** Saves the request to the provider and
  costs a JOSE implementation and its key handling, for no gain here: the
  token never passes through anything that could have altered it.
