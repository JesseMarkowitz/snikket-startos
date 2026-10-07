import { storeJson } from './fileModels/store.json'
import { sdk } from './sdk'
import { coturnId, coturnVersionRange } from './utils'

export const setDependencies = sdk.setupDependencies(async ({ effects }) => {
  const turnRelay = await storeJson.read((s) => s.turnRelay).const(effects)
  if (turnRelay !== 'coturn') return {}
  return {
    [coturnId]: {
      kind: 'running',
      versionRange: coturnVersionRange,
      // No health checks: Coturn's own check reports `disabled` until a
      // public domain is attached to it, which would show here as a permanent
      // unmet dependency even though chat works without a relay.
      healthChecks: [],
    },
  }
})
