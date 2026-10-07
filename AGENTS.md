# AGENTS.md

This is a StartOS service-package repository — it builds a `.s9pk` for StartOS.

Develop it inside a StartOS packaging workspace created by `start-cli s9pk init-workspace`,
which provides the packaging guide and agent context one level up. If you're reading this in a
bare clone with no workspace, the full guide is at <https://docs.start9.com/packaging>.

**Start every task at the recipe index** — `../start-technologies/projects/start-sdk/docs/src/recipes.md`
(or <https://docs.start9.com/packaging/recipes.html>). It maps an intent ("prompt the user to create
admin credentials", "expose a web UI") to the constructs, the reference pages, and a named production
package to copy. Find the recipe before you read this package's neighbours: a package you reach by
grepping may be non-conformant, and the recipe outranks it.

Keep `README.md` (technical reference for an AI support or administering agent) and
`instructions.md` (end-user docs) in sync with your changes.

## This repo

- **Actions that talk to Prosody exec into the handle `main` registers in `startos/runtime.ts`,
  never into a temporary subcontainer.** `create-invite` goes through `prosodyctl shell`, which
  needs the admin socket inside the running server container; a fresh container has no socket
  and no running Prosody. The same handle is how a renewed certificate reaches the running nginx.
- **Do not pass `SNIKKET_SMTP_URL`; mail config is the msmtp user config the package renders under `main/msmtp/` and reaches through `XDG_CONFIG_HOME`.** Upstream's URL parser splits at the first `@`, so a Gmail-style username puts the password in the log. Two shortcuts fail on 0.4.0.1: a `readonly` file mount over `/etc/msmtprc` comes up read-write and the entrypoint overwrites it, and an id-mapped mount (`idmap`) is refused with `open_tree_attr IDMAP: Operation not permitted`, which is why the `msmtp-chown` oneshot exists.
- **Do not add `SNIKKET_TWEAK_WEB_PROXY_PROTOCOLS`.** Upstream's docs spell it that way and it
  does nothing; the proxy's entrypoint reads `_PROTOS`, which `main.ts` sets.
- **Do not `.const()` the whole store in `main.ts`.** Each field is read separately so that
  pasting DNS credentials or changing SMTP does not restart Prosody for an unrelated reason;
  the certificate daemon re-reads the store itself on every pass.
- **The domain stays immutable everywhere it appears.** The `configure` action refuses a changed
  domain and the `domain` health check names the configured one; Prosody keys every store by
  hostname, so a changed domain boots an empty server that looks like data loss.
- **Certificate sources plug into `ensureCertificate` in `startos/certificates.ts`.** A new
  source produces a `CertBundle` and goes through `applyBundle` and `reloadConsumers`; nothing
  else writes under `letsencrypt/live/`.
