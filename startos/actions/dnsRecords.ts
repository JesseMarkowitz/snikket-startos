import { storeJson } from '../fileModels/store.json'
import { i18n } from '../i18n'
import { sdk } from '../sdk'
import {
  c2sPort,
  hostId,
  s2sPort,
  snikketHostnames,
  webInterfaceId,
  webPort,
} from '../utils'

export const dnsRecords = sdk.Action.withoutInput(
  'dns-records',

  async ({ effects }) => ({
    name: i18n('Show DNS Records'),
    description: i18n(
      'List the DNS records your domain needs so apps, browsers, and other servers find this Snikket.',
    ),
    warning: null,
    allowedStatuses: 'any',
    group: null,
    visibility: 'enabled',
  }),

  async ({ effects }) => {
    const domain = await storeJson.read((s) => s.domain).once()
    if (!domain) {
      throw new Error(i18n('Set the domain with the Configure action first.'))
    }
    const host = await sdk.host.getOwn(effects, hostId).once()
    const web = host?.bindings[webPort]?.interfaces[webInterfaceId]
    const publicIps =
      web?.addressInfo.public
        .filter({ kind: 'ip' })
        .hostnames.map((h) => h.hostname) ?? []
    const c2s = host?.bindings[c2sPort]?.net.assignedPort ?? c2sPort
    const s2s = host?.bindings[s2sPort]?.net.assignedPort ?? s2sPort
    const target = publicIps.length
      ? publicIps.join(' / ')
      : i18n("this server's public IP address")

    const addressRecords = snikketHostnames(domain)
      .map((name) => `${name}.  A/AAAA  ${target}`)
      .join('\n')
    const srvRecords = [
      `_xmpp-client._tcp.${domain}.  SRV  0 5 ${c2s} ${domain}.`,
      `_xmpp-server._tcp.${domain}.  SRV  0 5 ${s2s} ${domain}.`,
      `_xmpp-server._tcp.groups.${domain}.  SRV  0 5 ${s2s} ${domain}.`,
    ].join('\n')
    const standard = c2s === c2sPort && s2s === s2sPort

    return {
      version: '1',
      title: i18n('DNS records for ${domain}', { domain }),
      message: standard
        ? i18n(
            'The address records are required. The SRV records are optional because this server was given the standard XMPP ports.',
          )
        : i18n(
            'The address records are required, and so are the SRV records: this server was given non-standard XMPP ports, which apps and other servers only discover through SRV.',
          ),
      result: {
        type: 'group',
        value: [
          {
            type: 'single',
            name: i18n('Address records'),
            description: i18n(
              'All three names must resolve to this server. Add the domain to the Web Portal interface and enable it on the XMPP interfaces too.',
            ),
            value: addressRecords,
            copyable: true,
            qr: false,
            masked: false,
          },
          {
            type: 'single',
            name: i18n('SRV records'),
            // As strings: a number would be locale-formatted (5,222).
            description: i18n('Client port ${c2s}, federation port ${s2s}', {
              c2s: String(c2s),
              s2s: String(s2s),
            }),
            value: srvRecords,
            copyable: true,
            qr: false,
            masked: false,
          },
        ],
      },
    }
  },
)
