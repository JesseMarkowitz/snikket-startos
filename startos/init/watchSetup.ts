import { configure } from '../actions/configure'
import { configureCertificate } from '../actions/configureCertificate'
import { createInvite } from '../actions/createInvite'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'

/**
 * Snikket cannot start without a domain (Prosody keys its storage by it) or
 * a certificate source (nginx and Prosody both wait for the certificate), so
 * each is a critical task until set. Both re-evaluate whenever the store
 * changes; a task whose condition is already met is never raised again.
 */
export const watchSetup = sdk.setupOnInit(async (effects, kind) => {
  const domain = await storeJson.read((s) => s.domain).const(effects)
  if (!domain) {
    await sdk.action.createOwnTask(effects, configure, 'critical', {
      reason: i18n(
        'Set the permanent domain and the admin contact address before Snikket can start',
      ),
    })
  }

  const source = await storeJson
    .read((s) => s.certificate.source)
    .const(effects)
  if (source === 'unset') {
    await sdk.action.createOwnTask(effects, configureCertificate, 'critical', {
      reason: i18n(
        'Choose where Snikket gets its TLS certificate; nothing can connect without one',
      ),
    })
  }

  if (kind === 'install') {
    await sdk.action.createOwnTask(effects, createInvite, 'important', {
      reason: i18n(
        'Once Snikket is running, create an admin invite and register your own account from it',
      ),
    })
  }
})
