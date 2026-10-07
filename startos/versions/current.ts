import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

// Upstream tags images by date (`stable.20260611`); the upstream part of this
// version is that date written as year.month.day so releases sort correctly.
export const current = VersionInfo.of({
  version: '2026.6.11:0',
  releaseNotes: {
    en_US: 'Initial release for StartOS',
    es_ES: 'Lanzamiento inicial para StartOS',
    de_DE: 'Erstveröffentlichung für StartOS',
    pl_PL: 'Pierwsze wydanie dla StartOS',
    fr_FR: 'Version initiale pour StartOS',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
