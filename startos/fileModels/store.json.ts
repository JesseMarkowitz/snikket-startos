import { FileHelper, smtpShape, z } from '@start9labs/start-sdk'
import { sdk } from '../sdk'

export const certificateSources = [
  'unset',
  'letsencrypt',
  'startos-ca',
  'manual',
] as const
export type CertificateSource = (typeof certificateSources)[number]

const letsencryptShape = z.object({
  // A lego DNS provider code, e.g. `cloudflare`.
  provider: z.string().catch(''),
  // The provider's credentials, one KEY=VALUE per line, handed to lego as env.
  credentials: z.string().catch(''),
  staging: z.boolean().catch(false),
})

const certificateShape = z.object({
  source: z.enum(certificateSources).catch('unset'),
  letsencrypt: letsencryptShape.catch(() => letsencryptShape.parse({})),
})

const shape = z.object({
  // Permanent once set: Prosody keys every account and archive by it.
  domain: z.string().optional().catch(undefined),
  adminEmail: z.string().catch(''),
  siteName: z.string().catch(''),
  turnRelay: z.enum(['coturn', 'none']).catch('coturn'),
  // Signs the portal's sessions; generated once at install.
  webSecretKey: z.string().catch(''),
  certificate: certificateShape.catch(() => certificateShape.parse({})),
  smtp: smtpShape,
})

export const storeJson = FileHelper.json(
  { base: sdk.volumes.startos, subpath: 'store.json' },
  shape,
)
