import { sdk } from './sdk'

type Sub = ReturnType<typeof sdk.SubContainer.of>

/**
 * The subcontainers `main` is currently running, registered so actions and
 * the certificate daemon can exec into them.
 *
 * Invites and password resets go through `prosodyctl shell`, which talks to
 * the admin socket inside the running server container, and a certificate
 * renewal has to `nginx -s reload` the running proxy. A temporary
 * subcontainer shares neither, so only the handles main created will do.
 * StartOS loads this package's JavaScript once and dispatches main and every
 * action from that one process, which is what makes a module-level handle
 * valid.
 */
let running: { server: Sub; proxy: Sub } | null = null

export const runtime = {
  set(subs: { server: Sub; proxy: Sub }) {
    running = subs
  },
  clear() {
    running = null
  },
  get() {
    return running
  },
}
