import { i18n } from './i18n'
import { sdk } from './sdk'
import {
  c2sInterfaceId,
  c2sPort,
  hostId,
  s2sInterfaceId,
  s2sPort,
  webInterfaceId,
  webPort,
} from './utils'

export const setInterfaces = sdk.setupInterfaces(async ({ effects }) => {
  const multi = sdk.MultiHost.of(effects, hostId)

  // Passthrough: nginx inside the container serves the publicly trusted
  // certificate itself, so invite links and federation see the real one. A
  // public domain rides external 443 by SNI even though the package cannot
  // claim that port.
  const webOrigin = await multi.bindPort(webPort, {
    protocol: null,
    addSsl: null,
    preferredExternalPort: webPort,
    secure: { ssl: true },
  })
  const web = sdk.createInterface(effects, {
    name: i18n('Web Portal'),
    id: webInterfaceId,
    description: i18n(
      'Account management, invites, and file sharing, served over TLS by Snikket itself',
    ),
    type: 'ui',
    masked: false,
    schemeOverride: { ssl: 'https', noSsl: 'https' },
    username: null,
    path: '',
    query: {},
  })

  // Plain XMPP ports; STARTTLS happens inside the protocol.
  const c2sOrigin = await multi.bindPort(c2sPort, {
    protocol: null,
    addSsl: null,
    preferredExternalPort: c2sPort,
    secure: { ssl: false },
  })
  const c2s = sdk.createInterface(effects, {
    name: i18n('XMPP Clients'),
    id: c2sInterfaceId,
    description: i18n(
      'Where chat apps connect (the standard XMPP client port)',
    ),
    type: 'api',
    masked: false,
    schemeOverride: { ssl: 'xmpp', noSsl: 'xmpp' },
    username: null,
    path: '',
    query: {},
  })

  const s2sOrigin = await multi.bindPort(s2sPort, {
    protocol: null,
    addSsl: null,
    preferredExternalPort: s2sPort,
    secure: { ssl: false },
  })
  const s2s = sdk.createInterface(effects, {
    name: i18n('XMPP Federation'),
    id: s2sInterfaceId,
    description: i18n(
      'Where other XMPP servers connect to deliver messages to your users',
    ),
    type: 'api',
    masked: false,
    schemeOverride: { ssl: 'xmpp', noSsl: 'xmpp' },
    username: null,
    path: '',
    query: {},
  })

  return [
    await webOrigin.export([web]),
    await c2sOrigin.export([c2s]),
    await s2sOrigin.export([s2s]),
  ]
})
