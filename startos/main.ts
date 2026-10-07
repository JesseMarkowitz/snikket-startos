import { mkdir, writeFile } from 'node:fs/promises'
import { smtpShape, T, z } from '@start9labs/start-sdk'
import type { HealthCheckResult } from '@start9labs/start-sdk/lib/health/checkFns'
import {
  ensureCertificate,
  readInstalled,
  reloadConsumers,
  uncovered,
} from './certificates'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { runtime } from './runtime'
import { sdk } from './sdk'
import {
  c2sPort,
  certificateTickMs,
  coturnHostId,
  coturnId,
  coturnMountpoint,
  coturnSecretPath,
  coturnTurnInterfaceId,
  hostId,
  legoSubpath,
  msmtpSubpath,
  prosodyUser,
  portalPort,
  renewalCheckIntervalMs,
  renewalRetryIntervalMs,
  snikketHostnames,
  snikketMountpoint,
  snikketMounts,
  webPort,
} from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting Snikket!'))

  const domain = await storeJson.read((s) => s.domain).const(effects)
  if (!domain) {
    throw new Error(
      'Snikket domain is not configured (run the Configure action)',
    )
  }
  const adminEmail =
    (await storeJson.read((s) => s.adminEmail).const(effects)) ?? ''
  const siteName =
    (await storeJson.read((s) => s.siteName).const(effects)) ?? ''
  const turnRelay = await storeJson.read((s) => s.turnRelay).const(effects)
  const webSecretKey =
    (await storeJson.read((s) => s.webSecretKey).const(effects)) ?? ''
  const smtp = await storeJson.read((s) => s.smtp).const(effects)

  // The certificate's SANs and the StartOS CA's willingness to sign them
  // both follow the domains attached to this host, so a change there
  // restarts the daemons and re-runs the certificate check at once.
  await sdk.host
    .getOwn(effects, hostId, (host) =>
      Object.keys(host?.publicDomains ?? {}).sort(),
    )
    .const()

  // Upstream renders msmtp's system config from an SMTP URL that its parser
  // cannot read back when the username contains '@' (every Gmail account) —
  // the password then lands in the log as part of a bogus hostname. The
  // package writes msmtp's *user* config instead, which msmtp prefers, under
  // the data volume where XDG_CONFIG_HOME (set on the server daemon) points.
  const smtpCreds = await resolveSmtp(effects, smtp)
  const msmtpDir = sdk.volumes.main.subpath(msmtpSubpath)
  await mkdir(msmtpDir, { recursive: true, mode: 0o700 })
  await writeFile(`${msmtpDir}/config`, msmtprc(smtpCreds), { mode: 0o600 })
  const turn = turnRelay === 'coturn' ? await resolveCoturn(effects) : null

  // lego wants its state directory to exist before it is mounted. The
  // certificate directory itself is created only when a certificate lands
  // in it (applyBundle): upstream's wait-for-certs treats the directory's
  // existence as "certificate present", and an empty one makes it exit and
  // be restarted by s6 every second.
  await mkdir(sdk.volumes.main.subpath(legoSubpath), { recursive: true })

  const serverSub = sdk.SubContainer.of(
    effects,
    { imageId: 'server' },
    snikketMounts,
    'server-sub',
  )
  const proxySub = sdk.SubContainer.of(
    effects,
    { imageId: 'proxy' },
    snikketMounts,
    'proxy-sub',
  )
  runtime.set({ server: serverSub, proxy: proxySub })

  const commonEnv = {
    SNIKKET_DOMAIN: domain,
    SNIKKET_ADMIN_EMAIL: adminEmail,
    ...(siteName ? { SNIKKET_SITE_NAME: siteName } : {}),
  }

  // What the certificate daemon last did, for its health check.
  const certState: { error: string | null; busy: boolean } = {
    error: null,
    busy: false,
  }

  return (
    sdk.Daemons.of(effects)
      .addDaemon('certificates', {
        subcontainer: null,
        exec: {
          fn: async (_: null, abort: AbortSignal) => {
            let lastSerial: string | null = null
            let nextRenewalCheck = 0
            while (!abort.aborted) {
              try {
                const installed = await readInstalled(domain)
                // A certificate that changed under us (pasted, or written by
                // a previous run) has to reach nginx and Prosody.
                if (lastSerial !== null && installed?.serial !== lastSerial) {
                  await reloadConsumers()
                }
                lastSerial = installed?.serial ?? null
                if (Date.now() >= nextRenewalCheck) {
                  certState.busy = true
                  await ensureCertificate(effects, domain)
                  nextRenewalCheck = Date.now() + renewalCheckIntervalMs
                  lastSerial = (await readInstalled(domain))?.serial ?? null
                  certState.error = null
                }
              } catch (e) {
                // The OS wraps RPC failures in a multi-line report with a
                // backtrace; the first line is the part a person can act on.
                certState.error = String(e instanceof Error ? e.message : e)
                  .split('\n')[0]
                  .trim()
                console.error('certificate maintenance failed:', e)
                // Soon enough that fixing the cause (attaching the domain,
                // correcting a token) takes effect, without hammering the CA.
                nextRenewalCheck = Date.now() + renewalRetryIntervalMs
              } finally {
                certState.busy = false
              }
              await sleep(certificateTickMs, abort)
            }
            return null
          },
        },
        ready: {
          display: i18n('Certificate'),
          gracePeriod: 5 * 60 * 1000,
          trigger: sdk.trigger.cooldownTrigger(60_000),
          fn: () => certificateHealth(domain, certState),
        },
        requires: [],
      })
      // msmtp refuses a user config it does not own, and the package writes
      // as root. (An id-mapped mount would avoid the chown, but the OS refuses
      // one here.)
      .addOneshot('msmtp-chown', {
        subcontainer: serverSub,
        exec: {
          command: [
            'chown',
            '-R',
            `${prosodyUser}:${prosodyUser}`,
            `${snikketMountpoint}/${msmtpSubpath}`,
          ],
          user: 'root',
        },
        requires: [],
      })
      .addDaemon('server', {
        subcontainer: serverSub,
        exec: {
          command: sdk.useEntrypoint(),
          // s6-svscan supervises Prosody and anacron and must be PID 1.
          runAsInit: true,
          env: {
            ...commonEnv,
            // Prosody 13's "modern" profile is TLS 1.3 only, which the iOS app
            // cannot negotiate on 5222; it hangs on a spinner while the web
            // portal keeps working. Intermediate allows TLS 1.2.
            SNIKKET_TLS_PROFILE: 'intermediate',
            // StartOS delivers updates; no DNS beacon to snikket.net.
            SNIKKET_UPDATE_CHECK: '0',
            SNIKKET_TWEAK_STORAGE: 'files',
            // The bundled coturn stays off; calls relay through the Coturn
            // service when configured, else directly.
            SNIKKET_TWEAK_TURNSERVER: '0',
            // Where msmtp finds the package's mail config (see above).
            XDG_CONFIG_HOME: snikketMountpoint,
            ...(turn
              ? {
                  SNIKKET_TWEAK_TURNSERVER_DOMAIN: turn.domain,
                  SNIKKET_TWEAK_TURNSERVER_PORT: String(turn.port),
                  SNIKKET_TWEAK_TURNSERVER_SECRET: turn.secret,
                }
              : {}),
          },
        },
        ready: {
          display: i18n('XMPP Server'),
          // Prosody does not listen until a certificate is on disk.
          gracePeriod: 5 * 60 * 1000,
          fn: () =>
            sdk.healthCheck.checkPortListening(effects, c2sPort, {
              successMessage: i18n('Prosody is accepting XMPP connections'),
              errorMessage: i18n(
                'Prosody is not listening yet; it waits for a certificate',
              ),
            }),
        },
        requires: ['msmtp-chown'],
      })
      .addDaemon('portal', {
        subcontainer: sdk.SubContainer.of(
          effects,
          { imageId: 'portal' },
          null,
          'portal-sub',
        ),
        exec: {
          command: sdk.useEntrypoint(),
          env: {
            ...commonEnv,
            SNIKKET_WEB_SECRET_KEY: webSecretKey,
          },
        },
        ready: {
          display: i18n('Web Portal'),
          fn: () =>
            sdk.healthCheck.checkPortListening(effects, portalPort, {
              successMessage: i18n('The web portal is ready'),
              errorMessage: i18n('The web portal is not ready'),
            }),
        },
        requires: ['server'],
      })
      .addDaemon('proxy', {
        subcontainer: proxySub,
        exec: {
          command: sdk.useEntrypoint(),
          // tini then s6-svscan; must be PID 1.
          runAsInit: true,
          env: {
            ...commonEnv,
            // Port 80 is unreachable behind StartOS, so render only the TLS
            // vhosts. (Upstream's docs spell this _PROTOCOLS; the code reads
            // _PROTOS.)
            SNIKKET_TWEAK_WEB_PROXY_PROTOS: 'https',
            // Upstream proxies to `localhost`, which nginx resolves to ::1
            // first; the portal listens on 127.0.0.1 only, so every request
            // logged a refused IPv6 attempt before falling back.
            SNIKKET_TWEAK_INTERNAL_HTTP_HOST: '127.0.0.1',
            SNIKKET_TWEAK_PORTAL_INTERNAL_HTTP_HOST: '127.0.0.1',
          },
        },
        ready: {
          display: i18n('Web Interface'),
          // nginx serves 443 only once a certificate exists.
          gracePeriod: 5 * 60 * 1000,
          fn: () =>
            sdk.healthCheck.checkPortListening(effects, webPort, {
              successMessage: i18n('The web interface is ready'),
              errorMessage: i18n(
                'The web interface is not serving yet; it waits for a certificate',
              ),
            }),
        },
        requires: ['portal'],
      })
      .addHealthCheck('domain', {
        ready: {
          display: i18n('Public Domain'),
          trigger: sdk.trigger.cooldownTrigger(30_000),
          fn: () => domainHealth(effects, domain),
        },
        requires: [],
      })
  )
})

function sleep(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (abort.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      abort.removeEventListener('abort', done)
      resolve()
    }
    abort.addEventListener('abort', done, { once: true })
  })
}

async function certificateHealth(
  domain: string,
  state: { error: string | null; busy: boolean },
): Promise<HealthCheckResult> {
  const source = await storeJson.read((s) => s.certificate.source).once()
  const installed = await readInstalled(domain)
  if (!installed) {
    if (source === 'unset' || !source) {
      return {
        result: 'failure',
        message: i18n(
          'No certificate source is configured. Run Configure Certificate.',
        ),
      }
    }
    if (state.busy) {
      return { result: 'starting', message: i18n('Obtaining a certificate…') }
    }
    if (state.error) {
      return {
        result: 'failure',
        message: i18n('Could not obtain a certificate: ${error}', {
          error: state.error,
        }),
      }
    }
    return {
      result: 'failure',
      message:
        source === 'manual'
          ? i18n(
              'No certificate is installed. Paste one with Configure Certificate.',
            )
          : i18n('No certificate is installed yet.'),
    }
  }
  const missing = uncovered(installed.hostnames, domain)
  if (missing.length) {
    return {
      result: 'failure',
      message: i18n(
        'The installed certificate does not cover ${names}; apps and other servers will reject it.',
        { names: missing.join(', ') },
      ),
    }
  }
  if (installed.daysLeft < 0) {
    return {
      result: 'failure',
      message: i18n('The certificate expired on ${date}.', {
        date: installed.notAfter,
      }),
    }
  }
  if (state.error) {
    return {
      result: 'failure',
      message: i18n(
        'Renewal failed (${error}); the current certificate expires on ${date}.',
        { error: state.error, date: installed.notAfter },
      ),
    }
  }
  return {
    result: 'success',
    message: i18n('Valid until ${date}, issued by ${issuer}', {
      date: installed.notAfter,
      issuer: installed.issuer,
    }),
  }
}

/**
 * The guard against the one change that looks like total data loss: Prosody
 * keys everything by hostname, so a domain that no longer points here boots
 * into what looks like an empty server.
 */
async function domainHealth(
  effects: T.Effects,
  domain: string,
): Promise<HealthCheckResult> {
  const host = await sdk.host.getOwn(effects, hostId).once()
  const attached = Object.keys(host?.publicDomains ?? {})
  const required = snikketHostnames(domain)
  const missing = required.filter((n) => !attached.includes(n))
  if (!attached.length) {
    return {
      result: 'disabled',
      message: i18n(
        'No public domain is attached. Only devices that resolve ${domain} to this server themselves can connect.',
        { domain },
      ),
    }
  }
  if (!missing.length) {
    return {
      result: 'success',
      message: i18n('${domain} and its groups. and share. names are attached', {
        domain,
      }),
    }
  }
  if (missing.length === required.length) {
    return {
      result: 'failure',
      message: i18n(
        'The attached domains do not include ${domain}, the one this server was set up on. Your accounts and history are intact under it: attach ${domain} again rather than starting over on another name.',
        { domain },
      ),
    }
  }
  return {
    result: 'failure',
    message: i18n(
      'Attach these names to the Web Portal interface too: ${names}',
      {
        names: missing.join(', '),
      },
    ),
  }
}

/** The SMTP credentials the user selected, or null when email is off. */
async function resolveSmtp(
  effects: T.Effects,
  smtp: z.infer<typeof smtpShape> | null | undefined,
): Promise<T.SmtpValue | null> {
  if (smtp?.selection === 'system') {
    const creds = await sdk.getSystemSmtp(effects).const()
    if (creds && smtp.value.customFrom) creds.from = smtp.value.customFrom
    return creds
  }
  if (smtp?.selection === 'custom') {
    const { host, from, username, password, security } =
      smtp.value.provider.value
    return {
      host,
      port: Number(security.value.port),
      from,
      username,
      password: password ?? null,
      security: security.selection,
    }
  }
  return null
}

/**
 * msmtp's config, in the shape upstream's `smtp-url-to-msmtp` renders. With
 * email off it points at the same unreachable local sink upstream defaults
 * to, so Prosody's mail attempts fail quietly instead of going anywhere.
 */
function msmtprc(creds: T.SmtpValue | null): string {
  const quote = (v: string) =>
    `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  if (!creds) {
    return [
      'account default',
      'host localhost',
      'port 1025',
      'tls off',
      '',
    ].join('\n')
  }
  return [
    'account default',
    `host ${quote(creds.host)}`,
    `port ${creds.port}`,
    'tls on',
    'tls_trust_file /etc/ssl/certs/ca-certificates.crt',
    ...(creds.security === 'tls' ? ['tls_starttls off'] : []),
    ...(creds.username ? ['auth on', `user ${quote(creds.username)}`] : []),
    ...(creds.password ? [`password ${quote(creds.password)}`] : []),
    `from ${quote(creds.from)}`,
    '',
  ].join('\n')
}

type CoturnTurn = { domain: string; port: number; secret: string }

/**
 * The Coturn package's public TURN endpoint and its shared secret, or null
 * when Coturn is absent, has no public domain yet, or its secret cannot be
 * read. Mirrors jitsi-startos: the secret is read through Coturn's `shared`
 * subpath only, read-only, in a throwaway container.
 */
async function resolveCoturn(effects: T.Effects): Promise<CoturnTurn | null> {
  const endpoint = await sdk.host
    .get(effects, { hostId: coturnHostId, packageId: coturnId }, (host) => {
      const iface =
        host &&
        Object.values(host.bindings)
          .flatMap((b) => Object.values(b.interfaces))
          .find((i) => i.id === coturnTurnInterfaceId)
      const domains = iface
        ? iface.addressInfo
            .filter({ visibility: 'public', kind: 'domain' })
            .hostnames.filter((h) => h.port != null && !h.ssl)
        : []
      const first = domains[0]
      return first ? { domain: first.hostname, port: first.port! } : null
    })
    .const()
  if (!endpoint) return null

  const secret = await sdk.SubContainer.withTemp(
    effects,
    { imageId: 'server' },
    sdk.Mounts.of().mountDependency({
      dependencyId: coturnId,
      volumeId: 'main',
      subpath: 'shared',
      mountpoint: coturnMountpoint,
      readonly: true,
    }),
    'coturn-secret-read',
    async (sub) => {
      const res = await sub.exec(['cat', coturnSecretPath])
      return res.exitCode === 0 ? String(res.stdout).trim() : ''
    },
  ).catch(() => '')
  return secret ? { ...endpoint, secret } : null
}
