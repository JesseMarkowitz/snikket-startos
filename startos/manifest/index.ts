import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'snikket',
  title: 'Snikket',
  // The server and proxy are Apache-2.0; the web portal is AGPL-3.0, the more
  // restrictive of the two, which is what a package of several images carries.
  license: 'AGPL-3.0',
  packageRepo: 'https://github.com/JesseMarkowitz/snikket-startos',
  upstreamRepo: 'https://github.com/snikket-im/snikket-server',
  marketingUrl: 'https://snikket.org/',
  donationUrl: 'https://snikket.org/donate/',
  description: { short, long },
  volumes: ['main', 'startos'],
  images: {
    // All three Snikket images publish coordinated `stable.<date>` tags.
    server: {
      source: { dockerTag: 'snikket/snikket-server:stable.20260611' },
      arch: ['x86_64', 'aarch64'],
    },
    proxy: {
      source: { dockerTag: 'snikket/snikket-web-proxy:stable.20260611' },
      arch: ['x86_64', 'aarch64'],
    },
    portal: {
      source: { dockerTag: 'snikket/snikket-web-portal:stable.20260611' },
      arch: ['x86_64', 'aarch64'],
    },
    // ACME client for the Let's Encrypt (DNS-01) certificate source.
    lego: {
      source: { dockerTag: 'goacme/lego:v5.5.1' },
      arch: ['x86_64', 'aarch64'],
    },
  },
  dependencies: {
    coturn: {
      description:
        'Relays voice and video calls for participants behind NAT or restrictive firewalls',
      optional: true,
      metadata: {
        title: 'Coturn',
        icon: 'https://raw.githubusercontent.com/Start9Labs/coturn-startos/d67ecaca5800a87e3300ce44c62484888f35d51b/icon.svg',
      },
    },
  },
})
