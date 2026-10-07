import { sdk } from './sdk'
import { legoSubpath, letsencryptSubpath } from './utils'

// Both volumes, minus the certificate tree and lego's ACME state: a
// certificate is re-obtained after a restore, and a stale one carried onto a
// new box would be served until it was.
export const { createBackup, restoreInit } = sdk.setupBackups(
  async ({ effects }) =>
    sdk.Backups.withOptions({
      exclude: [`/${letsencryptSubpath}`, `/${legoSubpath}`],
    })
      .addVolume('main')
      .addVolume('startos'),
)
