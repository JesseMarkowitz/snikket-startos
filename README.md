<p align="center">
  <img src="icon.svg" alt="Snikket Logo" width="21%">
</p>

# Snikket on StartOS

> Everything not listed in this document should behave the same as upstream Snikket.
> If a feature, setting, or behavior is not mentioned here, the upstream
> documentation is accurate and fully applicable — see the Documentation section of
> `instructions.md` for links.

[Snikket](https://github.com/snikket-im/snikket-server) is a batteries-included XMPP chat server: Prosody, a web portal for accounts and invites, and a web proxy, with its own mobile apps. This package runs upstream's images with one structural change: upstream's certificate manager is dropped, because the HTTP-01 challenge it uses cannot reach a service behind StartOS, and the package obtains and installs the certificate itself. Everything downstream of the certificate — nginx serving TLS on 443, Prosody importing it for 5222 and 5269 — is upstream's own machinery, driven exactly as upstream drives it.

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Dependencies](#dependencies)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Actions](#actions)
- [Tasks](#tasks)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

Three upstream Snikket images run unmodified, plus a fourth that exists only to obtain certificates. Upstream's `snikket-cert-manager` image is not used.

| Image                        | Subcontainer | Runs                                                             |
| ---------------------------- | ------------ | ---------------------------------------------------------------- |
| `snikket/snikket-server`     | `server-sub` | Prosody and anacron under s6-svscan (`runAsInit`), as upstream   |
| `snikket/snikket-web-proxy`  | `proxy-sub`  | nginx and the `cert-monitor` service under tini and s6 (`runAsInit`) |
| `snikket/snikket-web-portal` | `portal-sub` | hypercorn serving the portal on loopback `:5765`                 |
| `goacme/lego`                | `lego`       | temporary; one `lego run` per issuance or renewal, then destroyed |

All three Snikket images publish x86_64 and aarch64; so does lego. Each daemon uses the image's own entrypoint. The subcontainers share one network namespace, so upstream's `localhost` wiring between nginx, the portal (`:5765`) and Prosody's HTTP API (`:5280`) is unchanged.

One oneshot, `msmtp-chown`, runs in `server-sub` before Prosody to hand the generated mail config to the `prosody` user. A fourth daemon, `certificates`, is not a container at all: a loop in the package's own runtime that keeps the installed certificate matching the configured source (see [Health Checks](#health-checks)).

## Volume and Data Layout

Two volumes. Prosody's data, shared files and the certificate tree live on `main`; the package's own state lives on `startos`, which no container mounts.

| Volume    | Mounted at            | Into                     | Holds                                                                                                                             |
| --------- | --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `main`    | `/snikket`            | `server-sub`, `proxy-sub` | `prosody/` (accounts, rosters, archives, uploads — upstream's `files` storage), `letsencrypt/live/<domain>/` (the certificate), `lego/` (lego's ACME account and issued certificates), `msmtp/config` (generated mail config) |
| `main`    | `/.lego` (`lego/` subpath) | the temporary lego container | lego state only                                                                                                              |
| `startos` | not mounted           | —                        | `store.json`                                                                                                                      |

The certificate directory is `letsencrypt/live/<punycode domain>/` with `cert.pem`, `chain.pem`, `fullchain.pem`, `privkey.pem` as real files (never symlinks), mode `0600`, owned by root — which is what upstream's nginx templates and `wait-for-certs` read, and what the bundled coturn (disabled here) could not. The package also writes `startos-source` there, naming which source installed the current certificate. `install -d` of that tree is the package's job: nothing upstream creates it once cert-manager is gone.

The volume root is root-owned, so upstream's entrypoint leaves the `prosody` user's uid alone and chowns only `/snikket/prosody`.

## File Models

One model, and it is package state rather than upstream configuration: Snikket is configured entirely through environment variables, so there is no upstream config file to own. One further file is generated without a model.

| File                  | Format | Seeded                                                                                  | Rewritten by                                          | Hand edit survives |
| --------------------- | ------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------ |
| `startos/store.json`  | JSON   | at install with schema defaults; `webSecretKey` generated once; `smtp` set to disabled | `configure`, `configure-certificate`, `manage-smtp`   | yes, but the file is not on a mounted volume |
| `main/msmtp/config`   | msmtp  | rendered from the SMTP selection on every start                                         | every start                                           | no                 |

`msmtp/config` replaces upstream's `SNIKKET_SMTP_URL` mechanism. Upstream renders msmtp's *system* config (`/etc/msmtprc`) from that URL with a parser that splits the authority at the first `@`, so a username that is itself an email address (every Gmail account) breaks the parse and the password is logged as part of a bogus hostname. The package leaves that file alone (it renders upstream's default, an unreachable local sink) and instead supplies msmtp's *user* config, which msmtp prefers: `XDG_CONFIG_HOME=/snikket` on the server daemon makes msmtp read `/snikket/msmtp/config`, and the `msmtp-chown` oneshot hands that directory to the `prosody` user before every start, because msmtp refuses a user config it does not own.

Fields: `domain` (permanent), `adminEmail`, `siteName`, `turnRelay`, `webSecretKey`, `certificate.source` with the Let's Encrypt provider code, its credentials (as `KEY=value` lines) and staging flag, and `smtp`. **DNS provider credentials therefore live in `store.json`**, on the unmounted volume, and are passed to the lego container as environment variables for the duration of one run only.

Every value reaches Snikket as an environment variable on the next start, re-asserted each time, so nothing set here can drift. Beyond the user's own settings, the package fixes these upstream variables and does not expose them:

| Variable                          | Fixed to       | Why                                                                                                                                    |
| --------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SNIKKET_TLS_PROFILE`             | `intermediate` | Upstream's default `modern` is TLS 1.3 only on Prosody 13; the iOS app offers TLS 1.2 on 5222 and hangs on a spinner while the portal keeps working. |
| `SNIKKET_UPDATE_CHECK`            | `0`            | StartOS delivers updates; the DNS beacon to `update.snikket.net` is off.                                                               |
| `SNIKKET_TWEAK_STORAGE`           | `files`        | Upstream's default; the SQLite "sneak preview" is not offered.                                                                          |
| `SNIKKET_TWEAK_TURNSERVER`        | `0`            | The bundled coturn is never started; relaying is Coturn's job (see Dependencies).                                                       |
| `SNIKKET_TWEAK_WEB_PROXY_PROTOS`  | `https`        | Port 80 is unreachable behind StartOS, so only the TLS vhosts are rendered. (Upstream's docs spell this `_PROTOCOLS`; the code reads `_PROTOS`.) |
| `XDG_CONFIG_HOME` (server only)   | `/snikket`     | Where msmtp finds the package's mail config; see File Models. |
| `SNIKKET_TWEAK_INTERNAL_HTTP_HOST`, `SNIKKET_TWEAK_PORTAL_INTERNAL_HTTP_HOST` | `127.0.0.1` | Upstream proxies to `localhost`, which nginx resolves to `::1` first while the portal listens on IPv4 only; every request logged a refused attempt before falling back. |
| `SNIKKET_WEB_SECRET_KEY`          | from the store | Upstream writes the portal's session secret into the container filesystem, which does not survive a StartOS restart; regenerating it signs everyone out. |

The `SNIKKET_TWEAK_TURNSERVER_*` triple is set only while Coturn resolves (see below).

## Dependencies

One optional dependency, declared only while the `configure` action's relay choice is Coturn.

| Dependency | Required | Health checks | Mounted                                                                 | Why                                                                                        |
| ---------- | -------- | ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Coturn     | optional | none          | its `main` volume's `shared/` subpath, read-only, into a throwaway container at `/mnt/coturn` for the length of one read | Relays voice and video for participants who cannot connect directly. Chat, groups and file sharing work without it. |

At start the package reads Coturn's plain TURN address from its `turn` interface's public domain and its REST-API secret from `shared/turn-secret`, and passes both to Prosody as `turn_external_*`. If Coturn is absent, stopped, has no public domain yet, or the secret cannot be read, Prosody advertises no relay and calls connect only where a direct path exists. No health check is listed on the dependency on purpose: Coturn's own check reports `disabled` until it has a public domain, which would otherwise show here as a permanent unmet dependency.

## Network Access and Interfaces

Three bindings on one host, so a domain added once is available to enable on each.

| Interface | Type | Port | Protocol                  | Serves                                                                                                   |
| --------- | ---- | ---- | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `web`     | ui   | 443  | TLS **passthrough**       | The web portal, invite links, and file sharing. nginx inside the container terminates TLS with the package's certificate. |
| `c2s`     | api  | 5222 | raw TCP (STARTTLS inside) | XMPP clients.                                                                                            |
| `s2s`     | api  | 5269 | raw TCP (STARTTLS inside) | Other XMPP servers (federation).                                                                          |

The web binding is a passthrough rather than the usual StartOS-terminated HTTPS because federation and the apps need to see a certificate valid for the Snikket domain, and invite links must carry no port. A public domain attached to the binding rides external port 443 by SNI; the package cannot claim 443 for LAN addresses, so those carry the assigned port, and a client dialing a LAN address must still present the Snikket domain as SNI and Host, since nginx selects its vhost by name and answers other names with a refusal.

Snikket needs three names on that binding: the domain, `groups.<domain>` and `share.<domain>`. nginx serves a vhost for each; Prosody serves the MUC component on `groups.` and HTTP upload on `share.`. The `dns-records` action prints what to publish.

Port 80, upstream's HTTP vhost and ACME webroot, is not bound: StartOS answers 80 itself with a redirect. Upstream's `proxy65` (5000) and direct-TLS (5223) ports are not bound either.

5222 and 5269 are requested as the external ports; if either is already taken on the box, StartOS assigns another silently. The `dns-records` action reads the assigned ports back and says whether SRV records are required.

## Installation and First-Run Flow

Nothing runs until two critical tasks are completed, because Prosody cannot start without a domain and neither nginx nor Prosody serves anything without a certificate.

1. `configure` sets the domain (permanent), admin email, site name and relay choice.
2. `configure-certificate` picks the source. The three sources all feed one apply path — write the four PEMs, then `nginx -s reload` in the proxy and `/etc/cron.daily/refresh-certs` (upstream's `prosodyctl cert import`) in the server — so upstream's certificate handling is exercised the same way regardless of source.
3. Attach the domain, `groups.<domain>` and `share.<domain>` to the host (the `domain` check reports which are missing). On start, the `certificates` daemon obtains a certificate if the source is Let's Encrypt or the StartOS CA. nginx's own `cert-monitor` notices the file within ten seconds and swaps from its holding page to the real vhosts; Prosody's `wait-for-certs` imports it and starts listening. Both wait on their own, so the daemons have no start-order dependency on the certificate.
4. There is no first-run wizard and no open registration: every account, the admin's included, starts from an invite. An `important` task points at `create-invite`; run it with **Administrator** on, register from the link, and the first admin exists.

The `manage-smtp` action is optional; without it, invites and password resets are links to hand out rather than emails.

## Actions

Six user-facing actions. The OS carries their names, descriptions and forms; this is what it cannot.

- **`configure`** — run first, and again to change the email, site name or relay choice. Writes the store; every change restarts the daemons. The domain is accepted once and refused thereafter with an error, because Prosody keys every account, roster and archive by hostname: a changed domain would boot an empty server with the data intact but invisible. Safe to repeat.
- **`configure-certificate`** — run once at setup and again to switch sources or paste a renewal. Let's Encrypt and StartOS-CA selections only write the store; the daemon acts on them within a minute while running, or at the next start, and a switched source triggers a fresh issuance even if the current certificate is still valid. The manual variant validates the PEMs (parseable, key matches, all three names covered) and installs them immediately; consumers reload within a minute. Let's Encrypt issuance takes one to three minutes (DNS propagation) and counts against Let's Encrypt's rate limits, so the staging toggle exists for experiments. Safe to repeat.
- **`create-invite`** — needs Snikket running: it runs upstream's `create-invite` inside the server container, which talks to Prosody's admin socket. Returns a single-use link and QR code; `--admin` when the toggle is on. Repeating it mints another invite.
- **`reset-password`** — needs Snikket running; calls `prosodyctl shell invite create_reset` in the server container directly, because upstream's `create-invite --reset` wrapper keeps only the confirmation line and drops the link. Returns a single-use link, valid for a day, that sets a new password for the named account. Nothing changes until the link is used.
- **`manage-smtp`** — writes the store and restarts the daemons, which re-render `msmtprc`. The sender is the selection's `from` address (the system SMTP's, or the custom one), unlike upstream, which always sends as `snikket@<domain>`. Any username or password is accepted. Sending itself has not been exercised against a real SMTP server.
- **`dns-records`** — read-only. Prints the A/AAAA records for the three names, the assigned client and federation ports, and the SRV records those ports need if non-standard.

No hidden actions.

## Tasks

Three, all raised by the package's own init.

| Task                    | Severity  | Raised when                                        | Cleared by                                   | Returns?                                    |
| ----------------------- | --------- | -------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| `configure`             | critical  | the store has no domain                            | running the action with a domain             | no; the domain cannot be unset              |
| `configure-certificate` | critical  | the certificate source is unset                    | running the action                           | no; a source, once chosen, is only switched |
| `create-invite`         | important | install                                            | running the action                           | no                                          |

Both critical tasks block startup; while either is raised the user sees only the task, not the start button. The certificate task is critical rather than important because with no certificate nothing at all answers: nginx serves a holding page on a port nobody can reach and Prosody never binds 5222.

## Health Checks

Five checks. The two that matter most are the ones upstream cannot express.

| Check          | Probes                                                                                                                                                                                                                       | Failure means                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `certificates` | the installed `fullchain.pem`: present, not expired, covering all three names; plus the last issuance or renewal attempt. 5-minute grace, polled every minute.                                                                | No source configured; issuance failed (the message carries lego's or the OS's error — bad DNS credentials, a wrong provider code, rate limits); a name missing from a pasted certificate; expiry. Fix the source, then wait a minute. |
| `server`       | Prosody listening on 5222. 5-minute grace.                                                                                                                                                                                   | Past the grace period, Prosody is still waiting for a certificate (see `certificates`) or crashed; read the service log.                                                                                                             |
| `portal`       | hypercorn listening on 5765.                                                                                                                                                                                                 | The portal crashed; almost always a log line about `SNIKKET_WEB_PROSODY_ENDPOINT` or the secret key.                                                                                                                                   |
| `proxy`        | nginx listening on 443. 5-minute grace.                                                                                                                                                                                      | nginx has no certificate yet (it binds 443 only once `fullchain.pem` exists) or a template failed to render.                                                                                                                          |
| `domain`       | the host's attached public domains against the configured one and its `groups.`/`share.` names. Polled every 30 s.                                                                                                            | `disabled` when no domain is attached at all (LAN-only use). `failure` naming the missing names when some are attached, or — the case that looks like data loss — when domains are attached but the configured one is not among them. |

The `domain` failure message states that the data is intact and to re-attach the configured domain; that is the correct remedy, never reinstalling.

Renewal: the `certificates` daemon checks every twelve hours and renews with thirty days left. lego handles Let's Encrypt renewals through the same `run` it issues with; the StartOS CA re-mints. Manual certificates are never renewed by the package.

## Backups and Restore

Both volumes are copied wholesale, with two paths excluded.

Excluded: `main/letsencrypt/` (the certificate) and `main/lego/` (lego's account and certificate archive). After a restore, the `certificates` daemon obtains a fresh certificate from the configured source on first start; a certificate carried onto a new box would be served, stale, until it did. A restored install with the manual source has no certificate until one is pasted again, and the `certificates` check says so.

Included: every account, roster, archive and shared file under `main/prosody/`, and `store.json` — which carries the domain, the portal's session secret, and the DNS provider credentials, so a restored Let's Encrypt setup re-issues without re-entering anything.

StartOS stops the service for the duration of a backup, so the file copy is consistent. Shared files can make the backup large; upload retention and quotas are upstream settings the package does not change.

## Limitations and Differences

1. Upstream's certificate manager (HTTP-01 through the ACME webroot) is not used; the package is the ACME client, over DNS-01, or uses the StartOS CA or a pasted certificate.
2. The domain is permanent. Changing it means uninstalling; upstream leaves this to the operator too, but the package refuses rather than allowing a change that orphans every account.
3. Port 80 is not served, so the plain-HTTP redirect vhost and the ACME webroot do not exist. Invite links are always `https://`.
4. The bundled coturn is disabled. Relaying comes from the Coturn service or not at all; the relay port range upstream exposes (`SNIKKET_TWEAK_TURNSERVER_MIN_PORT`/`MAX_PORT`) is inert and not offered.
5. `proxy65` (5000) and direct TLS on 5223 are not exposed.
6. Mail goes out through a package-rendered msmtp user config rather than upstream's `SNIKKET_SMTP_URL`, and the sender is the configured `from` address rather than `snikket@<domain>`.
7. The StartOS-CA source does not federate: other servers will not trust the certificate, and every client device must trust the box's root.
8. Image downgrades are unsafe: upstream's entrypoint runs forward-only data migrations on every start.
10. Upstream's image is missing `mod_track_muc_joins`; Prosody logs one `Unable to load module` error per start. Group chat works regardless; it is an upstream packaging gap, not something this package can fix.
9. The portal is AGPL-3.0 while the server and proxy are Apache-2.0; the package declares AGPL-3.0, the more restrictive.

---

## Quick Reference for AI Consumers

```yaml
package_id: 'snikket'
image: snikket/snikket-server, snikket/snikket-web-proxy, snikket/snikket-web-portal, goacme/lego
architectures: [x86_64, aarch64]
subcontainers: [server-sub, proxy-sub, portal-sub, lego]
volumes:
  main: /snikket
  startos: unmounted
file_models:
  - startos/store.json
startos_managed_env_vars:
  - SNIKKET_DOMAIN
  - SNIKKET_ADMIN_EMAIL
  - SNIKKET_SITE_NAME
  - SNIKKET_TLS_PROFILE
  - SNIKKET_UPDATE_CHECK
  - SNIKKET_TWEAK_STORAGE
  - SNIKKET_TWEAK_TURNSERVER
  - SNIKKET_TWEAK_TURNSERVER_DOMAIN
  - SNIKKET_TWEAK_TURNSERVER_PORT
  - SNIKKET_TWEAK_TURNSERVER_SECRET
  - SNIKKET_WEB_SECRET_KEY
  - SNIKKET_TWEAK_WEB_PROXY_PROTOS
  - SNIKKET_TWEAK_INTERNAL_HTTP_HOST
  - SNIKKET_TWEAK_PORTAL_INTERNAL_HTTP_HOST
  - XDG_CONFIG_HOME
dependencies: [coturn (optional)]
interfaces:
  web: { type: ui, port: 443 }
  c2s: { type: api, port: 5222 }
  s2s: { type: api, port: 5269 }
actions:
  - configure
  - configure-certificate
  - create-invite
  - reset-password
  - manage-smtp
  - dns-records
tasks:
  - { action: configure, severity: critical }
  - { action: configure-certificate, severity: critical }
  - { action: create-invite, severity: important }
health_checks:
  - certificates
  - server
  - portal
  - proxy
  - domain
```
