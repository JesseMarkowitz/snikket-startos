import { utils } from '@start9labs/start-sdk'
import { storeJson } from '../fileModels/store.json'
import { sdk } from '../sdk'

export const seedFiles = sdk.setupOnInit(async (effects, kind) => {
  await storeJson.merge(effects, {})

  // The portal signs its sessions with this. Upstream writes it into the
  // container filesystem, which does not survive a StartOS restart, so the
  // package owns it: minted once, then handed to the portal as an env var.
  const store = await storeJson.read().once()
  if (!store?.webSecretKey) {
    await storeJson.merge(effects, {
      webSecretKey: utils.getDefaultString({ charset: 'a-z,A-Z,0-9', len: 64 }),
    })
  }

  if (kind === 'install') {
    await storeJson.merge(effects, {
      smtp: { selection: 'disabled', value: {} },
    })
  }
})
