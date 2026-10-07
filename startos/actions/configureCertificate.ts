import { createPrivateKey } from 'node:crypto'
import { T } from '@start9labs/start-sdk'
import {
  applyBundle,
  bundleFromFullchain,
  hostnamesOf,
  parseCert,
  parseEnvLines,
  uncovered,
} from '../certificates'
import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import { providerPattern } from '../utils'

const { InputSpec, Value, Variants } = sdk

export const inputSpec = InputSpec.of({
  source: Value.union({
    name: i18n('Certificate source'),
    description: i18n(
      "Snikket serves its own TLS certificate, which must be valid for your domain and its groups. and share. subdomains. Let's Encrypt gives you a publicly trusted one (needed for federation and for the apps without extra setup); the StartOS certificate authority suits a LAN-only server whose devices trust this server's root; or paste a certificate you obtained elsewhere.",
    ),
    default: 'startos-ca',
    variants: Variants.of({
      letsencrypt: {
        name: i18n("Let's Encrypt (DNS-01)"),
        spec: InputSpec.of({
          provider: Value.text({
            name: i18n('DNS provider'),
            description: i18n(
              'The lego provider code for the DNS service hosting your domain, such as cloudflare, route53, cpanel, or desec. The full list is at https://go-acme.github.io/lego/dns/',
            ),
            required: true,
            default: null,
            placeholder: 'cloudflare',
            patterns: [
              {
                regex: providerPattern,
                description: i18n('Lowercase letters and digits only'),
              },
            ],
          }),
          credentials: Value.textarea({
            name: i18n('Provider credentials'),
            description: i18n(
              'One KEY=value per line, using the variable names the lego page for your provider lists (for example CLOUDFLARE_DNS_API_TOKEN=...). Stored on this server and passed to the ACME client only.',
            ),
            required: true,
            default: null,
            minRows: 3,
          }),
          staging: Value.toggle({
            name: i18n("Use Let's Encrypt staging"),
            description: i18n(
              'Issue from the staging environment while testing, so failed attempts do not count against the production rate limits. Staging certificates are not trusted by clients.',
            ),
            default: false,
          }),
        }),
      },
      'startos-ca': {
        name: i18n('StartOS certificate authority'),
        spec: InputSpec.of({}),
      },
      manual: {
        name: i18n('Paste a certificate'),
        spec: InputSpec.of({
          fullchain: Value.textarea({
            name: i18n('Certificate chain (PEM)'),
            description: i18n(
              'The certificate followed by its intermediates, covering the domain, groups.<domain>, and share.<domain>.',
            ),
            required: true,
            default: null,
            minRows: 6,
          }),
          privkey: Value.textarea({
            name: i18n('Private key (PEM)'),
            description: null,
            required: true,
            default: null,
            minRows: 6,
          }),
        }),
      },
    }),
  }),
})

export const configureCertificate = sdk.Action.withInput(
  'configure-certificate',

  async ({ effects }) => ({
    name: i18n('Configure Certificate'),
    description: i18n(
      'Choose where Snikket gets the TLS certificate it serves to apps, browsers, and other servers.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  inputSpec,

  async ({ effects }): Promise<T.DeepPartial<typeof inputSpec._TYPE>> => {
    const cfg = await storeJson.read((s) => s.certificate).once()
    if (cfg?.source === 'letsencrypt') {
      return {
        source: {
          selection: 'letsencrypt',
          value: {
            provider: cfg.letsencrypt.provider,
            credentials: cfg.letsencrypt.credentials,
            staging: cfg.letsencrypt.staging,
          },
        },
      }
    }
    if (cfg?.source === 'manual') {
      return { source: { selection: 'manual', value: {} } }
    }
    return { source: { selection: 'startos-ca', value: {} } }
  },

  async ({ effects, input }) => {
    const source = input.source
    switch (source.selection) {
      case 'letsencrypt': {
        parseEnvLines(source.value.credentials)
        await storeJson.merge(effects, {
          certificate: {
            source: 'letsencrypt',
            letsencrypt: {
              provider: source.value.provider.trim(),
              credentials: source.value.credentials,
              staging: source.value.staging,
            },
          },
        })
        return {
          version: '1',
          title: i18n("Let's Encrypt configured"),
          message: i18n(
            'The certificate is requested when Snikket starts and checked again within a minute while it runs. The Certificate health check reports the result.',
          ),
          result: null,
        }
      }
      case 'startos-ca': {
        await storeJson.merge(effects, {
          certificate: { source: 'startos-ca' },
        })
        return {
          version: '1',
          title: i18n('StartOS certificate authority selected'),
          message: i18n(
            "A certificate for your domain is minted from this server's own CA within a minute while Snikket runs, or at the next start. Devices must trust this server's root certificate to connect.",
          ),
          result: null,
        }
      }
      case 'manual': {
        const domain = await storeJson.read((s) => s.domain).once()
        if (!domain) {
          throw new Error(
            i18n(
              'Set the domain with the Configure action before pasting a certificate.',
            ),
          )
        }
        const bundle = bundleFromFullchain(
          source.value.fullchain,
          source.value.privkey,
        )
        const x = parseCert(bundle.cert)
        let key
        try {
          key = createPrivateKey(bundle.privkey)
        } catch {
          throw new Error(i18n('The private key could not be parsed.'))
        }
        if (!x.checkPrivateKey(key)) {
          throw new Error(
            i18n('The private key does not belong to the pasted certificate.'),
          )
        }
        const missing = uncovered(hostnamesOf(x), domain)
        if (missing.length) {
          throw new Error(
            i18n('The certificate does not cover: ${names}', {
              names: missing.join(', '),
            }),
          )
        }
        await applyBundle(domain, bundle, 'manual')
        await storeJson.merge(effects, { certificate: { source: 'manual' } })
        return {
          version: '1',
          title: i18n('Certificate installed'),
          message: i18n(
            'Snikket picks it up within a minute while running, or at the next start. Paste a renewed certificate here before this one expires.',
          ),
          result: {
            type: 'single',
            value: i18n('Valid until ${date}', { date: new Date(x.validTo) }),
            copyable: false,
            qr: false,
            masked: false,
          },
        }
      }
    }
  },
)
