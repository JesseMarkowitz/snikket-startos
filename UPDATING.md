# Updating the upstream version

Snikket ships as three coordinated upstream images plus one ACME client, all pinned by
`dockerTag` in `startos/manifest/index.ts`.

## Determining the upstream version

- **Snikket** — `snikket/snikket-server`, `snikket/snikket-web-proxy` and
  `snikket/snikket-web-portal` are built and tagged together from
  [`snikket-im/snikket-server`](https://github.com/snikket-im/snikket-server) and its sibling
  repos. Each release is a `stable.<YYYYMMDD>` tag that all three images share; `beta.*` and
  `dev` tags are not releases. The current pin lives on the `server`, `proxy` and `portal`
  image entries.

  ```bash
  gh api repos/snikket-im/snikket-server/tags --jq '.[].name' | grep '^stable\.' | head -3
  curl -s 'https://hub.docker.com/v2/repositories/snikket/snikket-server/tags?page_size=20' \
    | jq -r '.results[] | select(.name|startswith("stable.")) | "\(.name) \([.images[].architecture]|join(","))"'
  ```

  Confirm every one of the three images carries the new tag for both `amd64` and `arm64`
  before pinning it.

- **lego** — `goacme/lego`, pinned on the `lego` image entry, versioned by
  [`go-acme/lego`](https://github.com/go-acme/lego) releases.

  ```bash
  gh release view -R go-acme/lego --json tagName -q .tagName
  ```

## Applying the bump

- Snikket: set all three `snikket/*` `dockerTag`s to the same `stable.<YYYYMMDD>`, and set
  `version` in `startos/versions/current.ts` to that date written as `YYYY.M.D:0` (no leading
  zeros on month or day, so `stable.20260611` is `2026.6.11:0`). Read upstream's release notes
  for the bumped range and summarize them in `releaseNotes`.

  Upstream's server entrypoint runs forward-only data migrations on every start, so an image
  bump is not reversible: `down: IMPOSSIBLE` stays, and a bump needs testing on a populated
  install before release, not only a fresh one.

  Check, on the bump, that the five facts this package relies on still hold: the image's
  Prosody user is still named `prosody` and mail still goes out through msmtp honouring
  `XDG_CONFIG_HOME` (the `msmtp-chown` oneshot in `startos/main.ts` relies on both); the certificate
  path `/snikket/letsencrypt/live/<domain>/{cert,chain,fullchain,privkey}.pem`, the proxy's
  `cert-monitor` service and `nginx -s reload`, the server's `/etc/cron.daily/refresh-certs`,
  and the `create-invite` script's `--admin` and `--reset` flags. `startos/main.ts` and
  `startos/certificates.ts` name each.

- lego: set the `lego` `dockerTag` to the new `vX.Y.Z` and bump the downstream revision. Check
  `lego run --help` still carries `--dns`, `--path`, `--cert.name`, `--renew-days` and
  `--no-random-sleep`; lego 5 folded renewal into `run`, and a later major may move them again.
