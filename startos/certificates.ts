import { X509Certificate } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { T } from '@start9labs/start-sdk'
import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { runtime } from './runtime'
import { sdk } from './sdk'
import {
  domainAscii,
  legoMountpoint,
  legoMounts,
  legoSubpath,
  letsencryptSubpath,
  renewBeforeDays,
  snikketHostnames,
} from './utils'

/**
 * The certificate subsystem. Whatever obtains a certificate, applying it is
 * one operation: write the four PEMs Snikket's nginx and Prosody read, then
 * tell both to reload. Three sources feed it — lego over DNS-01, the StartOS
 * certificate authority, and a certificate the user pastes.
 */

export type CertBundle = {
  cert: string
  chain: string
  fullchain: string
  privkey: string
}

export type InstalledCert = {
  serial: string
  issuer: string
  notAfter: Date
  daysLeft: number
  hostnames: string[]
  source: string
}

const pemBlock = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g

/** The directory upstream's nginx and `wait-for-certs` both read. */
export function liveDir(domain: string): string {
  return sdk.volumes.main.subpath(
    `${letsencryptSubpath}/live/${domainAscii(domain)}`,
  )
}

export function splitPem(pem: string): string[] {
  return (pem.match(pemBlock) ?? []).map((b) => b.trim() + '\n')
}

/** Leaf first, then the rest of the chain, as lego and most CAs hand it out. */
export function bundleFromFullchain(
  fullchain: string,
  privkey: string,
): CertBundle {
  const blocks = splitPem(fullchain)
  if (!blocks.length) {
    throw new Error(i18n('No certificate found in the PEM text.'))
  }
  const keyBlocks = splitPem(privkey)
  if (keyBlocks.length !== 1 || !/PRIVATE KEY-----/.test(keyBlocks[0])) {
    throw new Error(i18n('The private key must be exactly one PEM block.'))
  }
  return {
    cert: blocks[0],
    chain: blocks.slice(1).join(''),
    fullchain: blocks.join(''),
    privkey: keyBlocks[0],
  }
}

export function parseCert(pem: string): X509Certificate {
  return new X509Certificate(splitPem(pem)[0] ?? pem)
}

export function hostnamesOf(x: X509Certificate): string[] {
  return [...(x.subjectAltName ?? '').matchAll(/DNS:([^,\s]+)/g)].map((m) =>
    m[1].toLowerCase(),
  )
}

export async function readInstalled(
  domain: string,
): Promise<InstalledCert | null> {
  const dir = liveDir(domain)
  let pem: string
  try {
    pem = await readFile(`${dir}/fullchain.pem`, 'utf8')
  } catch {
    return null
  }
  const x = parseCert(pem)
  const notAfter = new Date(x.validTo)
  const source = await readFile(`${dir}/startos-source`, 'utf8')
    .then((s) => s.trim())
    .catch(() => 'unknown')
  return {
    serial: x.serialNumber,
    issuer: x.issuer.split('\n').join(', '),
    notAfter,
    daysLeft: Math.floor((notAfter.getTime() - Date.now()) / 86_400_000),
    hostnames: hostnamesOf(x),
    source,
  }
}

/** The names Snikket serves that the certificate does not cover. */
export function uncovered(hostnames: string[], domain: string): string[] {
  return snikketHostnames(domain).filter((name) => {
    if (hostnames.includes(name)) return false
    const parent = name.slice(name.indexOf('.') + 1)
    return !hostnames.includes(`*.${parent}`)
  })
}

/** Write the four PEMs as real files, 0600, owned by the package (root). */
export async function applyBundle(
  domain: string,
  bundle: CertBundle,
  source: string,
): Promise<void> {
  const dir = liveDir(domain)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const files: Record<string, string> = {
    'cert.pem': bundle.cert,
    'chain.pem': bundle.chain,
    'fullchain.pem': bundle.fullchain,
    'privkey.pem': bundle.privkey,
    'startos-source': source + '\n',
  }
  for (const [name, content] of Object.entries(files)) {
    const tmp = `${dir}/.${name}.tmp`
    await writeFile(tmp, content, { mode: 0o600 })
    await rename(tmp, `${dir}/${name}`)
  }
}

/** Tell the running nginx and Prosody to pick up what is on disk. */
export async function reloadConsumers(): Promise<void> {
  const subs = runtime.get()
  if (!subs) return
  await subs.proxy
    .exec(['/usr/sbin/nginx', '-s', 'reload'])
    .catch((e) => console.warn('nginx reload failed:', e))
  await subs.server
    .exec(['/etc/cron.daily/refresh-certs'], { user: 'root' })
    .catch((e) => console.warn('prosody cert import failed:', e))
}

/** Mint a certificate from the box's own CA, chained to its root. */
export async function mintStartosCa(
  effects: T.Effects,
  domain: string,
): Promise<CertBundle> {
  const hostnames = snikketHostnames(domain)
  const [leaf, intermediate, root] = await sdk
    .getSslCertificate(effects, hostnames)
    .once()
  const privkey = await sdk.getSslKey(effects, { hostnames })
  return bundleFromFullchain(leaf + intermediate + root, privkey)
}

/** `KEY=VALUE` lines to an env map; blank lines and `#` comments ignored. */
export function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    const key = eq < 0 ? '' : line.slice(0, eq).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(
        i18n(
          'Each credential line must look like KEY=value. Bad line: ${line}',
          {
            line,
          },
        ),
      )
    }
    let value = line.slice(eq + 1).trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    env[key] = value
  }
  if (!Object.keys(env).length) {
    throw new Error(i18n('At least one credential line is required.'))
  }
  return env
}

/** Obtain or renew through lego, then read what it wrote. */
export async function runLego(
  effects: T.Effects,
  opts: {
    domain: string
    email: string
    provider: string
    credentials: string
    staging: boolean
  },
): Promise<CertBundle> {
  const env = parseEnvLines(opts.credentials)
  const name = domainAscii(opts.domain)
  const args = [
    '/lego',
    'run',
    '--accept-tos',
    '--email',
    opts.email,
    '--dns',
    opts.provider,
    '--path',
    legoMountpoint,
    '--cert.name',
    name,
    '--renew-days',
    String(renewBeforeDays),
    '--no-random-sleep',
    '--log.format',
    'text',
    ...snikketHostnames(opts.domain).flatMap((h) => ['--domains', h]),
    ...(opts.staging ? ['--server', 'letsencrypt-staging'] : []),
  ]
  await sdk.SubContainer.withTemp(
    effects,
    { imageId: 'lego' },
    legoMounts,
    'lego',
    (sub) => sub.execFail(args, { env }, 15 * 60 * 1000),
  )
  const base = sdk.volumes.main.subpath(`${legoSubpath}/certificates/${name}`)
  const [crt, key] = await Promise.all([
    readFile(`${base}.crt`, 'utf8'),
    readFile(`${base}.key`, 'utf8'),
  ])
  return bundleFromFullchain(crt, key)
}

export type EnsureResult = 'unchanged' | 'renewed' | 'skipped'

/**
 * Make the installed certificate match the configured source: obtain one when
 * none is installed, the source changed, a name is missing, or renewal is due.
 */
export async function ensureCertificate(
  effects: T.Effects,
  domain: string,
): Promise<EnsureResult> {
  const store = await storeJson.read().once()
  const cfg = store?.certificate
  if (!cfg || cfg.source === 'unset' || cfg.source === 'manual')
    return 'skipped'

  const installed = await readInstalled(domain)
  const due =
    !installed ||
    installed.source !== cfg.source ||
    installed.daysLeft <= renewBeforeDays ||
    uncovered(installed.hostnames, domain).length > 0
  if (!due) return 'unchanged'

  const bundle =
    cfg.source === 'startos-ca'
      ? await mintStartosCa(effects, domain)
      : await runLego(effects, {
          domain,
          email: store.adminEmail,
          provider: cfg.letsencrypt.provider,
          credentials: cfg.letsencrypt.credentials,
          staging: cfg.letsencrypt.staging,
        })
  await applyBundle(domain, bundle, cfg.source)
  await reloadConsumers()
  return 'renewed'
}
