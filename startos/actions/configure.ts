import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { domainPattern, emailPattern } from '../utils'

const { InputSpec, Value } = sdk

export const inputSpec = InputSpec.of({
  domain: Value.text({
    name: i18n('Domain'),
    description: i18n(
      'The domain your server lives at, such as chat.example.com. Snikket also uses groups.<domain> and share.<domain>. Every account and message archive is stored under this name, so it cannot be changed once set.',
    ),
    required: true,
    default: null,
    placeholder: 'chat.example.com',
    patterns: [
      {
        regex: domainPattern,
        description: i18n(
          'A lowercase domain name, such as chat.example.com (use the punycode form for non-ASCII names)',
        ),
      },
    ],
    immutable: true,
  }),
  adminEmail: Value.text({
    name: i18n('Admin email'),
    description: i18n(
      'Contact address for your server. It is shown to your users and used to register for a certificate.',
    ),
    required: true,
    default: null,
    inputmode: 'email',
    patterns: [
      { regex: emailPattern, description: i18n('A valid email address') },
    ],
  }),
  siteName: Value.text({
    name: i18n('Site name'),
    description: i18n(
      'A friendly name shown in the portal and the apps. Leave blank to show the domain.',
    ),
    required: false,
    default: null,
  }),
  turnRelay: Value.select({
    name: i18n('Voice and video relay'),
    description: i18n(
      'Calls between people who cannot reach each other directly need a relay. The Coturn service on this server provides one.',
    ),
    values: {
      coturn: i18n('Coturn service (recommended)'),
      none: i18n('None'),
    },
    default: 'coturn',
  }),
})

export const configure = sdk.Action.withInput(
  'configure',

  async ({ effects }) => ({
    name: i18n('Configure'),
    description: i18n(
      'Set the permanent domain, the admin contact address, the site name, and the call relay.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async ({ effects }) => {
    const store = await storeJson.read().once()
    return {
      domain: store?.domain,
      adminEmail: store?.adminEmail || undefined,
      siteName: store?.siteName || undefined,
      turnRelay: store?.turnRelay,
    }
  },

  async ({ effects, input }) => {
    const existing = await storeJson.read((s) => s.domain).once()
    const domain = input.domain.trim().toLowerCase()
    if (existing && existing !== domain) {
      throw new Error(
        i18n(
          'The domain cannot be changed once set: your accounts and history are stored under it. To start over on a new domain, uninstall and reinstall Snikket.',
        ),
      )
    }
    await storeJson.merge(effects, {
      domain,
      adminEmail: input.adminEmail.trim(),
      siteName: input.siteName?.trim() ?? '',
      turnRelay: input.turnRelay,
    })
  },
)
